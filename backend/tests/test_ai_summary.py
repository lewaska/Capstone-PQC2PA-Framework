import asyncio
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import SecretStr

from app.api.routes.ai import AISummaryRequest, create_summary
from app.core.config import settings
from app.services.ai_summary import (
    AISummaryInputTooLargeError,
    AISummaryResult,
    summarize_report,
)


def test_ai_summary_endpoint_returns_frontend_envelope() -> None:
    result = AISummaryResult(
        summary="검증 결과 요약",
        model="test-model",
        request_id="req_test",
    )
    async def fake_summarize_report(report, audience):
        return result

    with patch(
        "app.api.routes.ai.summarize_report",
        new=fake_summarize_report,
    ):
        response = asyncio.run(
            create_summary(
                AISummaryRequest(
                    audience="general",
                    report={"trust_status": "TRUSTED"},
                )
            )
        )

    assert response == {
        "data": {
            "summary": "검증 결과 요약",
            "model": "test-model",
            "request_id": "req_test",
        }
    }


def test_summary_service_uses_configured_secret(monkeypatch) -> None:
    calls = []

    async def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            output_text="정상 요약",
            _request_id="req_test",
        )

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            assert kwargs["api_key"] == "test-secret"
            self.responses = SimpleNamespace(create=create)

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            return None

    monkeypatch.setattr(settings, "openai_api_key", SecretStr("test-secret"))
    monkeypatch.setattr(settings, "openai_model", "test-model")
    monkeypatch.setattr(
        "app.services.ai_summary.AsyncOpenAI",
        FakeClient,
    )

    result = asyncio.run(
        summarize_report(
            {"trust_status": "TRUSTED"},
            "general",
        )
    )

    assert result.summary == "정상 요약"
    assert result.request_id == "req_test"
    assert len(calls) == 1
    assert calls[0]["store"] is False


def test_summary_service_rejects_large_input() -> None:
    with pytest.raises(AISummaryInputTooLargeError):
        asyncio.run(
            summarize_report(
                {"payload": "x" * (64 * 1024)},
                "general",
            )
        )
