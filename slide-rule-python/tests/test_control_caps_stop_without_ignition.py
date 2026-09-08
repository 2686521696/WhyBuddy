"""M1 硬帽：8 轮 / 8k cheap tokens / 45s → 停在控制面，helper=0。

反向：删掉 in-loop / post-loop 的 over-cap return，这三条必须红。
Header grep 不算。

⚠ 2026-08-27 复审改判：这三条原来断言的是**同一个常量** OVER_CAP_TEXT——
  也就是说它们本来就分辨不出三种停法。把三条闸互相接错（墙钟到顶报成额度
  用完）照样全绿。现在各断各的 stopReason，接错就红。
  停止原因是数据这件事，抄的是 grok-build `StopCancelledReason`
  （见 services/rehearsal_control.py 那段头注）。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from services.rehearsal_control import (
    ControlStopReason,
    POST_SPEC_USER,
    POST_WRITE_FALLBACK,
    _cap_speech,
    stop_text,
)
from models.v5_state import V5SessionState

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _confirmed(sid: str) -> None:
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )


def _over_cap_texts(events) -> list:
    return [e.get("text") for e in events if e.get("type") == "control_text"]


def _stops(events) -> list:
    """事件里带出来的结构化停止信息（前端据此分辨，不靠读那句话）。"""
    return [
        {k: e.get(k) for k in ("stopReason", "stoppedBy", "limit", "used")}
        for e in events
        if e.get("type") == "control_text" and e.get("stopReason")
    ]


def test_eight_tool_rounds_then_rehearse_stays_capped(harness):
    sid = new_sid("cap-rounds")
    _confirmed(sid)

    def impl(messages, **kw):
        n = len(harness.llm_calls)
        if n <= 8:
            return llm_tool(
                "search_evidence", {"query": f"q{n}"}, call_id=f"c{n}"
            )
        return llm_tool("rehearse", {}, call_id="rehearse")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "帮我搜一下再推演"))
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)
    [stop] = _stops(events)
    assert stop["stopReason"] == ControlStopReason.TOOL_ROUNDS.value, stop
    assert stop["stoppedBy"] == "runtime"
    # 抄 turn_hook 的 cancellation_context：光说"到顶了"没法行动，
    # 带上限额才知道是不是该调这个数。
    assert stop["limit"] == 8
    assert stop_text(ControlStopReason.TOOL_ROUNDS) in _over_cap_texts(events)
    assert len(harness.llm_calls) == 8


def test_token_cap_stops_before_rehearse_dispatch(harness):
    sid = new_sid("cap-tok")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "rehearse", {}, usage={"total_tokens": 8001}
    )
    _, events = harness.post(six_fields(sid, "开始"))
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)
    [stop] = _stops(events)
    assert stop["stopReason"] == ControlStopReason.TOKEN_BUDGET.value, stop
    assert stop["stoppedBy"] == "runtime"
    assert stop["limit"] == 8000 and stop["used"] == 8001


def test_wall_clock_cap_stops_before_dispatch(harness, monkeypatch):
    import services.rehearsal_control as rc

    sid = new_sid("cap-wall")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: llm_tool("rehearse", {})
    ticks = {"n": 0}

    def fake_mono():
        # 每次 +46s：HTTP 中间件若先调 monotonic，started 仍会与下一次
        # _maybe_over_cap 相差超过 45s。删掉 over-cap return → helper=1。
        ticks["n"] += 1
        return 1000.0 + ticks["n"] * 46.0

    monkeypatch.setattr(rc.time, "monotonic", fake_mono)
    _, events = harness.post(six_fields(sid, "现在有哪些角色？"))
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)
    [stop] = _stops(events)
    assert stop["stopReason"] == ControlStopReason.WALL_CLOCK.value, stop
    assert stop["stoppedBy"] == "runtime"
    assert stop["limit"] == 45.0
    assert harness.llm_calls == []


def test_三条闸报的是三个不同的原因_不是同一句话():
    """把三条闸摆在一起看：wire 值必须两两不同。

    ⚠ 这条是上面三条的"合"。分开看时，把墙钟那条错接成额度那条，只会让
      **一条**红；而真正要防的是"三种情况在前端长得一样"——那正是改这一版
      之前的现状（三条判据断言同一个常量）。
    """
    reasons = {
        ControlStopReason.WALL_CLOCK.value,
        ControlStopReason.TOKEN_BUDGET.value,
        ControlStopReason.TOOL_ROUNDS.value,
        ControlStopReason.LLM_UNAVAILABLE.value,
    }
    assert len(reasons) == 4
    texts = {
        stop_text(r)
        for r in (
            ControlStopReason.WALL_CLOCK,
            ControlStopReason.TOKEN_BUDGET,
            ControlStopReason.TOOL_ROUNDS,
            ControlStopReason.LLM_UNAVAILABLE,
        )
    }
    assert len(texts) == 4, "给用户看的话也塌成一句了"


def test_控制面挂了是_provider_不是_runtime(harness):
    """谁停的必须分清：我们的闸 vs 模型/网关。

    抄 grok 的 `CancelledBy`——"Derived from `reason` and shipped anyway, so
    hosts do not re-derive it as reasons are added"。前端不该自己维护一份
    reason → 归属的映射。

    对用户也是两句不同的话：额度到了再点一次可能就过了；网关挂了点一百次
    也没用。
    """
    from sliderule_llm.client import LlmError

    def boom(messages, **kw):
        raise LlmError("gateway timeout (522):", status=522, transient=True)

    sid = new_sid("cap-provider")
    _confirmed(sid)
    harness.llm_impl = boom
    _, events = harness.post(six_fields(sid, "现在有哪些角色？"))
    assert harness.helper_calls == [], "控制面挂了不许点火"
    [stop] = _stops(events)
    assert stop["stopReason"] == ControlStopReason.LLM_UNAVAILABLE.value, stop
    assert stop["stoppedBy"] == "provider", "把网关故障算成了我们自己的闸"
    texts = _over_cap_texts(events)
    assert any("522" in (t or "") for t in texts), texts
    assert not any("模型网关这会儿连不上" == (t or "") for t in texts)


def test_打孔失败时额度到顶要说失败页():
    """真机：p1/p2 failed 仍端「页面已经出来」= 装已经接好。"""
    state = V5SessionState(
        sessionId="cap-bind-fail",
        goal={"text": "鲜果速收", "status": "clear"},
        specFirstPages={
            "spec": {"appName": "鲜果速收", "pages": [{"id": "p1"}]},
            "pages": {"p1": "<html/>", "p2": "<html/>", "p3": "<html/>"},
            "pageBindStatus": {"p1": "failed", "p2": "failed", "p3": "bound"},
        },
    )
    text = _cap_speech(state, ControlStopReason.TOOL_ROUNDS)
    assert "failed" in text
    assert "p1" in text and "p2" in text
    assert "没点火" not in text
    assert "额度用完" not in text
    assert "闭环完成" not in text


def test_工厂出过页后轮次到顶不许说没点火(harness):
    """⚠ 2026-09-09 真机 sr-20260909032509：bind 都跑完了，收尾却端
    「思考额度用完了，先停在控制面没点火」。额度是闸，不是完工台词。

    变异：``_cap_speech`` 改回 ``stop_text`` → 本条红。
    反向：下面那条没出货的仍说没点火，不许一律换成「页面已经出来」。
    """
    sid = new_sid("cap-after-write")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {"appName": "请假", "pages": [{"id": "p1", "name": "申请"}]},
            "pages": {"p1": "<html>已出的页</html>"},
        },
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )

    def impl(messages, **kw):
        n = len(harness.llm_calls)
        if n <= 8:
            return llm_tool("search_evidence", {"query": f"q{n}"}, call_id=f"c{n}")
        return llm_tool("rehearse", {}, call_id="rehearse")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "帮我搜一下再推演"))
    texts = _over_cap_texts(events)
    blob = "\n".join(t or "" for t in texts)
    assert POST_WRITE_FALLBACK in blob, texts
    assert "没点火" not in blob, texts
    assert "额度用完" not in blob, texts
    [stop] = _stops(events)
    assert stop["stopReason"] == ControlStopReason.TOOL_ROUNDS.value, stop
    assert harness.helper_calls == []


def test_工厂出过页后token帽不许说额度用完(harness):
    """用户原话就是「别把额度用完当成完工台词」。stopReason 仍是 token_budget，
    给人看的那句必须是页面已经出来，不许再说没点火。"""
    sid = new_sid("cap-tok-after-write")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {"appName": "请假", "pages": [{"id": "p1", "name": "申请"}]},
            "pages": {"p1": "<html>已出的页</html>"},
        },
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "search_evidence", {"query": "q"}, usage={"total_tokens": 8001}
    )
    _, events = harness.post(six_fields(sid, "开始"))
    blob = "\n".join(t or "" for t in _over_cap_texts(events))
    assert POST_WRITE_FALLBACK in blob, _over_cap_texts(events)
    assert "额度用完" not in blob
    assert "没点火" not in blob
    [stop] = _stops(events)
    assert stop["stopReason"] == ControlStopReason.TOKEN_BUDGET.value, stop
    assert harness.helper_calls == []


def test_只有SPEC没有页面时轮次到顶说规格不是额度(harness):
    sid = new_sid("cap-after-spec")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {"appName": "请假", "pages": [{"id": "p1", "name": "申请"}]},
            "pages": {},
        },
    )

    def impl(messages, **kw):
        n = len(harness.llm_calls)
        if n <= 8:
            return llm_tool("search_evidence", {"query": f"q{n}"}, call_id=f"c{n}")
        return llm_tool("rehearse", {}, call_id="rehearse")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "帮我搜一下"))
    blob = "\n".join(t or "" for t in _over_cap_texts(events))
    assert POST_SPEC_USER in blob
    assert "没点火" not in blob
    assert "额度用完" not in blob


def test_非_LlmError_不许冒充网关连不上(harness):
    """persist / schema 自己炸了走 UNKNOWN，不许借网关那张嘴。"""

    def boom(messages, **kw):
        raise RuntimeError("persist exploded")

    sid = new_sid("cap-unknown")
    _confirmed(sid)
    harness.llm_impl = boom
    _, events = harness.post(six_fields(sid, "现在有哪些角色？"))
    assert harness.helper_calls == [], "控制面挂了不许点火"
    [stop] = _stops(events)
    assert stop["stopReason"] == ControlStopReason.UNKNOWN.value, stop
    texts = _over_cap_texts(events)
    assert not any("网关" in (t or "") for t in texts), texts
