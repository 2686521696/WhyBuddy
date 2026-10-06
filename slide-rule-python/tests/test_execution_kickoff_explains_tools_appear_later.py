"""批准后还没工作区：开工那句话要说清楚文件 / 命令工具是建了工程才出现的。

⚠ 2026-10-06 真机 r27 sr-20261006024958-49FVD87BK4（@doc-coauthoring 远程办公制度）：执行第一回合只摆了
  project_create（should_list_tool：没 projectId 不列工程工具），模型对用户说「当前环境未提供命令执行或文件写入工具」。
走真 HTTP 批准那条路（ControlHarness），看模型实际收到的那句。
"""

from __future__ import annotations

from control_turn_support import llm_text, llm_tool, new_sid, seed_session, six_fields
from test_continuation_turn_carries_opened_skills import _approve, _script, harness  # noqa: F401  （夹具）

TOPIC = "帮我写一份《远程办公制度》Word 文档，给全体员工看，大概两页"


def _kickoff(harness):
    sid = new_sid("kickoff")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    _script(harness, [llm_tool("write_plan", {"planContent": "生成 output/远程办公制度.docx 并回读核验。"}),
                      llm_tool("exit_plan_mode", {})])
    _, events = harness.post(six_fields(sid, TOPIC))
    seen, _ = _approve(harness, sid, events, [llm_text("好的。")])
    return next(m["content"] for m in seen[0] if m["role"] == "user" and str(m["content"]).startswith("用户已批准"))


def test_no_workspace_yet_says_the_tools_come_after_project_create(harness):
    note = _kickoff(harness)
    assert "先调 project_create" in note and "不是环境缺工具" in note


def test_with_a_workspace_the_note_stays_out():
    """反向：已有工程时不说这句——工具都在，再说就是错的。

    普通保存不许凭空写进 projectId（persistence 绑定闸），所以这一条直接在内存态上看，不走 HTTP。
    """
    from models.v5_state import V5SessionState
    from services import rehearsal_control as control
    state = V5SessionState(sessionId="sr-kick-ws", ownerId="alice", goal={"text": TOPIC},
                           runtimeKind="project", projectId="prj-existing")
    assert control._workspace_pending_note(state) == ""
    state.projectId = None
    assert "project_create" in control._workspace_pending_note(state)
