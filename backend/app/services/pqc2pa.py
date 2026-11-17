"""Build and verify the project-specific detached P1 PQC manifest."""
from __future__ import annotations

import io
import hashlib
from dataclasses import replace
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import cbor2
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding

from app.core.config import settings
from app.services.classic_preparation import prepare_classic_for_pq
from app.services.source_timestamp import (
    SourceTimestampState, ensure_source_timestamp, inspect_source_timestamp,
    timestamp_input_from_cose,
)
from app.services.rfc3161 import verify_rfc3161_token
from app.services.pqc_source import (
    PqcSourceError,
    current_c2pa_exclusions,
    extract_source,
    hash_excluding,
    make_hard_binding,
)

from app.services import pqc_manifest
from app.services import haetae

PROFILE = pqc_manifest.PROFILE
HAETAE_ALGORITHM = "HAETAE-3-P1"
HAETAE_KEY_HASH_HEADER = -70001


class PqcBuildError(RuntimeError):
    pass


def encode(value) -> bytes:
    return cbor2.dumps(value, canonical=True)


def decode_p1_cbor(raw: bytes):
    """Reject trailing data and non-canonical/duplicate-key encodings."""
    stream = io.BytesIO(raw)
    value = cbor2.CBORDecoder(stream).decode()
    if stream.tell() != len(raw) or encode(value) != raw:
        raise PqcBuildError("P1 CBOR가 canonical 형식이 아니거나 뒤에 데이터가 있습니다.")
    return value


def read_certificate(path: Path) -> bytes:
    raw = path.read_bytes()
    cert = (
        x509.load_pem_x509_certificate(raw)
        if b"-----BEGIN CERTIFICATE-----" in raw
        else x509.load_der_x509_certificate(raw)
    )
    return cert.public_bytes(Encoding.DER)


def make_cose_signature(claim_raw: bytes) -> bytes:
    protected_raw = encode({1: HAETAE_ALGORITHM,
                            HAETAE_KEY_HASH_HEADER: hashlib.sha256(haetae.public_key()).digest()})
    signature_input = encode(["Signature1", protected_raw, b"", claim_raw])
    signature = haetae.sign(signature_input)
    if not haetae.verify(signature_input, signature):
        raise PqcBuildError("HAETAE-3 signature self-check failed")
    return encode(cbor2.CBORTag(18, [protected_raw, {}, None, signature]))


def verify_p1(p1_bytes: bytes, image: Path) -> dict:
    try:
        parsed = pqc_manifest.inspect(p1_bytes)
        source_timestamp = parsed["source_timestamp"]
        claim_raw = parsed["claim_raw"]
        cose = decode_p1_cbor(parsed["signature_raw"])
        if not isinstance(cose, cbor2.CBORTag) or cose.tag != 18:
            raise PqcBuildError("P1 signature must be COSE_Sign1")
        protected_raw, unprotected, payload, signature = cose.value
        if unprotected or payload is not None or not isinstance(signature, bytes) or len(signature) != haetae.SIGNATURE_BYTES:
            raise PqcBuildError("Invalid detached HAETAE-3 COSE structure")
        protected = decode_p1_cbor(protected_raw)
        expected = {1: HAETAE_ALGORITHM,
                    HAETAE_KEY_HASH_HEADER: hashlib.sha256(haetae.public_key()).digest()}
        if protected != expected:
            raise PqcBuildError("Unexpected HAETAE signer/algorithm")
        if not haetae.verify(encode(["Signature1", protected_raw, b"", claim_raw]), signature):
            raise PqcBuildError("HAETAE-3 claim signature invalid")
        binding = parsed["hard_binding"]
        if not isinstance(binding, dict) or binding.get("alg") != "sha3-256":
            raise PqcBuildError("Invalid SHA3 hard binding")
        asset = image.read_bytes()
        exclusions = current_c2pa_exclusions(asset)
        if binding.get("exclusions") != exclusions or binding.get("hash") != hash_excluding(asset, exclusions, "sha3-256"):
            raise PqcBuildError("assertion.dataHash.mismatch")
        classic = extract_source(image)  # Official SDK validates the actual asset.
        if source_timestamp is None:
            if parsed["evidence"]["timestamp_tokens"] or classic.timestamps:
                raise PqcBuildError("P1 omitted an available Classic timestamp")
        elif source_timestamp["source"] == "ISSUED":
            if (source_timestamp["sourceManifest"] != classic.manifest_id
                    or source_timestamp["storage"] != "sigTst2"
                    or source_timestamp["targetSignatureHash"]["hash"]
                    != hashlib.sha3_256(classic.signature_raw).digest()
                    or source_timestamp["token"] not in classic.timestamps):
                raise PqcBuildError("P1 timestamp does not match M1 sigTst2")
            payload = timestamp_input_from_cose(classic.cose_raw)
            if not verify_rfc3161_token(payload, source_timestamp["token"]):
                raise PqcBuildError("M1 sigTst2 token is invalid")
        from app.services.pqc_source import manifest_map
        current = manifest_map(classic.store_raw)
        for name, box in parsed["source_manifests"].items():
            if name not in current or current[name].raw != box.raw:
                raise PqcBuildError("Current Classic history differs from protected source")
        from app.services.classic_preparation import decode_fingerprint
        soft = parsed["soft_binding"]
        if not isinstance(soft, dict) or soft.get("alg") != "io.iscc.v0" or len(soft.get("blocks", [])) != 1:
            raise PqcBuildError("Unsupported soft binding")
        block = soft["blocks"][0]
        if not isinstance(block, dict) or block.get("scope") != {}:
            raise PqcBuildError("Unsupported soft binding scope")
        fp = decode_fingerprint(block.get("value"), soft.get("bindingMetadata"))
        from app.services.pqc_source import boxes, cbor_payload
        classic_fingerprints = []
        for name, raw in classic.assertions:
            if name.split("__", 1)[0] != "c2pa.soft-binding":
                continue
            data = cbor2.loads(cbor_payload(boxes(raw)[0]))
            if data.get("alg") != "io.iscc.v0":
                continue
            for classic_block in data.get("blocks", []):
                if classic_block.get("scope") == {}:
                    classic_fingerprints.append(decode_fingerprint(
                        classic_block.get("value"), data.get("bindingMetadata")).value)
        if classic_fingerprints != [fp.value]:
            raise PqcBuildError("Classic/P1 fingerprint mismatch or ambiguous binding")
        from app.services.fingerprint import generate_image_fingerprint
        computed = generate_image_fingerprint(image)
        if fp.units[0] != computed.units[0]:
            raise PqcBuildError("Soft binding Image-Code mismatch")
        return {
            "profile": PROFILE, "container": "JUMBF", "manifest_id": parsed["manifest_id"],
            "assertion_hashes": "VALID", "ingredient_references": "VALID",
            "source_evidence": "VALID", "classic_validation": "SDK_VALIDATED",
            "claim_signature": "VALID", "hard_binding": "VALID", "soft_binding": "VALID",
            "signature_algorithm": "HAETAE-3",
            "signer": "FRAMEWORK_PINNED_SIGNER",
            "timestamp": ("NOT_AVAILABLE" if source_timestamp is None else
                          "M1_SIGTST2_ISSUED" if source_timestamp["source"] == "ISSUED"
                          else "M0_TOKEN_EXISTING"),
            "revocation": "NOT_CHECKED", "conformance": "EXPERIMENTAL_PQ_PROFILE",
        }
    except (KeyError, TypeError, ValueError, IndexError, PqcSourceError, cbor2.CBORDecodeError) as exc:
        raise PqcBuildError("P1 validation failed: " + str(exc)) from exc


def build_p1(source_image: Path, classic_output: Path, p1_output: Path) -> dict:
    source_image = Path(source_image).resolve()
    classic_output = Path(classic_output).resolve()
    p1_output = Path(p1_output).resolve()
    if len({source_image, classic_output, p1_output}) != 3:
        raise PqcBuildError("입력과 출력 경로는 서로 달라야 합니다.")
    if classic_output.exists() or p1_output.exists():
        raise PqcBuildError("기존 출력 파일을 덮어쓰지 않습니다.")
    source = extract_source(source_image)
    source_timestamp = inspect_source_timestamp(source_image)
    tsa_ready = (
        settings.tsa_private_key_path.is_file()
        and settings.tsa_certificate_path.is_file()
        and settings.tsa_config_path.is_file()
        and settings.tsa_private_key_passphrase is not None
        and bool(settings.tsa_private_key_passphrase.get_secret_value())
    )
    request_timestamp = source_timestamp.state is SourceTimestampState.MISSING and tsa_ready
    with TemporaryDirectory(prefix="pqc-build-") as directory:
        working_image = Path(directory) / ("classic" + source_image.suffix.lower())
        prepared = prepare_classic_for_pq(
            source_image, working_image,
            timestamp_authority_url=(settings.classic_tsa_url
                                     if request_timestamp
                                     else None),
        )
        if request_timestamp:
            if prepared.mode == "REUSE_EXISTING":
                # An existing soft binding does not require an M1. Timestamp
                # the already signed M0 through its COSE unprotected header.
                issued = ensure_source_timestamp(working_image)
                token_path = Path(directory) / "source.tsr"
                stamped_image = Path(directory) / ("timestamped" + source_image.suffix.lower())
                token_path.write_bytes(issued.token)
                attached = subprocess.run(
                    [str(settings.pqc2pa_cli_path.resolve()), "attach-timestamp",
                     "--input", str(working_image), "--output", str(stamped_image),
                     "--token", str(token_path)],
                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                    check=False, timeout=120,
                )
                if attached.returncode != 0 or not stamped_image.is_file():
                    raise PqcBuildError(
                        "M0 sigTst2 삽입에 실패했습니다. 기존 서명의 예약 공간을 확인하십시오."
                    )
                attached_evidence = inspect_source_timestamp(stamped_image)
                if (attached_evidence.state is not SourceTimestampState.EXISTING
                        or attached_evidence.timestamp_kind != "sigTst2"
                        or attached_evidence.token != issued.token
                        or attached_evidence.signature != source.signature_raw):
                    raise PqcBuildError("M0 sigTst2 삽입 후 서명 또는 토큰이 일치하지 않습니다.")
                # P1 must preserve the *timestamped* M0 bytes, not the input.
                source = extract_source(stamped_image)
                stamped_image.replace(working_image)
                source_timestamp = replace(attached_evidence, state=SourceTimestampState.ISSUED)
            else:
                issued = inspect_source_timestamp(working_image)
                if issued.state is not SourceTimestampState.EXISTING or issued.timestamp_kind != "sigTst2":
                    raise PqcBuildError("M1 signer did not produce a valid sigTst2")
                source_timestamp = replace(issued, state=SourceTimestampState.ISSUED)
        fingerprint_data = prepared.fingerprint.assertion_definition()["data"]
        fingerprint_data["blocks"][0]["value"] = prepared.fingerprint.value
        timestamp_data = None
        if source_timestamp.state is not SourceTimestampState.MISSING:
            timestamp_data = source_timestamp.assertion_definition()["data"]
            timestamp_data["token"] = source_timestamp.token
            timestamp_data["targetSignatureHash"]["hash"] = source_timestamp.signature_sha3_256
        p1_bytes = pqc_manifest.assemble(
            source, fingerprint_data, make_hard_binding(working_image), make_cose_signature,
            timestamp_data,
        )
        validation = verify_p1(p1_bytes, working_image)
        classic_output.parent.mkdir(parents=True, exist_ok=True)
        p1_output.parent.mkdir(parents=True, exist_ok=True)
        created: list[Path] = []
        try:
            with classic_output.open("xb") as stream:
                created.append(classic_output)
                stream.write(working_image.read_bytes())
            with p1_output.open("xb") as stream:
                created.append(p1_output)
                stream.write(p1_bytes)
        except BaseException:
            for path in created:
                path.unlink(missing_ok=True)
            raise
        return {
            "classic_action": prepared.mode,
            "source_manifest": source.manifest_id,
            "final_classic_manifest": prepared.active_manifest,
            "fingerprint_base64": prepared.fingerprint.value_base64,
            "classic_output": str(classic_output),
            "p1_output": str(p1_output),
            "p1_size": len(p1_bytes),
            "source_timestamp_count": len(source.timestamps),
            "validation": validation,
        }
