"""A lease heartbeat cannot turn a valid model edit into an admission failure.

Inject at the actual INSERT used by ProjectTools -> supervisor -> durable store,
then require that the original runtime worker applies exactly one source edit.
Fresh authorization and unknown SQL responses have separate retry contracts.
"""
import threading

from project_actor_support import project_actor
from services.project_store import ProjectStoreUnavailable
from test_project_live_source_sync import live, patch_args, child_done
from test_project_runtime_worker import eventually


def admission_sql(sql):
    return sql.startswith("insert into wb_project_operation") and " select " in sql


def renew(live):
    lease = live.store.get_lease(live.project["projectId"], owner_id="alice")
    live.store.renew_lease(lease.projectId, owner_id="alice", generation=lease.generation,
        lease_owner=lease.leaseOwner)


def test_actual_heartbeat_cas_retries_then_same_runtime_applies_one_patch(live, monkeypatch):
    original, real, inserts = live.parent(), live.store._q, []
    def racing(sql, params=None):
        if admission_sql(sql):
            inserts.append(True)
            if len(inserts) == 1:
                renew(live)
        return real(sql, params)
    monkeypatch.setattr(live.store, "_q", racing)
    submitted = live.tools.execute("project_patch", patch_args(live), live.state)
    assert submitted["ok"], submitted
    done = eventually(lambda: child_done(live, submitted))
    assert 2 <= len(inserts) <= 3 and done.status == "completed" and done.result["synchronized"]
    assert len(live.store.list_runtime_patches(original.operationId, owner_id="alice", include_terminal=True)) == 1
    # ⚠ 2026-09-29 负载下偶发第二次同步，是 'Updated task' → 'Updated task' 的原样重放（探针见
    #   test_project_live_source_sync 竞争补丁那条，改动前后都是 5/80）。「只落一次」数的是改内容的同步。
    changed = [after for before, after, _ in live.provider.syncs if before != after]
    assert live.provider.contents["src/App.tsx"] == "Updated task\n" and len(changed) == 1
    assert live.parent().runtime.processId == original.runtime.processId
    assert live.parent().runtime.status == "ready" and live.provider.created == 1


def test_second_attempt_reloads_real_plan_authority_and_refuses_revoked_approval(live, monkeypatch):
    real, inserts, authorizations = live.store._q, [], []
    authorizer, caller = live.supervisor.authorizer, threading.get_ident()
    def authorize(store, operation, owner):
        if threading.get_ident() == caller:
            authorizations.append(operation.expectedRevision)
        return authorizer(store, operation, owner)
    def racing(sql, params=None):
        if admission_sql(sql):
            inserts.append(True)
            if len(inserts) == 1:
                renew(live)
                row = live.sessions.load(live.state.sessionId)
                live.sessions.save(live.state.sessionId,
                    {**row.payload, "controlTranscript": row.payload["controlTranscript"][:-1]}, expected_rev=row.rev)
        return real(sql, params)
    monkeypatch.setattr(live.supervisor, "authorizer", authorize)
    monkeypatch.setattr(live.store, "_q", racing)
    result = live.tools.execute("project_patch", patch_args(live), live.state)
    assert not result["ok"] and "approval" in result["error"]
    assert len(authorizations) == 2 and len(inserts) == 1
    assert not live.store.list_runtime_patches(live.started["operationId"], owner_id="alice", include_terminal=True)
    assert not live.provider.syncs


def test_unknown_insert_reply_is_returned_without_repeating_an_already_saved_admission(live, monkeypatch):
    real, inserts = live.store._q, []
    def lost_reply(sql, params=None):
        result = real(sql, params)
        if admission_sql(sql) and real("select id from wb_project_operation where id=$1", [params[0]]):
            inserts.append(True)
            raise ProjectStoreUnavailable("unknown_patch_admission_reply")
        return result
    monkeypatch.setattr(live.store, "_q", lost_reply)
    result = live.tools.execute("project_patch", patch_args(live), live.state)
    assert result == {"ok": False, "error": "unknown_patch_admission_reply"}
    assert len(inserts) == 1
    children = live.store.list_runtime_patches(live.started["operationId"], owner_id="alice", include_terminal=True)
    assert len(children) == 1
    done = eventually(lambda: child_done(live, {"operationId": children[0].operationId}))
    assert done.status == "completed" and len(live.provider.syncs) == 1


def test_repeated_confirmed_heartbeat_conflicts_stop_after_five_admissions(live, monkeypatch):
    real, inserts = live.store._q, []
    def racing(sql, params=None):
        if admission_sql(sql):
            inserts.append(True)
            renew(live)
        return real(sql, params)
    monkeypatch.setattr(live.store, "_q", racing)
    result = live.tools.execute("project_patch", patch_args(live), live.state)
    assert result == {"ok": False, "error": "project_runtime_patch_changed"}
    assert len(inserts) == 5 and not live.provider.syncs
    assert not live.store.list_runtime_patches(live.started["operationId"], owner_id="alice", include_terminal=True)


# ⚠ 2026-09-29 全量 -n 4 负载下，验收准入连撞三次心跳就把 project_runtime_patch_changed 交给模型
#   （test_project_browser_verification 约 1/8；撞的是运行时自己落盘改了父操作）。三发紧挨着的重试落在同一段写入窗口里。
#   这里让前三次准入都撞上，第四次放行：退避带抖动、多给两次之后，验收照样排上。
def test_three_back_to_back_collisions_still_admit_the_check_after_backing_off(live, monkeypatch):
    import services.project_runtime_worker as worker
    real, inserts, waits = live.store._q, [], []
    def racing(sql, params=None):
        if admission_sql(sql):
            inserts.append(True)
            if len(inserts) <= 3:
                renew(live)
        return real(sql, params)
    monkeypatch.setattr(worker, "_admission_backoff", lambda attempt: waits.append(attempt))
    monkeypatch.setattr(live.store, "_q", racing)
    result = live.tools.execute("project_verify", {"approvalRef": live.approval,
        "expectedRevision": live.parent().runtime.revision,
        "runtimeOperationId": live.started["operationId"], "idempotencyKey": "verify-after-collisions"}, live.state)
    assert result["ok"], result
    assert len(inserts) == 4 and waits == [0, 1, 2]


def test_a_refusal_other_than_a_collision_is_not_retried_or_delayed(live, monkeypatch):
    """反向：只有确认零行才退避重来；别的拒绝当场交回，不白等。"""
    import services.project_runtime_worker as worker
    waits = []
    monkeypatch.setattr(worker, "_admission_backoff", lambda attempt: waits.append(attempt))
    result = live.tools.execute("project_verify", {"approvalRef": live.approval,
        "expectedRevision": "prv-" + "0" * 32,
        "runtimeOperationId": live.started["operationId"], "idempotencyKey": "verify-stale"}, live.state)
    assert not result["ok"] and waits == []
