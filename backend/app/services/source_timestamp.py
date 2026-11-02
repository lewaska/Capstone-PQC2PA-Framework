"""Source Classic Manifest timestamp extraction and policy."""
# 진짜 존나게 하기 싫네 내가 이걸 왜해야되냐?
from __future__ import annotations

import base64
import hashlib
import json
import subprocess
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from app.core.config import settings
from app.services.rfc3161 import (
    issue_rfc3161_token,
    verify_rfc3161_token,
)

SOURCE_TIMESTAMP_ASSERTION_LABEL = (
    "org.pq-c2pa.source-timestamp"
)

INVALID_TIMESTAMP_CODES = {
    "timeStamp.malformed",
    "timeStamp.mismatch",
    "timeStamp.outsideValidity",
}


class SourceTimestampError(Exception):
    """Source timestamp 처리에 실패했습니다."""


class SourceTimestampInvalidError(SourceTimestampError):
    """기존 timestamp가 있지만 유효하지 않습니다."""


class SourceTimestampState(StrEnum):
    EXISTING = "EXISTING"
    MISSING = "MISSING"
    ISSUED = "ISSUED"


@dataclass(frozen=True, slots=True)
class SourceTimestampEvidence:
    state: SourceTimestampState
    manifest_id: str
    signature: bytes
    cose_sign1: bytes
    timestamp_kind: str | None
    token: bytes | None
    validated: bool
    trusted: bool
    validation_codes: tuple[str, ...]

    @property
    def signature_sha3_256(self) -> bytes:
        return hashlib.sha3_256(self.signature).digest()

    def assertion_definition(self) -> dict[str, Any]:
        """PQC Manifest에 넣을 source timestamp assertion입니다."""

        if self.token is None or self.timestamp_kind is None:
            raise SourceTimestampError(
                "timestamp token이 없어 assertion을 만들 수 없습니다."
            )

        return {
            "label": SOURCE_TIMESTAMP_ASSERTION_LABEL,
            "created": True,
            "data": {
                "sourceManifest": self.manifest_id,
                "source": self.state.value,
                "storage": self.timestamp_kind,
                "token": list(self.token),
                "targetSignatureHash": {
                    "alg": "sha3-256",
                    "hash": list(self.signature_sha3_256),
                },
                "validation": {
                    "validated": self.validated,
                    "trusted": self.trusted,
                    "codes": list(self.validation_codes),
                },
            },
        }

    def classic_timestamp_assertion_definition(self) -> dict[str, Any]:
        """새로 발급한 RFC 3161 토큰을 Classic Update에 넣는 정의입니다."""

        if self.state is not SourceTimestampState.ISSUED:
            raise SourceTimestampError(
                "새로 발급한 timestamp만 Classic Update에 추가할 수 있습니다."
            )
        if self.token is None:
            raise SourceTimestampError("발급된 timestamp token이 없습니다.")

        return {
            "label": "c2pa.time-stamp",
            "created": True,
            "data": {
                self.manifest_id: list(self.token),
            },
        }


def _decode_base64(value: Any, field_name: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise SourceTimestampError(
            f"{field_name}이 비어 있거나 문자열이 아닙니다."
        )

    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise SourceTimestampError(
            f"{field_name}의 Base64를 해석하지 못했습니다."
        ) from exc


def _collect_validation_codes(value: Any) -> set[str]:
    codes: set[str] = set()

    if isinstance(value, dict):
        code = value.get("code")
        if isinstance(code, str):
            codes.add(code)

        for child in value.values():
            codes.update(_collect_validation_codes(child))

    elif isinstance(value, list):
        for child in value:
            codes.update(_collect_validation_codes(child))

    return codes


def _run_native_extractor(
    image_path: Path,
) -> dict[str, Any]:
    cli_path = settings.pqc2pa_cli_path.resolve()
    source_path = Path(image_path).resolve()

    if not cli_path.is_file():
        raise SourceTimestampError(
            f"pqc2pa-cli 실행 파일이 없습니다: {cli_path}"
        )

    if not source_path.is_file():
        raise SourceTimestampError(
            f"입력 이미지가 없습니다: {source_path}"
        )

    with TemporaryDirectory(prefix="pqc2pa-source-") as temp_dir:
        output_path = Path(temp_dir) / "classic-source.json"

        try:
            result = subprocess.run(
                [
                    str(cli_path),
                    "extract-classic",
                    "--input",
                    str(source_path),
                    "--output",
                    str(output_path),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
                timeout=120,
            )
        except subprocess.TimeoutExpired as exc:
            raise SourceTimestampError(
                "Classic timestamp 추출 시간이 초과됐습니다."
            ) from exc
        except OSError as exc:
            raise SourceTimestampError(
                "pqc2pa-cli를 실행하지 못했습니다."
            ) from exc

        if result.returncode != 0:
            message = (
                result.stderr.strip()
                or result.stdout.strip()
                or "알 수 없는 native extractor 오류"
            )
            raise SourceTimestampError(
                f"Classic timestamp 추출 실패: {message}"
            )

        if not output_path.is_file():
            raise SourceTimestampError(
                "native extractor가 결과 JSON을 만들지 않았습니다."
            )

        try:
            value = json.loads(
                output_path.read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as exc:
            raise SourceTimestampError(
                "native extractor 결과 JSON을 읽지 못했습니다."
            ) from exc

    if not isinstance(value, dict):
        raise SourceTimestampError(
            "native extractor 결과가 JSON 객체가 아닙니다."
        )

    return value


def inspect_source_timestamp(
    image_path: Path,
) -> SourceTimestampEvidence:
    """Classic active manifest의 timestamp evidence를 가져옵니다."""

    extracted = _run_native_extractor(image_path)

    manifest_id = extracted.get("active_manifest")
    if not isinstance(manifest_id, str) or not manifest_id:
        raise SourceTimestampError(
            "active_manifest가 없습니다."
        )

    signature = _decode_base64(
        extracted.get("signature_base64"),
        "signature_base64",
    )
    cose_sign1 = _decode_base64(
        extracted.get("cose_sign1_base64"),
        "cose_sign1_base64",
    )

    validation_codes = _collect_validation_codes(
        extracted.get("validation_results")
    )

    timestamp_value = extracted.get("timestamp")

    if timestamp_value is None:
        return SourceTimestampEvidence(
            state=SourceTimestampState.MISSING,
            manifest_id=manifest_id,
            signature=signature,
            cose_sign1=cose_sign1,
            timestamp_kind=None,
            token=None,
            validated=False,
            trusted=False,
            validation_codes=tuple(
                sorted(validation_codes)
            ),
        )

    if not isinstance(timestamp_value, dict):
        raise SourceTimestampError(
            "timestamp 항목이 객체가 아닙니다."
        )

    timestamp_kind = timestamp_value.get("kind")
    if timestamp_kind not in {"sigTst", "sigTst2"}:
        raise SourceTimestampError(
            f"지원하지 않는 timestamp 종류입니다: "
            f"{timestamp_kind}"
        )

    token = _decode_base64(
        timestamp_value.get("token_base64"),
        "timestamp.token_base64",
    )

    invalid_codes = (
        validation_codes & INVALID_TIMESTAMP_CODES
    )
    validated = "timeStamp.validated" in validation_codes
    trusted = "timeStamp.trusted" in validation_codes

    if invalid_codes or not validated:
        raise SourceTimestampInvalidError(
            "기존 timestamp가 유효하지 않습니다: "
            + ", ".join(sorted(validation_codes))
        )

    return SourceTimestampEvidence(
        state=SourceTimestampState.EXISTING,
        manifest_id=manifest_id,
        signature=signature,
        cose_sign1=cose_sign1,
        timestamp_kind=timestamp_kind,
        token=token,
        validated=validated,
        trusted=trusted,
        validation_codes=tuple(
            sorted(validation_codes)
        ),
    )


def ensure_source_timestamp(
    image_path: Path,
) -> SourceTimestampEvidence:
    """기존 유효 토큰은 보존하고, 없을 때만 ES256 TSA로 새 토큰을 발급합니다."""

    evidence = inspect_source_timestamp(image_path)
    if evidence.state is SourceTimestampState.EXISTING:
        return evidence

    issued = issue_rfc3161_token(
        evidence.signature,
        hash_algorithm="sha256",
    )
    if not verify_rfc3161_token(evidence.signature, issued.token):
        raise SourceTimestampError(
            "새 RFC 3161 token이 원본 Classic signature와 일치하지 않습니다."
        )

    return SourceTimestampEvidence(
        state=SourceTimestampState.ISSUED,
        manifest_id=evidence.manifest_id,
        signature=evidence.signature,
        cose_sign1=evidence.cose_sign1,
        timestamp_kind="c2pa.time-stamp",
        token=issued.token,
        validated=True,
        trusted=True,
        validation_codes=(
            "timeStamp.trusted",
            "timeStamp.validated",
        ),
    )
