"""撤销「刚才那次改动」要回到那一轮开始时的版本，不是上一版。

⚠ 2026-09-27 隔离真机第 57 轮 sr-20260927165648-XGSRGKPGSH（待读书单 + 追问「主色换紫色、
  按钮改胶囊形」+「刚才这次改动不要了，恢复到改之前的版本」）：紫色那一轮是 11 次
  file_str_replace，每次都存一版。project_revisions 一页只给 5 版、看不出哪几版属于哪一轮。
  模型恢复到「直接上一版」prv-c9749…——只撤掉最后一处小改动，紫色还在，回话却说
  「已恢复到刚才改动之前的版本」。那一轮真正的起点是 prv-438ee…。

夹具是那个工程的源码版本链原样（16 版，含最后那次恢复）和三句用户原话的时间戳。
"""

from __future__ import annotations

import json
from pathlib import Path

from project_actor_support import project_actor  # noqa: F401
from services.project_tools import revisions_by_turn
from test_project_tools import change, create, execute, setup  # noqa: F401

CHAIN = [tuple(item) for item in json.loads(
    (Path(__file__).parent / "fixtures" / "round57_revision_chain.json").read_text("utf-8"))]
TURNS = [
    ("2026-09-27T16:57:23.625126+00:00", "做一个简单的待读书单网页：添加书名和作者、标记已读、显示已读数量"),
    ("2026-09-27T17:05:16.686321+00:00", "把主色调换成紫色，按钮改成圆角胶囊形"),
    ("2026-09-27T17:09:33.056335+00:00", "刚才这次改动不要了，恢复到改之前的版本"),
]
# 模型那次调用 project_revisions 时（17:09:38），恢复还没发生。
BEFORE_RESTORE = [row for row in CHAIN if row[1] < "2026-09-27T17:09:38"]


def test_the_purple_turn_starts_from_the_version_before_all_its_edits():
    turns = revisions_by_turn(BEFORE_RESTORE, TURNS)
    purple = next(t for t in turns if t["turn"].startswith("把主色调换成紫色"))
    assert purple["revisionsMade"] == 11
    assert purple["startedFrom"] == "prv-438eea6df50e8765288482b726e66b51"
    # 反向：不是模型当时选的那一版（只退了一步）
    assert purple["startedFrom"] != "prv-c9749815c0c27444a553c61fcec87a4e"
    assert turns[0] is purple  # 最新的一轮排最前


def test_the_first_turn_started_before_there_was_a_project():
    first = revisions_by_turn(BEFORE_RESTORE, TURNS)[-1]
    assert first["turn"].startswith("做一个简单的待读书单") and first["startedFrom"] is None


def test_a_turn_that_changed_nothing_is_not_listed():
    """反向：「恢复」那句在恢复之前还没改出任何版本，不列。"""
    turns = revisions_by_turn(BEFORE_RESTORE, TURNS)
    assert not any(t["turn"].startswith("刚才这次改动") for t in turns)


def test_the_live_tool_reports_turns(setup):
    """接在链路上：project_revisions 的回执里真有 turns 和那句提示。"""
    project = create(setup)
    row = setup.sessions.load(setup.state.sessionId)
    stamp = "2000-01-01T00:00:00+00:00"  # 早于建工程：第一轮
    row.payload["controlTranscript"].append({"role": "user", "kind": "turn", "timestamp": stamp, "text": "做一个应用"})
    assert setup.sessions.save(setup.state.sessionId, row.payload, expected_rev=row.rev)
    from models.v5_state import V5SessionState
    state = V5SessionState.server_load(setup.sessions.load(setup.state.sessionId).payload)
    assert change(setup, project)["ok"]
    listed = execute(setup, "project_revisions", {}, state)
    assert listed["ok"] and listed["turns"] and listed["turns"][0]["turn"] == "做一个应用"
    assert "startedFrom" in listed["hint"]
