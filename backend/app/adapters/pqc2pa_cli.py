import subprocess
from pathlib import Path
from typing import Sequence


class Pqc2paCliError(RuntimeError):
    """Rust PQ-C2PA CLI 실행에 실패했습니다."""


def run_pqc2pa_cli(
    *,
    executable_path: Path,
    arguments: Sequence[str | Path],
    timeout_seconds: int = 120,
) -> subprocess.CompletedProcess[str]:
    """Rust PQ-C2PA CLI를 실행하는 공통 어댑터입니다.

    구체적인 build/verify 명령과 인자 검증은 새 PQC 매니페스트
    프로파일 구현 단계에서 추가합니다.
    """
    if not executable_path.is_file():
        raise Pqc2paCliError(
            f"Rust CLI 파일이 없습니다: {executable_path}"
        )

    command = [str(executable_path), *(str(value) for value in arguments)]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise Pqc2paCliError(
            "Rust CLI 실행 시간이 초과되었습니다."
        ) from exc
    except OSError as exc:
        raise Pqc2paCliError(
            f"Rust CLI를 실행할 수 없습니다: {executable_path}"
        ) from exc

    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        raise Pqc2paCliError(
            message or "Rust CLI가 알 수 없는 오류로 종료되었습니다."
        )

    return result
