"""Build and verify the project-specific detached P1 PQC manifest."""
from __future__ import annotations

import io
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import cbor2
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding

from app.core.config import settings
from app.services.classic_preparation import prepare_classic_for_pq
from app.services.pqc_source import (
    PqcSourceError,
    current_c2pa_exclusions,
    extract_source,
    hash_excluding,
    make_hard_binding,
)

from app.services import pqc_manifest

PROFILE = pqc_manifest.PROFILE
ML_DSA_65 = -49


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


def _run_openssl(arguments: list[str], password: str | None = None) -> None:
    process = subprocess.run(
        [str(settings.openssl_bin), *arguments],
        input=None if password is None else (password + "\n").encode(),
        capture_output=True,
        check=False,
        timeout=120,
    )
    if process.returncode != 0:
        raise PqcBuildError(
            "OpenSSL 작업이 실패했습니다. 키·인증서·실행 경로를 확인하십시오."
        )


def check_our_certificate_chain() -> None:
    leaf = x509.load_der_x509_certificate(read_certificate(settings.mldsa_leaf_certificate_path))
    try:
        constraints = leaf.extensions.get_extension_for_class(x509.BasicConstraints).value
        usage = leaf.extensions.get_extension_for_class(x509.KeyUsage).value
        eku = leaf.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
    except x509.ExtensionNotFound as exc:
        raise PqcBuildError("Signing certificate requires basic constraints, key usage and EKU") from exc
    if (constraints.ca or not usage.digital_signature or usage.key_cert_sign
            or leaf.public_key_algorithm_oid.dotted_string != "2.16.840.1.101.3.4.3.18"
            or not {oid.dotted_string for oid in eku} & {"1.3.6.1.4.1.62558.2.1", "1.3.6.1.5.5.7.3.36"}):
        raise PqcBuildError("Signing certificate is not an ML-DSA-65 C2PA signing credential")
    _run_openssl([
        "verify", "-purpose", "any",
        "-CAfile", str(settings.mldsa_root_certificate_path),
        str(settings.mldsa_leaf_certificate_path),
    ])


def sign_with_our_signer(message: bytes) -> bytes:
    with TemporaryDirectory(prefix="pqc-sign-") as directory:
        root = Path(directory)
        message_path, signature_path = root / "message.bin", root / "signature.bin"
        message_path.write_bytes(message)
        arguments = [
            "pkeyutl", "-sign",
            "-inkey", str(settings.mldsa_private_key_path),
            "-in", str(message_path),
            "-out", str(signature_path),
        ]
        password = None
        if settings.mldsa_private_key_passphrase is not None:
            password = settings.mldsa_private_key_passphrase.get_secret_value()
            arguments.extend(["-passin", "stdin"])
        _run_openssl(arguments, password)
        signature = signature_path.read_bytes()
        if len(signature) != 3309:
            raise PqcBuildError("ML-DSA-65 서명 길이가 아닙니다.")
        return signature


def verify_with_our_signer(message: bytes, signature: bytes) -> None:
    with TemporaryDirectory(prefix="pqc-verify-") as directory:
        root = Path(directory)
        message_path, signature_path = root / "message.bin", root / "signature.bin"
        message_path.write_bytes(message)
        signature_path.write_bytes(signature)
        _run_openssl([
            "pkeyutl", "-verify", "-certin",
            "-inkey", str(settings.mldsa_leaf_certificate_path),
            "-in", str(message_path),
            "-sigfile", str(signature_path),
        ])


def make_cose_signature(claim_raw: bytes) -> bytes:
    check_our_certificate_chain()
    chain = [
        read_certificate(settings.mldsa_leaf_certificate_path),
        read_certificate(settings.mldsa_root_certificate_path),
    ]
    protected_raw = encode({1: ML_DSA_65, 33: chain})
    signature_input = encode(["Signature1", protected_raw, b"", claim_raw])
    signature = sign_with_our_signer(signature_input)
    verify_with_our_signer(signature_input, signature)
    return encode(cbor2.CBORTag(18, [protected_raw, {}, None, signature]))


def verify_p1(p1_bytes: bytes, image: Path) -> dict:
    try:
        parsed = pqc_manifest.inspect(p1_bytes)
        claim_raw = parsed["claim_raw"]
        cose = decode_p1_cbor(parsed["signature_raw"])
        if not isinstance(cose, cbor2.CBORTag) or cose.tag != 18:
            raise PqcBuildError("P1 signature must be COSE_Sign1")
        protected_raw, unprotected, payload, signature = cose.value
        if unprotected or payload is not None or not isinstance(signature, bytes) or len(signature) != 3309:
            raise PqcBuildError("Invalid detached ML-DSA-65 COSE structure")
        protected = decode_p1_cbor(protected_raw)
        expected_chain = [read_certificate(settings.mldsa_leaf_certificate_path),
                          read_certificate(settings.mldsa_root_certificate_path)]
        if not isinstance(protected, dict) or set(protected) != {1, 33} or protected.get(1) != ML_DSA_65 or protected.get(33) != expected_chain:
            raise PqcBuildError("Unexpected ML-DSA signer/algorithm")
        check_our_certificate_chain()
        verify_with_our_signer(encode(["Signature1", protected_raw, b"", claim_raw]), signature)
        binding = parsed["hard_binding"]
        if not isinstance(binding, dict) or binding.get("alg") != "sha3-256":
            raise PqcBuildError("Invalid SHA3 hard binding")
        asset = image.read_bytes()
        exclusions = current_c2pa_exclusions(asset)
        if binding.get("exclusions") != exclusions or binding.get("hash") != hash_excluding(asset, exclusions, "sha3-256"):
            raise PqcBuildError("assertion.dataHash.mismatch")
        classic = extract_source(image)  # Official SDK validates the actual asset.
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
            "signer": "FRAMEWORK_PINNED_SIGNER", "timestamp": "NOT_ISSUED_FOR_P1",
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
    with TemporaryDirectory(prefix="pqc-build-") as directory:
        working_image = Path(directory) / ("classic" + source_image.suffix.lower())
        prepared = prepare_classic_for_pq(source_image, working_image)
        fingerprint_data = prepared.fingerprint.assertion_definition()["data"]
        fingerprint_data["blocks"][0]["value"] = prepared.fingerprint.value
        p1_bytes = pqc_manifest.assemble(
            source, fingerprint_data, make_hard_binding(working_image), make_cose_signature,
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
