"""拿旧版本号调验收 / 命令：错误码照旧，回执说清工程当前是哪一版。

⚠ 2026-09-29 隔离真机第 113 轮 sr-20260929092634-ZNB4YGA34R（家庭植物养护网页，追问「逾期没浇水的植物标红并排到最前面」）：
  project_start 复用在跑的服务器，回执 revision 是它当初起来时那一版；模型拿它当 expectedRevision，
  project_verify → project_runtime_patch_unavailable、project_exec → project_revision_conflict，都没提示，
  它没验就把「验证」勾成完成。判据用真实的旧版本号（先建工程、再改一次让版本前进），走真 _dispatch_tool。
把 execute 里挂 _stale_revision_hint 的那支删掉，前两条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch, _hold_runtime


def _advanced(setup):
    """R1 建工程 → 改一次到 R2；返回 (R1, R2)。"""
    project = create(setup)
    first = project["revision"]
    assert _dispatch(setup, "file_write", {"file": "src/App.tsx", "content": "Changed task\n"})["ok"]
    head = setup.store.get_revision(project["projectId"], owner_id="alice").revision
    assert head != first
    return project, first, head


def test_a_verify_with_the_old_revision_names_the_current_one(setup, monkeypatch):
    from services import rehearsal_control as rc
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project, first, head = _advanced(setup)
    holder = _hold_runtime(setup, {**project, "revision": head})
    result = _dispatch(setup, "project_verify", {"runtimeOperationId": holder, "expectedRevision": first,
        "approvalRef": setup.approval, "idempotencyKey": "r113-verify"})
    assert result["ok"] is False and result["error"] == "project_runtime_patch_unavailable"   # 照旧拒
    assert head in result["hint"] and first in result["hint"]


def test_an_exec_with_the_old_revision_names_the_current_one(setup):
    _project, first, head = _advanced(setup)
    result = _dispatch(setup, "project_exec", {"approvalRef": setup.approval, "expectedRevision": first,
        "idempotencyKey": "r113-build", "command": "build"})
    assert result["ok"] is False and result["error"] == "project_revision_conflict"
    assert f"expectedRevision={head}" in result["hint"]


def test_the_current_revision_goes_through_without_a_hint(setup, monkeypatch):
    """反向：拿当前版本号就过，不挂提示。"""
    from services import rehearsal_control as rc
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project, _first, head = _advanced(setup)
    holder = _hold_runtime(setup, {**project, "revision": head})
    result = _dispatch(setup, "project_verify", {"runtimeOperationId": holder, "expectedRevision": head,
        "approvalRef": setup.approval, "idempotencyKey": "r113-ok"})
    assert result["ok"] is True, result
    assert "hint" not in result
