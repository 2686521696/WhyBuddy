"""Contract tests for POST /api/sliderule/aigc-tryrun (AIGC 能力试跑).

诚实边界：flag 关 → LLM_GENERATE_DISABLED（不伪造输出）；LLM 失败 →
LLM_GENERATE_FAILED 透传原因；成功 → 原样返回 content。HTTP 恒 200，
诚实在 body 里（ok/code/detail）。
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

PAYLOAD = {
    "capability": {
        "id": "cap_summary",
        "name": "课程简介生成",
        "inputFields": ["course.title"],
        "outputField": "course.description",
    },
    "inputs": {"course.title": "Python 入门"},
    "goal": "在线选课系统",
}


def test_flag_off_returns_disabled_diagnostic(monkeypatch):
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    res = client.post("/api/sliderule/aigc-tryrun", json=PAYLOAD)
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "LLM_GENERATE_DISABLED"


def test_missing_capability_name_is_400():
    res = client.post("/api/sliderule/aigc-tryrun", json={"capability": {}, "inputs": {}})
    assert res.status_code == 400


def test_llm_failure_surfaces_fail_closed(monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")

    def boom(*args, **kwargs):
        raise LlmError("provider 502", transient=True)

    monkeypatch.setattr("sliderule_llm.client.call_llm", boom)
    res = client.post("/api/sliderule/aigc-tryrun", json=PAYLOAD)
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "LLM_GENERATE_FAILED"
    assert "502" in body["detail"]


def test_success_returns_llm_content_verbatim(monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")

    captured = {}

    def fake_call_llm(messages, **kwargs):
        captured["messages"] = messages
        return LlmResult(
            content="面向零基础学员的 Python 课程简介。",
            usage=None,
            finish_reason="stop",
            model="fake",
            latency_ms=5,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    res = client.post("/api/sliderule/aigc-tryrun", json=PAYLOAD)
    body = res.json()
    assert body["ok"] is True
    assert body["output"] == "面向零基础学员的 Python 课程简介。"
    assert body["elapsedMs"] >= 0
    # prompt 里带上了能力名、输入值与产品意图
    user_msg = captured["messages"][-1]["content"]
    assert "课程简介生成" in user_msg
    assert "Python 入门" in user_msg
    assert "在线选课系统" in user_msg
