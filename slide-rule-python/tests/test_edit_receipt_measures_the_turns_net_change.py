"""编辑回执带「和这一轮开始时比的净改动」，宿主量的。

⚠ 2026-09-29 隔离真机第 118 轮 sr-20260929111945-BCHHHHSVVS（读书清单网页，追问「每本书后面加一个删除按钮」）：按钮第一轮就有。
  模型补了一行重复的 React Hook import，构建挂掉，再删回去——这轮开始和结束的 treeHash 一模一样；
  收尾写「每本书后新增删除按钮（×）……已修复重复导入问题」。下面两笔改动照那一轮的形状（加一行 import、删掉它）。

判据走真 HTTP control-turn（ControlHarness + 真 _run_control_turn 设起点），不自己拼起点版本（§一之二）。
把 rehearsal_control 里 TURN_START_REVISION.set 那一行删掉，第一条变红；把 _kernel_edit 里挂 net 的
那两行删掉，也红。
"""

from __future__ import annotations

import json

from project_actor_support import project_actor  # noqa: F401  （夹具）
from conftest import TEST_USER_ID
from control_turn_support import ControlHarness, llm_text, llm_tool
from services.project_creation import create_session_project
from test_control_project_tools import post, setup  # noqa: F401  （夹具）

DUPLICATE = "import { useEffect, useMemo, useState } from 'react';\n"


def _first_line(setup, project_id):
    revision = setup.store.get_revision(project_id, owner_id=TEST_USER_ID)
    body = setup.store.read_files(project_id, revision.revision, owner_id=TEST_USER_ID)["src/main.tsx"]
    return body.split("\n", 1)[0] + "\n"


def test_an_edit_undone_in_the_same_turn_is_measured_as_zero(setup, monkeypatch):
    project = create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    project_id = getattr(project, "projectId", None) or project["projectId"]
    first = _first_line(setup, project_id)
    harness = ControlHarness(monkeypatch)
    receipts = []
    edits = [("src/main.tsx", first, first + DUPLICATE), ("src/main.tsx", first + DUPLICATE, first)]

    def model(messages, **kwargs):
        results = [json.loads(m["content"]) for m in messages if m["role"] == "tool"]
        receipts[:] = results
        if len(results) < len(edits):
            path, old, new = edits[len(results)]
            return llm_tool("file_str_replace", {"file": path, "old_str": old, "new_str": new},
                            call_id=f"call-{len(results)}")
        return llm_text("done")
    harness.llm_impl = model
    post(setup.state)
    assert len(receipts) >= 2 and receipts[0]["ok"] and receipts[1]["ok"], receipts
    assert "净改动" not in str(receipts[0].get("hint") or "")           # 第一笔的净改动就是它自己，不唠叨
    assert "净改动为零" in receipts[1]["hint"] and "原来就有" in receipts[1]["hint"], receipts[1]


def test_a_real_change_is_measured_in_lines_not_called_zero(setup, monkeypatch):
    """反向：真改了，就报真改了多少，不许说成零。"""
    project = create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    project_id = getattr(project, "projectId", None) or project["projectId"]
    first = _first_line(setup, project_id)
    harness = ControlHarness(monkeypatch)
    receipts = []
    edits = [("src/main.tsx", first, first + DUPLICATE),
             ("src/main.tsx", first + DUPLICATE, first + DUPLICATE + "// keep\n")]

    def model(messages, **kwargs):
        results = [json.loads(m["content"]) for m in messages if m["role"] == "tool"]
        receipts[:] = results
        if len(results) < len(edits):
            path, old, new = edits[len(results)]
            return llm_tool("file_str_replace", {"file": path, "old_str": old, "new_str": new},
                            call_id=f"call-{len(results)}")
        return llm_text("done")
    harness.llm_impl = model
    post(setup.state)
    hint = receipts[1]["hint"]
    assert "src/main.tsx +2/−0 行" in hint and "净改动为零" not in hint, hint
