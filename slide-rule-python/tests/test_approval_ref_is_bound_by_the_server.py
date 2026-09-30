"""工程操作不必让模型抄 approvalRef：不传就由服务端绑定当前已批准的那一版。闸不松：没批准照旧拒，传错照旧拒。

⚠ 2026-09-30 隔离真机第 132 轮 sr-20260930001652-TXP71T9C42（团队任务应用，追问「截止日期、过期标红」）：同一批两发 project_verify
  都把 110 位的 approvalRef 抄错（plan-4a391c… 应为 plan-4a772c…），模型没再试，这一轮没验就收尾。
  全库 9 次 project_plan_approval_required，6 次是抄错。系统提示写「不要自己传 approvalRef」，合同却必填。

判据走真 _dispatch_tool。把 project_tools.execute 里「没传就绑定」那段删掉，第一条变红（落到 schema 之后
approvalRef=None 进不了闸）；把 WriteArguments 的 approvalRef 改回必填，第一、四条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.project_tool_contracts import project_tool_definitions
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

ROUND132_TYPO = ("plan-4a391c90815a4b0da8a99b53703ff0f6:1:"
                 "4d9bed92cb1e92fa9c5ce61eecdc8e81dc28dfb8d4d751b0376f82d44236ba02")


def _exec(setup, project, **extra):
    return _dispatch(setup, "project_exec", {"expectedRevision": project["revision"],
        "idempotencyKey": "check-bound", "command": "check", **extra})


def test_an_omitted_approval_ref_is_bound_to_the_approved_plan(setup):
    project = create(setup)
    result = _exec(setup, project)
    assert result["ok"] is True, result
    saved = setup.store.get_operation(result["operationId"], owner_id="alice")
    assert saved.approvalRef == setup.approval                  # 逐字就是批准的那一版


def test_a_mistyped_ref_is_still_refused_with_the_real_one(setup):
    """反向：传了就逐字核对——第 132 轮那种抄错照旧拒，回执给原样那串。"""
    project = create(setup)
    result = _exec(setup, project, approvalRef=ROUND132_TYPO)
    assert result["ok"] is False and result["error"] == "project_plan_approval_required"
    assert setup.approval in result["hint"]


def test_omitting_it_does_not_open_an_unapproved_session(setup):
    """反向：没批准就是没批准，不传也不放行。"""
    project = create(setup)
    row = setup.sessions.load(setup.state.sessionId)
    setup.sessions.save(setup.state.sessionId, {**row.payload, "controlTranscript": []}, expected_rev=row.rev)
    result = _exec(setup, project)
    assert result["ok"] is False and result["error"] == "project_plan_approval_required"


def test_the_schema_offers_it_as_optional():
    for item in project_tool_definitions():
        fn = item.get("function", item)
        if fn["name"] in {"project_verify", "project_exec", "project_start", "project_restore", "project_create"}:
            params = fn["parameters"]
            assert "approvalRef" in params["properties"], fn["name"]
            assert "approvalRef" not in params.get("required", []), fn["name"]

