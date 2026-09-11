"""Durable control runs, session exclusion, and fenced producer updates.

The HTTPS SQL adapter cannot keep a transaction open across requests. A run is
prepared before a session CAS publishes it; only the published active run can
be claimed. A crash in that gap leaves an inert row that the same idempotency
key can recover. Lease expiry never frees the session for another user turn.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

TERMINAL = frozenset({"completed", "waiting_user", "failed", "cancelled", "interrupted"})
MAX_RUN_BYTES = 8 * 1024 * 1024
MAX_PAYLOAD_BYTES = 128 * 1024
MAX_EVENT_BYTES = 64 * 1024
MAX_STATE_EVENT_BYTES = 2 * 1024 * 1024
MAX_EVENTS = 2000
_RESERVED_BYTES = 4096
_DDL = (
    "create table if not exists wb_control_cancel_request (session_id varchar(240) not null, owner_id varchar(240) not null, idempotency_key varchar(240) not null, primary key(session_id,idempotency_key))",
    "create table if not exists wb_control_session (session_id varchar(240) primary key, owner_id varchar(240) not null, active_run_id varchar(80), rev integer not null)",
    "create table if not exists wb_control_run (id varchar(80) primary key, session_id varchar(240) not null, owner_id varchar(240) not null, idempotency_key varchar(240) not null, status varchar(24) not null, accepted integer not null, rev integer not null, generation integer not null, lease_owner varchar(240), lease_expires_at double precision not null, payload text not null, unique(session_id,idempotency_key))",
    "create index if not exists wb_control_run_session on wb_control_run(session_id)",
)


class ControlRunUnavailable(RuntimeError):
    pass


class ControlRunConflict(RuntimeError):
    pass


class ControlRunNotFound(LookupError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 240:
        raise ValueError(name)
    return value


def _json(value: Any, limit: int) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode("utf-8")) > limit:
        raise ValueError("control_run_size_limit")
    return encoded


def _seconds(value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 1 <= value <= 3600:
        raise ValueError("invalid_control_lease_seconds")
    return float(value)


class ControlRunStore:
    def __init__(self, query: Callable[[str, list[Any]], list[dict[str, Any]]], *,
                 max_run_bytes: int = MAX_RUN_BYTES, max_events: int = MAX_EVENTS):
        if type(max_run_bytes) is not int or not 8192 <= max_run_bytes <= MAX_RUN_BYTES:
            raise ValueError("invalid_control_run_limit")
        if type(max_events) is not int or not 1 <= max_events <= MAX_EVENTS:
            raise ValueError("invalid_control_event_limit")
        self._query = query
        self.max_run_bytes, self.max_events = max_run_bytes, max_events
        for statement in _DDL:
            self._q(statement)

    def _q(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        try:
            return self._query(sql, params or [])
        except Exception as exc:
            raise ControlRunUnavailable("control_run_store_unavailable") from exc

    def _row(self, run_id: str, owner_id: str | None = None) -> dict[str, Any]:
        sql = "select r.* from wb_control_run r where r.id=$1 and (r.accepted=1 or exists(select 1 from wb_control_session s where s.session_id=r.session_id and s.active_run_id=r.id))"
        params = [run_id]
        if owner_id is not None:
            sql += " and r.owner_id=$2"
            params.append(owner_id)
        rows = self._q(sql, params)
        if not rows:
            raise ControlRunNotFound("control_run_not_found")
        return rows[0]

    def get(self, run_id: str, owner_id: str) -> dict[str, Any]:
        _required(owner_id, "control_owner_required")
        record = json.loads(self._row(run_id, owner_id)["payload"])
        if record["status"] not in TERMINAL and self._request_cancelled(record):
            record["cancelRequested"] = True
        return record

    def _request_cancelled(self, record):
        return bool(self._q("select 1 from wb_control_cancel_request where session_id=$1 and owner_id=$2 and idempotency_key=$3",
            [record["sessionId"], record["ownerId"], record["idempotencyKey"]]))

    def latest(self, session_id: str, owner_id: str) -> dict[str, Any] | None:
        _required(owner_id, "control_owner_required")
        slots = self._q("select * from wb_control_session where session_id=$1", [session_id])
        if not slots:
            return None
        if slots[0]["owner_id"] != owner_id:
            raise ControlRunNotFound("control_run_not_found")
        return self.get(slots[0]["active_run_id"], owner_id) if slots[0]["active_run_id"] else None

    def submit(self, session_id: str, owner_id: str, idempotency_key: str, payload: dict[str, Any]) -> dict[str, Any]:
        _required(session_id, "control_session_required")
        _required(owner_id, "control_owner_required")
        _required(idempotency_key, "control_idempotency_key_required")
        if not isinstance(payload, dict):
            raise ValueError("control_payload_required")
        encoded = _json(payload, min(MAX_PAYLOAD_BYTES, self.max_run_bytes - _RESERVED_BYTES))
        request_hash = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        self._q("insert into wb_control_session(session_id,owner_id,active_run_id,rev) values($1,$2,null,0) on conflict(session_id) do nothing", [session_id, owner_id])
        run_id = "ctr-" + uuid.uuid5(uuid.NAMESPACE_URL, "whybuddy:control:" + _json([session_id, idempotency_key], 4096)).hex
        for _ in range(20):
            slot = self._q("select * from wb_control_session where session_id=$1", [session_id])[0]
            if slot["owner_id"] != owner_id:
                raise ControlRunNotFound("control_run_not_found")
            existing = self._q("select * from wb_control_run where session_id=$1 and idempotency_key=$2", [session_id, idempotency_key])
            if existing:
                prior = json.loads(existing[0]["payload"])
                if prior["requestHash"] != request_hash:
                    raise ControlRunConflict("control_idempotency_conflict")
                if existing[0]["accepted"] or slot["active_run_id"] == prior["runId"]:
                    return self.get(prior["runId"], owner_id)
            if slot["active_run_id"]:
                active = self._row(slot["active_run_id"])
                if active["status"] not in TERMINAL:
                    raise ControlRunConflict("control_run_active")
                # Repair publication acknowledgement before moving the pointer;
                # a previous crash may have occurred immediately after its CAS.
                self._q("update wb_control_run set accepted=1 where id=$1", [active["id"]])
            if not existing:
                now = _now()
                record = {"runId": run_id, "sessionId": session_id, "ownerId": owner_id,
                    "idempotencyKey": idempotency_key, "requestHash": request_hash, "status": "queued",
                    "payload": json.loads(encoded), "checkpoint": None, "events": [], "lastSeq": 0,
                    "generation": 0, "leaseOwner": None, "leaseExpiresAt": 0.0, "cancelRequested": False,
                    "createdAt": now, "updatedAt": now, "error": None}
                self._q("insert into wb_control_run(id,session_id,owner_id,idempotency_key,status,accepted,rev,generation,lease_owner,lease_expires_at,payload) values($1,$2,$3,$4,'queued',0,0,0,null,0,$5) on conflict(session_id,idempotency_key) do nothing",
                    [run_id, session_id, owner_id, idempotency_key, _json(record, self.max_run_bytes - _RESERVED_BYTES)])
                continue
            changed = self._q("update wb_control_session set active_run_id=$1,rev=rev+1 where session_id=$2 and owner_id=$3 and rev=$4 returning session_id",
                [run_id, session_id, owner_id, slot["rev"]])
            if changed:
                self._q("update wb_control_run set accepted=1 where id=$1", [run_id])
                return self.get(run_id, owner_id)
        raise ControlRunConflict("control_submit_conflict")

    def list_runnable(self, *, limit: int = 100) -> list[dict[str, Any]]:
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError("invalid_control_scan_limit")
        rows = self._q("select r.payload from wb_control_run r join wb_control_session s on s.active_run_id=r.id and s.session_id=r.session_id where r.status in ('queued','running') and r.lease_expires_at<=$1 order by r.id limit $2", [time.time(), limit])
        return [json.loads(row["payload"]) for row in rows]

    def claim(self, run_id: str, worker_id: str, lease_seconds: float) -> dict[str, Any] | None:
        _required(worker_id, "control_worker_required")
        duration = _seconds(lease_seconds)
        for _ in range(20):
            row = self._row(run_id)
            record = json.loads(row["payload"])
            if record["status"] in TERMINAL:
                return None
            now = time.time()
            if row["lease_expires_at"] > now:
                return record if row["lease_owner"] == worker_id else None
            updated = {**record, "status": "running", "generation": row["generation"] + 1,
                "leaseOwner": worker_id, "leaseExpiresAt": now + duration, "updatedAt": _now()}
            updated["cancelRequested"] = record["cancelRequested"] or self._request_cancelled(record)
            rows = self._q("update wb_control_run set status='running',accepted=1,rev=rev+1,generation=$1,lease_owner=$2,lease_expires_at=$3,payload=$4 where id=$5 and rev=$6 and lease_expires_at<=$7 and exists(select 1 from wb_control_session s where s.active_run_id=wb_control_run.id and s.session_id=wb_control_run.session_id) returning id",
                [updated["generation"], worker_id, updated["leaseExpiresAt"], _json(updated, self.max_run_bytes), run_id, row["rev"], time.time()])
            if rows:
                return updated
        raise ControlRunConflict("control_claim_conflict")

    def _producer_update(self, run_id, worker_id, generation, transform, *, reserve=True):
        if type(generation) is not int or generation < 1:
            raise ControlRunConflict("control_lease_lost")
        for _ in range(20):
            row = self._row(run_id)
            record = json.loads(row["payload"])
            if (record["status"] in TERMINAL or row["lease_owner"] != worker_id or row["generation"] != generation
                    or row["lease_expires_at"] <= time.time()):
                raise ControlRunConflict("control_lease_lost")
            updated = transform(record)
            updated["updatedAt"] = _now()
            encoded = _json(updated, self.max_run_bytes - (_RESERVED_BYTES if reserve else 0))
            saved = self._q("update wb_control_run set status=$1,rev=rev+1,lease_expires_at=$2,payload=$3 where id=$4 and rev=$5 and generation=$6 and lease_owner=$7 and lease_expires_at>$8 and exists(select 1 from wb_control_session s where s.active_run_id=wb_control_run.id and s.session_id=wb_control_run.session_id) returning id",
                [updated["status"], updated["leaseExpiresAt"], encoded, run_id, row["rev"], generation, worker_id, time.time()])
            if saved:
                return updated
        raise ControlRunConflict("control_update_conflict")

    def heartbeat(self, run_id: str, worker_id: str, generation: int, lease_seconds: float) -> dict[str, Any]:
        duration = _seconds(lease_seconds)
        return self._producer_update(run_id, worker_id, generation,
            lambda record: {**record, "leaseExpiresAt": time.time() + duration}, reserve=False)

    def save_checkpoint(self, run_id: str, worker_id: str, generation: int, checkpoint: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(checkpoint, dict):
            raise ValueError("control_checkpoint_required")
        frozen = json.loads(_json(checkpoint, self.max_run_bytes - _RESERVED_BYTES))
        return self._producer_update(run_id, worker_id, generation, lambda record: {**record, "checkpoint": frozen})

    def append_event(self, run_id: str, worker_id: str, generation: int, event: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(event, dict):
            raise ValueError("control_event_required")
        # Legacy complete/factory_complete carry the full session, including
        # generated HTML. Bound them independently from ordinary log events.
        event_limit = MAX_STATE_EVENT_BYTES if event.get("type") in {
            "complete", "factory_complete", "spec_page", "skill_result", "publish_closure"
        } else MAX_EVENT_BYTES
        frozen = json.loads(_json(event, event_limit))

        def append(record):
            if len(record["events"]) >= self.max_events:
                raise ValueError("control_event_count_limit")
            next_seq = record["lastSeq"] + 1
            saved = {**frozen, "controlRunId": run_id, "seq": next_seq}
            return {**record, "events": [*record["events"], saved], "lastSeq": next_seq}

        record = self._producer_update(run_id, worker_id, generation, append)
        return record["events"][-1]

    def finish(self, run_id: str, worker_id: str, generation: int, status: str, error=None) -> dict[str, Any]:
        if status not in TERMINAL:
            raise ValueError("invalid_control_terminal_status")
        frozen = json.loads(_json(error, 2048))
        return self._producer_update(run_id, worker_id, generation,
            lambda record: {**record, "status": status, "error": frozen, "leaseExpiresAt": 0.0}, reserve=False)

    def complete(self, run_id: str, worker_id: str, generation: int,
                 status: str, event: dict[str, Any]) -> dict[str, Any]:
        """Publish completion and release the session in the same durable CAS."""
        if status not in {"completed", "waiting_user"} or event.get("type") != "complete":
            raise ValueError("invalid_control_completion")
        frozen = json.loads(_json(event, MAX_STATE_EVENT_BYTES))
        def finish(record):
            if record["cancelRequested"]:
                return {**record, "status": "cancelled", "error": "control_cancelled", "leaseExpiresAt": 0.0}
            if len(record["events"]) >= self.max_events:
                raise ValueError("control_event_count_limit")
            seq = record["lastSeq"] + 1
            saved = {**frozen, "controlRunId": run_id, "seq": seq}
            return {**record, "events": [*record["events"], saved], "lastSeq": seq,
                    "status": status, "error": None, "leaseExpiresAt": 0.0}
        return self._producer_update(run_id, worker_id, generation, finish)

    def suspend(self, run_id: str, worker_id: str, generation: int) -> dict[str, Any]:
        """Release only after the producer has drained, preserving its checkpoint."""
        return self._producer_update(run_id, worker_id, generation,
            lambda record: {**record, "leaseExpiresAt": 0.0}, reserve=False)

    def cancel(self, run_id: str, owner_id: str) -> dict[str, Any]:
        _required(owner_id, "control_owner_required")
        for _ in range(20):
            row = self._row(run_id, owner_id)
            record = json.loads(row["payload"])
            if record["status"] in TERMINAL or record["cancelRequested"]:
                return record
            updated = {**record, "cancelRequested": True, "updatedAt": _now()}
            rows = self._q("update wb_control_run set rev=rev+1,payload=$1 where id=$2 and owner_id=$3 and rev=$4 returning id",
                [_json(updated, self.max_run_bytes), run_id, owner_id, row["rev"]])
            if rows:
                return updated
        raise ControlRunConflict("control_cancel_conflict")

    def cancel_request(self, session_id: str, owner_id: str, idempotency_key: str) -> dict[str, Any]:
        """An explicit stop can arrive before POST has published its run ID."""
        for value, name in ((session_id, "control_session_required"), (owner_id, "control_owner_required"),
                            (idempotency_key, "control_idempotency_key_required")):
            _required(value, name)
        self._q("insert into wb_control_cancel_request(session_id,owner_id,idempotency_key) values($1,$2,$3) on conflict do nothing",
            [session_id, owner_id, idempotency_key])
        rows = self._q("select r.id from wb_control_run r where r.session_id=$1 and r.owner_id=$2 and r.idempotency_key=$3 and (r.accepted=1 or exists(select 1 from wb_control_session s where s.active_run_id=r.id))",
            [session_id, owner_id, idempotency_key])
        if rows:
            return self.cancel(rows[0]["id"], owner_id)
        return {"sessionId": session_id, "cancelRequested": True, "runId": None}
