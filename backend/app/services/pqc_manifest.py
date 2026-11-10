"""Detached C2PA JUMBF layout with an explicitly experimental PQ profile.

Structure: C2PA 2.3 sections 8, 10, 15 and ingredient v3. Algorithm
extensions: SHA3-256 hashed URIs/data binding and ML-DSA-65 COSE signing.
Classic evidence remains byte-exact and is validated by the official SDK.
This is not a claim of C2PA conformance certification.
"""
from __future__ import annotations

import io
import json
import uuid
from collections.abc import Mapping

import cbor2

from app.services.pqc_jumbf import (
    content_box, hash_superbox, require_type, resolve_uri, superbox, verify_reference,
)
from app.services.pqc_source import (
    PqcSourceError, boxes, cbor_payload, child_map, decode_cose, label_of, manifest_map,
)

PROFILE = "pq-c2pa-jumbf-1"
ALGORITHM = "sha3-256"
EVIDENCE = "org.pq-c2pa.source-evidence"
INGREDIENT = "c2pa.ingredient.v3"
HARD_BINDINGS = {"c2pa.hash.data", "c2pa.hash.boxes", "c2pa.hash.collection.data",
                 "c2pa.hash.bmff", "c2pa.hash.bmff.v2", "c2pa.hash.bmff.v3"}


def copy_as_gathered(label):
    # Actions/ingredients describe M0's creation and parents, not P1's. They
    # remain byte-exact in evidence; promoting them creates duplicate opened /
    # created actions or multiple parentOf ingredients (spec 15.10.1.2).
    base = label.split("__", 1)[0]
    return (base not in HARD_BINDINGS | {"c2pa.soft-binding"}
            and not base.startswith(("c2pa.actions", "c2pa.ingredient")))


def encode(value):
    return cbor2.dumps(value, canonical=True)


def one_box(raw):
    parsed = boxes(raw)
    if len(parsed) != 1 or parsed[0].kind != b"jumb":
        raise PqcSourceError("Expected exactly one JUMBF superbox")
    return parsed[0]


def strict_cbor(box):
    contents = [b for b in boxes(box.payload) if b.kind == b"cbor"]
    if len(contents) != 1:
        raise PqcSourceError("Missing or duplicate CBOR content")
    raw = contents[0].payload
    value = cbor2.loads(raw)
    if encode(value) != raw:
        raise PqcSourceError("Non-deterministic CBOR, duplicate key or trailing bytes")
    return value, raw


def assertion(label, value):
    return superbox(label, b"cbor", [content_box(b"cbor", encode(value))])


def reference(raw, url):
    return {"url": url, "alg": ALGORITHM, "hash": hash_superbox(one_box(raw), ALGORITHM)}


def local_ref(raw):
    return reference(raw, "self#jumbf=c2pa.assertions/" + label_of(one_box(raw)))


def assemble(source, fingerprint_data, hard_binding, sign):
    """Preserve all M0 history; add a last/active P1 standard manifest box."""
    original = one_box(source.store_raw)
    require_type(original, b"c2pa")
    source_boxes = manifest_map(source.store_raw)
    source_box = source_boxes[source.manifest_id]
    source_children = child_map(source_box)
    gathered = []
    for label, raw in source.assertions:
        if not copy_as_gathered(label):
            continue
        gathered.append(raw)
    evidence = assertion(EVIDENCE, {
        "profile": PROFILE,
        "manifest_id": source.manifest_id,
        "manifest_store_raw": source.store_raw,
        "manifest_raw": source.manifest_raw,
        "claim_raw": source.claim_raw,
        "cose_sign1_raw": source.cose_raw,
        "signature_raw": source.signature_raw,
        "x5chain": list(source.certificate_chain),
        "timestamp_tokens": list(source.timestamps),
        "assertions_raw": [{"label": label, "jumbf": raw} for label, raw in source.assertions],
    })
    # Unique labels also when the source already contains an ingredient v3.
    used = {label_of(one_box(raw)) for raw in gathered}
    ingredient_label = INGREDIENT
    index = 1
    while ingredient_label in used:
        ingredient_label = f"{INGREDIENT}__{index}"
        index += 1
    ingredient = assertion(ingredient_label, {
        "relationship": "parentOf",
        "validationResults": source.validation_results,
        "activeManifest": reference(source_box.raw, f"self#jumbf=/c2pa/{source.manifest_id}"),
        "claimSignature": reference(source_children["c2pa.signature"].raw,
                                    f"self#jumbf=/c2pa/{source.manifest_id}/c2pa.signature"),
    })
    actions = assertion("c2pa.actions.v2", {"actions": [
        {"action": "c2pa.opened", "parameters": {"ingredients": [local_ref(ingredient)]}},
        {"action": "c2pa.repackaged"},
    ]})
    # Source action bytes remain gathered. Our new actions need their own label.
    if "c2pa.actions.v2" in used:
        i = 1
        while f"c2pa.actions.v2__{i}" in used:
            i += 1
        actions = assertion(f"c2pa.actions.v2__{i}", cbor2.loads(cbor_payload(one_box(actions))))
    created = [evidence, ingredient, actions,
               assertion("c2pa.soft-binding", fingerprint_data),
               assertion("c2pa.hash.data", hard_binding)]
    labels = [label_of(one_box(raw)) for raw in gathered + created]
    if len(set(labels)) != len(labels):
        raise PqcSourceError("Source collides with reserved PQ assertion label")
    claim = {
        "instanceID": f"xmp:iid:{uuid.uuid4()}",
        "claim_generator_info": {"name": "PQ-C2PA Framework", "version": "1",
                                 "org.pq-c2pa.profile": PROFILE},
        "signature": "self#jumbf=c2pa.signature",
        "created_assertions": [local_ref(raw) for raw in created],
        "alg": ALGORITHM,
    }
    if gathered:
        claim["gathered_assertions"] = [local_ref(raw) for raw in gathered]
    claim_raw = encode(claim)
    manifest_id = f"urn:c2pa:{uuid.uuid4()}"
    children = [superbox("c2pa.assertions", b"c2as", gathered + created),
                superbox("c2pa.claim.v2", b"c2cl", [content_box(b"cbor", claim_raw)]),
                superbox("c2pa.signature", b"c2cs", [content_box(b"cbor", sign(claim_raw))])]
    # Keep source data/credential stores for copied assertion references.
    children.extend(box.raw for name, box in source_children.items()
                    if name not in {"c2pa.assertions", "c2pa.claim", "c2pa.claim.v2", "c2pa.signature"})
    p1 = superbox(manifest_id, b"c2ma", children)
    return superbox("c2pa", b"c2pa", [box.raw for box in boxes(original.payload)
                                      if box.kind != b"jumd"] + [p1])


def _walk_refs(value, store, manifest, default_alg):
    if isinstance(value, Mapping):
        if "url" in value and "hash" in value:
            verify_reference(store, manifest, dict(value), default_alg)
        for child in value.values():
            _walk_refs(child, store, manifest, value.get("alg", default_alg))
    elif isinstance(value, (list, tuple)):
        for child in value:
            _walk_refs(child, store, manifest, default_alg)


def inspect(raw):
    """Validate structure and references before any certificate or asset IO."""
    store = one_box(raw)
    require_type(store, b"c2pa")
    if label_of(store) != "c2pa":
        raise PqcSourceError("Manifest store label must be c2pa")
    manifests = child_map(store)
    if len(manifests) < 2:
        raise PqcSourceError("P1 must retain its source manifest")
    manifest_id, manifest = list(manifests.items())[-1]
    require_type(manifest, b"c2ma")
    children = child_map(manifest)
    if "c2pa.claim" in children:
        raise PqcSourceError("Multiple or legacy P1 claims")
    claim_box = children["c2pa.claim.v2"]
    require_type(claim_box, b"c2cl")
    claim, claim_raw = strict_cbor(claim_box)
    if (not isinstance(claim, dict) or claim.get("alg") != ALGORITHM
            or not isinstance(claim.get("instanceID"), str) or not claim["instanceID"]
            or not isinstance(claim.get("claim_generator_info"), dict)
            or not claim["claim_generator_info"].get("name")
            or claim["claim_generator_info"].get("org.pq-c2pa.profile") != PROFILE):
        raise PqcSourceError("claim.malformed")
    if claim.get("signature") != "self#jumbf=c2pa.signature":
        raise PqcSourceError("claimSignature.missing")
    signature_box = resolve_uri(store, manifest, claim["signature"])
    require_type(signature_box, b"c2cs")
    _, signature_raw = strict_cbor(signature_box)
    assertions = children["c2pa.assertions"]
    require_type(assertions, b"c2as")
    assertion_boxes = child_map(assertions)
    created, gathered = claim.get("created_assertions"), claim.get("gathered_assertions", [])
    if not isinstance(created, list) or not created or not isinstance(gathered, list):
        raise PqcSourceError("claim.malformed: assertion lists")
    declared = set()
    for ref in created + gathered:
        if not isinstance(ref, dict) or ref.get("alg", ALGORITHM) != ALGORITHM:
            raise PqcSourceError("Unsupported P1 reference algorithm")
        target = verify_reference(store, manifest, ref, ALGORITHM)
        label = label_of(target)
        if ref["url"] != "self#jumbf=c2pa.assertions/" + str(label):
            raise PqcSourceError("assertion.outsideManifest")
        if label in declared or assertion_boxes.get(label) != target:
            raise PqcSourceError("Duplicate or missing assertion")
        declared.add(label)
    if declared != set(assertion_boxes):
        raise PqcSourceError("assertion.undeclared")
    evidence, _ = strict_cbor(assertion_boxes[EVIDENCE])
    if not isinstance(evidence, dict) or evidence.get("profile") != PROFILE:
        raise PqcSourceError("Missing source evidence profile")
    original_store = one_box(evidence["manifest_store_raw"])
    require_type(original_store, b"c2pa")
    original_manifests = child_map(original_store)
    if set(manifests) != set(original_manifests) | {manifest_id}:
        raise PqcSourceError("Uncommitted or missing source history")
    for name, original in original_manifests.items():
        if manifests[name].raw != original.raw:
            raise PqcSourceError("Source history modified")
    source_id = evidence["manifest_id"]
    source = original_manifests[source_id]
    source_children = child_map(source)
    source_claims = [box for name, box in source_children.items()
                     if name in {"c2pa.claim", "c2pa.claim.v2"}]
    if len(source_claims) != 1:
        raise PqcSourceError("Source claim missing/multiple")
    source_cose = cbor_payload(source_children["c2pa.signature"])
    protected, unprotected, _, sig = decode_cose(source_cose)
    chain = protected.get(33, unprotected.get(33))
    if isinstance(chain, bytes):
        chain = [chain]
    from app.services.pqc_source import _timestamp_tokens
    if (evidence["manifest_raw"] != source.raw
            or evidence["claim_raw"] != cbor_payload(source_claims[0])
            or evidence["cose_sign1_raw"] != source_cose
            or evidence["signature_raw"] != sig
            or evidence["x5chain"] != list(chain)
            or evidence["timestamp_tokens"] != list(_timestamp_tokens(unprotected))):
        raise PqcSourceError("Source evidence inconsistent with original bytes")
    source_assertions = child_map(source_children["c2pa.assertions"])
    if evidence.get("assertions_raw") != [{"label": name, "jumbf": box.raw}
                                          for name, box in source_assertions.items()]:
        raise PqcSourceError("Source assertion evidence is incomplete")
    expected_copies = {name: box for name, box in source_assertions.items()
                       if copy_as_gathered(name)}
    gathered_labels = {label_of(resolve_uri(store, manifest, ref["url"])) for ref in gathered}
    if gathered_labels != set(expected_copies):
        raise PqcSourceError("Source assertions omitted or replaced")
    for name, box in expected_copies.items():
        if assertion_boxes[name].raw != box.raw:
            raise PqcSourceError("Copied assertion bytes changed")
    parents = []
    opening_actions = []
    for name, box in assertion_boxes.items():
        data_boxes = [b for b in boxes(box.payload) if b.kind in {b"cbor", b"json"}]
        if not data_boxes:
            continue  # Embedded binary assertions are protected by hashed URI.
        if len(data_boxes) != 1:
            raise PqcSourceError("Assertion has ambiguous content")
        data = data_boxes[0]
        if data.kind == b"cbor":
            stream = io.BytesIO(data.payload)
            value = cbor2.CBORDecoder(stream).decode()
            if stream.tell() != len(data.payload):
                raise PqcSourceError("Trailing assertion CBOR")
        else:
            value = json.loads(data.payload)
        # Gathered bytes retain original provenance; relative hashed references
        # must resolve to identical bytes in P1, never silently change target.
        default_alg = cbor2.loads(evidence["claim_raw"]).get("alg", "sha256") if name in gathered_labels else ALGORITHM
        _walk_refs(value, store, manifest, default_alg)
        if name.startswith("c2pa.actions"):
            if not isinstance(value, dict) or not isinstance(value.get("actions"), list) or not value["actions"]:
                raise PqcSourceError("assertion.action.malformed")
            for index, action in enumerate(value["actions"]):
                if not isinstance(action, dict) or not isinstance(action.get("action"), str):
                    raise PqcSourceError("assertion.action.malformed")
                if action["action"] in {"c2pa.created", "c2pa.opened"}:
                    if index != 0:
                        raise PqcSourceError("assertion.action.malformed")
                    opening_actions.append(action)
        if name.startswith("c2pa.ingredient") and isinstance(value, dict):
            if value.get("relationship") == "parentOf":
                parents.append((name, value))
    if len(parents) != 1:
        raise PqcSourceError("manifest.multipleParents: cannot copy parent ingredients without changing their semantics")
    parent = parents[0][1]
    results = parent.get("validationResults")
    if not isinstance(results, dict) or not isinstance(results.get("activeManifest"), dict):
        raise PqcSourceError("Ingredient v3 requires source validation results")
    if len(opening_actions) != 1 or opening_actions[0]["action"] != "c2pa.opened":
        raise PqcSourceError("P1 requires exactly one opening action")
    action_refs = opening_actions[0].get("parameters", {}).get("ingredients", [])
    if len(action_refs) != 1 or verify_reference(store, manifest, action_refs[0], ALGORITHM) != assertion_boxes[parents[0][0]]:
        raise PqcSourceError("Opening action does not reference P1 parent ingredient")
    if (verify_reference(store, manifest, parent["activeManifest"], ALGORITHM).raw != source.raw
            or verify_reference(store, manifest, parent["claimSignature"], ALGORITHM).raw != source_children["c2pa.signature"].raw):
        raise PqcSourceError("Ingredient does not reference M0")
    hard = [name for name in assertion_boxes if name.split("__", 1)[0] in HARD_BINDINGS]
    if hard != ["c2pa.hash.data"]:
        raise PqcSourceError("claim.hardBindings.missing or assertion.multipleHardBindings")
    binding, _ = strict_cbor(assertion_boxes["c2pa.hash.data"])
    if (not isinstance(binding, dict) or binding.get("alg") != ALGORITHM
            or not isinstance(binding.get("hash"), bytes) or len(binding["hash"]) != 32
            or not isinstance(binding.get("pad"), bytes)
            or not isinstance(binding.get("exclusions"), list)):
        raise PqcSourceError("assertion.dataHash.malformed")
    for exclusion in binding["exclusions"]:
        if (not isinstance(exclusion, dict)
                or type(exclusion.get("start")) is not int
                or type(exclusion.get("length")) is not int
                or exclusion["start"] < 0 or exclusion["length"] <= 0):
            raise PqcSourceError("assertion.dataHash.malformed: exclusion")
    soft, _ = strict_cbor(assertion_boxes["c2pa.soft-binding"])
    return {"claim_raw": claim_raw, "signature_raw": signature_raw,
            "hard_binding": binding, "soft_binding": soft, "evidence": evidence,
            "manifest_id": manifest_id, "source_manifests": original_manifests}
