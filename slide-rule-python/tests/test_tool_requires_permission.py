"""批准是工具声明的属性，由分发统一强制——不是每个分支各写一遍。

抄的标准答案：grok-build `xai-grok-workspace-types/src/types/tools.rs`

    pub struct ToolDef {
        pub name: String,
        ...
        /// Whether invocations require explicit user permission.
        pub requires_permission: bool,
    }

    pub enum ToolProgress {
        /// Tool started (after permission was granted, before execution).
        Started { call_id: ToolCallId },
        ...
    }

两件事：
  1. 「要不要批准」是**工具定义上的一个字段**，缺省 false；
  2. `Started` 的语义被钉死为「批准之后、执行之前」——所以未获批准的工具
     不许出现 Started。

本仓原来的形状：批准检查散在各自的 if 分支里——rehearse 一处
（`_scope_confirmed`）、refine 一处（`_has_model`，还是 2026-08-27 才补的，
补之前空会话上 refine 零范围卡就点火）。散着写的代价刚付过：**新加一个
贵动词很容易忘了写那一段**，而忘了不会报错，只会绕过范围卡。

⚠ 这条只搬机制，不扩大范围：声明的就是今天已经在查的那两个。
  「有模型时的 refine 要不要也出薄卡」是产品决定（M2 Q2），不在本次。

反向：删掉声明 / 删掉统一闸 / 未获批准时冒出 control_tool_start —— 都必须红。
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.rehearsal_control import (  # noqa: E402
    CLOSED_TOOLS,
    TOOL_PERMISSION,
    tool_permission_granted,
    tool_requires_permission,
)


def _fresh() -> V5SessionState:
    return V5SessionState(sessionId="perm-fresh", goal={"text": "", "status": "needs_refinement"})


def _confirmed() -> V5SessionState:
    return V5SessionState(
        sessionId="perm-ok",
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "c1", "role": "system", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )


def test_default_is_no_permission_needed():
    """缺省 false（grok 的 `requires_permission` 默认 false）。"""
    for name in ("ask_user", "clarify", "search_evidence", "inspect_model", "scope_card"):
        assert tool_requires_permission(name) is False
    assert tool_requires_permission("一个还没声明过的新工具") is False
    assert tool_permission_granted("search_evidence", _fresh()) is True


def test_the_expensive_verbs_declare_permission():
    """今天已经在查批准的那两个，一个不多一个不少。"""
    declared = {n for n in CLOSED_TOOLS if tool_requires_permission(n)}
    assert declared == {"rehearse", "refine"}, (
        f"要批准的工具集变了：{sorted(declared)}。"
        "多一个 = 用户平白多一次确认；少一个 = 那个动词能绕过范围卡点火。"
    )


def test_permission_table_only_covers_closed_tools():
    assert set(TOOL_PERMISSION) - set(CLOSED_TOOLS) == set()


def test_rehearse_granted_only_after_scope_confirmed():
    assert tool_permission_granted("rehearse", _fresh()) is False
    assert tool_permission_granted("rehearse", _confirmed()) is True


def test_parked_on_scope_card_is_not_granted():
    """停泊 = 等确认，不是已确认（_scope_confirmed 头注记过这次评审）。"""
    st = _confirmed()
    st.awaitReason = "control_scope"
    assert tool_permission_granted("rehearse", st) is False


# ── 统一强制：未获批准不许执行，也不许冒出 Started ────────────────


def _run_tool(tool: str, *, goal_text: str = ""):
    """夹具让模型挑指定工具，回 (信封调用次数, 事件类型)。"""
    pytest.importorskip("fastapi")
    from control_turn_support import (  # noqa: PLC0415
        ControlHarness,
        event_types,
        llm_tool,
        new_sid,
        seed_session,
        six_fields,
    )
    import _pytest.monkeypatch as _mp

    mp = _mp.MonkeyPatch()
    try:
        harness = ControlHarness(mp)
        sid = new_sid(f"perm-{tool}")
        seed_session(sid, goal={"text": goal_text, "status": "needs_refinement"})
        harness.llm_impl = lambda messages, **kw: llm_tool(tool, {})
        _, events = harness.post(six_fields(sid, "做一个请假系统"))
        return len(harness.helper_calls), event_types(events)
    finally:
        mp.undo()


@pytest.mark.parametrize("tool", ["rehearse", "refine"])
def test_ungranted_tool_parks_instead_of_igniting(tool):
    calls, types = _run_tool(tool)
    assert calls == 0, (
        f"{tool} 未获批准就点了火——确认前 drive_full_* 必须是 0（验收 A / KD4）。事件：{types}"
    )
    assert "control_scope_card" in types, (
        f"{tool} 既没点火也没开范围卡：用户会看到一轮什么都没发生。事件：{types}"
    )


@pytest.mark.parametrize("tool", ["rehearse", "refine"])
def test_no_started_event_before_permission(tool):
    """grok：`Started` 是「批准之后、执行之前」。未获批准不许有 Started。"""
    _, types = _run_tool(tool)
    assert "control_tool_start" not in types, (
        f"{tool} 未获批准却发了 control_tool_start——Started 的语义是"
        f"「批准之后、执行之前」。事件：{types}"
    )
    assert "control_handoff_factory" not in types


def test_gate_is_declared_once_not_per_branch():
    """通电：闸要在统一出口上，不是各分支各写一段。

    变异：把统一闸删掉、退回每分支自查 → 上面的 park 判据仍可能绿
    （因为分支里还有），所以这条单独钉"只有一处"。
    """
    import inspect
    import re

    from services import rehearsal_control as rc

    src = re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(rc._dispatch_tool))
    src = re.sub(r"#.*", "", src)
    assert "tool_permission_granted(" in src, "分发器没走统一批准闸"
    assert src.count("tool_permission_granted(") == 1, (
        "统一闸出现了不止一次——又散回各分支了"
    )


def test_the_button_is_the_grant_not_a_bypass():
    """停泊态 + forcedTool=rehearse = 用户授予，必须点得着火。

    对照 grok：NeedPermission 是请求，用户回的 Permission{decision} 是授予。
    分发闸（TOOL_PERMISSION）管的是**模型自己挑** rehearse；按钮走 forced
    路径，是那个 decision 本身。
    变异：把 forced 路径那个 or 子句删掉 → 按钮永远点不着，本条必红。
    """
    pytest.importorskip("fastapi")
    from control_turn_support import (  # noqa: PLC0415
        ControlHarness,
        event_types,
        llm_tool,
        new_sid,
        seed_session,
        six_fields,
    )
    import _pytest.monkeypatch as _mp

    mp = _mp.MonkeyPatch()
    try:
        harness = ControlHarness(mp)
        sid = new_sid("perm-grant")
        seed_session(
            sid,
            goal={"text": "请假系统", "status": "clear"},
            awaitReason="control_scope",
            awaitDetail="请假系统",
        )
        harness.llm_impl = lambda messages, **kw: llm_tool("ask_user", {"question": "?"})
        _, events = harness.post(
            six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
        )
        assert len(harness.helper_calls) == 1, (
            f"停泊态点「开始推演」没点着火——授予被当成了未批准。事件：{event_types(events)}"
        )
        assert "control_scope_card" not in event_types(events), (
            "点了确认还在重开范围卡：用户会以为按钮坏了"
        )
    finally:
        mp.undo()
