"""Contract tests for POST /api/sliderule/tour-flavor（Work 模式五期 LLM 入魂档）.

诚实边界：flag 关 → LLM_GENERATE_DISABLED（不伪造台词）；LLM 失败 →
LLM_GENERATE_FAILED 人话化透传；不可解析输出 → LLM_BAD_OUTPUT；
成功 → rows/lines 原样返回（结构级消毒在客户端 tour-flavor.ts，
因为值要落进浏览器运行时）。HTTP 恒 200，诚实在 body 里。
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
    "appTitle": "工单审批系统",
    "entities": [
        {
            "id": "ticket",
            "name": "工单",
            "fields": [
                {"id": "title", "name": "标题", "type": "string"},
                {"id": "amount", "name": "金额", "type": "number"},
            ],
        }
    ],
    "steps": [
        {"index": 0, "kind": "walk", "role": "创作者", "target": "st-ticket"},
        {"index": 1, "kind": "create_row", "role": "创作者", "target": "st-ticket"},
    ],
}


def test_flag_off_returns_disabled_diagnostic(monkeypatch):
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    res = client.post("/api/sliderule/tour-flavor", json=PAYLOAD)
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "LLM_GENERATE_DISABLED"


def test_missing_steps_is_400():
    res = client.post("/api/sliderule/tour-flavor", json={"appTitle": "x", "entities": [], "steps": []})
    assert res.status_code == 400


def test_llm_failure_surfaces_fail_closed(monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")

    def boom(*args, **kwargs):
        raise LlmError("provider 502", transient=True)

    monkeypatch.setattr("sliderule_llm.client.call_llm", boom)
    res = client.post("/api/sliderule/tour-flavor", json=PAYLOAD)
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "LLM_GENERATE_FAILED"


def test_unparseable_output_is_honest(monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")

    def fake_call_llm(messages, **kwargs):
        return LlmResult(content="抱歉我只想聊聊天", usage=None, finish_reason="stop", model="fake", latency_ms=5)

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    res = client.post("/api/sliderule/tour-flavor", json=PAYLOAD)
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "LLM_BAD_OUTPUT"


def test_success_extracts_json_even_in_markdown_fence(monkeypatch):
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")

    captured = {}

    def fake_call_llm(messages, **kwargs):
        captured["messages"] = messages
        return LlmResult(
            content='```json\n{"rows": {"ticket": {"title": "官网首页改版报价", "amount": 12800}}, '
            '"lines": {"0": "今天必须把这单提上去", "1": "报价我再核一遍"}}\n```',
            usage=None,
            finish_reason="stop",
            model="fake",
            latency_ms=5,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm", fake_call_llm)
    res = client.post("/api/sliderule/tour-flavor", json=PAYLOAD)
    body = res.json()
    assert body["ok"] is True
    assert body["rows"]["ticket"]["amount"] == 12800
    assert body["lines"]["0"] == "今天必须把这单提上去"
    # 实体字段清单与步骤表进了 user 消息；system 说明 JSON 输出契约
    assert "ticket" in captured["messages"][-1]["content"]
    assert "JSON" in captured["messages"][0]["content"]
