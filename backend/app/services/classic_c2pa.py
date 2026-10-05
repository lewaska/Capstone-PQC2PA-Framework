import json
from pathlib import Path
from typing import Any

from c2pa import Reader


class ClassicC2PAReadError(Exception):
    """Classic C2PA manifest를 읽지 못했습니다."""


def read_classic_manifest(image_path: Path) -> dict[str, Any]:
    try:
        reader = Reader(str(image_path))
        return json.loads(reader.json())
    except Exception as exc:
        raise ClassicC2PAReadError(
            "이미지에서 Classic C2PA manifest를 읽지 못했습니다."
        ) from exc