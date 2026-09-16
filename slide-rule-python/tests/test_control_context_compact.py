# -*- coding: utf-8 -*-
"""上下文占用到 19.7 万就折叠较早的工具结果，不是把累计花费当硬闸。

变异：compact_messages 变成恒等 → 占用仍超阈值，活路径那条会停成
token_budget，而不是继续采样。
"""

from __future__ import annotations

import json

from services.control_budget import PROJECT_BUDGET, PROJECT_BUDGET_V1
from services.control_context_compact import (
    COMPACT_NOTICE_PREFIX,
    compact_messages,
    estimate_message_tokens,
    is_compact_notice,
)


def _history(*, tools: int, payload: str) -> list:
    messages = [
        {"role": "system", "content": "你是控制面。"},
        {"role": "user", "content": "做团长工作台"},
    ]
    for index in range(tools):
        call_id = f"call-{index}"
        messages.append({
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": call_id,
                "type": "function",
                "function": {"name": "project_read", "arguments": "{}"},
            }],
        })
        messages.append({
            "role": "tool",
            "tool_call_id": call_id,
            "content": payload,
        })
    return messages


def test_没到阈值不许动消息():
    messages = _history(tools=2, payload="短")
    out, report = compact_messages(messages, max_tokens=200_000, compact_at_tokens=197_000)
    assert report.did_compact is False
    assert out == messages


def test_到阈值就折叠较早的tool并留下最近两条():
    payload = "源码" * 4000
    messages = _history(tools=6, payload=payload)
    before = estimate_message_tokens(messages)
    assert before >= 8_000
    out, report = compact_messages(messages, max_tokens=12_000, compact_at_tokens=8_000)
    assert report.did_compact is True
    assert report.folded >= 1
    assert report.tokens_after < report.tokens_before
    assert any(is_compact_notice(row) for row in out)
    assert out[0]["content"] == "你是控制面。"
    assert out[1]["content"].startswith(COMPACT_NOTICE_PREFIX)
    assert any(row.get("role") == "user" and "团长" in str(row.get("content")) for row in out)
    tool_bodies = [row["content"] for row in out if row.get("role") == "tool"]
    assert payload in tool_bodies[-1]
    assert tool_bodies.count(payload) <= 2


def test_工程档标定是20万窗口197000压缩_v1不压缩():
    """反向：v1 compact_at=0，把 v2 的数填进 v1 等于没换档。"""
    assert PROJECT_BUDGET.profile == "project-v2"
    assert PROJECT_BUDGET.max_tokens == 200_000
    assert PROJECT_BUDGET.compact_at_tokens == 197_000
    assert PROJECT_BUDGET.context_token_budget is True
    assert PROJECT_BUDGET.max_request_seconds == 600.0
    assert PROJECT_BUDGET.max_wall_seconds == 900.0
    assert PROJECT_BUDGET_V1.profile == "project-v1"
    assert PROJECT_BUDGET_V1.max_tokens == 64_000
    assert PROJECT_BUDGET_V1.compact_at_tokens == 0
    assert PROJECT_BUDGET_V1.context_token_budget is False
    assert PROJECT_BUDGET.should_compact(197_000) is True
    assert PROJECT_BUDGET.should_compact(196_999) is False
    assert PROJECT_BUDGET_V1.should_compact(1_000_000) is False


def test_折叠后的桩仍是json():
    messages = _history(tools=4, payload="X" * 20_000)
    out, report = compact_messages(messages, max_tokens=3_000, compact_at_tokens=2_000)
    assert report.did_compact
    stub = json.loads(next(row["content"] for row in out if row.get("role") == "tool"
                           and "compacted" in str(row.get("content"))))
    assert stub["compacted"] is True
