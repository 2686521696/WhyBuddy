"""WRITE 工具跑完工厂后必须交回控制面。

第一版把 `control_handoff_factory` 和工厂 `complete` 都当循环终局，
点了 rehearse 控制面就 return——抄 grok 是工具流有自己的 Terminal，
host 循环另算。按钮点火仍跳过 LLM；工厂收尾必须再问一轮。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    PY_ROOT,
    ControlHarness,
    event_types,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
    strip_python,
)
from services.rehearsal_control import (
    CANNED_FAILURE,
    POST_SPEC_HOP_FALLBACK,
    POST_WRITE_FALLBACK,
    _after_write_hint,
    _factory_tool_body,
)
from models.v5_state import V5SessionState
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _scoped(sid: str):
    return seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )


def test_llm_rehearse_calls_llm_again_after_factory(harness):
    sid = new_sid("free-orch")
    _scoped(sid)
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("rehearse", {}, call_id="r1")
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "开始做请假系统"))
    assert len(harness.helper_calls) == 1
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert "factory_complete" in types, (
        "嵌套工厂的 complete 没改名——客户端会在工厂收尾处掐断 SSE"
    )
    assert any(
        e.get("type") == "control_tool_result"
        and e.get("tool") in ("spec", "rehearse")
        for e in events
    ), "WRITE 没有 control_tool_result 交回模型。"
    assert rounds["n"] >= 2, "工厂之后没有第二轮 LLM——控制面被 handoff 吞掉了"
    assert types[-1] == "complete"


def test_ask_user_still_parks_the_loop(harness):
    """反向：问用户仍然要停，不许为了自由编排把 park 也盘活。"""
    sid = new_sid("still-park")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        return llm_tool("ask_user", {"question": "做什么应用？"}, call_id="a1")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "你好"))
    assert "control_ask_user" in event_types(events)
    assert rounds["n"] == 1
    assert harness.helper_calls == []


def test_dispatch_factory_hops_are_on_the_live_path():
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "FACTORY_HOPS" in src
    assert "[hop]" in src
    assert "_factory_hop_blocker" in src
    assert "spec" in src


def test_loop_does_not_return_on_handoff_flag():
    """变异：把 `if parked or handed: return` 加回去，这条必须红。"""
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "if parked or handed:" not in src
    assert "factory_complete" in src
    assert "nest=True" in src
    assert "_resume_control_llm_after_write" in src
    assert "_after_write_hint" in src
    assert 'messages.append({"role": "user"' in src or "messages.append(" in src


def test_forced_rehearse_rejoins_loop_after_factory(harness):
    """按钮点火不经过 LLM；工厂收尾必须交回。把 handoff 后的 return 加回去，这条红。"""
    sid = new_sid("forced-rejoin")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "点火前不得问控制面模型"
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
    )
    assert len(harness.helper_calls) == 1
    assert harness.llm_calls, "工厂之后没有 LLM——自由编排没介入"
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert "factory_complete" in types, (
        "按钮路径 nest=False 的话客户端会在工厂 complete 处掐断 SSE"
    )
    assert any(
        e.get("type") == "control_tool_result"
        and e.get("tool") in ("spec", "rehearse")
        for e in events
    )
    assert any(
        e.get("type") == "control_text"
        and "页面已经出来" in str(e.get("text") or "")
        for e in events
    ), "交回之后的人话没上屏"
    assert types[-1] == "complete"
    fc = types.index("factory_complete")
    speech = next(
        i
        for i, e in enumerate(events)
        if e.get("type") == "control_text"
        and "页面已经出来" in str(e.get("text") or "")
    )
    last_complete = len(types) - 1 - types[::-1].index("complete")
    assert fc < speech < last_complete, (
        f"流序必须是 factory_complete → control_text → complete，实际 {types}"
    )


def test_after_write_hint_reads_this_hop_tools_not_stale_pages():
    """会话里还有上一跳的页面，本跳只跑了 spec，不许问结构绑定 / 假装页面刚出来。"""
    state = V5SessionState(
        sessionId="t-hint-hop",
        goal={"text": "图书馆", "status": "clear", "tools": ["spec"]},
        specFirstPages={
            "pages": {"p1": "<html>旧页</html>"},
            "capabilityPlan": {"tools": ["spec"]},
        },
    )
    hint = _after_write_hint(state)
    assert "本跳实际跑了" in hint
    assert "起草 SPEC" in hint
    assert "结构绑定" in hint
    assert "已经出过页面" not in hint
    assert "下一跳必须调 pages" in hint


def test_after_write_hint_full_hop_does_not_ask_structure_bind():
    state = V5SessionState(
        sessionId="t-hint-full",
        goal={"text": "图书馆", "status": "clear"},
        specFirstPages={
        "pages": {"p1": "<html>本跳页</html>"},
        "capabilityPlan": {"tools": ["spec", "pages", "bind"]},
    },
    )
    hint = _after_write_hint(state)
    assert "权限工作流" in hint or "bind" in hint
    assert "不要问已经跑过的那一步" in hint
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "_this_hop_tools" in src
    assert "capabilityPlan" in src


def test_forced_rehearse_empty_llm_uses_post_spec_hop_fallback(harness):
    """SPEC 单跳后模型空回复不许说页面已经出来，也不许套开场罐头。"""
    sid = new_sid("forced-empty")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    harness.llm_impl = lambda messages, **kw: llm_text("")
    _, events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
    )
    texts = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    blob = "\n".join(texts)
    assert POST_SPEC_HOP_FALLBACK in blob
    assert POST_WRITE_FALLBACK not in blob
    assert CANNED_FAILURE not in blob


def test_forced_refine_rejoins_loop_after_factory(harness):
    """成对改：精修按钮也 nest。只改 rehearse 等于一半不生效。"""
    sid = new_sid("forced-refine-rejoin")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
        specFirstPages={
            "spec": {"appName": "请假", "pages": [{"id": "p1", "name": "申请"}]},
            "pages": {"p1": "<html>旧</html>"},
        },
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "精修点火前不得问控制面模型"
        return llm_text("按钮已经改过了。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "把提交按钮改成红色", forcedTool="refine")
    )
    assert len(harness.helper_calls) == 1
    assert harness.helper_calls[0].get("profile") == "app"
    assert harness.helper_calls[0].get("goal_tools") == ["spec"]
    assert harness.llm_calls
    types = event_types(events)
    assert "factory_complete" in types
    assert any(
        e.get("type") == "control_tool_result" and e.get("tool") == "refine"
        for e in events
    )
    assert types[-1] == "complete"
    saved = load_session(sid)
    tools = (saved.goal or {}).get("tools") if saved and isinstance(saved.goal, dict) else None
    assert list(tools or []) == ["spec"], f"按钮精修缺省 spec，实际 {tools}"


def test_refine_branch_writes_tools_and_uses_app_profile():
    """建设单 O-1：变异把 goal['tools'] 或 profile='app' 改回 full → 红。"""
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    at = src.find("if forced == 'refine'")
    if at < 0:
        at = src.find('if forced == "refine"')
    assert at > 0
    repair_at = src.find("if forced == 'repair'", at)
    if repair_at < 0:
        repair_at = src.find('if forced == "repair"', at)
    body = src[at:repair_at]
    assert "_set_goal_tools" in body
    assert "profile='app'" in body or 'profile="app"' in body
    assert "profile='full'" not in body and 'profile="full"' not in body
    challenge_at = src.find("if forced == 'challenge'", repair_at)
    if challenge_at < 0:
        challenge_at = src.find('if forced == "challenge"', repair_at)
    repair = src[repair_at:challenge_at]
    assert "profile='full'" in repair or 'profile="full"' in repair
    assert "profile='app'" not in repair and 'profile="app"' not in repair


def test_workflow_tool_is_listed_and_handoffs_after_scope(harness):
    """抄 grok WorkflowTool：日历是可挑选的 WRITE，不是默认唯一路径。"""
    sid = new_sid("wf-pick")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool(
                "workflow",
                {"name": "product-rehearsal", "tools": ["spec", "pages"]},
                call_id="w1",
            )
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "按日历跑"))
    assert len(harness.helper_calls) == 1
    loaded = load_session(sid)
    assert loaded is not None
    tools = (loaded.goal or {}).get("tools") if isinstance(loaded.goal, dict) else None
    assert list(tools or []) == ["spec", "pages"]
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert "factory_complete" in types
    assert any(
        e.get("type") == "control_tool_result" and e.get("tool") == "workflow"
        for e in events
    )
    assert types[-1] == "complete"
    assert (loaded.goal or {}).get("workflow") == "product-rehearsal"


def test_forced_rehearse_stamps_scope_card_tools_onto_goal(harness):
    """范围卡 tools 必须落到 goal，工厂才能少跑。只打孔 plan 会假绿。"""
    sid = new_sid("scope-tools")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
        controlTranscript=[
            {
                "id": "ct-1",
                "kind": "scope_card",
                "text": "请假系统",
                "device": "desktop",
                "tools": ["spec", "pages", "closure"],
            }
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("页面已经出来。")
    harness.post(
        six_fields(
            sid,
            "将做成：请假系统",
            forcedTool="rehearse",
            tools=["spec", "pages", "closure"],
        )
    )
    loaded = load_session(sid)
    assert loaded is not None
    tools = (loaded.goal or {}).get("tools") if isinstance(loaded.goal, dict) else None
    assert list(tools or []) == ["spec", "pages"], (
        "开始推演跑首轮产出链，范围卡减菜仍是上限："
        "卡上 spec/pages/closure → 首轮只剩 spec+pages，不许把 structure/bind 塞回去，"
        "也不许只点火 spec。"
    )


def test_forced_rehearse_default_menu_is_first_pass_chain(harness):
    """没减菜时开始推演必须一口气跑 spec→bind，不许再只点火 spec。"""
    from services.capability_plan import FIRST_PASS_TOOLS

    sid = new_sid("first-pass")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    harness.llm_impl = lambda messages, **kw: llm_text("首轮做完了。")
    harness.post(six_fields(sid, "将做成：请假系统", forcedTool="rehearse"))
    loaded = load_session(sid)
    tools = (loaded.goal or {}).get("tools") if loaded and isinstance(loaded.goal, dict) else None
    assert list(tools or []) == list(FIRST_PASS_TOOLS), (
        f"开始推演没跑产出链：{tools}"
    )
    assert "closure" not in list(tools or [])
    assert harness.helper_calls[-1].get("goal_tools") == list(FIRST_PASS_TOOLS)


def test_pages_preview_workflow_stamps_recipe_tools_without_override(harness):
    """挑 pages-preview 必须带上配方默认 tools，不能再跑 bind。"""
    sid = new_sid("wf-preview")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("workflow", {"name": "pages-preview"}, call_id="w2")
        return llm_text("先看页面。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "先只出管理员看板"))
    assert len(harness.helper_calls) == 1
    loaded = load_session(sid)
    assert loaded is not None
    goal = loaded.goal if isinstance(loaded.goal, dict) else {}
    assert goal.get("workflow") == "pages-preview"
    assert list(goal.get("tools") or []) == ["spec", "pages", "closure"]
    assert "bind" not in (goal.get("tools") or [])
    assert "factory_complete" in event_types(events)


def test_llm_pages_without_spec_does_not_handoff(harness):
    """缺 SPEC 调 pages 必须 canned，不许进工厂。"""
    sid = new_sid("pages-no-spec")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_tool("pages", {}, call_id="p1")
    _, events = harness.post(six_fields(sid, "先出页面"))
    assert harness.helper_calls == []
    blob = "\n".join(str(e.get("text") or "") for e in events if e.get("type") == "control_text")
    assert "SPEC" in blob


def test_llm_pages_after_spec_handoffs(harness):
    """有 SPEC 之后 pages 必须进工厂，goal.tools 只有 pages。"""
    sid = new_sid("pages-after-spec")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {"appName": "请假", "pages": [{"id": "p1", "name": "首页"}], "nodes": []},
            "pages": {},
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("pages", {}, call_id="p1")
        return llm_text("页面出来了。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "出页面"))
    assert len(harness.helper_calls) == 1
    loaded = load_session(sid)
    tools = (loaded.goal or {}).get("tools") if loaded and isinstance(loaded.goal, dict) else None
    assert list(tools or []) == ["pages"]
    assert any(
        e.get("type") == "control_tool_result" and e.get("tool") == "pages"
        for e in events
    )
    assert rounds["n"] >= 2


def test_after_spec_hop_lists_pages_and_user_hint(harness):
    """SPEC 跳交回：提示词仍说下一跳 pages，但清单必须空——假设卡等确认。

    ⚠ 2026-09-02：交回时若仍列出 pages / scope_card，模型会自己点火或
      把范围卡弹回来，ComposerDock 有 pendingScope 就不画假设面板，
      「确认继续」点不着。变异：把 tools=[] 拿掉 → 本条红。
    """
    sid = new_sid("after-spec-hint")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    seen: dict = {"names": [], "users": []}

    def impl(messages, **kw):
        seen["names"] = [
            ((t.get("function") or {}).get("name"))
            for t in (kw.get("tools") or [])
        ]
        seen["users"] = [
            str(m.get("content") or "")
            for m in messages
            if m.get("role") == "user"
        ]
        return llm_text("先出页面。")

    harness.llm_impl = impl
    harness.post(six_fields(sid, "将做成：请假系统", forcedTool="rehearse"))
    assert harness.llm_calls, "工厂之后没有第二轮 LLM"
    assert seen["names"] == [], f"SPEC 跳完还带工具，会跳过假设确认：{seen['names']}"
    assert any("必须调 pages" in u for u in seen["users"]), (
        "提示词没作为 user 指令交回。只写进 system 会被下一句用户话盖掉。"
    )
    loaded = load_session(sid)
    assert loaded is not None
    body = _factory_tool_body(loaded, "spec")
    assert body.get("hasSpec") is True
    assert body.get("pageCount") == 0
    assert "pages" in str(body.get("nextHint") or "")


def test_factory_tool_body_counts_pages_from_the_dict():
    """变异：把 specFirstPages 当 list 量，pageCount 恒 0，host 以为没产物。"""
    from models.v5_state import V5SessionState

    st = V5SessionState(
        sessionId="body-pages",
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {"appName": "请假", "pages": [{"id": "p1"}, {"id": "p2"}], "nodes": []},
            "pages": {"p1": "<html>1</html>", "p2": "<html>2</html>"},
            "navItems": [],
        },
    )
    body = _factory_tool_body(st, "pages")
    assert body["pageCount"] == 2
    assert body["hasSpec"] is True
    assert body["declaredPages"] == 2
    assert "已经出过 2 页" in str(body.get("human") or "")


def test_host_hop_clips_factory_loop_to_one():
    """hop 成功还按 10 圈跑 = SPEC 起草两遍。剥注释后删掉 max_loops = 1 这条红。"""
    import inspect
    import re

    from services.v5_full_driver import (
        _host_factory_hop,
        drive_full_v5_session_stream,
    )
    from models.v5_state import V5SessionState

    st = V5SessionState(sessionId="hop-one", goal={"tools": ["spec"]})
    assert _host_factory_hop(st) is True
    st.goal = {"tools": ["spec", "pages"]}
    assert _host_factory_hop(st) is False

    src = inspect.getsource(drive_full_v5_session_stream)
    src = re.sub(r'"""[\s\S]*?"""', "", src)
    src = re.sub(r"#.*", "", src)
    hop_at = src.index("_host_factory_hop")
    window = src[hop_at : hop_at + 500]
    assert "max_loops = 1" in window, (
        "host hop 没有把工厂循环收成一跳。删掉这句，食堂那趟会再起草一遍 SPEC。"
    )
