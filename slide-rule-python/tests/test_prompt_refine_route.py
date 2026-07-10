"""Contract tests for POST /api/sliderule/prompt-refine（输入条「优化提示词」）.

诚实边界：flag 关 → LLM_GENERATE_DISABLED（不伪造输出）；LLM 失败 →
LLM_GENERATE_FAILED 人话化透传；LLM 空返回 → LLM_EMPTY_OUTPUT（原文不动）；
成功 → 改写后的提示词原样返回。HTTP 恒 200，诚实在 body 里。
"""

import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import routes.sliderule_full as sliderule_full  # noqa: E402
from sliderule_llm.client import LlmError, LlmResult  # noqa: E402


app = FastAPI()
app.include_router(sliderule_full.router, prefix="/api/sliderule")
client = TestClient(app)


def test_flag_off_returns_disabled_diagnostic(monkeypatch):
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    res = client.post("/api/sliderule/prompt-refine", json={"text": "做一个宠物寄养平台"})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "LLM_GENERATE_DISABLED"


def test_empty_text_is_400():
    res = client.post("/api/sliderule/prompt-refine", json={"text": "  "})
    assert res.status_code == 400


def test_llm_failure_surfaces_fail_closed(monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")

    def boom(*args, **kwargs):
        raise LlmError("provider 502", transient=True)

    monkeypatch.setattr("sliderule_llm.client.call_llm", boom)
    res = client.post("/api/sliderule/prompt-refine", json={"text": "做一个宠物寄养平台"})
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "LLM_GENERATE_FAILED"
    assert "502" in body["detail"]


def test_empty_llm_output_is_honest(monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")

    def fake_call_llm(messages, **kwargs):
        return LlmResult(content="  ", usage=None, finish_reason="stop", model="fake", latency_ms=5)

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    res = client.post("/api/sliderule/prompt-refine", json={"text": "做一个宠物寄养平台"})
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "LLM_EMPTY_OUTPUT"


def test_success_returns_refined_text(monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")

    captured = {}

    def fake_call_llm(messages, **kwargs):
        captured["messages"] = messages
        return LlmResult(
            content="做一个宠物寄养平台：宠物主发布寄养需求，寄养家庭接单……",
            usage=None,
            finish_reason="stop",
            model="fake",
            latency_ms=5,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    res = client.post("/api/sliderule/prompt-refine", json={"text": "做一个宠物寄养平台"})
    body = res.json()
    assert body["ok"] is True
    assert body["text"].startswith("做一个宠物寄养平台")
    assert body["elapsedMs"] >= 0
    # 用户原文进 user 消息；system 强调忠实原意
    assert captured["messages"][-1]["content"] == "做一个宠物寄养平台"
    assert "忠实" in captured["messages"][0]["content"]
