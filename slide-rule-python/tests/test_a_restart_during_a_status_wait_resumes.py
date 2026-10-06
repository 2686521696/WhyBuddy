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
from project_actor_support import project_actor  # noqa: F401
from test_office_artifacts import tools_setup  # noqa: F401  （真 ProjectTools + supervisor）

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
    control_names = {tool["function"]["name"] for tool in control.CONTROL_TOOLS}
    # recall / subagent 是控制面工具（不是工程工具），但得是真名字
    assert {"recall", "subagent"} <= control_names
    assert READ_ONLY_TOOLS - {"recall", "subagent"} <= set(PROJECT_TOOL_NAMES)
    assert not READ_ONLY_TOOLS & {"shell_exec", "bash", "file_write", "file_str_replace", "project_patch",
                                  "project_verify", "project_start", "project_create", "browser_click"}


# —— 命令派发中重启：按调用 id 定下的键查回那条操作，拿真实状态当回执（2026-10-05） ——
#
# ⚠ 2026-10-05 真机 sr-20261005075508-N0HNNHN7SN（新员工入职 PPT）：容器重启落在 shell_exec 派发中。
#   checkpoint 停在 dispatching、挂着下面这一发（原样）；操作 pop-b9f40… 已经落库，但幂等键是随机 uuid，
#   恢复时只能 control_reconciliation_required、目标 failed。

R19_CALL = {"arguments": {"command": "python3 scripts/build_deck.py", "exec_dir": ".", "timeout": 300},
            "id": "call_N3jb9TAMes1c5no32nCTWIkF", "name": "shell_exec"}
R19_ASSISTANT = {"content": "", "role": "assistant", "tool_calls": [{"function": {
    "arguments": json.dumps(R19_CALL["arguments"]), "name": "shell_exec"}, "id": R19_CALL["id"], "type": "function"}]}


def _recorded_command(env, call_id):
    """那一发已经落库的工程操作：键按调用 id 定（跟派发时同一个函数）。"""
    from services.project_tools import control_call_operation_key
    project = env.project.create_project(env.state.sessionId, owner_id=env.owner,
                                         files={"README.md": "x"}, template_version="whybuddy-workspace-1",
                                         plan_ref="plan-1")
    return env.project.create_operation(project.projectId, owner_id=env.owner, kind="runtime.exec",
        idempotency_key=control_call_operation_key(call_id), expected_revision=project.currentRevision,
        approval_ref="plan-1", input={"command": "shell", "script": R19_CALL["arguments"]["command"]})


def test_a_command_already_recorded_is_reconciled_not_interrupted(env, monkeypatch):
    operation = _recorded_command(env, R19_CALL["id"])
    final, calls = _recover(env, monkeypatch, _checkpoint([R19_CALL], R19_ASSISTANT), "r19")
    assert final["error"] != "control_reconciliation_required", final
    assert calls, "查到了那条命令却没有开新一轮"
    flat = json.dumps(calls[0], ensure_ascii=False)
    assert operation.operationId in flat and "recoveredAfterRestart" in flat   # 回执是库里那条操作的真实状态
    assert "[服务重启]" in flat


def test_a_command_never_recorded_is_still_reconciled_by_hand(env, monkeypatch):
    """反向：库里没有这一发的操作（没落库就重启了）——不猜、不重放，照旧对账。"""
    _recorded_command(env, "call_some_other_call")
    final, calls = _recover(env, monkeypatch, _checkpoint([R19_CALL], R19_ASSISTANT), "r19-missing")
    assert final["status"] == "interrupted" and final["error"] == "control_reconciliation_required"
    assert not calls


def test_the_dispatched_command_is_keyed_by_its_call_id():
    """派发那一端：控制面这一发的 id 进了工程操作的幂等键（恢复时按同一个函数查）。"""
    from services import project_tools
    token = project_tools.CONTROL_CALL_ID.set(R19_CALL["id"])
    try:
        assert project_tools.control_call_operation_key(project_tools.CONTROL_CALL_ID.get()) == "call-" + R19_CALL["id"]
    finally:
        project_tools.CONTROL_CALL_ID.reset(token)
    assert project_tools.control_call_operation_key(None) is None


def test_the_control_loop_hands_the_call_id_to_the_project_tool(env, monkeypatch):
    """派发那一端（真控制回合）：执行工程工具时——在线程池里——拿得到这一发的 id。
    把 rehearsal_control 里设 PROJECT_CONTROL_CALL_ID 的那行删掉，这条红。"""
    from control_turn_support import llm_tool
    from services import project_tools
    seen = []

    def execute(adapter, name, args, state):
        seen.append((name, project_tools.CONTROL_CALL_ID.get()))
        return {"ok": False, "error": "fixture_stop"}
    from services.project_creation import create_session_project
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref,
                           template_id="react-vite")            # 有工程，shell_exec 才在清单里
    monkeypatch.setattr(control, "_execute_project_tool", execute)
    script = iter([llm_tool("shell_exec", R19_CALL["arguments"], call_id=R19_CALL["id"]), llm_text("停在这里")])

    async def model(messages, **kwargs):
        return next(script)
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    record = env.store.submit(env.state.sessionId, env.owner, "call-id",
                              six_fields(env.state.sessionId, "跑一下生成脚本"))

    async def run():
        service = env.service()
        await service.start()
        try:
            await settled(service, record["runId"])
        finally:
            await service.shutdown()
    asyncio.run(run())
    assert ("shell_exec", R19_CALL["id"]) in seen, seen
    assert project_tools.CONTROL_CALL_ID.get() is None                       # 派发完复位，不串到别处


def test_a_shell_command_dispatched_with_a_call_id_is_stored_under_it(tools_setup):
    """工程工具那一端（真 ProjectTools + supervisor）：带着调用 id 派发的 shell_exec，操作按 call-<id> 落库。
    把 _kernel_runtime 里换成 call_key 的那段删掉，这条红。"""
    from services import project_tools
    from services.project_tools import control_call_operation_key
    created = tools_setup.tools.execute("project_create", {"approvalRef": tools_setup.approval}, tools_setup.state)
    assert created["ok"], created
    token = project_tools.CONTROL_CALL_ID.set(R19_CALL["id"])
    try:
        tools_setup.tools.execute("shell_exec", {"command": "echo hi", "is_background": True}, tools_setup.state)
    finally:
        project_tools.CONTROL_CALL_ID.reset(token)
    found = tools_setup.store.operation_by_key(created["projectId"], control_call_operation_key(R19_CALL["id"]),
                                               owner_id="alice")
    assert found is not None and found.kind == "runtime.exec"
