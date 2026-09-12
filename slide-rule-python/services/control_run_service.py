"""A durable owner for the existing control generator, independent of SSE readers.

Only checkpoints before sampling or between acknowledged tool calls are resumed.
An expired dispatch intent is evidence of uncertainty, never permission to replay
the original POST. Shutdown drains synchronous writes before releasing ownership.
"""

from __future__ import annotations

import asyncio
import copy
import logging
import time
import uuid
from contextlib import aclosing

from services.control_checkpoint import ControlRunStopped, current_checkpoint
from services.control_run_store import ControlRunConflict, ControlRunStore, TERMINAL
from services.project_actor_access import authorize_project_actor
from services.project_creation import load_authorized_session
from services.project_tools import ProjectTools
from services.project_tool_contracts import PROJECT_TOOL_NAMES
from services.rehearsal_control import run_control_turn, validate_control_turn_body, bound_tool_result

log = logging.getLogger(__name__)


def authorize_control_run(session_id, owner_id):
    try:
        authorize_project_actor(owner_id)
    except PermissionError:
        raise PermissionError("control_run_access_revoked") from None
    return load_authorized_session(session_id, owner_id=owner_id)


def public_control_run(record):
    # Model messages, tool arguments and provider handles never enter discovery.
    return {key: record[key] for key in (
        "runId", "sessionId", "status", "lastSeq", "cancelRequested",
        "createdAt", "updatedAt", "error"
    )}


class RunCheckpoint:
    def __init__(self, service, record):
        self.service, self.record = service, record
        self.checkpoint = copy.deepcopy(record.get("checkpoint"))
        self.stop_reason = None

    def fence(self) -> dict:
        return {"runId": self.record["runId"], "generation": self.record["generation"],
                "workerId": self.service.worker_id, "ownerId": self.record["ownerId"]}

    def guard(self):
        if self.stop_reason:
            raise ControlRunStopped(self.stop_reason)
        try:
            record = self.service.store.get(self.record["runId"], self.record["ownerId"])
        except Exception as exc:
            raise ControlRunStopped("control_checkpoint_unavailable") from exc
        if (record["generation"] != self.record["generation"]
                or record["leaseOwner"] != self.service.worker_id
                or record["leaseExpiresAt"] <= time.time()
                or record["status"] in TERMINAL):
            raise ControlRunStopped("control_lease_lost")
        if record["cancelRequested"]:
            raise ControlRunStopped("control_cancelled")
        try:
            self.service.authorize(record["sessionId"], record["ownerId"])
        except Exception as exc:
            raise ControlRunStopped("control_run_access_revoked") from exc

    async def save(self, checkpoint):
        await asyncio.to_thread(self.guard)
        try:
            await asyncio.to_thread(self.service.store.save_checkpoint,
                self.record["runId"], self.service.worker_id,
                self.record["generation"], checkpoint)
        except Exception as exc:
            raise ControlRunStopped("control_checkpoint_unavailable") from exc
        self.checkpoint = copy.deepcopy(checkpoint)


class ControlRunService:
    @classmethod
    def observer(cls, project_store):
        """Build a read/cancel facade without starting a worker or DDL.

        During rollout rollback the application intentionally does not start the
        control worker. Existing durable runs must remain observable and
        explicitly cancellable, however. Constructing ``ControlRunStore`` via
        its normal initializer would execute CREATE TABLE statements from a
        GET, so this facade wires the already-open project's query function
        directly and leaves all producer state disabled.
        """
        store = ControlRunStore.__new__(ControlRunStore)
        store._query = project_store._q
        store.max_run_bytes = 8 * 1024 * 1024
        store.max_events = 2000
        service = cls.__new__(cls)
        service.store = store
        service.project_store = project_store
        service.project_supervisor = None
        # Route handlers already enforce session ownership before subscribing;
        # keep the service callback callable so the shared observation loop can
        # run without a producer-side actor dependency.
        service.authorize = lambda _session_id, _owner_id: None
        service.lease_seconds = 0
        service.poll_seconds = 0.25
        service.max_workers = 0
        service.worker_id = "control-observer"
        service._tasks = {}
        service._ports = {}
        service._scanner = None
        service._stopping = True
        service._wake = asyncio.Event()
        return service

    def __init__(self, store: ControlRunStore, project_store, project_supervisor,
                 *, authorize=authorize_control_run, lease_seconds=120,
                 poll_seconds=1, max_workers=2):
        self.store, self.project_store = store, project_store
        self.project_supervisor, self.authorize = project_supervisor, authorize
        self.lease_seconds, self.poll_seconds = lease_seconds, poll_seconds
        self.max_workers = max_workers
        self.worker_id = "control-" + uuid.uuid4().hex
        self._tasks = {}
        self._ports = {}
        self._scanner = None
        self._stopping = False
        self._wake = asyncio.Event()

    async def start(self):
        if self._scanner is None:
            self._scanner = asyncio.create_task(self._scan())

    async def submit(self, payload, owner_id, idempotency_key):
        validate_control_turn_body(payload)
        session_id = str(payload["sessionId"]).strip()
        await asyncio.to_thread(self.authorize, session_id, owner_id)
        if self._stopping:
            raise ControlRunConflict("control_worker_stopping")
        record = await asyncio.to_thread(self.store.submit, session_id, owner_id,
                                        idempotency_key, payload)
        self._wake.set()
        return record

    async def cancel(self, run_id, owner_id):
        record = await asyncio.to_thread(self.store.cancel, run_id, owner_id)
        self._wake.set()
        return record

    async def shutdown(self):
        self._stopping = True
        self._wake.set()
        if self._scanner is not None:
            await self._scanner
            self._scanner = None
        for port in self._ports.values():
            port.stop_reason = "control_worker_shutdown"
        # Cancelling a task does not stop a threadpool write. Drain producers,
        # with their heartbeat alive, until they reach a fenced checkpoint.
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)

    async def _scan(self):
        while not self._stopping:
            self._wake.clear()
            try:
                available = self.max_workers - len(self._tasks)
                if available > 0:
                    candidates = await asyncio.to_thread(self.store.list_runnable)
                    for record in candidates:
                        run_id = record["runId"]
                        if run_id in self._tasks:
                            continue
                        claimed = await asyncio.to_thread(self.store.claim, run_id,
                            self.worker_id, self.lease_seconds)
                        if claimed is not None:
                            self._tasks[run_id] = asyncio.create_task(self._produce(claimed))
                            available -= 1
                        if available <= 0:
                            break
            except Exception:
                log.exception("control run scan failed")
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self.poll_seconds)
            except asyncio.TimeoutError:
                pass

    async def _heartbeat(self, port, finished):
        while not finished.is_set():
            try:
                await asyncio.wait_for(finished.wait(), timeout=self.lease_seconds / 3)
            except asyncio.TimeoutError:
                try:
                    await asyncio.to_thread(self.store.heartbeat, port.record["runId"],
                        self.worker_id, port.record["generation"], self.lease_seconds)
                except Exception:
                    port.stop_reason = "control_lease_lost"
                    return

    async def _produce(self, record):
        run_id, generation = record["runId"], record["generation"]
        port = RunCheckpoint(self, record)
        self._ports[run_id] = port
        finished = asyncio.Event()
        heartbeat = asyncio.create_task(self._heartbeat(port, finished))
        token = current_checkpoint.set(port)
        status, error = "completed", None
        abandoned = False
        suspend = False
        completion = None
        try:
            await asyncio.to_thread(port.guard)
            if any(event.get("type") == "complete" for event in record["events"]):
                status = "waiting_user" if any(event.get("type") in {
                    "control_ask_user", "control_plan_approval", "control_clarify"
                } for event in record["events"]) else "completed"
                return
            checkpoint = port.checkpoint
            if checkpoint is not None and checkpoint.get("schemaVersion") != 1:
                raise ControlRunStopped("control_reconciliation_required")
            if checkpoint and checkpoint.get("phase") == "dispatching":
                calls = checkpoint.get("pendingCalls", [])
                call = calls[0] if calls else {}
                receipt = next((e for e in reversed(record["events"])
                    if e.get("type") == "control_tool_result" and e.get("toolCallId") == call.get("id")), None)
                if call.get("name") in PROJECT_TOOL_NAMES and receipt:
                    checkpoint["messages"].append({"role": "tool", "tool_call_id": call["id"],
                        "content": bound_tool_result({k: v for k, v in receipt.items()
                            if k not in {"type", "seq", "controlRunId"}})})
                    checkpoint["pendingCalls"] = calls[1:]
                    checkpoint["phase"] = "tools" if calls[1:] else "model"
                    if not calls[1:]:
                        checkpoint["round"] += 1
                    operation_id = receipt.get("operationId")
                    if operation_id and operation_id not in checkpoint.get("operationIds", []):
                        checkpoint.setdefault("operationIds", []).append(operation_id)
                    await port.save(checkpoint)
            if checkpoint is not None and checkpoint.get("phase") not in {"model", "tools"}:
                raise ControlRunStopped("control_reconciliation_required")
            if checkpoint is None:
                await port.save({"schemaVersion": 1, "phase": "entry"})
            tools = ProjectTools(self.project_store, self.project_supervisor, record["ownerId"])
            async with aclosing(run_control_turn(record["payload"],
                    authorized_owner_id=record["ownerId"], project_tools=tools)) as stream:
                async for event in stream:
                    await asyncio.to_thread(port.guard)
                    if event.get("type") == "complete":
                        completion = event
                    else:
                        await asyncio.to_thread(self.store.append_event, run_id,
                            self.worker_id, generation, event)
                    if event.get("type") in {"control_ask_user", "control_plan_approval", "control_clarify"}:
                        status = "waiting_user"
        except ControlRunStopped as exc:
            status = "cancelled" if exc.reason == "control_cancelled" else "interrupted"
            error = exc.reason
            suspend = exc.reason == "control_worker_shutdown"
        except asyncio.CancelledError:
            # Process-level cancellation leaves the durable intent for a later
            # owner. It must not announce completion or cancel remote commands.
            abandoned = True
        except Exception:
            log.exception("control producer failed")
            status, error = "interrupted", "control_producer_failed"
        finally:
            current_checkpoint.reset(token)
            try:
                if suspend:
                    await asyncio.to_thread(self.store.suspend, run_id, self.worker_id, generation)
                elif completion is not None and status in {"completed", "waiting_user"} and not abandoned:
                    await asyncio.to_thread(self.store.complete, run_id, self.worker_id,
                        generation, status, completion)
                elif not abandoned:
                    await asyncio.to_thread(self.store.finish, run_id, self.worker_id,
                        generation, status, error)
            except Exception:
                log.exception("control run finalization deferred to recovery")
                try:
                    await asyncio.to_thread(self.store.finish, run_id, self.worker_id,
                        generation, "interrupted", "control_completion_unavailable")
                except Exception:
                    pass
            finished.set()
            await heartbeat
            self._ports.pop(run_id, None)
            self._tasks.pop(run_id, None)
            self._wake.set()

    async def subscribe(self, run_id, owner_id, after_seq=0):
        if type(after_seq) is not int or after_seq < 0:
            raise ValueError("invalid_control_event_cursor")
        cursor = after_seq
        while True:
            record = await asyncio.to_thread(self.store.get, run_id, owner_id)
            await asyncio.to_thread(self.authorize, record["sessionId"], owner_id)
            for event in record["events"]:
                if event["seq"] > cursor:
                    cursor = event["seq"]
                    yield event
            if record["status"] in TERMINAL:
                yield {"type": "control_run_settled", "controlRunId": run_id,
                       "status": record["status"], "error": record["error"], "lastSeq": record["lastSeq"]}
                return
            await asyncio.sleep(min(self.poll_seconds, 0.25))
