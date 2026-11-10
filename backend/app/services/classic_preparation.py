"""Classic preparation for an explicit PQ request; never claims to build P1."""
from dataclasses import dataclass
import base64
import binascii
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from typing import Any

import iscc_core as ic

from app.services.classic_c2pa import read_and_parse_classic_manifest
from app.services.classic_update import build_classic_update_manifest
from app.services.fingerprint import SoftBindingFingerprint, generate_image_fingerprint


class PreparationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ClassicPreparation:
    output_path: Path
    mode: str
    reason: str
    fingerprint: SoftBindingFingerprint
    computed_fingerprint: SoftBindingFingerprint
    source_manifest: str
    active_manifest: str
    source_validation_state: str
    output_validation_state: str


def require_valid_source(parsed: dict) -> None:
    # SDK Valid includes cryptographically valid but untrusted credentials.
    # Trust is not promoted by this preparation operation.
    store = parsed.get("raw_manifest_store", {})
    results = parsed.get("validation_results") or {}
    active = results.get("activeManifest", {})
    codes = {item.get("code") for item in active.get("success", [])}
    if (store.get("validation_state") not in {"Valid", "Trusted"}
            or active.get("failure")
            or "claimSignature.validated" not in codes):
        raise PreparationError("SOURCE_C2PA_INVALID", "기존 C2PA 서명 또는 파일 결합 검증을 통과하지 못했습니다.")


def decode_fingerprint(
    value: Any,
    binding_metadata: Any = None,
) -> SoftBindingFingerprint:
    if isinstance(value, list) and all(type(v) is int and 0 <= v <= 255 for v in value):
        value = bytes(value)
    if isinstance(value, str):
        encoded = value
        if encoded.startswith("b64'") and encoded.endswith("'"):
            encoded = encoded[4:-1]
        try:
            value = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Invalid base64 ISCC-SEQ") from exc
        if base64.b64encode(value).decode("ascii") != encoded:
            raise ValueError("Non-canonical base64 ISCC-SEQ")
    if not isinstance(value, bytes):
        raise ValueError("ISCC-SEQ must contain bytes")
    units = tuple(ic.decode_seq(value))
    headers = [ic.decode_header(ic.decode_base32(u.split(":")[-1])) for u in units]
    # Project reuse profile: Image/Data/Instance, version 0, 256 bits, in order.
    if [h[:4] for h in headers] != [(2, 1, 0, 7), (3, 0, 0, 7), (4, 0, 0, 7)]:
        raise ValueError("Unsupported ISCC reuse profile")
    if ic.encode_seq(units) != value:
        raise ValueError("Non-canonical sequence")
    # Conservative low-information filter for this project's image search.
    image_body = headers[0][4]
    if any(not 8 <= sum(b.bit_count() for b in image_body[i:i + 8]) <= 56
           for i in range(0, 32, 8)):
        raise ValueError("Low-information Image-Code")
    generator_name = None
    generator_version = None
    if isinstance(binding_metadata, dict):
        generator = binding_metadata.get("io.iscc.generator")
        if isinstance(generator, dict):
            name = generator.get("name")
            sdk_version = generator.get("version")
            if isinstance(name, str) and isinstance(sdk_version, str):
                generator_name = name
                generator_version = sdk_version
    return SoftBindingFingerprint(
        units=units,
        value=value,
        generator_name=generator_name,
        generator_version=generator_version,
    )


def select_fingerprint(parsed: dict, current: SoftBindingFingerprint):
    bindings = [a for a in parsed["assertions"] if a["kind"] == "SOFT_BINDING"]
    if not bindings:
        return current, "ADD_SOFT_BINDING", "ABSENT"
    # Do not arbitrarily select among multiple assertions/blocks.
    if len(bindings) > 1:
        raise PreparationError(
            "FINGERPRINT_AMBIGUOUS",
            "소프트바인딩 어설션이 여러 개여서 재사용할 값을 결정할 수 없습니다.",
        )
    data = bindings[0].get("data")
    if not isinstance(data, dict) or data.get("alg") != "io.iscc.v0":
        return current, "ADD_SOFT_BINDING", "UNSUPPORTED_ALGORITHM"
    blocks = data.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return current, "ADD_SOFT_BINDING", "UNSUPPORTED_BLOCKS"
    if len(blocks) > 1:
        raise PreparationError(
            "FINGERPRINT_AMBIGUOUS",
            "소프트바인딩 블록이 여러 개여서 재사용할 값을 결정할 수 없습니다.",
        )
    if not isinstance(blocks[0], dict):
        return current, "ADD_SOFT_BINDING", "UNSUPPORTED_BLOCKS"
    if blocks[0].get("scope") != {}:
        return current, "ADD_SOFT_BINDING", "UNSUPPORTED_SCOPE"
    try:
        existing = decode_fingerprint(
            blocks[0].get("value"),
            data.get("bindingMetadata"),
        )
    except (ValueError, TypeError):
        return current, "ADD_SOFT_BINDING", "UNSUPPORTED_VALUE"
    if existing.units[0] != current.units[0]:
        # A signed fingerprint contradicts our image calculation. Do not silently
        # re-sign and conceal it as an ordinary missing-fingerprint case.
        raise PreparationError("FINGERPRINT_MISMATCH", "기존 Image-Code가 재계산한 값과 다릅니다. 전처리 방식 또는 이미지 변경 여부를 확인해야 합니다.")
    # Data/Instance cover the pre-embedding file and normally change after signing.
    return existing, "REUSE_EXISTING", "IMAGE_CODE_MATCH"


def prepare_classic_for_pq(source: Path, output: Path) -> ClassicPreparation:
    source = Path(source).resolve()
    output = Path(output).resolve()
    if not source.is_file():
        raise PreparationError("SOURCE_NOT_FOUND", "입력 파일이 없습니다.")
    if output.exists() or source == output:
        raise PreparationError("OUTPUT_EXISTS", "출력 파일을 덮어쓸 수 없습니다.")
    if source.suffix.lower() != output.suffix.lower():
        raise PreparationError(
            "OUTPUT_FORMAT_MISMATCH",
            "입력과 출력 파일의 확장자가 같아야 합니다.",
        )
    parsed = read_and_parse_classic_manifest(source)
    require_valid_source(parsed)
    current = generate_image_fingerprint(source)
    try:
        decode_fingerprint(current.value)
    except (ValueError, TypeError) as exc:
        raise PreparationError("FINGERPRINT_UNUSABLE", "안정적인 Image-Code를 만들 수 없어 변환 준비를 중단했습니다. 서명 검증은 별도로 가능합니다.") from exc
    fingerprint, mode, reason = select_fingerprint(parsed, current)
    output.parent.mkdir(parents=True, exist_ok=True)

    with TemporaryDirectory(
        prefix="classic-prepare-",
        dir=output.parent,
    ) as directory:
        candidate = Path(directory) / output.name
        if mode == "REUSE_EXISTING":
            shutil.copyfile(source, candidate)
        else:
            build_classic_update_manifest(source, candidate, fingerprint)

        updated = read_and_parse_classic_manifest(candidate)
        require_valid_source(updated)
        output_computed = generate_image_fingerprint(candidate)
        if output_computed.units[0] != current.units[0]:
            raise PreparationError(
                "OUTPUT_IMAGE_CODE_CHANGED",
                "처리 전후 이미지의 Image-Code가 다릅니다.",
            )

        actual, output_mode, _ = select_fingerprint(updated, output_computed)
        if output_mode != "REUSE_EXISTING" or actual.value != fingerprint.value:
            raise PreparationError(
                "OUTPUT_FINGERPRINT_INVALID",
                "출력 매니페스트의 핑거프린트가 선택한 값과 다릅니다.",
            )
        if mode == "REUSE_EXISTING" and candidate.read_bytes() != source.read_bytes():
            raise PreparationError(
                "REUSED_ASSET_CHANGED",
                "기존 매니페스트 재사용 중 파일이 변경되었습니다.",
            )

        try:
            destination = output.open("xb")
        except FileExistsError as exc:
            raise PreparationError("OUTPUT_EXISTS", "출력 파일이 이미 존재합니다.") from exc
        try:
            with destination, candidate.open("rb") as stream:
                shutil.copyfileobj(stream, destination)
        except BaseException:
            output.unlink(missing_ok=True)
            raise

    return ClassicPreparation(
        output_path=output,
        mode=mode,
        reason=reason,
        fingerprint=fingerprint,
        computed_fingerprint=current,
        source_manifest=parsed["active_manifest"],
        active_manifest=updated["active_manifest"],
        source_validation_state=parsed["raw_manifest_store"]["validation_state"],
        output_validation_state=updated["raw_manifest_store"]["validation_state"],
    )
