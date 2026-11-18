"""HTTP endpoint for AI-assisted verification summaries."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    RateLimitError,
)
from pydantic import BaseModel, Field

from app.services.ai_summary import (
    AISummaryEmptyResponseError,
    AISummaryInputTooLargeError,
    AISummaryNotConfiguredError,
    summarize_report,
)


router = APIRouter(prefix="/ai", tags=["ai"])


class AISummaryRequest(BaseModel):
    audience: Literal["general", "researcher"] = "general"
    report: dict[str, Any] = Field(min_length=1)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
            }
        },
    )


@router.post("/summaries", response_model=None)
async def create_summary(body: AISummaryRequest) -> Any:
    try:
        result = await summarize_report(body.report, body.audience)
    except AISummaryNotConfiguredError:
        return _error(
            503,
            "AI_NOT_CONFIGURED",
            "AI 요약 서비스 설정을 확인해야 합니다.",
        )
    except AISummaryInputTooLargeError as exc:
        return _error(413, "AI_INPUT_TOO_LARGE", str(exc))
    except AISummaryEmptyResponseError:
        return _error(
            502,
            "AI_EMPTY_RESPONSE",
            "AI가 요약 결과를 반환하지 않았습니다.",
        )
    except AuthenticationError:
        return _error(
            503,
            "AI_AUTHENTICATION_FAILED",
            "AI 서비스 인증 설정을 확인해야 합니다.",
        )
    except RateLimitError:
        return _error(
            429,
            "AI_RATE_LIMITED",
            "AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
        )
    except APITimeoutError:
        return _error(
            504,
            "AI_TIMEOUT",
            "AI 응답 시간이 초과되었습니다.",
        )
    except APIConnectionError:
        return _error(
            502,
            "AI_CONNECTION_FAILED",
            "AI 서비스에 연결하지 못했습니다.",
        )
    except APIStatusError:
        return _error(
            502,
            "AI_UPSTREAM_ERROR",
            "AI 서비스가 요청을 처리하지 못했습니다.",
        )

    return {
        "data": {
            "summary": result.summary,
            "model": result.model,
            "request_id": result.request_id,
        }
    }
