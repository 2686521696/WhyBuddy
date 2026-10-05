"""无上下文读者（reader_test）：读者那一发只有文档和问题，读者的回答回到模型手里。

⚠ 2026-10-05 真机 @doc-coauthoring 远程办公制度（sr-20261005085702-FCHJKG751E 与同题重跑）：计划落了
  「Stage 3: Reader Testing」，开工也把原话摆回去了，两轮执行都没做——技能要的是「没有上下文的新读者」，
  平台没有这件工具（services/reader_test 头注）。

文档是那一轮真机生成的《远程办公制度.docx》（fixtures/remote_policy_r23.docx）。
判据走真 ControlRunService 回合：模型调 reader_test → 读者那一发 → 回执回喂。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from control_turn_support import llm_text, llm_tool, six_fields
from services import rehearsal_control as control
from services.control_goal_continuation import READ_ONLY_TOOLS
from services.closed_tools import CLOSED_TOOLS
from services.project_creation import create_session_project
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.reader_test import reader_document_text, reader_messages
from test_control_run_service import env, settled  # noqa: F401  （夹具）

DOCX = (Path(__file__).parent / "fixtures" / "remote_policy_r23.docx").read_bytes()
PATH = "output/远程办公制度.docx"
QUESTIONS = ["我每周最多能远程办公几天？", "远程办公要找谁审批？", "远程期间消息多久内要回复？"]
USER_SAID = "帮我写一份《远程办公制度》Word 文档，给全体员工看"


def test_the_reader_sees_the_real_document_and_nothing_else():
    text = reader_document_text(PATH, data=DOCX)
    assert text and "第2条" in text and "适用范围" in text
    messages = reader_messages(text, QUESTIONS, "刚入职的员工")
    flat = json.dumps(messages, ensure_ascii=False)
    assert "远程办公制度" in flat and QUESTIONS[0] in flat
    assert "不要用常识替它补" in flat                       # 不许替作者圆
    assert reader_document_text("x.xlsx", data=b"PK\x03\x04") is None   # 读不出来不编一份


def _run(env, monkeypatch, *, put_file=True):
    project = create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref,
                                     template_id="react-vite")
    if put_file:
        ProjectOfficeArtifactStore(env.project).put(project.projectId, owner_id=env.owner, path=PATH, data=DOCX)
    calls = []
    script = iter([
        llm_tool("reader_test", {"file": f"/home/user/workspace/{PATH}", "questions": QUESTIONS,
                                 "reader": "刚入职的员工"}, call_id="call-reader"),
        llm_text("答：最多 2 天；找直属主管；文档没写回复时限（含糊）。"),     # 读者那一发
        llm_text("读者说回复时限没写，我补上。"),
    ])

    async def model(messages, **kwargs):
        calls.append((messages, kwargs))
        return next(script)
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    record = env.store.submit(env.state.sessionId, env.owner, "reader", six_fields(env.state.sessionId, USER_SAID))

    async def run():
        service = env.service()
        await service.start()
        try:
            return await settled(service, record["runId"])
        finally:
            await service.shutdown()
    return asyncio.run(run()), calls


def test_the_reader_call_carries_only_the_document_and_the_answers_come_back(env, monkeypatch):
    final, calls = _run(env, monkeypatch)
    assert len(calls) >= 3, final
    reader_messages_sent, reader_kwargs = calls[1]
    flat = json.dumps(reader_messages_sent, ensure_ascii=False)
    assert "第2条" in flat and QUESTIONS[1] in flat                          # 读者读的是那份 docx 的正文
    assert USER_SAID not in flat                                           # 没有这次对话的任何一句
    assert [m["role"] for m in reader_messages_sent] == ["system", "user"]
    assert not reader_kwargs.get("tools")                                  # 读者不拿工具
    back = json.dumps(calls[2][0], ensure_ascii=False)
    assert "文档没写回复时限" in back and "readerAnswers" in back            # 读者的回答回喂给模型


def test_a_missing_file_is_said_not_answered(env, monkeypatch):
    """反向：文件不在，照实说读不到，不去问读者、不编答案。"""
    final, calls = _run(env, monkeypatch, put_file=False)
    assert len(calls) >= 2
    back = json.dumps(calls[1][0], ensure_ascii=False)
    assert "读不出正文" in back and "readerAnswers" not in back


def test_reader_test_is_known_on_both_sides_and_safe_to_retry():
    assert "reader_test" in CLOSED_TOOLS and "reader_test" in READ_ONLY_TOOLS
    ts = (Path(__file__).resolve().parents[2] / "client/src/lib/factory-hops.ts").read_text("utf-8")
    assert '"reader_test"' in ts
