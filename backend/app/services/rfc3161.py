"""Generic local RFC 3161 token issuance and verification."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from app.core.config import settings


SUPPORTED_IMPRINT_ALGORITHMS = {
    "sha256",
    "sha384",
    "sha512",
    "sha3-256",
}


class Rfc3161Error(Exception):
    """RFC 3161 발급 또는 검증에 실패했습니다."""


@dataclass(frozen=True, slots=True)
class Rfc3161Token:
    token: bytes
    hash_algorithm: str


def _require_file(path: Path, name: str) -> Path:
    resolved = Path(path).resolve()

    if not resolved.is_file():
        raise Rfc3161Error(
            f"{name} 파일이 없습니다: {resolved}"
        )

    return resolved


def _tsa_environment() -> dict[str, str]:
    return {
        "PQC2PA_TSA_SERIAL_FILE": str(
            settings.tsa_serial_file_path.resolve()
        ),
        "PQC2PA_TSA_CERT_PATH": str(
            settings.tsa_certificate_path.resolve()
        ),
        "PQC2PA_TSA_PRIVATE_KEY_PATH": str(
            settings.tsa_private_key_path.resolve()
        ),
        "PQC2PA_ROOT_CA_CERT_PATH": str(
            settings.tsa_root_certificate_path.resolve()
        ),
    }


def _run_openssl(
    arguments: list[str],
    *,
    passphrase: str | None = None,
    environment: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    openssl_path = Path(settings.openssl_bin)

    if not openssl_path.is_file():
        raise Rfc3161Error(
            f"OpenSSL 실행 파일이 없습니다: {openssl_path}"
        )

    process_environment = os.environ.copy()

    if environment:
        process_environment.update(environment)

    try:
        return subprocess.run(
            [str(openssl_path), *arguments],
            input=(
                None
                if passphrase is None
                else f"{passphrase}\n"
            ),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=60,
            env=process_environment,
        )
    except subprocess.TimeoutExpired as exc:
        raise Rfc3161Error(
            "OpenSSL RFC 3161 작업 시간이 초과됐습니다."
        ) from exc
    except OSError as exc:
        raise Rfc3161Error(
            "OpenSSL을 실행하지 못했습니다."
        ) from exc


def _failure_message(
    operation: str,
    result: subprocess.CompletedProcess[str],
) -> Rfc3161Error:
    message = (
        result.stderr.strip()
        or result.stdout.strip()
        or "알 수 없는 OpenSSL 오류"
    )

    return Rfc3161Error(
        f"{operation} 실패: {message}"
    )


def issue_rfc3161_token(
    data: bytes,
    *,
    hash_algorithm: str = "sha256",
) -> Rfc3161Token:
    """data에 대한 DER RFC 3161 TimeStampToken을 발급합니다."""

    if not data:
        raise Rfc3161Error(
            "timestamp 입력 데이터가 비어 있습니다."
        )

    if hash_algorithm not in SUPPORTED_IMPRINT_ALGORITHMS:
        raise Rfc3161Error(
            f"지원하지 않는 imprint 알고리즘입니다: "
            f"{hash_algorithm}"
        )

    tsa_config_path = _require_file(
        settings.tsa_config_path,
        "TSA config",
    )
    tsa_private_key_path = _require_file(
        settings.tsa_private_key_path,
        "TSA private key",
    )
    tsa_certificate_path = _require_file(
        settings.tsa_certificate_path,
        "TSA certificate",
    )
    root_certificate_path = _require_file(
        settings.tsa_root_certificate_path,
        "TSA root certificate",
    )

    serial_path = settings.tsa_serial_file_path.resolve()
    serial_path.parent.mkdir(parents=True, exist_ok=True)

    if not serial_path.exists():
        serial_path.write_text("01\n", encoding="ascii")

    passphrase_value = (
        settings.tsa_private_key_passphrase
    )
    if passphrase_value is None:
        raise Rfc3161Error(
            "TSA_PRIVATE_KEY_PASSPHRASE가 설정되지 않았습니다."
        )

    passphrase = passphrase_value.get_secret_value()
    if not passphrase:
        raise Rfc3161Error(
            "TSA private key 비밀번호가 비어 있습니다."
        )

    with TemporaryDirectory(
        prefix="pqc2pa-rfc3161-"
    ) as temp_dir:
        temp_path = Path(temp_dir)

        data_path = temp_path / "timestamp-input.bin"
        request_path = temp_path / "timestamp-request.tsq"
        response_path = temp_path / "timestamp-response.tsr"
        token_path = temp_path / "timestamp-token.tst"

        data_path.write_bytes(data)

        query_result = _run_openssl(
            [
                "ts",
                "-query",
                "-data",
                str(data_path),
                f"-{hash_algorithm}",
                "-cert",
                "-out",
                str(request_path),
            ]
        )

        if query_result.returncode != 0:
            raise _failure_message(
                "RFC 3161 request 생성",
                query_result,
            )

        reply_result = _run_openssl(
            [
                "ts",
                "-reply",
                "-config",
                str(tsa_config_path),
                "-section",
                "tsa_config",
                "-queryfile",
                str(request_path),
                "-out",
                str(response_path),
                "-passin",
                "stdin",
            ],
            passphrase=passphrase,
            environment=_tsa_environment(),
        )

        if reply_result.returncode != 0:
            raise _failure_message(
                "RFC 3161 response 발급",
                reply_result,
            )

        verify_result = _run_openssl(
            [
                "ts",
                "-verify",
                "-queryfile",
                str(request_path),
                "-in",
                str(response_path),
                "-CAfile",
                str(root_certificate_path),
                "-untrusted",
                str(tsa_certificate_path),
            ]
        )

        if verify_result.returncode != 0:
            raise _failure_message(
                "RFC 3161 response 자체 검증",
                verify_result,
            )

        token_result = _run_openssl(
            [
                "ts",
                "-reply",
                "-in",
                str(response_path),
                "-token_out",
                "-out",
                str(token_path),
            ]
        )

        if token_result.returncode != 0:
            raise _failure_message(
                "RFC 3161 token 추출",
                token_result,
            )

        token = token_path.read_bytes()

    if not token:
        raise Rfc3161Error(
            "발급된 RFC 3161 token이 비어 있습니다."
        )

    return Rfc3161Token(
        token=token,
        hash_algorithm=hash_algorithm,
    )


def verify_rfc3161_token(
    data: bytes,
    token: bytes,
) -> bool:
    """우리 TSA가 발급한 DER TimeStampToken을 검증합니다."""

    if not data or not token:
        return False

    tsa_certificate_path = _require_file(
        settings.tsa_certificate_path,
        "TSA certificate",
    )
    root_certificate_path = _require_file(
        settings.tsa_root_certificate_path,
        "TSA root certificate",
    )

    with TemporaryDirectory(
        prefix="pqc2pa-rfc3161-verify-"
    ) as temp_dir:
        temp_path = Path(temp_dir)

        data_path = temp_path / "timestamp-input.bin"
        token_path = temp_path / "timestamp-token.tst"

        data_path.write_bytes(data)
        token_path.write_bytes(token)

        result = _run_openssl(
            [
                "ts",
                "-verify",
                "-token_in",
                "-in",
                str(token_path),
                "-data",
                str(data_path),
                "-CAfile",
                str(root_certificate_path),
                "-untrusted",
                str(tsa_certificate_path),
            ]
        )

        return result.returncode == 0

def issue_rfc3161_response(query: bytes) -> bytes:
    """DER TimeStampReq를 받아 DER TimeStampResp를 발급합니다."""

    if not query:
        raise Rfc3161Error(
            "RFC 3161 TimeStampReq가 비어 있습니다."
        )

    tsa_config_path = _require_file(
        settings.tsa_config_path,
        "TSA config",
    )
    tsa_private_key_path = _require_file(
        settings.tsa_private_key_path,
        "TSA private key",
    )
    tsa_certificate_path = _require_file(
        settings.tsa_certificate_path,
        "TSA certificate",
    )
    root_certificate_path = _require_file(
        settings.tsa_root_certificate_path,
        "TSA root certificate",
    )

    serial_path = settings.tsa_serial_file_path.resolve()
    serial_path.parent.mkdir(parents=True, exist_ok=True)

    if not serial_path.exists():
        serial_path.write_text("01\n", encoding="ascii")

    passphrase_value = settings.tsa_private_key_passphrase

    if passphrase_value is None:
        raise Rfc3161Error(
            "TSA_PRIVATE_KEY_PASSPHRASE가 설정되지 않았습니다."
        )

    passphrase = passphrase_value.get_secret_value()

    if not passphrase:
        raise Rfc3161Error(
            "TSA private key 비밀번호가 비어 있습니다."
        )

    with TemporaryDirectory(
        prefix="pqc2pa-rfc3161-server-"
    ) as temp_dir:
        temp_path = Path(temp_dir)

        request_path = temp_path / "request.tsq"
        response_path = temp_path / "response.tsr"

        request_path.write_bytes(query)

        reply_result = _run_openssl(
            [
                "ts",
                "-reply",
                "-config",
                str(tsa_config_path),
                "-section",
                "tsa_config",
                "-queryfile",
                str(request_path),
                "-out",
                str(response_path),
                "-passin",
                "stdin",
            ],
            passphrase=passphrase,
            environment=_tsa_environment(),
        )

        if reply_result.returncode != 0:
            raise _failure_message(
                "RFC 3161 response 발급",
                reply_result,
            )

        verify_result = _run_openssl(
            [
                "ts",
                "-verify",
                "-queryfile",
                str(request_path),
                "-in",
                str(response_path),
                "-CAfile",
                str(root_certificate_path),
                "-untrusted",
                str(tsa_certificate_path),
            ]
        )

        if verify_result.returncode != 0:
            raise _failure_message(
                "RFC 3161 response 자체 검증",
                verify_result,
            )

        response = response_path.read_bytes()

    if not response:
        raise Rfc3161Error(
            "발급된 RFC 3161 TimeStampResp가 비어 있습니다."
        )

    return response
