"""取消撞上预览授权的那一刻，按取消收尾，不记成失败。

⚠ 2026-09-25：xdist 并行全量里 test_published_e2b_host_does_not_drop_the_relay_host
  偶发卡死（单跑约 1/10）。探针抓到卡住时的状态：status=failed，
  runtime.errorCode=project_preview_unavailable，cancelRequested=True。
  工人循环先 check() 看取消，再 preview_runtime.ensure() 续隧道授权；取消落在
  两步之间时，授权（project_preview_access._authority）先看见 cancelRequested、
  抛 PreviewAccessDenied——用户的取消被记成「预览不可用失败」。

这里把窗口钉死：ensure 里先把取消写进库（相当于取消恰好此刻到达），再照真的
授权那样拒绝。把 worker 里 ensure 外面那层 except PermissionError 删掉，本条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.project_preview_access import PreviewAccessDenied
from test_project_preview_runtime import scanner  # noqa: F401  （夹具）
from test_project_runtime_worker import eventually, setup, state, submit  # noqa: F401


class _CancelArrivesDuringGrant:
    def __init__(self, store):
        self.store, self.armed = store, False

    def ensure(self, task):
        if self.armed:
            self.store.request_operation_cancel(task.operation_id, owner_id=task.owner_id)
            raise PreviewAccessDenied("project_preview_unavailable")

    def revoke(self, task):
        return None

    def suspend_for_sync(self, task):
        return None


def test_a_cancel_racing_the_preview_grant_ends_as_cancelled(scanner):
    grant = _CancelArrivesDuringGrant(scanner.store)
    worker = scanner.make_worker(preview_runtime=grant)
    operation = submit(worker, scanner.project)
    eventually(lambda: state(scanner.store, operation, "ready"))
    grant.armed = True
    stopped = eventually(lambda: state(scanner.store, operation, "stopped"))
    assert stopped.status == "cancelled"
    assert stopped.runtime.errorCode != "project_preview_unavailable"
