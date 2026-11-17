from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services.pqc2pa import PqcBuildError, build_p1
from app.services.source_timestamp import SourceTimestampEvidence, SourceTimestampState


def test_existing_fingerprint_gets_sigtst2_before_p1(tmp_path: Path):
    original = tmp_path / "input.png"
    original.write_bytes(b"original")
    classic = tmp_path / "classic.png"
    p1 = tmp_path / "p1.jumbf"
    missing = SimpleNamespace(state=SourceTimestampState.MISSING)
    issued = SimpleNamespace(token=b"rfc3161", state=SourceTimestampState.ISSUED)
    attached = SourceTimestampEvidence(
        state=SourceTimestampState.EXISTING,
        manifest_id="m0",
        timestamp_kind="sigTst2",
        token=b"rfc3161",
        signature=b"signature",
        cose_sign1=b"cose",
        validated=True,
        trusted=True,
        validation_codes=(),
    )
    source_before = SimpleNamespace(signature_raw=b"signature", manifest_id="m0")
    source_after = SimpleNamespace(manifest_id="m0", timestamps=(b"rfc3161",))
    fingerprint = SimpleNamespace(
        value=b"fingerprint", value_base64="encoded",
        assertion_definition=lambda: {"data": {"blocks": [{}]}},
    )
    prepared = SimpleNamespace(
        mode="REUSE_EXISTING", active_manifest="m0", fingerprint=fingerprint,
    )

    def attach(args, **_kwargs):
        assert args[1] == "attach-timestamp"
        assert Path(args[args.index("--token") + 1]).read_bytes() == b"rfc3161"
        Path(args[args.index("--output") + 1]).write_bytes(b"timestamped")
        return SimpleNamespace(returncode=0)

    def assemble(source, _fingerprint, _binding, _signer, _timestamp):
        assert source is source_after
        assert _timestamp["token"] == b"rfc3161"
        return b"p1"

    with (
        patch("app.services.pqc2pa.extract_source", side_effect=[source_before, source_after]) as extract,
        patch("app.services.pqc2pa.inspect_source_timestamp", side_effect=[missing, attached]),
        patch("app.services.pqc2pa.ensure_source_timestamp", return_value=issued),
        patch("app.services.pqc2pa.prepare_classic_for_pq", return_value=prepared) as prepare,
        patch("app.services.pqc2pa.subprocess.run", side_effect=attach),
        patch("app.services.pqc2pa.pqc_manifest.assemble", side_effect=assemble),
        patch("app.services.pqc2pa.make_hard_binding", return_value={}),
        patch("app.services.pqc2pa.make_cose_signature"),
        patch("app.services.pqc2pa.verify_p1", return_value={}),
        patch("app.services.pqc2pa.settings") as settings,
    ):
        settings.tsa_private_key_path.is_file.return_value = True
        settings.tsa_certificate_path.is_file.return_value = True
        settings.tsa_config_path.is_file.return_value = True
        settings.tsa_private_key_passphrase.get_secret_value.return_value = "configured"
        result = build_p1(original, classic, p1)

    assert result["classic_action"] == "REUSE_EXISTING"
    assert classic.read_bytes() == b"timestamped"
    assert p1.read_bytes() == b"p1"
    assert extract.call_count == 2
    assert prepare.call_args.kwargs["timestamp_authority_url"] is not None


def test_existing_fingerprint_without_timestamp_space_fails_closed(tmp_path: Path):
    original = tmp_path / "input.png"
    original.write_bytes(b"original")
    fingerprint = SimpleNamespace(value=b"fingerprint")
    prepared = SimpleNamespace(mode="REUSE_EXISTING", fingerprint=fingerprint)
    with (
        patch("app.services.pqc2pa.extract_source", return_value=SimpleNamespace(signature_raw=b"sig")),
        patch("app.services.pqc2pa.inspect_source_timestamp", return_value=SimpleNamespace(state=SourceTimestampState.MISSING)),
        patch("app.services.pqc2pa.ensure_source_timestamp", return_value=SimpleNamespace(token=b"token")),
        patch("app.services.pqc2pa.prepare_classic_for_pq", side_effect=lambda _src, dst, **_kw: (dst.write_bytes(b"original"), prepared)[1]),
        patch("app.services.pqc2pa.subprocess.run", return_value=SimpleNamespace(returncode=1)),
        patch("app.services.pqc2pa.settings") as settings,
    ):
        settings.tsa_private_key_path.is_file.return_value = True
        settings.tsa_certificate_path.is_file.return_value = True
        settings.tsa_config_path.is_file.return_value = True
        settings.tsa_private_key_passphrase.get_secret_value.return_value = "configured"
        with pytest.raises(PqcBuildError, match="예약 공간"):
            build_p1(original, tmp_path / "classic.png", tmp_path / "p1.jumbf")
    assert original.read_bytes() == b"original"
    assert not (tmp_path / "classic.png").exists()
    assert not (tmp_path / "p1.jumbf").exists()
