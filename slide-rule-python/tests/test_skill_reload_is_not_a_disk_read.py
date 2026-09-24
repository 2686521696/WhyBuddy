# -*- coding: utf-8 -*-
"""本回合已加载的技能不许再灌全文（2026-09-21 sr-20260921150545-6QG1GNGP1P）。

真机：skill(office-skills) 成功 → 压缩桩写 file_read/grep → 再调 skill
第三遍 → control_producer_failed。判据必须走 dispatch，不许只测 helper。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from control_turn_support import (
    ControlHarness,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
    strip_python,
)
from models.v5_state import V5SessionState
from services.control_skills import parse_skill_md
from services.slide_rule_session import load_session
import services.rehearsal_control as control

CONTROL_SRC = Path(control.__file__)


def _skill(name: str, description: str, body: str):
    info = parse_skill_md(
        f"---\nname: {name}\ndescription: {description}\n---\n{body}\n",
        path=f".sliderule/skills/{name}/SKILL.md",
    )
    assert info is not None
    return info


def _fn_body(src: str, name: str) -> str:
    tree = ast.parse(src)
    fn = next(
        n
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
    )
    start = fn.lineno - 1
    end = fn.end_lineno or start + 1
    return "\n".join(src.splitlines()[start:end])


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_second_skill_call_same_turn_does_not_resend_body(harness, monkeypatch):
    office = _skill("office-skills", "做 PPT", "HOW TO MAKE PPT WITH PYTHON-PPTX")
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [office])
    sid = new_sid("skill-reload")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "clear"})
    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] <= 2:
            return llm_tool(
                "skill",
                {"name": "office-skills"},
                call_id=f"sk-{n['i']}",
            )
        return llm_text("开始写计划")

    harness.llm_impl = model
    _, events = harness.post(six_fields(
        sid,
        "@office-skills 做个PPT",
        selectedSkills=["office-skills"],
        installedSkills=["office-skills"],
    ))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert len(results) >= 2, [e.get("type") for e in events]
    assert results[0].get("ok") is True
    assert "HOW TO MAKE PPT WITH PYTHON-PPTX" in str(results[0].get("skill_message") or "")
    assert results[1].get("alreadyLoaded") is True
    assert "HOW TO MAKE PPT WITH PYTHON-PPTX" not in str(results[1].get("skill_message") or "")
    assert "不要再调 skill" in str(results[1].get("skill_message") or "")


def test_llm_fail_after_questionnaire_is_error_not_idle(harness):
    """问卷答案落了、模型 503，不许看起来像做完了。"""
    from sliderule_llm.client import LlmError

    sid = new_sid("ask-503")
    seed_session(sid, goal={"text": "做个PPT", "status": "needs_refinement"})
    harness.llm_impl = lambda *_a, **_k: llm_tool(
        "ask_user_question",
        {"question": "风格？", "options": ["浅色", "深色"]},
    )
    _, events = harness.post(six_fields(sid, "做个PPT"))
    ask = next(e for e in events if e.get("type") == "control_ask_user")
    req = ask.get("reqId")
    assert load_session(sid).awaitReason == "control_ask"

    def boom(*_a, **_k):
        raise LlmError(
            "upstream 503: All available accounts exhausted",
            status=503,
            transient=False,
        )

    harness.llm_impl = boom
    _, events = harness.post(six_fields(
        sid,
        "浅色",
        toolAnswer={
            "kind": "ask_user",
            "reqId": req,
            "outcome": "accepted",
            "answers": {"q1": ["浅色"]},
            "text": "浅色",
        },
    ))
    _assert_error_park(sid, events, "user_answer")


def test_first_turn_llm_fail_is_error_not_idle(harness):
    """⚠ 2026-09-21 sr-20260921155056-HKA1MC5142：首轮就 503。
    问卷那条只覆盖了 toolAnswer 路径。首轮没有停泊可清，`_canned`
    仍把 complete 画成 idle——卡片一样是「任务已完成」。
    """
    from sliderule_llm.client import LlmError

    sid = new_sid("first-503")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "needs_refinement"})

    def boom(*_a, **_k):
        raise LlmError(
            "upstream 503: All available accounts exhausted",
            status=503,
            transient=False,
        )

    harness.llm_impl = boom
    _, events = harness.post(six_fields(sid, "@office-skills 做个PPT"))
    _assert_error_park(sid, events)


def test_turn_after_503_does_not_finish_still_failed(harness):
    """⚠ 2026-09-22 BABCJGGB44：503 之后下一轮已经生成完并 idle，
    complete 仍是 failed/error、stop 为空。旧停泊必须在新一轮开头清掉。
    """
    from sliderule_llm.client import LlmError

    sid = new_sid("after-503")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "needs_refinement"})

    def boom(*_a, **_k):
        raise LlmError("upstream 503: Service temporarily unavailable", status=503, transient=True)

    harness.llm_impl = boom
    harness.post(six_fields(sid, "@office-skills 做个PPT"))
    parked = load_session(sid)
    assert parked.awaitReason == "error" and parked.runtimePhase == "failed"

    harness.llm_impl = lambda *_a, **_k: llm_tool("idle", {}, call_id="idle-1")
    _, events = harness.post(six_fields(sid, "继续执行。不要重做问卷。"))
    complete = next(e for e in reversed(events) if e.get("type") == "complete")
    st = complete.get("state") or {}
    assert st.get("runtimePhase") != "failed"
    assert st.get("awaitReason") != "error"
    assert complete.get("stopReason") is None
    done = load_session(sid)
    assert done.awaitReason != "error"
    assert done.runtimePhase != "failed"


def test_text_after_503_ends_idle_not_still_orchestrating(harness):
    """清掉失败停泊后，模型只用文字收口，complete 不能停在 orchestrating。"""
    from sliderule_llm.client import LlmError

    sid = new_sid("after-503-text")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "needs_refinement"})

    def boom(*_a, **_k):
        raise LlmError("upstream 503: Service temporarily unavailable", status=503, transient=True)

    harness.llm_impl = boom
    harness.post(six_fields(sid, "@office-skills 做个PPT"))
    harness.llm_impl = lambda *_a, **_k: llm_text("5 页已经生成。")
    _, events = harness.post(six_fields(sid, "继续执行。"))
    complete = next(e for e in reversed(events) if e.get("type") == "complete")
    st = complete.get("state") or {}
    assert st.get("runtimePhase") == "idle"
    assert not st.get("awaitReason")
    assert complete.get("stopReason") is None


def _assert_error_park(sid: str, events: list, *extra_kinds: str) -> None:
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "error"
    assert loaded.runtimePhase == "failed"
    assert loaded.awaitDetail == "llm_unavailable"
    kinds = [r.get("kind") for r in loaded.controlTranscript if isinstance(r, dict)]
    for kind in extra_kinds:
        assert kind in kinds
    assert "canned" in kinds
    complete = next(e for e in reversed(events) if e.get("type") == "complete")
    st = complete.get("state") or {}
    assert st.get("runtimePhase") == "failed"
    assert st.get("awaitReason") == "error"
    assert complete.get("stopReason") == "llm_unavailable"
    idle_done = [
        e for e in events
        if e.get("type") == "complete"
        and (e.get("state") or {}).get("runtimePhase") in (None, "idle")
        and not (e.get("state") or {}).get("awaitReason")
    ]
    assert not idle_done, idle_done


def test_skill_seed_fallback_when_turn_catalog_is_empty(harness, monkeypatch):
    """⚠ YKEDKJDJ5R：_skill_infos_for_turn 交空列表，点名仍必须打开种子 zip。"""
    monkeypatch.setattr(control, "_skill_infos_for_turn", lambda state: [])
    sid = new_sid("skill-invoke-seed")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "clear"})
    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-inv")
        return llm_text("开始写计划")

    harness.llm_impl = model
    _, events = harness.post(six_fields(sid, "@office-skills 做个PPT"))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("ok") is True, results[0]
    assert "office-skills" in str(results[0].get("skill_message") or "")
    assert int(results[0].get("seedBytes") or 0) > 80


def test_skill_loads_local_seed_when_catalog_is_empty(harness, monkeypatch):
    """⚠ 2026-09-21 XSGAMK9PYZ：GET /skills 已装 office-skills，
    skill() 却 available=[]。商店 unpack 失败时必须打开仓库种子 zip。
    """
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [])
    sid = new_sid("skill-seed")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "clear"})
    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-seed")
        return llm_text("开始写计划")

    harness.llm_impl = model
    _, events = harness.post(six_fields(
        sid, "@office-skills 做个PPT",
        selectedSkills=["office-skills"], installedSkills=["office-skills"],
    ))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("ok") is True, results[0]
    assert results[0].get("error") != "skill_not_found"
    body = str(results[0].get("skill_message") or "")
    assert "office-skills" in body
    assert len(body) > 80


def test_empty_catalog_still_loads_the_repo_office_seed(harness, monkeypatch):
    """商店目录这一发是空的，@office-skills 仍必须打开仓库种子。

    删掉 dispatch 里的 resolve_invoked_skill，本条变红。
    """
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [])
    sid = new_sid("skill-seed")
    seed_session(sid, goal={"text": "整理成 Word", "status": "clear"})

    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-empty")
        return llm_text("先问用途")

    harness.llm_impl = model
    _, events = harness.post(six_fields(
        sid, "@office-skills 将图片整理成 Word",
        selectedSkills=["office-skills"], installedSkills=["office-skills"],
    ))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("ok") is True, results[0]
    assert results[0].get("error") != "skill_not_found"
    assert int(results[0].get("seedBytes") or 0) > 0


def test_skill_survives_catalog_empty_after_plan_turn(harness, monkeypatch):
    """⚠ 2026-09-21 13ME64TF8Z：批准后新回合 skill_not_found。

    第一回合商店有 office-skills，第二回合目录空了。缓存必须还在。
    """
    office = _skill("office-skills", "做 PPT", "HOW TO MAKE PPT WITH PYTHON-PPTX")
    box = {"infos": [office]}
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: list(box["infos"]))
    sid = new_sid("skill-cache")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "clear"})

    n0 = {"i": 0}

    def first(*_a, **_k):
        n0["i"] += 1
        if n0["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-1")
        return llm_text("开始写计划")

    harness.llm_impl = first
    harness.post(six_fields(
        sid, "@office-skills 做个PPT",
        selectedSkills=["office-skills"], installedSkills=["office-skills"],
    ))
    loaded = load_session(sid)
    assert loaded is not None
    names = [row.get("name") for row in (loaded.controlSkillCache or [])]
    assert "office-skills" in names, loaded.controlSkillCache

    box["infos"] = []
    n = {"i": 0}

    def second(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-2")
        return llm_text("按计划继续")

    harness.llm_impl = second
    _, events = harness.post(six_fields(
        sid, "批准计划并执行",
        selectedSkills=["office-skills"], installedSkills=["office-skills"],
    ))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("ok") is True, results[0]
    assert results[0].get("error") != "skill_not_found"
    assert "HOW TO MAKE PPT WITH PYTHON-PPTX" in str(results[0].get("skill_message") or "")


def test_catalog_outage_still_opens_the_seed_and_says_why(harness, monkeypatch):
    """商店抛错不是空目录。种子仍打开，回执写明目录没答上来。"""
    def boom(_owner):
        raise RuntimeError("db down")

    monkeypatch.setattr(control, "installed_skill_infos", boom)
    sid = new_sid("skill-catalog-down")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "clear"})
    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-down")
        return llm_text("开始写计划")

    harness.llm_impl = model
    _, events = harness.post(six_fields(sid, "@office-skills 做个PPT"))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("ok") is True, results[0]
    assert results[0].get("catalogError") == "skill_catalog_unavailable"
    assert results[0].get("error") != "skill_not_found"
    assert "office-skills" in str(results[0].get("skill_message") or "")


def test_unknown_name_during_catalog_outage_is_not_skill_not_found(harness, monkeypatch):
    """目录没答上来时，不许把点名失败说成这个技能不存在。"""
    def boom(_owner):
        raise RuntimeError("db down")

    monkeypatch.setattr(control, "installed_skill_infos", boom)
    sid = new_sid("skill-catalog-miss")
    seed_session(sid, goal={"text": "做个东西", "status": "clear"})
    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "not-a-real-skill"}, call_id="sk-miss")
        return llm_text("目录没答上来")

    harness.llm_impl = model
    _, events = harness.post(six_fields(sid, "做个东西"))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("ok") is False
    assert results[0].get("error") == "skill_catalog_unavailable"
    assert "available" not in results[0]


def test_empty_catalog_that_answered_is_still_skill_not_found(harness, monkeypatch):
    """商店答了空目录，点了一个没有种子的名字，这才是 skill_not_found。"""
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [])
    sid = new_sid("skill-catalog-empty")
    seed_session(sid, goal={"text": "做个东西", "status": "clear"})
    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "not-a-real-skill"}, call_id="sk-empty-name")
        return llm_text("没有这个技能")

    harness.llm_impl = model
    _, events = harness.post(six_fields(sid, "做个东西"))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("error") == "skill_not_found"
    assert "catalogError" not in results[0]


def test_store_failure_is_not_swallowed_as_an_empty_catalog(monkeypatch):
    """把 installed_skill_infos 的异常再收成 []，本条变红。"""
    from services import skill_catalog_store as mod

    def boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(mod, "get_skill_catalog_store", boom)
    with pytest.raises(mod.SkillCatalogUnavailable):
        mod.installed_skill_infos("alice")


def test_reload_and_error_park_are_on_the_live_dispatch():
    body = _fn_body(strip_python(CONTROL_SRC), "_dispatch_tool")
    assert "_skills_loaded_this_turn" in body
    assert "alreadyLoaded" in body
    assert "_skill_turn_catalog" in body
    assert "classify_skill_catalog_result" in body
    loop = _fn_body(strip_python(CONTROL_SRC), "_control_llm_loop")
    fail_at = loop.find("except LlmError")
    park_at = loop.find("_park_control_error(", fail_at)
    generic_at = loop.find("except Exception", fail_at)
    park2_at = loop.find("_park_control_error(", generic_at)
    canned_in_fail = loop.find("_canned(", fail_at, generic_at)
    assert 0 <= fail_at < park_at < generic_at < park2_at
    assert canned_in_fail == -1, "LlmError 分支又走回了 _canned"


def test_skill_cache_holds_only_what_was_opened_and_is_capped():
    """会话缓存只留「真的 skill() 打开过」的那几份，并且封顶。

    ⚠ 2026-09-23 review：上一版 `_skill_infos_for_turn` 把**整份已装目录**
      连正文一起 `_remember_skill_infos` 进会话。种子包平均 ~6KB，装 20 个
      就是 ~120KB 每轮落库、只增不删。

    把 `_remember_skill_infos(state, merged)` 加回 `_skill_infos_for_turn`
    的收尾，或把 `_SKILL_CACHE_MAX` 去掉，本条变红。
    """
    from models.v5_state import V5SessionState
    from services import rehearsal_control as control
    from services.control_skills import SkillInfo

    def info(name, body_chars):
        return SkillInfo(name=name, description=f"{name} 一句话",
                         path=f".sliderule/skills/{name}/SKILL.md", body="正" * body_chars)

    state = V5SessionState(sessionId="sr-cache", ownerId="alice", goal={"text": "做PPT"})
    for index in range(control._SKILL_CACHE_MAX + 4):
        control._remember_skill_infos(state, [info(f"skill-{index}", 100)])

    rows = state.controlSkillCache or []
    assert len(rows) == control._SKILL_CACHE_MAX, rows
    # 淘汰最旧的，留最近打开的。
    assert [row["name"] for row in rows][-1] == f"skill-{control._SKILL_CACHE_MAX + 3}"
    assert "skill-0" not in {row["name"] for row in rows}

    # 一份大正文不许把窗口撑爆。
    state.controlSkillCache = None
    control._remember_skill_infos(state, [info("huge", control._SKILL_CACHE_MAX_CHARS)])
    control._remember_skill_infos(state, [info("next", 10)])
    total = sum(len(row["body"]) for row in state.controlSkillCache or [])
    assert total <= control._SKILL_CACHE_MAX_CHARS, total


def test_skill_cache_is_the_first_thing_slimmed_not_the_evidence():
    """落库超预算时先削缓存，不许拿闭环证据去给它腾地方（§7）。

    去掉 persistence._next_slim 里的 skill_cache 那一档，本条变红。
    """
    from models.v5_state import V5SessionState
    from services import persistence

    state = V5SessionState(
        sessionId="sr-slim", ownerId="alice", goal={"text": "做PPT"},
        controlSkillCache=[{"name": "office-skills", "description": "办公",
                            "path": "p", "body": "正" * 1000}],
        specFirstPages={"p1": "<html></html>"},
    )
    slimmed, flag = persistence._next_slim(state)
    assert flag == "skill_cache", flag
    assert slimmed.controlSkillCache is None
    # 证据还在：缓存削完才轮到页面。
    assert slimmed.specFirstPages == state.specFirstPages
    assert persistence._next_slim(slimmed)[1] != "skill_cache"
