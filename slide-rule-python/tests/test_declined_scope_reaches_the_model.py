# -*- coding: utf-8 -*-
"""用户点「不对再说」之后，模型必须知道自己被否了。

抄的标准答案：grok-build
`xai-grok-tools/src/implementations/grok_build/enter_plan_mode/mod.rs`

    //! This tool requires user approval before executing. …
    //! If the user declines, the tool result is rejected and
    //! the model receives `"User declined to enter plan mode."`.

**拒绝是一句模型收得到的话**，不是静默的状态复位。

改造前的真机现状（2026-09-09 逐处查过）：

    _dismiss_scope        清 awaitReason → 写一条 scope_dismissed → yield complete
    控制面 messages       每轮从零拼 [system_prompt, user_text]，transcript 不进 messages
    scope_dismissed       全仓只在那一次写入处出现；提示词 facts 里没有，前端也没有

也就是模型**完全不知道**自己被拒过，下一轮可以把同一份范围原样再提一遍。

判据分四类，缺一类这条就白改：

1. **活路径**（§1）——三发真 HTTP（出卡 → 点不对再说 → 再说一句），
   量的是**下一发采样时模型真正收到的那段 system**，不是单独调 `_system_prompt`。
2. **反向**（§3）——没拒过不许有这句；拒完又确认了、或者又出了新卡，
   这条回执**必须过期**。只写正向的话，「永远把最后一张卡的话贴上去」也全绿。
3. **内容**——必须带上被拒的**那一句**。grok 只回一句「用户拒绝了」是因为
   它的模型手里还攥着刚发出的调用；我们每轮重拼 messages，模型手里什么都没有。
4. **不下命令**——措辞只陈述发生了什么。`_system_prompt` 头注记着 2026-09-08
   第 2 格的教训：现场写成流程命令，模型就开始填答题卡。
"""

from __future__ import annotations

import copy

import pytest

from control_turn_support import (
    ControlHarness,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from models.v5_state import V5SessionState
from services.rehearsal_control import _declined_scope, _system_prompt

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _state(rows) -> V5SessionState:
    st = V5SessionState(sessionId="declined-unit", goal={"text": "请假系统"})
    st.controlTranscript = list(rows)
    return st


CARD = {"kind": "scope_card", "text": "一个请假系统：员工提交、主管审批、HR 归档"}
DISMISS = {"role": "system", "kind": "scope_dismissed", "text": "先改范围"}
TURN = {"role": "user", "kind": "turn", "text": "改成报销"}


# ── 一、活路径：三发真 HTTP ────────────────────────────────────────────────


def test_点了不对再说_下一发采样时模型收得到(harness):
    sid = new_sid("declined")
    seed_session(sid, goal={"text": ""})
    shots: list = []

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        # 第 1 发：出范围卡。之后只说话，别再点火。
        if len(harness.llm_calls) == 1:
            return llm_tool("scope_card", {}, call_id="card")
        return llm_text("好的")

    harness.llm_impl = impl

    # ① 说一句产品话 → 模型开范围卡
    _, events = harness.post(six_fields(sid, "做一个请假系统"))
    card = next((e for e in events if e.get("type") == "control_scope_card"), None)
    assert card is not None, [e.get("type") for e in events]
    # ⚠ 别在这儿写死一句复述。复述是 `_restate` 真跑出来的，判据自己编一句
    #   就变成「我编的那句在不在」——量的不是产线。拿卡上真发出去的原话当键。
    restatement = str(card.get("restatement") or card.get("text") or "").strip()
    assert restatement, card

    # ② 点「不对再说」
    harness.post(six_fields(sid, "", forcedTool="dismiss_scope"))

    # ③ 再说一句 —— 这一发的 system 里必须带着那条回执
    before = len(shots)
    harness.post(six_fields(sid, "改成报销系统"))
    assert len(shots) > before, "第三轮压根没采样，这条判据量不到东西"

    system = str(shots[before][0].get("content") or "")
    assert shots[before][0].get("role") == "system"
    # 变异咬这一条：把 facts.append(_declined) 那段删掉 → 红。
    assert "不对再说" in system, system[-400:]
    # 必须带上**被拒的那一句**，不能只说「被拒了」。
    #
    # ⚠ 第一版写的是 `assert restatement[:20] in system` —— 变异测试当场
    #   打脸：把这条现场换成光秃秃的「用户点了「不对再说」。」，判据照样绿。
    #   因为复述的文字跟提示词里那行**话题**本来就重合，判据是被别处喂绿的。
    #   CLAUDE.md §2 点名的形态：匹配的词同时出现在文档串/别的段落里。
    #   修法：钉在**跟「不对再说」同一句**里，那才是这条改造真正产出的东西。
    line = next((seg for seg in system.split("。") if "不对再说" in seg), "")
    assert line, system[-400:]
    assert restatement[:20] in line, (restatement, line)


def test_没拒过的会话里不许出现这句(harness):
    """反向。少了它，「每轮都贴最后一张卡」照样绿。"""
    sid = new_sid("nodecline")
    seed_session(sid, goal={"text": ""})
    shots: list = []

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        if len(harness.llm_calls) == 1:
            return llm_tool("scope_card", {}, call_id="card")
        return llm_text("好的")

    harness.llm_impl = impl
    harness.post(six_fields(sid, "做一个请假系统"))
    before = len(shots)
    harness.post(six_fields(sid, "再补一句"))

    system = str(shots[before][0].get("content") or "")
    assert "不对再说" not in system, system[-400:]


# ── 二、回执会过期（对应 grok 那条只在那一轮出现一次）──────────────────


def test_被拒的那一句要原样带出来():
    assert _declined_scope(_state([CARD, DISMISS])) == CARD["text"]
    # 拒完用户又说了话，回执仍然新鲜——那正是它该被看见的那一轮。
    assert _declined_scope(_state([CARD, DISMISS, TURN])) == CARD["text"]


def test_没拒过就是空的():
    assert _declined_scope(_state([])) == ""
    assert _declined_scope(_state([CARD])) == ""
    assert _declined_scope(_state([CARD, TURN])) == ""


def test_确认之后回执就过期():
    """拒了一次、后来又谈成了 → 不许再翻旧账。

    变异：把「从末尾往回扫、碰到第一条非用户行」改成「全表里找有没有
    scope_dismissed」→ 本条红。
    """
    rows = [CARD, DISMISS, TURN, CARD, {"kind": "scope_confirmed"}]
    assert _declined_scope(_state(rows)) == ""


def test_又出了新卡_回执也过期():
    rows = [CARD, DISMISS, TURN, {"kind": "scope_card", "text": "报销系统"}]
    assert _declined_scope(_state(rows)) == ""


def test_找不到被拒的原话就不说():
    """只说「用户拒绝了某个你看不见的东西」对模型是纯噪音，宁可不说。"""
    assert _declined_scope(_state([DISMISS, TURN])) == ""
    st = _state([DISMISS, TURN])
    assert "不对再说" not in _system_prompt(st)


# ── 三、措辞：陈述，不是命令 ──────────────────────────────────────────────


def test_这条现场是事实不是流程命令():
    """`_system_prompt` 头注那条纪律（2026-09-08 第 2 格）：现场写成命令，
    模型就开始填答题卡。这里只许说「发生了什么」。"""
    st = _state([CARD, DISMISS, TURN])
    prompt = _system_prompt(st)
    line = next(
        (seg for seg in prompt.split("。") if "不对再说" in seg), ""
    )
    assert line, prompt[-400:]
    for bossy in ("必须", "不要再", "请重新", "应该"):
        assert bossy not in line, f"这条现场写成了命令：{line}"
