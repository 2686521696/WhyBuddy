"""通用子代理（subagent）：全新上下文、只读工作区、交回结论。对标 Claude Code 的 Task。

⚠ 2026-10-05：上一版 reader_test 是给 doc-coauthoring 一个步骤造的专用工具。技能是流程，Agent 用通用原语执行；
  平台缺的是「子代理」这件原语（services/subagent 头注）。

文档是真机那一轮生成的《远程办公制度.docx》（fixtures/remote_policy_r23.docx）。判据走真 ControlRunService 回合：
主代理派 subagent → 子代理自己 read_file → 交回结论 → 回喂主代理。按 tools 参数区分哪一发是子代理问的。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from control_turn_support import llm_text, llm_tool, six_fields
from services import rehearsal_control as control
from services.closed_tools import CLOSED_TOOLS
from services.control_goal_continuation import READ_ONLY_TOOLS
from services.project_creation import create_session_project
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.subagent import MAX_ROUNDS, SUBAGENT_TOOLS, document_text
from test_control_run_service import env, settled  # noqa: F401  （夹具）

DOCX = (Path(__file__).parent / "fixtures" / "remote_policy_r23.docx").read_bytes()
PATH = "output/远程办公制度.docx"
USER_SAID = "帮我写一份《远程办公制度》Word 文档，给全体员工看"
SUB_TOOL_NAMES = {tool["function"]["name"] for tool in SUBAGENT_TOOLS}
PROMPT = ("你是刚入职的员工，第一次读 output/远程办公制度.docx。只凭这份文件回答："
          "1. 每周最多远程几天？2. 找谁审批？3. 消息多久内要回？并指出含糊的地方。")


def _is_subagent_call(kwargs):
    # 子代理的工具：三件只读 + 工作区能读图时的 view_image（services/subagent.subagent_tools）
    names = {t["function"]["name"] for t in kwargs.get("tools") or []}
    return SUB_TOOL_NAMES <= names <= SUB_TOOL_NAMES | {"view_image"}


def _run(env, monkeypatch, sub_script, *, files=None, put_file=True):
    project = create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref,
                                     template_id="react-vite")
    if put_file:
        ProjectOfficeArtifactStore(env.project).put(project.projectId, owner_id=env.owner, path=PATH, data=DOCX)
    main_calls, sub_calls = [], []
    args = {"description": "新员工试读", "prompt": PROMPT, **({"files": files} if files else {})}
    main = iter([llm_tool("subagent", args, call_id="call-sub"), llm_text("按子代理的结论改正文。")])
    sub = iter(sub_script)

    async def model(messages, **kwargs):
        if _is_subagent_call(kwargs):
            sub_calls.append(json.loads(json.dumps(messages, ensure_ascii=False)))
            return next(sub)
        main_calls.append(json.loads(json.dumps(messages, ensure_ascii=False)))
        return next(main)
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    record = env.store.submit(env.state.sessionId, env.owner, "sub", six_fields(env.state.sessionId, USER_SAID))

    async def run():
        service = env.service()
        await service.start()
        try:
            return await settled(service, record["runId"])
        finally:
            await service.shutdown()
    asyncio.run(run())
    return main_calls, sub_calls


def test_the_subagent_reads_the_workspace_itself_and_reports_back(env, monkeypatch):
    main_calls, sub_calls = _run(env, monkeypatch, [
        llm_tool("read_file", {"path": PATH}, call_id="sub-1"),
        llm_text("最多 2 天；找直属主管；文件没写回复时限（含糊）。"),
    ])
    first = json.dumps(sub_calls[0], ensure_ascii=False)
    assert USER_SAID not in first                                   # 看不到派它的那段对话
    assert [m["role"] for m in sub_calls[0]] == ["system", "user"] and "第1条" not in first
    read_back = json.dumps(sub_calls[1], ensure_ascii=False)
    assert "第2条" in read_back and "适用范围" in read_back          # 它自己读到了那份 docx 的正文
    back = json.dumps(main_calls[-1], ensure_ascii=False)
    assert "文件没写回复时限" in back and "filesRead" in back          # 结论回喂主代理


def test_files_named_by_the_parent_are_attached_up_front(env, monkeypatch):
    _main, sub_calls = _run(env, monkeypatch, [llm_text("看过了。")], files=[PATH])
    assert "第2条" in json.dumps(sub_calls[0], ensure_ascii=False)


def test_a_missing_file_is_said_not_invented(env, monkeypatch):
    _main, sub_calls = _run(env, monkeypatch, [
        llm_tool("read_file", {"path": PATH}, call_id="sub-1"), llm_text("文件不在。")], put_file=False)
    assert "读不到" in json.dumps(sub_calls[1], ensure_ascii=False)


def test_a_subagent_that_never_concludes_is_stopped(env, monkeypatch):
    """反向：一直调工具不交结论——用完轮数照实报失败，不拿半截当结论（§七）。"""
    loop = [llm_tool("list_files", {}, call_id=f"sub-{i}") for i in range(MAX_ROUNDS)]
    main_calls, sub_calls = _run(env, monkeypatch, loop)
    assert len(sub_calls) == MAX_ROUNDS
    back = json.dumps(main_calls[-1], ensure_ascii=False)
    assert "没有交回结论" in back and '"ok": false' in back.replace('\\"', '"')


def test_the_subagent_only_gets_read_only_tools():
    assert SUB_TOOL_NAMES == {"read_file", "list_files", "search_files"}
    assert document_text(PATH, data=DOCX) and "第2条" in document_text(PATH, data=DOCX)


def test_known_on_both_sides_safe_to_retry_and_announced_to_the_planner():
    from models.v5_state import V5SessionState
    assert "subagent" in CLOSED_TOOLS and "subagent" in READ_ONLY_TOOLS
    ts = (Path(__file__).resolve().parents[2] / "client/src/lib/factory-hops.ts").read_text("utf-8")
    assert '"subagent"' in ts and '"reader_test"' not in ts
    state = V5SessionState(sessionId="sr-sub-plan", ownerId="alice", goal={"text": "写一份远程办公制度"})
    tools = {t["function"]["name"]: t["function"] for t in control.list_control_tools(state)}
    assert "subagent" not in tools                                   # 规划时还没列出……
    assert "subagent" in tools["write_plan"]["description"]          # ……但写计划时知道执行期有它



def test_offered_only_once_there_is_a_workspace_to_read(monkeypatch):
    """⚠ 2026-10-06 r27：执行第一回合还没工程就摆了 subagent——调了只能拿回「没处可读」。"""
    from models.v5_state import V5SessionState
    monkeypatch.setattr(control, "plan_execution_authorized", lambda st: True)
    state = V5SessionState(sessionId="sr-sub-ws", ownerId="alice", goal={"text": "写一份远程办公制度"})
    token = control._PROJECT_TOOLS.set(object())
    try:
        assert not control.should_list_tool("subagent", state)
        state.projectId = "prj-1"
        assert control.should_list_tool("subagent", state)
    finally:
        control._PROJECT_TOOLS.reset(token)
