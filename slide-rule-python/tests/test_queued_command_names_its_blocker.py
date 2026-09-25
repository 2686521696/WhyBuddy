"""排队的命令要说清被谁挡住。

⚠ 2026-09-25 隔离真机 sr-20260925025649-74E9KCWHAB（记账网页）：runtime.start
  起了开发服务器（runtime ready、操作 running），之后 project_exec、shell_exec、
  browser_navigate 全是 queued。模型六次 project_status 只看见
  `"status": "queued"`，回执里没有一个字说是谁挡着、挡的那个会不会让路；
  前台 shell_exec 每次还白等满 120 秒。

判据走真的 `_dispatch_tool`（控制面分发 → ProjectTools → SQL 存储），租约
形状照真机：processRefs.operationId 指着那条 running 的 runtime.start。
删掉 rehearsal_control 里 explain_queue 那一行，第一条变红；删掉提前放行，
第二条变红（等满 8 秒）。
"""

from __future__ import annotations

import asyncio
import time

from models.project_runtime import RuntimeInstance
from models.v5_state import V5SessionState
from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import rehearsal_control as rc
from test_project_tools import create, setup  # noqa: F401  （夹具）


def _hold_runtime(setup, project, kind="runtime.start", status="running"):
    """照真机摆出挡路的那条：租约未过期、processRefs 指向它。"""
    inputs = {"port": 5173} if kind == "runtime.start" else {"command": "build"}
    operation = setup.store.create_operation(
        project["projectId"], owner_id="alice", kind=kind,
        idempotency_key="holder-" + kind, expected_revision=project["revision"],
        approval_ref=setup.approval, input=inputs)
    lease = setup.store.acquire_lease(project["projectId"], owner_id="alice",
        lease_owner="runtime-live", ttl_seconds=600)
    setup.store.claim_operation(operation.operationId, owner_id="alice",
        lease_owner=lease.leaseOwner, generation=lease.generation)
    runtime = RuntimeInstance(
        runtimeId="rt-live", workspaceId=lease.workspaceId, projectId=project["projectId"],
        revision=project["revision"], status="ready" if kind == "runtime.start" else "executing",
        port=5173, health="revision_verified" if kind == "runtime.start" else "unknown",
        lastHeartbeat="now")
    setup.store.update_runtime_operation(
        operation.operationId, owner_id="alice", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status=status,
        runtime=runtime, result={})
    setup.store.flush_operation_event(operation.operationId, owner_id="alice",
        lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    setup.store.renew_lease(project["projectId"], owner_id="alice",
        lease_owner=lease.leaseOwner, generation=lease.generation, ttl_seconds=600,
        process_refs={"operationId": operation.operationId})
    return operation.operationId


def _dispatch(setup, name, args):
    state = V5SessionState.server_load(setup.sessions.load(setup.state.sessionId).payload)
    token = rc._PROJECT_TOOLS.set(setup.tools)

    async def run():
        return [ev async for ev in rc._dispatch_tool(
            name, args, state, "", [], [], "desktop", None, "")]

    try:
        events = asyncio.run(run())
    finally:
        rc._PROJECT_TOOLS.reset(token)
    return next(ev for ev in events if ev["type"] == "control_tool_result")


def test_a_command_behind_the_dev_server_says_who_blocks_it(setup):
    project = create(setup)
    holder = _hold_runtime(setup, project)
    result = _dispatch(setup, "shell_exec", {"command": "npm run build"})
    assert result["ok"] is True and result["status"] == "queued", result
    assert result["blockedBy"] == {"operationId": holder, "kind": "runtime.start", "status": "running"}
    hint = result["queueHint"]
    assert holder in hint
    # 语义：挡路的不会自己让路；出路是停掉它。
    assert "不会自己结束" in hint and "shell_kill_process" in hint


def test_a_foreground_shell_behind_the_dev_server_does_not_wait_it_out(setup, monkeypatch):
    monkeypatch.setattr(rc, "SHELL_EXEC_FOREGROUND_BLOCK_SECONDS", 8)
    project = create(setup)
    _hold_runtime(setup, project)
    started = time.monotonic()
    result = _dispatch(setup, "shell_exec", {"command": "npm run build"})
    assert result["status"] == "queued"
    assert time.monotonic() - started < 4


def test_a_command_behind_a_finishing_exec_is_told_to_wait_not_to_kill(setup, monkeypatch):
    """反向：挡路的是会结束的命令，不许劝模型去杀它。"""
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)  # 只看回执，不看等待
    project = create(setup)
    holder = _hold_runtime(setup, project, kind="runtime.exec")
    result = _dispatch(setup, "project_status", {"operationId": setup.store.create_operation(
        project["projectId"], owner_id="alice", kind="runtime.exec", idempotency_key="later",
        expected_revision=project["revision"], approval_ref=setup.approval,
        input={"command": "build"}).operationId})
    assert result["blockedBy"]["operationId"] == holder
    assert "shell_kill_process" not in result["queueHint"]
    assert "结束后才会开始" in result["queueHint"]


def test_nothing_in_the_way_means_no_blocker_sentence(setup, monkeypatch):
    """反向：没人占着租约，queued 只是还没轮到，回执不编一个挡路的。"""
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    create(setup)
    result = _dispatch(setup, "project_exec", {
        "approvalRef": setup.approval, "expectedRevision": setup.store.get_revision(
            setup.store.get_project_for_session(setup.state.sessionId, owner_id="alice").projectId,
            owner_id="alice").revision,
        "idempotencyKey": "k1", "command": "build"})
    assert result["status"] == "queued", result
    assert "blockedBy" not in result and "queueHint" not in result
