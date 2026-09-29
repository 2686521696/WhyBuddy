"""服务在「只读查询」派发中重启：补齐、开新一轮，不判成需要人工对账。

⚠ 2026-09-29 隔离真机第 127 轮 sr-20260929141232-P9X867NGKK（书签网页）：容器重启正好落在
  `project_status {operationId, waitSeconds: 30}` 等构建的 30 秒里。checkpoint 停在 dispatching、挂着这一发、
  没有回执；恢复时一律 control_reconciliation_required，目标记 failed，页面黄条「控制面未返回结果」。
  下面 ROUND127_CALL / ROUND127_ASSISTANT 是那一份 checkpoint 里的原样（pendingCalls[0] 与最后一条 assistant）。

判据走真 ControlRunService 恢复。把 service 里 dispatching_readonly_checkpoint 那段删掉，第一条变红。
反向：挂着的是有副作用的工具（或混着一发），照旧对账，模型不被调用。
"""

from __future__ import annotations

import asyncio
import json
import time

import pytest

from control_turn_support import llm_text, six_fields
from services import rehearsal_control as control
from services.control_budget import PROJECT_BUDGET
from services.control_goal_continuation import READ_ONLY_TOOLS
from services.project_tool_contracts import PROJECT_TOOL_NAMES
from test_control_run_service import env, settled  # noqa: F401  （夹具）

ROUND127_CALL = {"arguments": {"operationId": "pop-d805704c69784b3881bbee97363098d1", "waitSeconds": 30},
                 "id": "call_IvZkkyfDahfSrmbkwsQKs9Qo", "name": "project_status"}
ROUND127_ASSISTANT = {"content": "", "role": "assistant", "tool_calls": [{"function": {
    "arguments": "{\"operationId\": \"pop-d805704c69784b3881bbee97363098d1\", \"waitSeconds\": 30}",
    "name": "project_status"}, "id": "call_IvZkkyfDahfSrmbkwsQKs9Qo", "type": "function"}]}
SHELL_CALL = {"arguments": {"command": "npm run build"}, "id": "call-shell", "name": "shell_exec"}
SHELL_ASSISTANT = {"content": "", "role": "assistant", "tool_calls": [{"function": {
    "arguments": "{\"command\": \"npm run build\"}", "name": "shell_exec"}, "id": "call-shell", "type": "function"}]}


def _checkpoint(pending, assistant):
    now = time.time()
    return {
        "schemaVersion": 1, "phase": "dispatching", "round": 15,
        "messages": [{"role": "system", "content": "sys"}, {"role": "user", "content": "做一个个人书签收藏网页"},
                     assistant],
        "startedAt": now, "cheapTokens": 338592, "retrySpent": 0, "retryStartedAt": now,
        "operationIds": [], "pendingCalls": pending, "content": "",
        "budgetPolicy": PROJECT_BUDGET.to_wire(),
        "options": {"user_text": "做一个个人书签收藏网页", "installed_skills": None, "active_connectors": None,
                    "preferred_device": None, "design_system_id": None,
                    "original_goal": "Build a small project", "empty_text": None, "tools": None},
    }


def _recover(env, monkeypatch, checkpoint, key):
    calls = []

    async def model(messages, **kwargs):
        calls.append(messages)
        return llm_text("构建还在跑，我再查一次状态。")
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    record = env.store.submit(env.state.sessionId, env.owner, key, six_fields(env.state.sessionId, "做一个个人书签收藏网页"))
    claimed = env.store.claim(record["runId"], "old-worker", 3)
    env.store.save_checkpoint(record["runId"], "old-worker", claimed["generation"], checkpoint)
    env.store.suspend(record["runId"], "old-worker", claimed["generation"])

    async def run():
        service = env.service()
        await service.start()
        try:
            return await settled(service, record["runId"])
        finally:
            await service.shutdown()
    return asyncio.run(run()), calls


def test_the_round127_status_wait_opens_a_new_round(env, monkeypatch):
    final, calls = _recover(env, monkeypatch, _checkpoint([ROUND127_CALL], ROUND127_ASSISTANT), "r127")
    assert final["error"] != "control_reconciliation_required", final
    assert calls, "只读查询中断没有开新一轮，模型没被再调用"
    flat = json.dumps(calls[0], ensure_ascii=False)
    assert "查询中断" in flat and ROUND127_CALL["id"] in flat          # 挂着那一发补了中断回执


@pytest.mark.parametrize("pending, assistant", [
    ([SHELL_CALL], SHELL_ASSISTANT),
    ([ROUND127_CALL, SHELL_CALL], ROUND127_ASSISTANT),
], ids=["side-effect", "mixed"])
def test_a_pending_side_effect_is_still_reconciled(env, monkeypatch, pending, assistant):
    final, calls = _recover(env, monkeypatch, _checkpoint(pending, assistant), "side-" + str(len(pending)))
    assert final["status"] == "interrupted" and final["error"] == "control_reconciliation_required"
    assert not calls


def test_the_read_only_names_are_real_tools():
    """判据自己的前提：名单里写错一个名字，那一发就会静默走对账。"""
    assert READ_ONLY_TOOLS - {"recall"} <= set(PROJECT_TOOL_NAMES)
    assert not READ_ONLY_TOOLS & {"shell_exec", "bash", "file_write", "file_str_replace", "project_patch",
                                  "project_verify", "project_start", "project_create", "browser_click"}
