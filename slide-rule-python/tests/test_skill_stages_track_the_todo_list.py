"""技能步骤表：批准计划里承诺的技能流程段落，各落在哪条待办、走到哪了——宿主算，给用户看，收尾时没做完的列出来。

⚠ 2026-10-08 用户本机 sr-20261008092556-8PW0MNC7ZW（@ui-ux-pro-max @office-skills 采购审批应用方案）：计划把 doc-coauthoring
  的 Stage 1/2/3 都落了位（「Stage 3 Reader Testing：文档生成后执行独立读者检查……」），执行开工列的五条待办一条都不带
  段落标题——页面只有「加载技能」和「待办 3/5」，看不出走到技能的哪一步；漏了一步也没有任何地方看得出来。
  同一轮还暴露：计划写「Stage 1 Context Gathering」，技能标题是「Stage 1: Context Gathering」，少一个冒号，
  原来「原样出现」的判据判不中——定计划点名、开工承诺块对 doc-coauthoring 全没生效（control_skills.stages_mentioned 头注）。

计划原文、开工那五条待办原文在 fixtures/plan_purchase_approval_skill_stages.json；技能正文读仓里入库的种子包原件。
判据走真 HTTP（ControlHarness）：定计划 → 批准 → 执行轮 todo_write → complete。
"""

from __future__ import annotations

import copy
import json
import zipfile
from pathlib import Path

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services import rehearsal_control as control
from services.control_skills import parse_skill_md, stages_mentioned

SEEDS = Path(__file__).resolve().parents[2] / "skills" / "seeds"
REAL = json.loads((Path(__file__).parent / "fixtures" / "plan_purchase_approval_skill_stages.json").read_text("utf-8"))
PLAN, ROUND_TODOS = REAL["planContent"], REAL["executionTodos"]
TOPIC = "@ui-ux-pro-max @office-skills 做一个采购审批应用，含采购单、经理审批、财务确认和字段权限的方案"
SKILLS = ("ui-ux-pro-max", "office-skills", "doc-coauthoring")


def _seed(name):
    with zipfile.ZipFile(SEEDS / f"{name}.zip") as archive:
        member = next(n for n in archive.namelist() if n.endswith("SKILL.md"))
        info = parse_skill_md(archive.read(member).decode("utf-8"), path=f".sliderule/skills/{name}/SKILL.md")
    assert info is not None
    return info


@pytest.fixture
def harness(monkeypatch):
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [_seed(n) for n in SKILLS])
    return ControlHarness(monkeypatch)


def _approved(harness):
    """定计划（三份技能都打开、写真机那版计划）→ 批准。返回 sid。"""
    sid = new_sid("skill-stage-table")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    steps = iter([*(llm_tool("skill", {"name": n}) for n in SKILLS),
                  llm_tool("write_plan", {"planContent": PLAN, "deliverableKind": "office-file"}),
                  llm_tool("exit_plan_mode", {})])
    harness.llm_impl = lambda messages, **kw: next(steps)
    _, events = harness.post(six_fields(sid, TOPIC))
    approval = next(e for e in events if e["type"] == "control_plan_approval")
    return sid, approval


def _execute(harness, sid, approval, script):
    seen, steps = [], iter(script)

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return next(steps)
    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "Approve", toolAnswer={
        "kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved"}))
    return events, seen


def _stage(table, skill, stage):
    return next(row for row in table if row["skill"] == skill and row["stage"] == stage)


def test_the_real_plan_commits_to_doc_coauthorings_stages_despite_the_missing_colon():
    titles = ["Stage 1: Context Gathering", "Stage 2: Refinement & Structure", "Stage 3: Reader Testing", "Final Review"]
    placed = {t for line in PLAN.splitlines() for t in stages_mentioned(line, titles)}
    assert placed == set(titles[:3])                                   # 计划写了 1/2/3，没写 Final Review
    assert all(t not in PLAN for t in titles[:3])                      # 前提：原样匹配确实一个都判不中


def test_the_real_todo_list_is_told_which_committed_steps_have_no_todo(harness):
    """真机开工那五条待办原样写进去：doc-coauthoring 三段一段都对不上——回执点名，表里是 missing。"""
    sid, approval = _approved(harness)
    events, seen = _execute(harness, sid, approval, [
        llm_tool("todo_write", {"merge": False, "todos": ROUND_TODOS}, call_id="td-1"),
        llm_text("先这样。"),
    ])
    todo = next(e for e in events if e.get("type") == "control_todo")
    table = todo["skillStages"]
    assert _stage(table, "doc-coauthoring", "Stage 3: Reader Testing")["status"] == "missing"
    receipt = next(m["content"] for m in seen[1] if m.get("role") == "tool" and m.get("tool_call_id") == "td-1")
    assert "待办里还没有对应的一条" in receipt and "Stage 3: Reader Testing" in receipt
    assert any(row["skill"] == "office-skills" for row in table)        # 别的技能的承诺也在表里
    complete = next(e for e in events if e.get("type") == "complete")
    assert complete["state"]["controlSkillStages"] == table             # 落进状态，刷新后也看得见


def test_todos_that_name_the_step_are_tracked_through_to_the_end(harness):
    """待办内容开头写上段落标题：表里对上那一条，状态跟着走；收尾时没做完的那段还是 pending。"""
    sid, approval = _approved(harness)
    titled = [
        {"id": "s1", "content": "Stage 1: Context Gathering：整理访谈结论", "status": "completed"},
        {"id": "s2", "content": "Stage 2 Refinement & Structure：起草正文", "status": "in_progress"},
        {"id": "s3", "content": "Stage 3: Reader Testing：独立读者检查", "status": "pending"},
    ]
    events, _seen = _execute(harness, sid, approval, [
        llm_tool("todo_write", {"merge": False, "todos": titled}),
        llm_tool("todo_write", {"todos": [{"id": "s2", "status": "completed"}]}),
        llm_text("正文写好了。"),
    ])
    last = [e for e in events if e.get("type") == "control_todo"][-1]["skillStages"]
    assert _stage(last, "doc-coauthoring", "Stage 2: Refinement & Structure") == {
        "skill": "doc-coauthoring", "stage": "Stage 2: Refinement & Structure", "status": "completed", "todoIds": ["s2"]}
    end = next(e for e in events if e.get("type") == "complete")["state"]["controlSkillStages"]
    assert _stage(end, "doc-coauthoring", "Stage 3: Reader Testing")["status"] == "pending"


def test_a_skipped_step_is_cancelled_not_missing(harness):
    sid, approval = _approved(harness)
    events, _ = _execute(harness, sid, approval, [
        llm_tool("todo_write", {"merge": False, "todos": [
            {"id": "s3", "content": "Stage 3: Reader Testing：用户要求不做读者测试", "status": "cancelled"}]}),
        llm_text("好。"),
    ])
    table = next(e for e in events if e.get("type") == "control_todo")["skillStages"]
    assert _stage(table, "doc-coauthoring", "Stage 3: Reader Testing")["status"] == "cancelled"


def test_no_approved_plan_means_no_table(harness):
    """反向：没批准计划（直接回答的回合）不算表，不拿空承诺吓人。"""
    sid = new_sid("skill-stage-none")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    steps = iter([llm_tool("todo_write", {"merge": False, "todos": ROUND_TODOS}), llm_text("好。")])
    harness.llm_impl = lambda messages, **kw: next(steps)
    _, events = harness.post(six_fields(sid, TOPIC))
    complete = next(e for e in events if e.get("type") == "complete")
    assert not complete["state"].get("controlSkillStages")


def test_a_follow_up_after_the_finished_list_does_not_report_every_step_missing(harness):
    """反向：做完的清单在下一句话开头被清掉，表一起清——追问轮计划还是旧的、待办是空的，不许把每段报成没做。"""
    sid, approval = _approved(harness)
    done = [{"id": f"s{i}", "content": f"{t}：完成", "status": "completed"} for i, t in enumerate(
        ["Stage 1: Context Gathering", "Stage 2: Refinement & Structure", "Stage 3: Reader Testing"])]
    _execute(harness, sid, approval, [llm_tool("todo_write", {"merge": False, "todos": done}), llm_text("做完了。")])
    steps = iter([llm_tool("todo_write", {"merge": False, "todos": [
                      {"id": "f1", "content": "缩短文档标题", "status": "completed"}]}),
                  llm_text("可以，标题改成这样。")])
    harness.llm_impl = lambda messages, **kw: next(steps)
    _, events = harness.post(six_fields(sid, "标题能再短一点吗"))
    assert not next(e for e in events if e.get("type") == "control_todo").get("skillStages")
    complete = next(e for e in events if e.get("type") == "complete")
    assert not complete["state"].get("controlSkillStages")


def test_the_client_can_neither_forge_nor_wipe_the_table(tmp_path, monkeypatch):
    """归属：表是宿主算的。客户端全量 PUT 带一份假的写不进去；不带（None）也抹不掉服务端那份（§四 生成侧/消费侧）。"""
    from fastapi.testclient import TestClient

    from app import app
    from conftest import TEST_USER_ID
    from models.v5_state import V5SessionState
    from services import persistence
    from services import slide_rule_session as sess

    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.setattr(persistence, "_blob_store", lambda store_file=None: None)
    real = [{"skill": "doc-coauthoring", "stage": "Stage 3: Reader Testing", "status": "missing", "todoIds": []}]
    sid = "sr-skill-stage-owner"
    sess.save_session(V5SessionState(sessionId=sid, goal={"text": TOPIC}, ownerId=TEST_USER_ID,
                                     controlSkillStages=copy.deepcopy(real)))
    client = TestClient(app)
    key = {"x-internal-key": "dev-slide-rule-internal"}
    forged = [{"skill": "doc-coauthoring", "stage": "Stage 3: Reader Testing", "status": "completed", "todoIds": ["x"]}]
    for body in ({"sessionId": sid, "goal": {"text": TOPIC}, "controlSkillStages": forged},
                 {"sessionId": sid, "goal": {"text": TOPIC}}):
        assert client.put(f"/api/sliderule/sessions/{sid}", json=body, headers=key).status_code == 200
        assert sess.load_session(sid).controlSkillStages == real


@pytest.mark.parametrize("incoming,kept", [(None, "prior"), ([], "cleared")])
def test_a_write_that_does_not_carry_the_table_keeps_it_but_an_empty_one_clears_it(incoming, kept):
    """落库合并（persistence._resolve_write_state，文件和库两个后端共用）：None 是「没带」，保留；[] 是「清掉了」，照写。
    反了的那一半就是误报——追问轮清掉的表被合并复活，每段又报成没做。"""
    from models.v5_state import V5SessionState
    from services.persistence import _resolve_write_state

    real = [{"skill": "doc-coauthoring", "stage": "Stage 3: Reader Testing", "status": "pending", "todoIds": ["s3"]}]
    prior = V5SessionState(sessionId="sr-merge-stages", goal={"text": TOPIC}, lastTurnId="turn-1",
                           controlSkillStages=copy.deepcopy(real))
    inc = prior.model_copy(update={"controlSkillStages": incoming})
    out = _resolve_write_state(prior, inc, server_write=True)
    assert out.controlSkillStages == (real if kept == "prior" else [])


# 前端判据读的那张表（client/.../__tests__/skill-stages-*.test.tsx）：由这里按真机计划 + 真机待办算出来、原样落盘。
# 表的算法改了、夹具没跟上，这条红——前端就不会拿着一张过期形状的表测「看起来对」。
TABLE_FIXTURE = Path(__file__).parent / "fixtures" / "skill_stages_purchase.json"


def _real_tables():
    infos = [_seed(n) for n in ("ui-ux-pro-max", "office-skills", "doc-coauthoring")]
    from services.control_skills import process_sections
    commitments = []
    for info in infos:
        titles = process_sections(info.body)
        placed = {t for line in PLAN.splitlines() for t in stages_mentioned(line, titles)}
        commitments.extend({"skill": info.name, "stage": t} for t in titles if t in placed)
    titled = [dict(row) for row in ROUND_TODOS] + [
        {"id": "s3", "content": "Stage 3: Reader Testing：独立读者检查", "status": "in_progress"}]
    return {"roundTodos": ROUND_TODOS, "roundTable": control.skill_stage_table(commitments, ROUND_TODOS),
            "titledTodos": titled, "titledTable": control.skill_stage_table(commitments, titled)}


def test_the_frontend_fixture_is_what_the_host_computes():
    assert json.loads(TABLE_FIXTURE.read_text("utf-8")) == _real_tables()
