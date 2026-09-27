"""计划批准了、只是 approvalRef 抄错：回执说清是抄错，给出原样那串。

⚠ 2026-09-27 隔离真机第 47 轮 sr-20260927141737-RYPR6MHWHK（团队周报网页）：计划
  14:20:15 批准。模型发 project_exec、project_verify 时把 64 位摘要抄错了四个字符
  （…fafe2d21c9dcb9b5… → …fafe2d21d9cdb9b5…），回执只有 project_plan_approval_required。
  模型读成「还没批准 / 不许验收」，放弃验收，这一轮停在「还没通过交付验收」。

闸不放松：对不上照旧拒（错误码不变）。判据走真 ProjectTools + SQL 存储。
把 execute 里挂 _approval_ref_mismatch 的那支删掉，第一条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401
from test_project_tools import create, execute, setup  # noqa: F401


def _mistype(ref: str) -> str:
    """照真机那样在摘要中段调换两对字符（c9dc → d9cd 的形状）。"""
    head, digest = ref.rsplit(":", 1)
    mid = len(digest) // 2
    swapped = digest[:mid] + digest[mid + 1] + digest[mid] + digest[mid + 3] + digest[mid + 2] + digest[mid + 4:]
    assert swapped != digest and len(swapped) == len(digest)
    return f"{head}:{swapped}"


def _exec(setup, project, ref):
    return execute(setup, "project_exec", {
        "approvalRef": ref, "expectedRevision": project["revision"],
        "idempotencyKey": "weekly-build-1", "command": "build"})


def test_a_mistyped_ref_on_an_approved_plan_says_so_and_gives_the_right_one(setup):
    project = create(setup)
    result = _exec(setup, project, _mistype(setup.approval))
    assert result["ok"] is False and result["error"] == "project_plan_approval_required"  # 闸不放松
    assert "已经批准" in result["hint"] and "抄错" in result["hint"]
    assert setup.approval in result["hint"]


def test_the_right_ref_is_not_refused(setup):
    """反向：原样那串照常过。"""
    project = create(setup)
    assert _exec(setup, project, setup.approval)["ok"] is True


def test_an_unapproved_plan_gets_no_such_hint(setup):
    """反向：真没批准（计划被撤回）就是没批准，不许说成「抄错了」，更不许递出一串钥匙。"""
    project = create(setup)
    row = setup.sessions.load(setup.state.sessionId)
    row.payload["controlTranscript"].append({"kind": "plan_exited"})
    assert setup.sessions.save(setup.state.sessionId, row.payload, expected_rev=row.rev)
    result = _exec(setup, project, _mistype(setup.approval))
    assert result["ok"] is False
    assert "hint" not in result or "已经批准" not in result["hint"]
