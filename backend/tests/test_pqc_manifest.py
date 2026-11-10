from dataclasses import replace

import cbor2
import pytest

from app.services import pqc_manifest as pm
from app.services.pqc_jumbf import content_box, superbox
from app.services.pqc_source import SourceManifest, PqcSourceError, child_map


def source_fixture():
    raw_assertions = [
        ("c2pa.actions.v2", pm.assertion("c2pa.actions.v2", {"actions": [{"action": "c2pa.created"}]})),
        ("org.example.caption", pm.assertion("org.example.caption", {"caption": "source caption"})),
    ]
    claim = pm.encode({"alg": "sha256"})
    cose = pm.encode(cbor2.CBORTag(18, [pm.encode({1: -7, 33: [b"certificate"]}), {}, None, b"signature"]))
    manifest = superbox("urn:c2pa:source", b"c2ma", [
        superbox("c2pa.assertions", b"c2as", [raw for _, raw in raw_assertions]),
        superbox("c2pa.claim.v2", b"c2cl", [content_box(b"cbor", claim)]),
        superbox("c2pa.signature", b"c2cs", [content_box(b"cbor", cose)]),
    ])
    store = superbox("c2pa", b"c2pa", [manifest])
    return SourceManifest("urn:c2pa:source", store, manifest, claim, cose,
                          b"signature", (b"certificate",), (), tuple(raw_assertions),
                          {"activeManifest": {"success": [], "informational": [], "failure": []}})


def artifact(source=None):
    return pm.assemble(source or source_fixture(),
                       {"alg": "io.iscc.v0", "blocks": [{"scope": {}, "value": b"test"}]},
                       {"alg": "sha3-256", "hash": b"x" * 32, "exclusions": [], "pad": b""},
                       lambda claim: pm.encode(cbor2.CBORTag(18, [b"", {}, None, b"fake"])))


def rewrite_claim(raw, mutate):
    store = pm.one_box(raw)
    manifests = child_map(store)
    name, active = list(manifests.items())[-1]
    children = child_map(active)
    claim, _ = pm.strict_cbor(children["c2pa.claim.v2"])
    mutate(claim)
    children["c2pa.claim.v2"] = pm.one_box(superbox("c2pa.claim.v2", b"c2cl", [content_box(b"cbor", pm.encode(claim))]))
    rebuilt = superbox(name, b"c2ma", [b.raw for b in children.values()])
    return superbox("c2pa", b"c2pa", [b.raw for b in list(manifests.values())[:-1]] + [rebuilt])


def test_actual_jumbf_store_preserves_all_source_bytes():
    source = source_fixture()
    raw = artifact(source)
    result = pm.inspect(raw)
    assert raw[4:8] == b"jumb"
    assert result["evidence"]["manifest_store_raw"] == source.store_raw
    assert result["evidence"]["claim_raw"] == source.claim_raw
    assert result["evidence"]["cose_sign1_raw"] == source.cose_raw
    claim = cbor2.loads(result["claim_raw"])
    assert claim["signature"] == "self#jumbf=c2pa.signature"
    assert all("url" in r and "hash" in r for r in claim["created_assertions"])
    assert len(claim["gathered_assertions"]) == 1  # historical actions preserved in evidence


@pytest.mark.parametrize("mutation", [
    lambda c: c.update(signature="self#jumbf=/c2pa/urn:c2pa:source/c2pa.signature"),
    lambda c: c.update(alg="sha256"),
    lambda c: c["created_assertions"].pop(),
    lambda c: c["created_assertions"].append(c["created_assertions"][0]),
    lambda c: c["created_assertions"][0].update(hash=b"x" * 32),
    lambda c: c["created_assertions"][0].update(url="self#jumbf=c2pa.assertions/missing"),
    lambda c: c.update(gathered_assertions=[]),
])
def test_invalid_claim_references_rejected(mutation):
    with pytest.raises(PqcSourceError):
        pm.inspect(rewrite_claim(artifact(), mutation))


def test_modified_source_history_rejected():
    raw = artifact()
    offset = raw.index(b"source caption")
    with pytest.raises(PqcSourceError, match="history modified"):
        pm.inspect(raw[:offset] + b"S" + raw[offset + 1:])


def test_truncated_and_appended_store_rejected():
    raw = artifact()
    for bad in (raw[:-1], raw + b"\x00", raw + raw):
        with pytest.raises(PqcSourceError):
            pm.inspect(bad)


def test_history_with_multiple_manifests_preserved():
    source = source_fixture()
    older = superbox("urn:c2pa:older", b"c2ma", [])
    source = replace(source, store_raw=superbox("c2pa", b"c2pa", [older, source.manifest_raw]))
    parsed = pm.inspect(artifact(source))
    assert len(parsed["source_manifests"]) == 2
