"""Contract tests for POST /api/sliderule/aigc-pipeline-tryrun（AIGC 编排链路试跑，一期）.

语义锁点：
  1. 字段级传递——上一步 outputField 的产出注入下一步同 ref 的输入（与门禁
     handoff 校验同一规则）；
  2. fail-fast——某步失败即停，已完成步骤如实返回，不伪造下游产物；
  3. 诚实边界与单步试跑同口径：flag 关 → LLM_GENERATE_DISABLED；HTTP 恒 200。
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
    "pipeline": {"id": "pipe_1", "name": "选课文案链"},
    "steps": [
        {
            "id": "cap_summary",
            "name": "课程简介生成",
            "inputFields": ["course.title"],
            "outputField": "course.description",
        },
        {
            "id": "cap_slogan",
            "name": "招生口号生成",
            "inputFields": ["course.description"],
            "outputField": "course.slogan",
        },
    ],
    "inputs": {"course.title": "Python 入门"},
    "goal": "在线选课系统",
}


def test_flag_off_returns_disabled_diagnostic(monkeypatch):
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    res = client.post("/api/sliderule/aigc-pipeline-tryrun", json=PAYLOAD)
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "LLM_GENERATE_DISABLED"
    assert body["steps"] == []


def test_single_step_is_400():
    payload = {**PAYLOAD, "steps": PAYLOAD["steps"][:1]}
    res = client.post("/api/sliderule/aigc-pipeline-tryrun", json=payload)
    assert res.status_code == 400


def test_field_level_handoff_carries_prev_output(monkeypatch):
    """第 2 步的 prompt 必须携带第 1 步的产出（注入 course.description）。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    seen_prompts = []

    def fake_call_llm(messages, **_kw):
        user = messages[-1]["content"]
        seen_prompts.append(user)
        n = len(seen_prompts)
        return LlmResult(content=f"步骤{n}产出", usage=None, finish_reason="stop", model="test", latency_ms=1)

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    res = client.post("/api/sliderule/aigc-pipeline-tryrun", json=PAYLOAD)
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert [s["ok"] for s in body["steps"]] == [True, True]
    assert body["steps"][0]["output"] == "步骤1产出"
    # 衔接：第 2 步 prompt 含第 1 步产出（course.description ← 步骤1产出）
    assert "course.description：步骤1产出" in seen_prompts[1]


def test_fail_fast_keeps_completed_steps(monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "true")
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    calls = {"n": 0}

    def fake_call_llm(messages, **_kw):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise LlmError("rate limited")
        return LlmResult(content="首步产出", usage=None, finish_reason="stop", model="test", latency_ms=1)

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    res = client.post("/api/sliderule/aigc-pipeline-tryrun", json=PAYLOAD)
    body = res.json()
    assert body["ok"] is False
    assert len(body["steps"]) == 2  # 首步成功 + 第二步失败记录，无第三步伪造
    assert body["steps"][0]["ok"] is True
    assert body["steps"][1]["ok"] is False
    assert body["steps"][1]["code"] == "LLM_GENERATE_FAILED"
