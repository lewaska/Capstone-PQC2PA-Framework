from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from app.services.rfc3161 import (
    Rfc3161Error,
    issue_rfc3161_response,
)

router = APIRouter(prefix="/tsa", tags=["tsa"])


@router.post("/rfc3161")
async def create_rfc3161_timestamp(
    request: Request,
) -> Response:
    query = await request.body()

    if not query:
        raise HTTPException(
            status_code=400,
            detail="RFC 3161 request가 비어 있습니다.",
        )

    try:
        timestamp_response = await run_in_threadpool(
            issue_rfc3161_response,
            query,
        )
    except Rfc3161Error as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    return Response(
        content=timestamp_response,
        media_type="application/timestamp-reply",
    )