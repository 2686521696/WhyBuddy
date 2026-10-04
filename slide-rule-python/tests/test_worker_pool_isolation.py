"""本地和线上连同一个库时，各领各的单（services/worker_pool.py）。

⚠ 2026-10-04 真机：本地 4 轮 @技能 测试批准后的执行阶段，33 个控制面任务全被线上工作器
  control-93440d… 领走（跨本地 4 次重启 ID 不变）——本地改的控制面代码在执行阶段一行没跑到。
  反过来本地工作器也能领线上真实用户的单。

两头都钉：开发组领不到默认组的单，默认组（线上，不设变量）也领不到开发组的单；
老行（这一列出现之前写的，NULL）归默认组，线上照常领——线上行为不能因为这次改动变。
同一个库文件、两个 store 实例 = 两套部署，跟真机的形状一样。
"""

from __future__ import annotations

import pytest

from services.control_run_store import ControlRunStore
from services.project_store import ProjectConflict, ProjectStore
from services.worker_pool import ENV_NAME, normalize_pool

DEV = "dev-box1"


def _two_deployments(tmp_path, monkeypatch, make):
    url = f"sqlite:///{tmp_path / 'shared.db'}"
    monkeypatch.delenv(ENV_NAME, raising=False)
    prod = make(url)
    monkeypatch.setenv(ENV_NAME, DEV)
    dev = make(url)
    monkeypatch.delenv(ENV_NAME, raising=False)
    return prod, dev


def _control_store(url):
    return ControlRunStore(ProjectStore.from_url(url)._q)


def _ids(records):
    return {r["runId"] for r in records}


def test_normalize_pool_never_turns_a_named_pool_into_the_default():
    assert normalize_pool(None) is None and normalize_pool("  ") is None
    assert normalize_pool("dev host/1") == "dev-host-1"      # 不合法字符不能让它掉回默认组


def test_control_runs_stay_in_the_pool_that_submitted_them(tmp_path, monkeypatch):
    prod, dev = _two_deployments(tmp_path, monkeypatch, _control_store)
    assert prod.pool is None and dev.pool == DEV
    mine = dev.submit("s-dev", "alice", "k1", {"goal": "本地测试"})
    theirs = prod.submit("s-prod", "bob", "k1", {"goal": "线上用户"})

    assert _ids(dev.list_runnable()) == {mine["runId"]}
    assert _ids(prod.list_runnable()) == {theirs["runId"]}
    # 扫描之外再挡一道：拿着 id 直接领也领不走
    assert prod.claim(mine["runId"], "control-prod", 30) is None
    assert dev.claim(theirs["runId"], "control-dev", 30) is None
    assert dev.claim(mine["runId"], "control-dev", 30) is not None
    assert prod.claim(theirs["runId"], "control-prod", 30) is not None


def test_waiting_scans_are_pooled_too(tmp_path, monkeypatch):
    prod, dev = _two_deployments(tmp_path, monkeypatch, _control_store)
    mine = dev.submit("s-dev", "alice", "k1", {"goal": "x"})
    theirs = prod.submit("s-prod", "bob", "k1", {"goal": "y"})
    for status in ("waiting_operation", "waiting_continue"):
        dev._q("update wb_control_run set status=$1", [status])
        assert _ids(getattr(dev, f"list_{status}")()) == {mine["runId"]}
        assert _ids(getattr(prod, f"list_{status}")()) == {theirs["runId"]}


def test_legacy_rows_without_a_pool_still_belong_to_production(tmp_path, monkeypatch):
    prod, dev = _two_deployments(tmp_path, monkeypatch, _control_store)
    old = prod.submit("s-old", "bob", "k1", {"goal": "老单"})
    prod._q("update wb_control_run set worker_pool=null where id=$1", [old["runId"]])
    assert _ids(prod.list_runnable()) == {old["runId"]}
    assert dev.list_runnable() == []
    assert prod.claim(old["runId"], "control-prod", 30) is not None


def _project_op(store, session, owner):
    project = store.create_project(session, owner_id=owner, files={"index.html": "<p>x</p>"},
                                   template_version="vite-1", plan_ref="plan-1", spec_revision="spec-1")
    return store.create_operation(project.projectId, owner_id=owner, kind="runtime.start",
        idempotency_key="start-1", expected_revision=project.currentRevision, approval_ref="plan-1",
        input={"port": 5173})


def test_project_operations_stay_in_the_pool_that_enqueued_them(tmp_path, monkeypatch):
    prod, dev = _two_deployments(tmp_path, monkeypatch, ProjectStore.from_url)
    mine = _project_op(dev, "s-dev", "alice")
    theirs = _project_op(prod, "s-prod", "bob")

    assert {op.operationId for op, _ in dev.list_runnable_operations()} == {mine.operationId}
    assert {op.operationId for op, _ in prod.list_runnable_operations()} == {theirs.operationId}

    lease = prod.acquire_lease(mine.projectId, owner_id="alice", lease_owner="runtime-prod")
    assert lease.generation == 1
    with pytest.raises(ProjectConflict, match="operation_other_worker_pool"):
        prod.claim_operation(mine.operationId, owner_id="alice", lease_owner=lease.leaseOwner,
                             generation=lease.generation)
    lease = dev.acquire_lease(theirs.projectId, owner_id="bob", lease_owner="runtime-dev")
    with pytest.raises(ProjectConflict, match="operation_other_worker_pool"):
        dev.claim_operation(theirs.operationId, owner_id="bob", lease_owner=lease.leaseOwner,
                            generation=lease.generation)
    # 反向：自己组的照常领（先放掉上面线上那把租约）
    prod.release_lease(mine.projectId, owner_id="alice", lease_owner="runtime-prod", generation=1)
    lease = dev.acquire_lease(mine.projectId, owner_id="alice", lease_owner="runtime-dev2")
    assert dev.claim_operation(mine.operationId, owner_id="alice", lease_owner=lease.leaseOwner,
                               generation=lease.generation).operationId == mine.operationId


def test_runtime_children_inherit_the_pool_of_the_deployment_that_enqueued_them(tmp_path, monkeypatch):
    """子操作（runtime.patch / runtime.verify）走另一条 insert——只改父操作那条，子操作就是 NULL，
    被线上扫走。形状照 tests/test_project_runtime_patch_store.py 的夹具。"""
    import time
    from models.project_runtime import RuntimeInstance
    from services.project_manifest import content_hash

    prod, dev = _two_deployments(tmp_path, monkeypatch, ProjectStore.from_url)
    files = {"package.json": "{}", "src/App.tsx": "export const t = 1;"}
    project = dev.create_project("s-dev", owner_id="alice", files=files, template_version="vite-1",
                                 plan_ref="plan-1", spec_revision="spec-1")
    parent = dev.create_operation(project.projectId, owner_id="alice", kind="runtime.start",
        idempotency_key="start-1", expected_revision=project.currentRevision, approval_ref="plan-1",
        input={"port": 5173})
    lease = dev.acquire_lease(project.projectId, owner_id="alice", lease_owner="runtime-dev", ttl_seconds=120)
    dev.claim_operation(parent.operationId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    lease = dev.renew_lease(project.projectId, owner_id="alice", lease_owner=lease.leaseOwner,
        generation=lease.generation, sandbox_id="sb-1", mounted_revision=project.currentRevision,
        process_refs={"operationId": parent.operationId, "server": "43"})
    instance = RuntimeInstance(runtimeId="rt-" + parent.operationId, projectId=project.projectId,
        workspaceId=lease.workspaceId, revision=project.currentRevision, status="ready", port=5173,
        processId="43", health="revision_verified", expiresAt=time.time() + 900, lastHeartbeat="2026-10-04T00:00:00Z")
    dev.update_runtime_operation(parent.operationId, owner_id="alice", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=instance)
    child = dev.enqueue_runtime_patch(parent.operationId, owner_id="alice",
        expected_revision=project.currentRevision, approval_ref="plan-1", idempotency_key="patch-1",
        changes=[{"path": "src/App.tsx", "content": "export const t = 2;",
                  "expectedSha256": content_hash(files["src/App.tsx"])}])

    stamped = dev._q("select worker_pool from wb_project_operation where id=$1", [child.operationId])
    assert stamped[0]["worker_pool"] == DEV
    dev.release_lease(project.projectId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    assert child.operationId not in {op.operationId for op, _ in prod.list_runnable_operations()}
