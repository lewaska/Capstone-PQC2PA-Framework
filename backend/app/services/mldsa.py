import os
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

class MLDsaError(Exception):
    """ML-DSA 작업에 실패했을 때 발생합니다."""


def _openssl_binary() -> str:
    return os.getenv("OPENSSL_BIN", "openssl")


def _run_openssl(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            [_openssl_binary(), *arguments],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise MLDsaError("OpenSSL 실행 파일을 찾을 수 없습니다.") from exc


def generate_mldsa65_keypair(
    private_key_path: Path,
    public_key_path: Path,
) -> None:
    private_key_path.parent.mkdir(parents=True, exist_ok=True)
    public_key_path.parent.mkdir(parents=True, exist_ok=True)

    generate_result = _run_openssl(
        [
            "genpkey",
            "-algorithm",
            "ML-DSA-65",
            "-out",
            str(private_key_path),
        ]
    )

    if generate_result.returncode != 0:
        raise MLDsaError(generate_result.stderr.strip())

    public_result = _run_openssl(
        [
            "pkey",
            "-in",
            str(private_key_path),
            "-pubout",
            "-out",
            str(public_key_path),
        ]
    )

    if public_result.returncode != 0:
        raise MLDsaError(public_result.stderr.strip())


def sign_mldsa65(message: bytes, private_key_path: Path) -> bytes:
    with TemporaryDirectory() as temp_dir:
        message_path = Path(temp_dir) / "message.bin"
        signature_path = Path(temp_dir) / "signature.bin"

        message_path.write_bytes(message)

        result = _run_openssl(
            [
                "pkeyutl",
                "-sign",
                "-inkey",
                str(private_key_path),
                "-in",
                str(message_path),
                "-out",
                str(signature_path),
            ]
        )

        if result.returncode != 0:
            raise MLDsaError(result.stderr.strip())

        return signature_path.read_bytes()


def verify_mldsa65(
    message: bytes,
    signature: bytes,
    public_key_path: Path,
) -> bool:
    with TemporaryDirectory() as temp_dir:
        message_path = Path(temp_dir) / "message.bin"
        signature_path = Path(temp_dir) / "signature.bin"

        message_path.write_bytes(message)
        signature_path.write_bytes(signature)

        result = _run_openssl(
            [
                "pkeyutl",
                "-verify",
                "-pubin",
                "-inkey",
                str(public_key_path),
                "-in",
                str(message_path),
                "-sigfile",
                str(signature_path),
            ]
        )

        return result.returncode == 0