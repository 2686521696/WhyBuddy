"""写计划那一刻，把打开过的技能里规定了流程的段落摆回模型眼前。

⚠ 2026-10-04 真机 @doc-coauthoring 团队周会制度 sr-20261004172458-JFH426E38Y：开场承诺「最后用『新同事会问
  什么』做一次可读性检查」（技能的 Stage 3: Reader Testing），计划「技能落点」只写了 Stage 1/2，
  Stage 3 一字没提，执行也没做。write_plan 说明里「跳过的写为什么」（修复 4）照样漏。

技能正文读仓里入库的种子包原件（真机加载的就是它），计划正文是真机那一版的原文（节选「技能落点」）。
判据走真 HTTP（ControlHarness）。删掉回执里挂 skillStages 的那支，前两条变红。
"""

from __future__ import annotations

import copy
import json
import zipfile
from pathlib import Path

import pytest

from control_turn_support import ControlHarness, llm_tool, new_sid, seed_session, six_fields
from services import rehearsal_control as control
from services.control_skills import parse_skill_md, process_sections

SEEDS = Path(__file__).resolve().parents[2] / "skills" / "seeds"
TOPIC = "@doc-coauthoring 帮我写一份团队周会制度的说明文档，大概一页，给新入职的同事看"
ROUND_PLAN = (
    "目标：为新入职同事编写一份约一页、简洁正式的《团队周会制度》说明文档。\n"
    "技能落点：\n"
    "- `doc-coauthoring`：将用户已确认的受众、目的、结构和语气落实为文档，并保留可继续修改的组织方式；"
    "由于已有问卷结论，本次跳过重复的初始访谈与多轮逐节问答。\n"
    "- `office-skills`：采用 CREATE_DOCX 流程，使用 `python-docx` 生成并重新读取验证。"
)


def _seed(name):
    with zipfile.ZipFile(SEEDS / f"{name}.zip") as archive:
        member = next(n for n in archive.namelist() if n.endswith("SKILL.md"))
        text = archive.read(member).decode("utf-8")
    info = parse_skill_md(text, path=f".sliderule/skills/{name}/SKILL.md")
    assert info is not None
    return info


def _plain(name):
    info = parse_skill_md(f"---\nname: {name}\ndescription: plain notes\n---\n## Scripts\n## Dependencies\n",
                          path=f".sliderule/skills/{name}/SKILL.md")
    assert info is not None
    return info


@pytest.fixture
def harness(monkeypatch):
    monkeypatch.setattr(control, "installed_skill_infos",
                        lambda owner: [_seed("doc-coauthoring"), _plain("reference-notes")])
    return ControlHarness(monkeypatch)


def _plan_turn(harness, script):
    sid = new_sid("skill-stages")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    shots, steps = [], iter(script)

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        return next(steps)

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, TOPIC))
    receipts = [e for e in events if e.get("type") == "control_tool_result" and e.get("tool") == "write_plan"]
    return receipts, shots


def test_the_real_seed_names_its_reader_testing_stage():
    sections = process_sections(_seed("doc-coauthoring").body)
    assert "Stage 3: Reader Testing" in sections
    # 反向：参考资料类段落不算流程，不拿来让模型逐条「落点」
    assert process_sections("## Scripts\n## Dependencies\n## Design Ideas\n") == []
    # 代码块里的 ## 不是标题
    assert process_sections("```\n## Step 1: fake\n```\n") == []


def test_the_plan_receipt_puts_the_opened_skills_stages_back_in_front_of_the_model(harness):
    receipts, shots = _plan_turn(harness, [
        llm_tool("skill", {"name": "doc-coauthoring"}),
        llm_tool("write_plan", {"planContent": ROUND_PLAN, "deliverableKind": "office-file"}),
        llm_tool("exit_plan_mode", {}),
    ])
    receipt = receipts[0]
    assert "Stage 3: Reader Testing" in receipt["skillStages"]["doc-coauthoring"]
    assert "reference-notes" not in receipt["skillStages"]          # 没打开的、没有流程段落的不列
    # 真的喂到了模型：写计划之后那一发请求里，回执带着这几段
    after_plan = str(shots[2][-1])
    assert "在计划里没点到" in after_plan and "Stage 3: Reader Testing" in after_plan
    # 真机那版计划只写了 Stage 1/2 的意思、没照抄任何标题：五段都算没点到
    assert "Stage 3: Reader Testing" in receipt["skillStagesUnplaced"]["doc-coauthoring"]


def test_it_is_said_once_per_planning_not_on_every_revision(harness):
    receipts, _shots = _plan_turn(harness, [
        llm_tool("skill", {"name": "doc-coauthoring"}),
        llm_tool("write_plan", {"planContent": ROUND_PLAN}),
        llm_tool("write_plan", {"planContent": ROUND_PLAN + "\n- Stage 3：执行时预测 5～10 个读者问题。"}),
        llm_tool("exit_plan_mode", {}),
    ])
    first, second = receipts
    assert first.get("skillStagesUnplaced") and "skillStages" not in second and "hint" not in second


def test_no_opened_skill_means_no_stage_list(harness):
    receipts, _shots = _plan_turn(harness, [
        llm_tool("write_plan", {"planContent": ROUND_PLAN}),
        llm_tool("exit_plan_mode", {}),
    ])
    assert "skillStages" not in receipts[0]


# —— 点名而不是「对一下」（2026-10-05 r14） ——

COFFEE_PLAN = json.loads((Path(__file__).parent / "fixtures" / "plan_frontend_design_coffee.json")
                         .read_text("utf-8"))["planContent"]


@pytest.fixture
def design_harness(monkeypatch):
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [_seed("frontend-design")])
    return ControlHarness(monkeypatch)


def test_the_real_coffee_plan_is_told_which_design_steps_it_never_named(design_harness):
    """真机那版计划没提自评：回执点名 frontend-design 的 Process 段，不是笼统地「对一下」。"""
    receipts, shots = _plan_turn(design_harness, [
        llm_tool("skill", {"name": "frontend-design"}),
        llm_tool("write_plan", {"planContent": COFFEE_PLAN}),
        llm_tool("exit_plan_mode", {}),
    ])
    unplaced = receipts[0]["skillStagesUnplaced"]["frontend-design"]
    assert "Process: plan, review against the brief, build, critique" in unplaced
    assert "Process: plan, review against the brief, build, critique" in str(shots[2][-1])


def test_a_plan_that_names_every_step_is_not_nagged(design_harness):
    """反向：每段都照抄标题落了位，回执不再提示（不给已经做对的计划添噪音）。"""
    sections = process_sections(_seed("frontend-design").body)
    named = COFFEE_PLAN + "\n技能落点：\n" + "\n".join(f"- {t}：落在第 6 步" for t in sections)
    receipts, _shots = _plan_turn(design_harness, [
        llm_tool("skill", {"name": "frontend-design"}),
        llm_tool("write_plan", {"planContent": named}),
        llm_tool("exit_plan_mode", {}),
    ])
    assert receipts[0]["skillStages"]["frontend-design"] == sections
    assert "skillStagesUnplaced" not in receipts[0]
    assert "在计划里没点到" not in str(receipts[0].get("hint") or "")


# —— 执行轮开工：把计划里技能步骤的落位原话摆回来（2026-10-05 r22） ——

REMOTE_POLICY_PLAN = json.loads((Path(__file__).parent / "fixtures" / "plan_doc_coauthoring_remote_policy.json")
                                .read_text("utf-8"))["planContent"]


def _execution_message(harness, plan):
    from control_turn_support import llm_text
    sid = new_sid("skill-commit")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    steps = iter([llm_tool("skill", {"name": "doc-coauthoring"}),
                  llm_tool("write_plan", {"planContent": plan, "deliverableKind": "office-file"}),
                  llm_tool("write_plan", {"planContent": plan + "\n（修订）", "deliverableKind": "office-file"}),
                  llm_tool("exit_plan_mode", {})])
    harness.llm_impl = lambda messages, **kw: next(steps)
    _, events = harness.post(six_fields(sid, TOPIC))
    approval = next(e for e in events if e["type"] == "control_plan_approval")
    seen = []

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return llm_text("好的。")
    harness.llm_impl = impl
    harness.post(six_fields(sid, "Approve", toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"],
                                                        "outcome": "approved"}))
    return next(m["content"] for m in seen[0] if m["role"] == "user" and str(m["content"]).startswith("用户已批准"))


def test_the_execution_turn_is_handed_the_plans_own_skill_commitments(harness):
    """真机那版计划：Stage 3 落在「生成 DOCX 前后以员工常见问题检查」，执行轮却拆成三条待办、整段没做。"""
    said = _execution_message(harness, REMOTE_POLICY_PLAN)
    assert "技能自己的流程步骤是这样落位的" in said
    assert "Stage 3: Reader Testing" in said and "常见问题" in said        # 原话带着它落在哪一步
    assert "Final Review" in said
    assert "待办里每条各占一项" in said


def test_a_plan_that_names_no_skill_step_adds_no_commitment_block(harness):
    """反向：计划里没点到任何段落标题，开工那句话不多出一段。"""
    said = _execution_message(harness, ROUND_PLAN)
    assert "技能自己的流程步骤是这样落位的" not in said
