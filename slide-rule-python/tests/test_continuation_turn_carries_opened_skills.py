"""同一件事的续跑回合（答问卷、批准计划）：规划里已经打开的技能由宿主带进来，模型不用一份份重开。

⚠ 2026-10-02 隔离真机第 181 轮 sr-20261001074130-DJAR0Z8FYN（门店月度复盘 PPT，下面的话题、技能顺序照原样）：
  规划开 6 份 → 答完问卷那一回合重开 6 份 → 批准后执行回合再开 7 份，一件事 20 次 skill()，
  每回合一轮并行重开、宿主逐个分发二十来秒，正文整份再进一次上下文。会话缓存只留 6 份，那一轮开过 8 份，data-storytelling、pptx-deck-context 已经被挤掉了。
技能正文用仓库里真的种子包（local_seed_skill_info），走真 HTTP（ControlHarness），跟产线同一条分发。

变异（逐条实测过）：
  去掉批准那条路上的 *_carried_skill_messages → 第一、四条红；
  去掉 _messages_after_need_answer 里的 → 第二、三条红；
  skill 分发改回按 transcript 数「本回合开过」→ 第三条、最后一条红；
  _SKILL_CACHE_MAX 改回 6 → 第四条红；
  skill 放回 microcompact 的 _MICRO_TOOLS → 第一、三、七、八条红；
  skills_in_context 改回严格 json.loads（不认后面贴着的 <system-reminder>）→ 第七条红。
"""

from __future__ import annotations

import copy
import json

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services import rehearsal_control as control
from services.skill_catalog_store import local_seed_skill_info

ROUND181_TOPIC = "做一份给新店长的门店月度复盘 PPT：销售、客流和转化率、毛利、问题和下月计划，6 页左右，要有原生图表"
# 第 181 轮规划时打开的顺序
PLANNING = ["office-skills", "pptx-deck-context", "pptx-slide-specification",
            "data-visualization-discipline", "data-storytelling", "theme-factory"]
LATER = ["verification-before-completion", "pptx-quality-gates"]
PLAN = "6 页：封面结论、销售、客流与转化率、毛利、问题、下月计划；python-pptx 原生图表，生成后回读核验。"


@pytest.fixture
def harness(monkeypatch):
    infos = [local_seed_skill_info(name) for name in PLANNING + LATER]
    assert all(infos), "种子包里应该都有"
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: list(infos))
    return ControlHarness(monkeypatch)


def _script(harness, steps):
    seen, it = [], iter(steps)

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return next(it)

    harness.llm_impl = impl
    return seen


def _carried(messages):
    """messages 里由宿主带进来的技能：{名字: 回执正文}。"""
    ids = {}
    for m in messages:
        for call in m.get("tool_calls") or []:
            if call["id"].startswith(control.CARRIED_SKILL_CALL_PREFIX):
                ids[call["id"]] = json.loads(call["function"]["arguments"])["name"]
    return {ids[m["tool_call_id"]]: json.loads(m["content"]) for m in messages
            if m.get("role") == "tool" and m.get("tool_call_id") in ids}


def _plan_and_ask(harness):
    sid = new_sid("carry-skills")
    seed_session(sid, goal={"text": ROUND181_TOPIC, "status": "clear"})
    _script(harness, [llm_tool("skill", {"name": n}) for n in PLANNING]
            + [llm_tool("ask_user_question", {"question": "这份复盘使用哪类数据？", "options": ["先用示例数据", "我来上传"]})])
    _, events = harness.post(six_fields(sid, ROUND181_TOPIC))
    ask = next(e for e in events if e["type"] == "control_ask_user")
    return sid, ask


def _answer(harness, sid, ask, steps):
    seen = _script(harness, steps)
    _, events = harness.post(six_fields(sid, "先用示例数据", toolAnswer={
        "kind": "ask_user_question", "text": "先用示例数据", "reqId": ask["reqId"]}))
    return seen, events


def _approve(harness, sid, events, steps):
    approval = next(e for e in events if e["type"] == "control_plan_approval")
    seen = _script(harness, steps)
    _, out = harness.post(six_fields(sid, "Approve", toolAnswer={
        "kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved"}))
    return seen, out


def _skill_receipts(events):
    return [e for e in events if e.get("type") == "control_tool_result" and e.get("tool") == "skill"]


def test_the_execution_turn_starts_with_the_planning_skills_already_loaded(harness):
    sid, ask = _plan_and_ask(harness)
    _seen, events = _answer(harness, sid, ask, [
        llm_tool("write_plan", {"planContent": PLAN}), llm_tool("exit_plan_mode", {})])
    seen, _ = _approve(harness, sid, events, [llm_text("好的。")])
    carried = _carried(seen[0])
    assert list(carried) == PLANNING                                   # 一份不少，顺序跟打开时一样
    body = carried["data-visualization-discipline"]["skill_message"]
    assert body.startswith('<skill name="data-visualization-discipline"')
    assert local_seed_skill_info("data-visualization-discipline").body[:200] in body  # 真正文，不是一句「已加载」
    note = next(m["content"] for m in seen[0] if m["role"] == "user" and str(m["content"]).startswith("用户已批准"))
    assert "已经在上面加载好了" in note and "不要再调 skill 重开" in note
    assert "执行中要用就先 skill 加载" not in note                      # 都带了，就不再让它重开


def test_answering_the_questionnaire_keeps_what_was_read_before_asking(harness):
    sid, ask = _plan_and_ask(harness)
    seen, _events = _answer(harness, sid, ask, [llm_text("好的。")])
    messages = seen[0]
    assert list(_carried(messages)) == PLANNING
    # 带进来的放在提问那一发之前：上下文顺序跟真实发生的一样
    ask_at = next(i for i, m in enumerate(messages) if any(
        c["function"]["name"] == "ask_user_question" for c in m.get("tool_calls") or []))
    carried_at = next(i for i, m in enumerate(messages) if any(
        c["id"].startswith(control.CARRIED_SKILL_CALL_PREFIX) for c in m.get("tool_calls") or []))
    assert carried_at < ask_at


def test_reopening_a_carried_skill_is_answered_without_resending_it(harness):
    sid, ask = _plan_and_ask(harness)
    _seen, events = _answer(harness, sid, ask, [
        llm_tool("skill", {"name": "data-visualization-discipline"}),   # 带过来的，再开一次
        llm_tool("skill", {"name": "verification-before-completion"}),  # 这段任务里没开过的
        llm_tool("write_plan", {"planContent": PLAN}), llm_tool("exit_plan_mode", {})])
    again, fresh = _skill_receipts(events)
    assert again["alreadyLoaded"] is True and "<skill " not in again["skill_message"]
    assert fresh.get("alreadyLoaded") is None and fresh["skill_message"].startswith('<skill name="verification-before-completion"')


def test_all_eight_skills_of_round_181_survive_to_the_execution_turn(harness):
    """第 181 轮一共开了 8 份（规划 6 + 答完问卷后 2），正文合计远没到字数上限，是份数上限 6 把两份挤掉了。"""
    sid, ask = _plan_and_ask(harness)
    _seen, events = _answer(harness, sid, ask, [llm_tool("skill", {"name": n}) for n in LATER]
                            + [llm_tool("write_plan", {"planContent": PLAN}), llm_tool("exit_plan_mode", {})])
    seen, _ = _approve(harness, sid, events, [llm_text("好的。")])
    assert sorted(_carried(seen[0])) == sorted(PLANNING + LATER)


def test_a_new_instruction_does_not_carry_anything(harness):
    """反向：新的一句用户话是新任务，开不开、开哪几份交给 Agent，宿主不替它带。"""
    sid, ask = _plan_and_ask(harness)
    _seen, events = _answer(harness, sid, ask, [
        llm_tool("write_plan", {"planContent": PLAN}), llm_tool("exit_plan_mode", {})])
    _approve(harness, sid, events, [llm_text("好的。")])
    seen = _script(harness, [llm_text("好的。")])
    harness.post(six_fields(sid, "第 4 页客流和转化率那张图看不清，帮我改清楚"))
    assert _carried(seen[0]) == {}


def test_nothing_opened_means_nothing_carried(harness):
    """反向：规划时一份没开，续跑回合不凭空塞技能。"""
    sid = new_sid("carry-none")
    seed_session(sid, goal={"text": ROUND181_TOPIC, "status": "clear"})
    _script(harness, [llm_tool("ask_user_question", {"question": "用哪类数据？", "options": ["示例", "上传"]})])
    _, events = harness.post(six_fields(sid, ROUND181_TOPIC))
    ask = next(e for e in events if e["type"] == "control_ask_user")
    seen, _ = _answer(harness, sid, ask, [llm_text("好的。")])
    assert _carried(seen[0]) == {}


# ── 同一回合里：开过的技能正文留在上下文里，「已加载」说的是实话 ─────────────────────────────


def test_every_skill_opened_this_turn_is_still_in_front_of_the_model(harness):
    """第 181 轮规划那一回合的原样顺序：开完 6 份再问模型，6 份正文都得还在。

    原来 microcompact 只留最近 4 万字的工具正文：data-visualization-discipline 一份 3.8 万字，
    排在它前面的 office-skills 等四份当场折成「本回合已经加载过，不要再调 skill」的桩。
    把 skill 放回 control_context_compact._MICRO_TOOLS，本条变红。"""
    sid = new_sid("carry-same-turn")
    seed_session(sid, goal={"text": ROUND181_TOPIC, "status": "clear"})
    seen = _script(harness, [llm_tool("skill", {"name": n}) for n in PLANNING]
                   + [llm_tool("skill", {"name": "data-visualization-discipline"}), llm_text("好的。")])
    _, events = harness.post(six_fields(sid, ROUND181_TOPIC))
    # 真机这一份回执后面贴着一段 <system-reminder>（只读提醒）——正文照样算在上下文里，再开回「已加载」
    assert _skill_receipts(events)[-1]["alreadyLoaded"] is True
    last = seen[-1]
    present = set()
    for m in last:
        if m.get("role") == "tool":
            body, _ = json.JSONDecoder().raw_decode(m["content"])  # 后面可能贴着 <system-reminder>
            if str(body.get("skill_message") or "").startswith("<skill "):
                present.add(body["skill"])
    assert present == set(PLANNING)


def test_a_skill_folded_by_the_window_can_be_loaded_again(harness, monkeypatch):
    """反向：窗口真快满时技能还是会折（最后折）；折掉的那份再开，回的是正文，不是「已加载」。
    这一份的正文真不在上下文里了，再说「已加载」就是第 181 轮那句谎话。
    分发改回按 transcript 数「本回合开过」，本条变红。"""
    from dataclasses import replace

    monkeypatch.setattr(control, "CONVERSATION_BUDGET",
                        replace(control.CONVERSATION_BUDGET, max_tokens=40_000, compact_at_tokens=12_000))
    sid = new_sid("carry-folded")
    seed_session(sid, goal={"text": ROUND181_TOPIC, "status": "clear"})
    _script(harness, [llm_tool("skill", {"name": n}) for n in PLANNING]
            + [llm_tool("skill", {"name": "office-skills"}),   # 最早开的，窗口压缩时折掉了
               llm_tool("skill", {"name": "theme-factory"}),   # 最近开的，还在
               llm_text("好的。")])
    _, events = harness.post(six_fields(sid, ROUND181_TOPIC))
    assert any(e.get("compacted") for e in events if e.get("type") == "control_text")  # 真走到了窗口压缩
    reopened, recent = _skill_receipts(events)[len(PLANNING):]
    assert reopened.get("alreadyLoaded") is None
    assert reopened["skill_message"].startswith('<skill name="office-skills"')
    assert recent["alreadyLoaded"] is True
