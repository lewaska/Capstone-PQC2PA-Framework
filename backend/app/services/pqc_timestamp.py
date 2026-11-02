import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

import cbor2


class PqcTimestampError(Exception):
    """RFC 3161 타임스탬프 처리에 실패했을 때 발생합니다."""


@dataclass(frozen=True)
class TimestampResult:
    token: bytes
    sig_tst2: dict


def build_timestamp_payload(
    protected_headers: bytes,
    signature: bytes,
) -> bytes:
    structure = [
        "CounterSignature",
        protected_headers,
        b"",
        b"",
        signature,
    ]

    return cbor2.dumps(structure, canonical=True)


def run_openssl(
    arguments: list[str],
    *,
    environment: dict[str, str] | None = None,
    passphrase: str | None = None,
) -> subprocess.CompletedProcess[str]:
    process_environment = os.environ.copy()

    if environment:
        process_environment.update(environment)

    try:
        return subprocess.run(
            [os.getenv("OPENSSL_BIN", "openssl"), *arguments],
            input=None if passphrase is None else f"{passphrase}\n",
            capture_output=True,
            text=True,
            check=False,
            env=process_environment,
        )
    except FileNotFoundError as exc:
        raise PqcTimestampError(
            "OpenSSL 실행 파일을 찾을 수 없습니다."
        ) from exc


def issue_timestamp_token(
    *,
    protected_headers: bytes,
    signature: bytes,
    tsa_config_path: Path,
    tsa_private_key_path: Path,
    tsa_certificate_path: Path,
    root_certificate_path: Path,
    serial_file_path: Path,
    tsa_passphrase: str,
) -> TimestampResult:
    timestamp_payload = build_timestamp_payload(
        protected_headers=protected_headers,
        signature=signature,
    )

    if not serial_file_path.exists():
        serial_file_path.parent.mkdir(parents=True, exist_ok=True)
        serial_file_path.write_text("01", encoding="ascii")

    with TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        payload_path = temp_path / "timestamp-payload.bin"
        request_path = temp_path / "timestamp-request.tsq"
        response_path = temp_path / "timestamp-response.tsr"
        token_path = temp_path / "timestamp-token.tst"
        runtime_config_path = temp_path / "tsa-runtime.cnf"

        payload_path.write_bytes(timestamp_payload)
        runtime_config_path.write_text(
            f"""
[ tsa ]
default_tsa = tsa_config

[ tsa_config ]
serial = {serial_file_path.resolve().as_posix()}
signer_cert = {tsa_certificate_path.resolve().as_posix()}
signer_key = {tsa_private_key_path.resolve().as_posix()}
certs = {root_certificate_path.resolve().as_posix()}

signer_digest = sha256
default_policy = 1.3.6.1.4.1.55555.1.1
digests = sha256, sha384, sha512, sha3-256
accuracy = secs:1
ordering = yes
tsa_name = yes
ess_cert_id_chain = yes
ess_cert_id_alg = sha256
clock_precision_digits = 0
""".strip(),
            encoding="utf-8",
        )

        query_result = run_openssl([
            "ts", "-query", "-data", str(payload_path),
            "-sha256", "-cert", "-out", str(request_path),
        ])
        if query_result.returncode != 0:
            raise PqcTimestampError(query_result.stderr.strip())

        reply_result = run_openssl(
            [
                "ts", "-reply", "-config", str(runtime_config_path),
                "-section", "tsa_config", "-queryfile", str(request_path),
                "-out", str(response_path), "-passin", "stdin",
            ],
            passphrase=tsa_passphrase,
        )
        if reply_result.returncode != 0:
            raise PqcTimestampError(reply_result.stderr.strip())

        verify_result = run_openssl([
            "ts", "-verify", "-queryfile", str(request_path),
            "-in", str(response_path), "-CAfile", str(root_certificate_path),
            "-untrusted", str(tsa_certificate_path),
        ])
        if verify_result.returncode != 0:
            raise PqcTimestampError(verify_result.stderr.strip())

        token_result = run_openssl([
            "ts", "-reply", "-in", str(response_path),
            "-token_out", "-out", str(token_path),
        ])
        if token_result.returncode != 0:
            raise PqcTimestampError(token_result.stderr.strip())

        token = token_path.read_bytes()

    return TimestampResult(
        token=token,
        sig_tst2={"tstTokens": [{"val": token}]},
    )


def verify_timestamp_token(
    *,
    protected_headers: bytes,
    signature: bytes,
    timestamp_token: bytes,
    tsa_certificate_path: Path,
    root_certificate_path: Path,
) -> bool:
    timestamp_payload = build_timestamp_payload(
        protected_headers=protected_headers,
        signature=signature,
    )

    with TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        payload_path = temp_path / "timestamp-payload.bin"
        token_path = temp_path / "timestamp-token.tst"
        payload_path.write_bytes(timestamp_payload)
        token_path.write_bytes(timestamp_token)

        result = run_openssl([
            "ts", "-verify", "-token_in", "-in", str(token_path),
            "-data", str(payload_path), "-CAfile", str(root_certificate_path),
            "-untrusted", str(tsa_certificate_path),
        ])

        return result.returncode == 0
