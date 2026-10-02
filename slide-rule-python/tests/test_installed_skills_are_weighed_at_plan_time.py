"""装了没点名的技能：定方案那一刻摆到 Agent 眼前（一次），批准后的执行轮说清规划时打开过哪些。

⚠ 2026-09-28 隔离真机第 92～96 轮，每轮装两份技能：只跟产出格式挂钩的被打开过；第 93 轮做 KPI 看板，
  装着的 kpi-dashboard-design、data-storytelling 五个回合一次没开。用户定的：装了没点名也要推，
  但在合适的时机、由自由 Agent 自己决定用不用——所以这里只摆事实，不点名、不强制。
  第 97 轮 sr-20260928095713-H6MF2TWY5J（@ 点名）证明执行轮能重新加载，是因为 @ 写在用户原话里；规划时自己挑的技能，
  执行轮那句「请按该版本执行」里没有。

话题与技能描述照真机原样（第 93 轮话题；描述是隔离库里已装目录的原文）。判据走真 HTTP（ControlHarness）。
删掉 write_plan 里挂 unopenedSkills 的那支，前两条变红；删掉 _planning_skills_note 的拼接，第三条变红。
"""

from __future__ import annotations

import copy

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services import rehearsal_control as control
from services.control_skills import parse_skill_md
from services.slide_rule_session import load_session

ROUND93_TOPIC = ("帮我做一个连锁奶茶店的季度销售分析 Excel：5 家门店、3 个月的日销售明细（随机但合理），"
                 "一个按门店和月份的汇总表，再加一个带图表的看板页")
CATALOG = {
    "office-skills": "Use this skill when you need to create, edit, convert, analyze, validate, or QA Office/document artifacts: DOCX, XLSX, PPTX, PDF, HTML dashboards, business reports.",
    "kpi-dashboard-design": "Design effective KPI dashboards with metrics selection, visualization best practices, and real-time monitoring patterns.",
    "data-storytelling": "Transform data into compelling narratives using visualization, context, and persuasive structure. Use when presenting analytics to stakeholders, creating data reports, or building executive presentations.",
}
PLAN = "做 3 张表：日销售明细、门店月度汇总、带 2 个原生图表的看板页；公式汇总，生成后校验。"


def _skill(name):
    info = parse_skill_md(f"---\nname: {name}\ndescription: {CATALOG[name]}\n---\nBODY OF {name}\n",
                          path=f".sliderule/skills/{name}/SKILL.md")
    assert info is not None
    return info


@pytest.fixture
def harness(monkeypatch):
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [_skill(n) for n in CATALOG])
    return ControlHarness(monkeypatch)


def _plan_turn(harness, script):
    sid = new_sid("skills-at-plan")
    seed_session(sid, goal={"text": ROUND93_TOPIC, "status": "clear"})
    shots, steps = [], iter(script)

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        return next(steps)

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, ROUND93_TOPIC))
    return sid, events, shots


def _plan_receipts(events):
    return [e for e in events if e.get("type") == "control_tool_result" and e.get("tool") == "write_plan"]


def test_the_unopened_installed_skills_are_put_in_front_of_the_plan(harness):
    _sid, events, shots = _plan_turn(harness, [
        llm_tool("skill", {"name": "office-skills"}),
        llm_tool("write_plan", {"planContent": PLAN}),
        llm_tool("exit_plan_mode", {}),
    ])
    receipt = _plan_receipts(events)[0]
    assert receipt["unopenedSkills"] == ["kpi-dashboard-design", "data-storytelling"]  # 打开过的不列
    assert "不对口的不用管" in receipt["hint"]                                          # 取舍留给 Agent
    assert "kpi-dashboard-design" in str(shots[2])                                     # 真的喂到了模型


def test_it_is_said_once_per_planning_not_on_every_revision(harness):
    _sid, events, _shots = _plan_turn(harness, [
        llm_tool("write_plan", {"planContent": PLAN}),
        llm_tool("write_plan", {"planContent": PLAN + "（修订）"}),
        llm_tool("exit_plan_mode", {}),
    ])
    first, second = _plan_receipts(events)
    assert first.get("unopenedSkills") and "unopenedSkills" not in second and "hint" not in second


def test_the_execution_turn_is_told_which_skills_planning_opened(harness):
    sid, events, _shots = _plan_turn(harness, [
        llm_tool("skill", {"name": "kpi-dashboard-design"}),
        llm_tool("skill", {"name": "data-storytelling"}),
        llm_tool("write_plan", {"planContent": PLAN}),
        llm_tool("exit_plan_mode", {}),
    ])
    approval = next(e for e in events if e["type"] == "control_plan_approval")
    seen = []

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return llm_text("好的。")

    harness.llm_impl = impl
    harness.post(six_fields(sid, "Approve", toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved"}))
    # 2026-10-02 起前面带着对话历史（_conversation_history），批准那句不再是第一条 user
    first_user = next(m["content"] for m in seen[0] if m["role"] == "user" and str(m["content"]).startswith("用户已批准"))
    assert first_user.startswith("用户已批准已保存的计划，请按该版本执行。")
    assert "data-storytelling" in first_user and "kpi-dashboard-design" in first_user
    # 2026-10-02 起正文由宿主带进执行轮（test_continuation_turn_carries_opened_skills），这句话说的是「已经加载好了」
    assert "已经在上面加载好了" in first_user


def test_nothing_opened_means_the_execution_message_is_unchanged(harness):
    """反向：规划时没开过技能，执行那句话原样，不编一个清单。"""
    sid, events, _shots = _plan_turn(harness, [
        llm_tool("write_plan", {"planContent": PLAN}),
        llm_tool("exit_plan_mode", {}),
    ])
    approval = next(e for e in events if e["type"] == "control_plan_approval")
    seen = []
    harness.llm_impl = lambda messages, **kw: (seen.append(copy.deepcopy(messages)), llm_text("好的。"))[1]
    harness.post(six_fields(sid, "Approve", toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved"}))
    # 2026-10-02 起前面带着对话历史（_conversation_history），批准那句不再是第一条 user
    first_user = next(m["content"] for m in seen[0] if m["role"] == "user" and str(m["content"]).startswith("用户已批准"))
    assert first_user == "用户已批准已保存的计划，请按该版本执行。"
    assert load_session(sid).controlTranscript


def test_the_skill_tool_no_longer_reads_as_format_only():
    from services.control_skills import skill_tool_description
    desc = skill_tool_description([_skill(n) for n in CATALOG])
    assert "用户自己装的" in desc and "不只看产出格式" in desc and "不要硬套" in desc
    assert "任务对得上下面某一份时再加载" not in desc


# ⚠ 2026-09-30 隔离真机第 145 轮（@frontend-design 读书打卡网页）：隔离库装了 15 份，write_plan 回执只列前 12 份——
#   按目录顺序截，截掉的正是 verification-before-completion、webapp-testing。下面是那一轮已装目录的原样顺序。
ROUND145_INSTALLED = ["avoid-ai-writing", "data-storytelling", "doc-coauthoring", "frontend-design", "internal-comms",
                      "kpi-dashboard-design", "office-skills", "pptx-deck-context", "pptx-quality-gates",
                      "pptx-slide-specification", "responsive-design", "systematic-debugging", "theme-factory",
                      "verification-before-completion", "webapp-testing"]


def test_the_plan_time_list_is_not_cut_short(monkeypatch):
    infos = [parse_skill_md(f"---\nname: {n}\ndescription: {n} skill\n---\nBODY\n", path=f".sliderule/skills/{n}/SKILL.md")
             for n in ROUND145_INSTALLED]
    monkeypatch.setattr(control, "_skill_turn_catalog", lambda state: (infos, None))
    monkeypatch.setattr(control, "_skills_opened_since_user_turn", lambda state: {"frontend-design"})
    names = [info.name for info in control._unopened_installed_skills(object())]
    assert "webapp-testing" in names and "verification-before-completion" in names
    assert "frontend-design" not in names and len(names) == 14


def test_a_mention_is_not_an_exclusive_choice():
    """@ 的要用，其他已装的照样能编排进来——提示里说清这条，不是只剩点名那一份。"""
    from services.control_skills import mentioned_skill_playbooks
    text = mentioned_skill_playbooks([_skill("office-skills")])
    assert "用户这一轮点名了技能：office-skills" in text
    assert "不是只许用它" in text and "其他已装技能" in text


def test_the_execution_turn_also_names_the_installed_skills_nobody_opened(harness):
    """⚠ 第 145/146 轮（@frontend-design）：规划只开了点名那一份，执行轮那句话就只提它，其他已装的整个执行期没碰。
    走真 HTTP 批准那一发，看执行轮第一条 user 消息。把 _planning_skills_note 里 others 那段删掉，本条变红。"""
    sid, events, _shots = _plan_turn(harness, [
        llm_tool("skill", {"name": "office-skills"}),
        llm_tool("write_plan", {"planContent": PLAN}),
        llm_tool("exit_plan_mode", {}),
    ])
    approval = next(e for e in events if e["type"] == "control_plan_approval")
    seen = []
    harness.llm_impl = lambda messages, **kw: (seen.append(copy.deepcopy(messages)), llm_text("好的。"))[1]
    harness.post(six_fields(sid, "Approve", toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved"}))
    # 2026-10-02 起前面带着对话历史（_conversation_history），批准那句不再是第一条 user
    first_user = next(m["content"] for m in seen[0] if m["role"] == "user" and str(m["content"]).startswith("用户已批准"))
    assert "规划时打开过的这些技能已经在上面加载好了：office-skills" in first_user
    others = first_user.split("其他已装、这次还没打开的技能：", 1)[1].split("（", 1)[0]
    assert set(others.split("、")) == {"kpi-dashboard-design", "data-storytelling"}
