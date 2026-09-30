"""加载技能失败时，会话日志那一行留住「点了哪个名字」。

⚠ 2026-09-30 用户本机截图（@office-skills 写《员工入职管理系统方案》Word）：左栏三行都只写
  「加载技能 skill_not_found」。开场那句技能名被失败的错误码盖掉（坏消息优先），刷新后回放的
  会话日志行也只剩错误码——模型到底点了什么名字无从查起。前端实时那一侧见 projectActionDetail
  （client/…/project-activity.ts，vitest 同名判据），这里是回放那一侧（§四）。

回执走真 resolve_invoked_skill（目录 + 仓库种子），名字是没有的那种；把 tool_transcript_entry
里接名字那段删掉，第一条变红。
"""

from __future__ import annotations

from services.control_transcript_log import tool_transcript_entry
from services.skill_catalog_store import local_seed_skill_info, resolve_invoked_skill


def _result(name):
    infos = [local_seed_skill_info("office-skills")]
    return {"type": "control_tool_result", "tool": "skill", **resolve_invoked_skill(infos, name)}


def test_the_row_names_what_was_asked_for_and_why_it_failed():
    row = tool_transcript_entry(_result("docx"))
    assert row["ok"] is False
    assert row["detail"] == "docx · skill_not_found", row


def test_a_loaded_skill_row_is_unchanged():
    """反向：成功那行不带错误，也不改形状。"""
    row = tool_transcript_entry(_result("office-skills"))
    assert row["ok"] is True and "skill_not_found" not in str(row.get("detail") or "")


def test_other_tools_failures_are_not_prefixed():
    """反向：只动技能。别的工具失败照旧只报错误码。"""
    row = tool_transcript_entry({"type": "control_tool_result", "tool": "file_read", "ok": False,
                                 "error": "project_file_not_found", "skill": "x"})
    assert row["detail"] == "project_file_not_found"
