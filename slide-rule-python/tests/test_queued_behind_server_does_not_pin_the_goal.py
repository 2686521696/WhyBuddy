"""排在常驻开发服务器后面的命令，不许把目标钉在「等它 settle」上。

⚠ 2026-09-27 隔离真机第 33 轮 sr-20260927101650-0WGCRZ9V30（番茄钟网页 + 追问
  「加一个暗色模式切换按钮」）：改完代码发 `npm run build`，排在 ready 的开发服务器
  后面（回执说了「它不停，这条就不会开始」）。模型没停它、写完收尾就交了。收尾侧
  看见 awaitingOperationIds 里这条还是 queued，挂起等——它要等开发服务器被空闲
  回收才轮得到：10:27:06 收尾，10:31:22 服务器过期，10:31:37 build 跑完，
  10:31:49 才续上。左栏 4 分 43 秒一个字没有。

跟 `test_serving_runtime_does_not_pin_the_goal.py` 是同一个病的下一层：那边修的是
「等开发服务器本身」，这里是「等排在它后面的东西」——两者都是在等沙盒死。

判据用真的 SQL 存储 + 真的 `_dispatch_tool` 发第 33 轮那条原样命令，租约形状照
`test_queued_command_names_its_blocker.py`（processRefs.operationId 指着那台服务器）。
唤醒侧直接执行 `_requeue_settled_goals` 的产线源码。
把 goal_released_by 里排队那条删掉，前两条变红。
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from types import SimpleNamespace

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.control_run_service import ControlRunService, goal_released_by
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch, _hold_runtime

ROUND33_BUILD = {"command": "npm run build"}


def _queued_build(setup):
    project = create(setup)
    holder = _hold_runtime(setup, project)
    result = _dispatch(setup, "shell_exec", ROUND33_BUILD)
    # 真机那一发的形状：queued，blockedBy 指着 running 的 runtime.start
    assert result["status"] == "queued" and result["blockedBy"]["operationId"] == holder, result
    return setup.store.get_operation(result["operationId"], owner_id="alice")


def _wake(setup, operation_id):
    requeued = []
    waiting = {"runId": "run-33", "ownerId": "alice",
               "goal": {"awaitingOperationIds": [operation_id]}}
    stub = SimpleNamespace(
        store=SimpleNamespace(
            list_waiting_operation=lambda: [waiting],
            requeue_waiting=lambda run_id, operation_ids: requeued.append((run_id, operation_ids)),
        ),
        project_store=setup.store,
        _wake=asyncio.Event(),
    )
    asyncio.run(ControlRunService._requeue_settled_goals(stub))
    return requeued


def test_a_build_queued_behind_the_dev_server_releases_the_goal(setup):
    build = _queued_build(setup)
    assert goal_released_by(setup.store, build, "alice")


def test_the_wake_side_lets_the_run_continue(setup):
    """唤醒侧（§4 的另一半）：已经挂起的 run 要被放出来，不是等到服务器过期。"""
    build = _queued_build(setup)
    assert _wake(setup, build.operationId) == [("run-33", [build.operationId])]


def test_a_command_behind_a_finishing_exec_still_holds_the_goal(setup):
    """反向：挡路的会自己结束（另一条命令），等它是对的。"""
    project = create(setup)
    _hold_runtime(setup, project, kind="runtime.exec")
    queued = setup.store.create_operation(
        project["projectId"], owner_id="alice", kind="runtime.exec", idempotency_key="after-exec",
        expected_revision=project["revision"], approval_ref=setup.approval, input={"command": "build"})
    assert not goal_released_by(setup.store, queued, "alice")
    assert _wake(setup, queued.operationId) == []


def test_a_queued_command_with_nothing_in_the_way_still_holds_the_goal(setup):
    """反向：没人占租约，queued 只是还没轮到，马上就会跑。"""
    project = create(setup)
    queued = setup.store.create_operation(
        project["projectId"], owner_id="alice", kind="runtime.exec", idempotency_key="free",
        expected_revision=project["revision"], approval_ref=setup.approval, input={"command": "build"})
    assert not goal_released_by(setup.store, queued, "alice")


def test_both_sides_go_through_the_same_rule():
    """挂起侧（_produce 收尾）跑不起来单测；至少钉住两处都走 goal_released_by，
    不许有一处退回只看 operation_released_the_goal（只改一半 = 一半不生效，§4）。"""
    source = Path(__file__).resolve().parents[1].joinpath("services", "control_run_service.py").read_text("utf-8")
    body = source.split("class ControlRunService:", 1)[1]
    code = re.sub(r'"""[\s\S]*?"""', "", re.sub(r"#.*", "", body))
    assert code.count("goal_released_by(") == 0  # 调用是 to_thread(goal_released_by, …) 的形式
    assert code.count("goal_released_by,") == 2
    assert "operation_released_the_goal(" not in code


def test_the_wake_prompt_says_the_queued_build_never_ran(setup):
    """放出来之后叫醒模型的那句话：排队的不许写在「已结束」底下。

    ⚠ 第 33 轮收尾写了「构建已通过」——那次碰巧真跑完了（等到服务器过期）。
      现在不等了，叫醒时 build 还在排队；照旧说「后台命令已结束」就是递给模型一个假绿灯。
    """
    from services.control_goal_continuation import operation_settled_notice

    build = _queued_build(setup)
    text = operation_settled_notice([build])
    # 真机那条的 input 就是受管的 {"command": "build"}（npm run build 被归成 build）
    assert build.operationId in text and "runtime.exec build" in text
    assert "还没开始" in text and "不能当成已通过" in text
    assert "已结束" not in text
