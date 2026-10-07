from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services.classic_c2pa import (
    ClassicC2PANotFoundError,
    ClassicC2PAReadError,
    read_and_parse_classic_manifest,
)

router = APIRouter(prefix="/assets", tags=["assets"])

ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
}

MAX_UPLOAD_SIZE = 20 * 1024 * 1024


@router.post("/inspect")
async def inspect_asset(file: UploadFile = File(...)) -> dict:
    suffix = ALLOWED_CONTENT_TYPES.get(file.content_type or "")

    if suffix is None:
        raise HTTPException(
            status_code=415,
            detail="JPEG 또는 PNG 파일만 업로드할 수 있습니다.",
        )

    content = await file.read(MAX_UPLOAD_SIZE + 1)

    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail="파일 크기는 20MB를 초과할 수 없습니다.",
        )

    if suffix == ".jpg" and not content.startswith(b"\xff\xd8\xff"):
        raise HTTPException(
            status_code=400,
            detail="올바른 JPEG 파일이 아닙니다.",
        )

    if suffix == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(
            status_code=400,
            detail="올바른 PNG 파일이 아닙니다.",
        )

    with TemporaryDirectory() as temp_dir:
        image_path = Path(temp_dir) / f"upload{suffix}"
        image_path.write_bytes(content)

        try:
            parsed = read_and_parse_classic_manifest(image_path)

        except ClassicC2PANotFoundError:
            return {
                "filename": file.filename,
                "content_type": file.content_type,
                "size": len(content),
                "has_c2pa": False,
                "state": "NoManifest",
                "active_manifest": None,
                "claim": None,
                "assertions": [],
                "assertion_count": 0,
                "validation_status": [],
                "validation_results": None,
                "manifest": None,
            }

        except ClassicC2PAReadError as exc:
            raise HTTPException(
                status_code=422,
                detail=str(exc),
            ) from exc

        manifest_store = parsed["raw_manifest_store"]

        return {
            "filename": file.filename,
            "content_type": file.content_type,
            "size": len(content),
            "has_c2pa": True,
            "state": manifest_store.get(
                "validation_state",
                "Unknown",
            ),
            "active_manifest": parsed["active_manifest"],
            "claim": parsed["claim"],
            "assertions": parsed["assertions"],
            "assertion_count": parsed["assertion_count"],
            "required_assertions_observed": parsed[
                "required_assertions_observed"
            ],
            "validation_status": parsed["validation_status"],
            "validation_results": parsed["validation_results"],
            "manifest": manifest_store,
        }