"""可解释 AI 输出（加厚 schema 三期）测试。

锁：结构化解析（整段/围栏/花括号子串三路）、confidence 钳制与非法剔除、
output 缺失整体作废；路由 explain 通道成功返回 confidence/rationale、
非 JSON 时诚实降级纯文本（不造数字）、不传 explain 时行为与历史逐字节一致。
"""

import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import routes.sliderule_full as sliderule_full  # noqa: E402
from services.v5_explainable import parse_explained_output  # noqa: E402
from sliderule_llm.client import LlmResult  # noqa: E402


def test_parse_valid_json_and_clamping() -> None:
    parsed = parse_explained_output(
        '{"output": "月销售额约 12 万元", "confidence": 0.82, "rationale": "基于近三月均值外推"}'
    )
    assert parsed == {
        "output": "月销售额约 12 万元",
        "confidence": 0.82,
        "rationale": "基于近三月均值外推",
    }
    # 钳制：>1 → 1.0；<0 → 0.0
    assert parse_explained_output('{"output": "x", "confidence": 1.7}')["confidence"] == 1.0
    assert parse_explained_output('{"output": "x", "confidence": -3}')["confidence"] == 0.0
    # 非数值 confidence / 布尔剔除（不带字段，而非造数）
    assert "confidence" not in parse_explained_output('{"output": "x", "confidence": "高"}')
    assert "confidence" not in parse_explained_output('{"output": "x", "confidence": true}')
    # 空 rationale 剔除
    assert "rationale" not in parse_explained_output('{"output": "x", "rationale": "  "}')


def test_parse_fenced_and_embedded_json() -> None:
    fenced = '好的，结果如下：\n```json\n{"output": "内容", "confidence": 0.5}\n```'
    assert parse_explained_output(fenced)["output"] == "内容"
    embedded = '前缀文字 {"output": "内容2", "rationale": "依据"} 后缀'
    assert parse_explained_output(embedded)["rationale"] == "依据"


def test_parse_rejects_missing_or_empty_output() -> None:
    assert parse_explained_output('{"confidence": 0.9}') is None
    assert parse_explained_output('{"output": "  "}') is None
    assert parse_explained_output("这不是 JSON") is None
    assert parse_explained_output("") is None
    assert parse_explained_output(None) is None


# --- 路由契约 ---------------------------------------------------------------

app = FastAPI()
app.include_router(sliderule_full.router, prefix="/api/sliderule")
client = TestClient(app)

PAYLOAD = {
    "capability": {"id": "cap_x", "name": "销售预测", "outputField": "shop.forecast"},
    "inputs": {"shop.history": "近三月 10/11/13 万"},
    "goal": "门店经营系统",
    "explain": True,
}


def _fake_llm(content: str):
    def fake_call_llm(messages, **kwargs):
        fake_call_llm.messages = messages  # type: ignore[attr-defined]
        return LlmResult(content=content, usage=None, finish_reason="stop", model="fake", latency_ms=5)

    return fake_call_llm


def test_explain_success_carries_confidence_and_rationale(monkeypatch) -> None:
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    fake = _fake_llm('{"output": "预计 12.5 万", "confidence": 0.74, "rationale": "线性外推"}')
    monkeypatch.setattr("sliderule_llm.client.call_llm", fake)
    body = client.post("/api/sliderule/aigc-tryrun", json=PAYLOAD).json()
    assert body["ok"] is True
    assert body["explained"] is True
    assert body["output"] == "预计 12.5 万"
    assert body["confidence"] == 0.74
    assert body["rationale"] == "线性外推"
    # explain 时 system prompt 带结构化输出指令
    assert "confidence" in fake.messages[0]["content"]


def test_explain_degrades_to_plain_text_when_not_json(monkeypatch) -> None:
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    monkeypatch.setattr("sliderule_llm.client.call_llm", _fake_llm("预计 12.5 万（纯文本）"))
    body = client.post("/api/sliderule/aigc-tryrun", json=PAYLOAD).json()
    assert body["ok"] is True
    assert body["output"] == "预计 12.5 万（纯文本）"
    # 诚实降级：不带 explained/confidence/rationale，不造数字
    assert "explained" not in body
    assert "confidence" not in body
    assert "rationale" not in body


def test_without_explain_flag_behavior_unchanged(monkeypatch) -> None:
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    fake = _fake_llm('{"output": "看起来像 JSON 也不解析", "confidence": 0.9}')
    monkeypatch.setattr("sliderule_llm.client.call_llm", fake)
    payload = {**PAYLOAD}
    payload.pop("explain")
    body = client.post("/api/sliderule/aigc-tryrun", json=payload).json()
    # 不传 explain → 原样返回 content、无结构化字段、prompt 无 JSON 指令
    assert body["ok"] is True
    assert body["output"] == '{"output": "看起来像 JSON 也不解析", "confidence": 0.9}'
    assert "confidence" not in body
    assert "输出必须是一个 JSON 对象" not in fake.messages[0]["content"]
