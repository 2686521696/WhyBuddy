"""按轮裁工具清单：这一轮做不成的事，别让模型看见。

抄的标准答案：grok-build `xai-tool-runtime/src/tool.rs`

    /// Per-turn listing predicate. Return `false` to exclude this tool
    /// from the model-facing manifest for a given turn.
    fn should_list(&self, _ctx: &ListToolsContext) -> bool { true }

比「闭集 + 分发时拒绝」强一档：模型**看不见**的工具，不需要写规则去拒绝它。
本仓分发器里那些防御性重定向（rehearse 未确认就 re-park、clarify 问过一轮
就改开范围卡）正是"本来就不该被列出"的现成清单——它们每次都要先让模型
挑一次、再被服务端纠正一次，白烧一轮。

缺省照 grok：没声明谓词的工具一律列出（`should_list` 默认 true）。

⚠ 底线：清单永不为空。全裁光了模型无事可做，比多列一个更糟。
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.rehearsal_control import (  # noqa: E402
    CLOSED_TOOLS,
    CONTROL_TOOLS,
    list_control_tools,
    should_list_tool,
)


def _names(state) -> set:
    return {t["function"]["name"] for t in list_control_tools(state)}


def _fresh() -> V5SessionState:
    return V5SessionState(sessionId="lst-fresh", goal={"text": "", "status": "needs_refinement"})


def _scoped() -> V5SessionState:
    """已开过范围卡并确认。"""
    return V5SessionState(
        sessionId="lst-scoped",
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "c1", "role": "system", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )


def _with_model() -> V5SessionState:
    """已经落过一版模型的会话。"""
    return V5SessionState(
        sessionId="lst-model",
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"systems": []}}],
        currentModelVersionId="v1",
    )


def test_default_is_list_absence_means_visible():
    """没声明谓词的工具一律列出（grok 的 `should_list` 默认 true）。

    ⚠ 这条原本拿 inspect_model 当例子，后来 inspect_model 也声明了谓词
      （见 test_inspect_model_hidden_without_anything_to_inspect），例子就得换。
      别再把它加回来：加回来这条就成了"断言一个有谓词的工具没被裁"，
      测的不是缺省行为。
    """
    assert should_list_tool("search_evidence", _fresh()) is True
    assert should_list_tool("ask_user", _fresh()) is True
    assert should_list_tool("scope_card", _fresh()) is True
    assert should_list_tool("一个还没声明谓词的新工具", _fresh()) is True


def test_rehearse_hidden_until_scope_confirmed():
    """分发器 :1672 本来就要把未确认的 rehearse re-park——别先让模型挑一次。

    「开始推演」按钮走 forcedTool，绕过 LLM（KD21），所以裁掉它不会
    让用户点不动。
    """
    assert "rehearse" not in _names(_fresh())
    assert "rehearse" in _names(_scoped())
    assert "spec" in _names(_scoped())
    assert "pages" not in _names(_scoped())
    with_model = _with_model()
    with_model.controlTranscript = [
        {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
    ]
    assert "rehearse" not in _names(with_model)
    assert "refine" in _names(with_model)
    assert "workflow" in _names(_scoped())
    assert "workflow" in _names(with_model)
    assert "workflow" not in _names(_fresh())
    assert "spec" not in _names(_fresh())


def test_pages_hidden_until_spec_exists():
    st = _scoped()
    st.specFirstPages = {
        "spec": {"appName": "请假", "pages": [{"id": "p1"}], "nodes": []},
        "pages": {},
    }
    names = _names(st)
    assert "spec" not in names
    assert "pages" in names
    assert "structure" not in names
    assert "bind" not in names
    st.specFirstPages["pages"] = {"p1": "<html>1</html>"}
    names = _names(st)
    assert "pages" in names
    assert "structure" in names
    assert "bind" in names
    assert "closure" in names


def test_workflow_tool_description_lists_registered_presets():
    """模型看不见配方名字就只能发明流程。删掉 list_control_tools 里的注入必红。"""
    tools = list_control_tools(_scoped())
    workflow = next(t for t in tools if t["function"]["name"] == "workflow")
    desc = workflow["function"]["description"]
    assert "pages-preview" in desc
    assert "product-rehearsal" in desc


def test_clarify_hidden_after_one_round():
    """分发器 :1631：问过一轮再问就改开范围卡。裁掉省一次往返。"""
    st = _fresh()
    assert "clarify" in _names(st)
    st.controlTranscript = [
        {"id": "c1", "role": "assistant", "kind": "clarify", "text": "问题一；问题二"}
    ]
    assert "clarify" not in _names(st)


def test_restore_version_hidden_without_a_previous_version():
    """_previous_model_version_id 对不上就返回 ""（fail-closed）——没上一版就别列。"""
    assert "restore_version" not in _names(_fresh())


def test_refine_and_fork_hidden_without_a_model():
    """空会话没东西可精修/可分叉。

    ⚠ 这条不是"顺手收紧"，是堵一个实测存在的洞：
      探针（空 goal + 夹具让模型挑 refine）实测
          helper(工厂信封) 调用次数: 1
          事件: ['control_handoff_factory', 'run_started', 'complete']
      —— 零范围卡就点着了火，违反验收 A「确认前 drive_full_* 调用 = 0」
      和 KD4。refine 的分发分支不像 rehearse 那样有 _scope_confirmed 兜底，
      而它现在是 WRITE，ToolScope 那道闸会放行。
      裁清单 + 分发兜底两处一起补（见 test_refine_without_model_reparks）。
    """
    assert "refine" not in _names(_fresh())
    assert "fork_variant" not in _names(_fresh())


def test_inspect_model_hidden_without_anything_to_inspect():
    """没有模型也没有闭环产物时，别让模型看见 inspect_model。

    ⚠ 2026-08-27 真机压测逮到的洞（refine/fork 补 _has_model 时漏掉的第三个）：
      同一句「中小学课后托管的报名、排班与考勤系统」连跑三遍，
          #1 scope_card → 范围卡 41s
          #3 scope_card → 范围卡 41s
          #2 inspect_model → 套话收尾 → **范围卡再没出现**，136s 打空
      真机会话 sr-20260827073836-C3VJV41PV5 的 controlTranscript 明写着
      `turn → clarify → turn → inspect_model → canned`。零模型的会话上
      `_inspect_digest` 只能回「当前还没有五系统模型可查看」，模型拿到这句
      就没有下一步了——不是它选错，是本来就不该让它看见这个选项。

    口径盯**能不能查到东西**，不盯 modelVersions 一个字段：`_inspect_digest`
    先读 publishClosure、再退 modelVersions，判据跟着它走（下面第二段）。
    """
    assert "inspect_model" not in _names(_fresh())
    assert "inspect_model" in _names(_with_model())


def test_inspect_model_visible_on_closure_only_sessions():
    """反向：有闭环产物、还没落版本的会话**必须**还能查看。

    这一条是上一条的对照。少了它，把谓词写成 `_has_model` 也全绿——
    而那样会在真机上把「跑完一轮、模型版本还没落库」的会话的查看入口
    裁没（CLAUDE.md §3：每写一条"不该有"，配一条"该有的还在"）。
    """
    state = _fresh()
    state.sessionId = "lst-closure-only"
    state.publishClosure = {"five_system_model": {"systems": []}}
    assert not (getattr(state, "modelVersions", None) or []), "前提：没有模型版本"
    assert "inspect_model" in _names(state)


def test_manifest_is_never_empty():
    """底线：全裁光比多列一个更糟。

    ⚠ 2026-08-27 变异检查逮到：只断言"现有状态下非空"咬不住这条底线——
      现有谓词组合下本来就裁不光，把兜底整段删掉判据照样全绿。
      所以这里**逼出**空清单：临时给每个工具都挂上恒假谓词，看兜底顶不顶得住。
    """
    from services import rehearsal_control as rc

    saved = dict(rc.TOOL_LIST_WHEN)
    try:
        rc.TOOL_LIST_WHEN.clear()
        rc.TOOL_LIST_WHEN.update({n: (lambda st: False) for n in CLOSED_TOOLS})
        floor = _names(_fresh())
        assert floor, "所有谓词都为假时清单空了——兜底没顶住，模型这一轮无事可做"
        assert floor == {"ask_user", "scope_card"}, (
            f"兜底放行的不是「问一句 / 开范围卡」，而是 {sorted(floor)}"
        )
    finally:
        rc.TOOL_LIST_WHEN.clear()
        rc.TOOL_LIST_WHEN.update(saved)

    for st in (_fresh(), _scoped()):
        assert len(list_control_tools(st)) > 0
    assert {"ask_user", "scope_card"} <= _names(_fresh()), (
        "空会话至少要留得下「问一句」和「开范围卡」，否则控制面无事可做"
    )


def test_listed_tools_are_a_subset_of_the_closed_set():
    """裁剪不许把闭集之外的东西放进来。"""
    for st in (_fresh(), _scoped()):
        assert _names(st) <= set(CLOSED_TOOLS)


def test_full_manifest_shape_is_untouched():
    """裁的是清单，不是工具定义本身——形状必须原样。

    workflow 除外：描述里要写上此刻已登记的配方名，改全局 CONTROL_TOOLS
    会让 schema 跟着注册表变，provider 那头不稳定。
    """
    listed = list_control_tools(_scoped())
    by_name = {t["function"]["name"]: t for t in listed}
    for t in CONTROL_TOOLS:
        n = t["function"]["name"]
        if n in by_name and n != "workflow":
            assert by_name[n] is t, f"{n} 的定义被复制/改写了，应当原样透传"
    assert by_name["workflow"] is not CONTROL_TOOLS[
        next(i for i, t in enumerate(CONTROL_TOOLS) if t["function"]["name"] == "workflow")
    ]


# ── 通电：光有 list_control_tools 不算数 ──────────────────────────


def test_llm_call_site_uses_the_filtered_manifest():
    """裁剪要真的接在喂给模型的那一处，不是摆着好看。

    变异：把调用点改回 tools=CONTROL_TOOLS → 本条必红。
    """
    import inspect
    import re

    from services import rehearsal_control as rc

    src = re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(rc))
    src = re.sub(r"#.*", "", src)
    assert "tools=list_control_tools(" in src, (
        "喂给控制模型的还是整张 CONTROL_TOOLS——裁剪没通电"
    )
    assert "tools=CONTROL_TOOLS" not in src, (
        "还留着直接传全量的调用点：裁剪会被绕过"
    )


def test_refine_without_model_reparks_instead_of_igniting():
    """分发兜底：裁清单挡不住硬调，refine 空会话必须 re-park 而不是点火。

    实测过的洞（探针）：空 goal 会话 + 夹具让模型挑 refine →
        helper(工厂信封) 调用次数: 1
        事件: ['control_handoff_factory', 'run_started', 'complete']
    零范围卡就点着了火。rehearse 有 _scope_confirmed 兜底，refine 没有，
    而它是 WRITE，ToolScope 那道闸会放行。两处都要补——清单裁掉是省一次
    往返，分发兜底才是闸。
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
        sid = new_sid("refine-no-model")
        seed_session(sid, goal={"text": "", "status": "needs_refinement"})
        harness.llm_impl = lambda messages, **kw: llm_tool("refine", {})
        _, events = harness.post(six_fields(sid, "做一个请假系统"))
        assert harness.helper_calls == [], (
            "空会话上 refine 点着了工厂——确认前 drive_full_* 必须是 0"
            f"（验收 A / KD4）。事件：{event_types(events)}"
        )
        assert "control_scope_card" in event_types(events), (
            "既没点火也没开范围卡：用户会看到一轮什么都没发生"
        )
    finally:
        mp.undo()
