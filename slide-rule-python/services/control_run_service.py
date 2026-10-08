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
from types import SimpleNamespace

from services.control_checkpoint import ControlRunStopped, current_checkpoint
from services.control_run_store import (
    ControlRunConflict, ControlRunNotFound, ControlRunStore, ControlRunUnavailable,
    TERMINAL,
    project_goal_promotion, session_goal_text, stamp_control_goal_payload)
from services.project_actor_access import authorize_project_actor
from services.project_creation import load_authorized_session
from services.project_tools import ProjectTools, control_call_operation_key, queue_blocker
from services.project_tool_contracts import PROJECT_TOOL_NAMES
from services.control_goal_continuation import (
    continuation_checkpoint, continuation_notice, operation_settled_notice,
    progress_mark, sampling_interrupted_checkpoint, should_continue,
    unfinished_slice_waits_for_user, unfinished_cap_waits_for_user,
    unfinished_project_waits_for_user, undelivered_notice,
    dispatching_readonly_checkpoint, dispatching_reconciled_checkpoint,
    RECONCILABLE_COMMAND_TOOLS, READ_ONLY_TOOLS)
from services.deliverable_kind import office_file_uses_task_delivery, plan_deliverable_kind
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.project_delivery import ProjectDeliveryService
from services.rehearsal_control import run_control_turn, validate_control_turn_body, bound_tool_result
from services.worker_pool import current_pool
from sliderule_llm.gateway_circuit import reject_reason
from services.project_rollout import rollout_readiness
from services.scope_authority import latest_control_plan, plan_execution_authorized

log = logging.getLogger(__name__)


def authorize_control_run(session_id, owner_id):
    try:
        authorize_project_actor(owner_id)
    except PermissionError as exc:
        # 「身份库查不到」不是「被吊销」：原样往上交，RunCheckpoint.guard 给它宽限（_authority_lookup_blip 头注）。
        if str(exc) == "project_actor_unavailable":
            raise
        raise PermissionError("control_run_access_revoked") from None
    return load_authorized_session(session_id, owner_id=owner_id)


def overlay_live_control_phase(state, run_store=None):
    """GET 时叠正在跑的控制回合。不写库。

    ⚠ 2026-09-21 sr-20260921170121-13ME64TF8Z：控制回合还在跑，
      GET /sessions 是 idle / await=None。驱动器当成做完；刷新工作台
      也是假绿灯。相位不许落成 orchestrating——abandoned stream 会
      把侧栏钉死在「推演中」。只在读路径叠 running。
    """
    if state is None or run_store is None:
        return state
    if getattr(state, "awaitReason", None):
        return state
    phase = getattr(state, "runtimePhase", None)
    if phase not in (None, "idle", "done"):
        return state
    try:
        record = run_store.latest(
            str(getattr(state, "sessionId", "") or ""),
            str(getattr(state, "ownerId", "") or ""),
        )
    except Exception:
        return state
    if not isinstance(record, dict):
        return state
    status = record.get("status")
    presented = state.model_copy(deep=False)
    if status == "running":
        presented.runtimePhase = "orchestrating"
        return presented
    # ⚠ 2026-09-21 FFR6VWM7CT：run=failed/llm_unavailable，GET 仍 idle。
    #   complete 信封没带停因；读路径必须和 discovery 同一份。
    if status == "failed" and phase in (None, "idle"):
        presented.runtimePhase = "failed"
        presented.awaitReason = "error"
        presented.awaitDetail = str(record.get("error") or "llm_unavailable")
        return presented
    return state


def _approves_pending_plan(payload, state) -> bool:
    """这一发是否正在批准会话里那份待审批的计划（与 _accept_plan_answer 同一判据）。"""
    answer = payload.get("toolAnswer") or payload.get("tool_answer")
    if not isinstance(answer, dict) or answer.get("kind") != "plan_approval":
        return False
    if answer.get("outcome") != "approved":
        return False
    if getattr(state, "awaitReason", None) != "control_plan_approval":
        return False
    rows = getattr(state, "controlTranscript", None) or []
    request = next((r for r in reversed(rows)
                    if isinstance(r, dict) and r.get("kind") == "plan_approval"), {})
    return bool(request.get("reqId")) and str(answer.get("reqId") or "") == request["reqId"]


def public_control_run(record):
    # Model messages, tool arguments and provider handles never enter discovery.
    public = {key: record[key] for key in (
        "runId", "sessionId", "status", "lastSeq", "cancelRequested",
        "createdAt", "updatedAt", "error"
    )}
    # A compact objective envelope lets a refreshed workbench explain what is
    # being resumed without exposing model prompts, tool arguments or provider
    # handles. Older records simply omit this optional field.
    goal = record.get("goal")
    if isinstance(goal, dict):
        public["goal"] = {
            "text": str(goal.get("text") or "")[:4000],
            "kind": goal.get("kind") if goal.get("kind") in {"project", "conversation"} else "conversation",
            "status": goal.get("status") if goal.get("status") in {"active", "waiting_user", "waiting_operation", "waiting_continue", "completed", "failed", "cancelled"} else "active",
            "awaitingOperationIds": [str(item)[:240] for item in (goal.get("awaitingOperationIds") or [])
                                     if isinstance(item, str)][:32],
            "updatedAt": goal.get("updatedAt") or record.get("updatedAt"),
        }
    # Older workers already committed completed after terminal provider errors.
    # Interpret their durable receipts truthfully on read without rewriting
    # history or reclaiming/replaying those finished runs.
    if public["status"] in {"completed", "waiting_user"}:
        failure = _record_failure(record)
        if failure is not None:
            public.update(status="failed", error=failure)
    return public


def _event_failure(event):
    # 2026-09-13: a real project_create/read turn hit content_filter. The
    # control generator caught LlmError and yielded its failure speech followed
    # by a complete STATE snapshot; treating that envelope as success made the
    # durable run say completed/error=null. Tool errors remain model feedback,
    # while terminal control failures also govern discovery and reconnects.
    if event.get("type") in {"control_text", "complete"}:
        reason = event.get("stopReason")
        if reason in {"llm_unavailable", "unknown"}:
            return reason
    if event.get("type") == "error":
        return "control_turn_failed"
    return None


def _record_failure(record):
    return next((failure for event in record["events"]
                 if (failure := _event_failure(event))), None)


def complete_with_provider_failure(completion, events):
    """control_text 带了停因、complete.state 却是 idle 时钉回去。

    ⚠ 2026-09-21 真机 CYVWJFENJQ：except 里写了 failed，SSE complete
      仍是 phase=idle stop=None。控制 run 是 failed/llm_unavailable。
      停因已经挂在 control_text 上，complete 必须同一份。
    """
    if not isinstance(completion, dict):
        return completion
    stop = None
    if completion.get("stopReason") in {"llm_unavailable", "unknown"}:
        stop = completion
    else:
        for event in events or []:
            if not isinstance(event, dict):
                continue
            if event.get("type") == "control_text" and event.get("stopReason") in {
                "llm_unavailable", "unknown",
            }:
                stop = event
    if stop is None:
        return completion
    out = dict(completion)
    for key in ("stopReason", "stoppedBy", "providerFinishReason"):
        if key in stop:
            out[key] = stop[key]
    state = dict(out.get("state") or {}) if isinstance(out.get("state"), dict) else {}
    if state.get("runtimePhase") in (None, "idle") and not state.get("awaitReason"):
        state["runtimePhase"] = "failed"
        state["awaitReason"] = "error"
        state["awaitDetail"] = (
            "llm_unavailable" if stop.get("stopReason") == "llm_unavailable"
            else "control_loop_failed"
        )
    out["state"] = state
    return out


_SAVE_ATTEMPTS = 3
_SAVE_BACKOFF_SECONDS = 0.5
#: 权限确认通过后多久内不重查（RunCheckpoint._authorize 头注）。
_AUTHORITY_RECHECK_SECONDS = 5.0
#: 身份库 / 会话库连续查不到多久才停掉正在跑的任务。
_AUTHORITY_BLIP_GRACE_SECONDS = 60.0


def _authority_lookup_blip(exc: BaseException) -> bool:
    """「查不到」而不是「查到了、没权限」：存储不可用、网关报错、抖一下回 0 行（会话 not_found，09-16 那一课）。"""
    if isinstance(exc, PermissionError):
        return str(exc) == "project_actor_unavailable"
    return True


class RunCheckpoint:
    def __init__(self, service, record):
        self.service, self.record = service, record
        self.checkpoint = copy.deepcopy(record.get("checkpoint"))
        self.stop_reason = None
        self._authorized_at = 0.0
        self._authority_blip_since = None

    def fence(self) -> dict:
        return {"runId": self.record["runId"], "generation": self.record["generation"],
                "workerId": self.service.worker_id, "ownerId": self.record["ownerId"]}

    def guard(self):
        if self.stop_reason:
            raise ControlRunStopped(self.stop_reason)
        try:
            record = self.service.store.inspect_fence(
                self.record["runId"], self.record["ownerId"])
        except ControlRunUnavailable as exc:
            raise ControlRunStopped("control_checkpoint_unavailable") from exc
        except ControlRunNotFound as exc:
            raise ControlRunStopped("control_lease_lost") from exc
        if (record["generation"] != self.record["generation"]
                or record["leaseOwner"] != self.service.worker_id
                or record["leaseExpiresAt"] <= time.time()
                or record["status"] in TERMINAL):
            raise ControlRunStopped("control_lease_lost")
        if record["cancelRequested"]:
            raise ControlRunStopped("control_cancelled")
        self._authorize(record)

    def _authorize(self, record):
        """账号和会话还归这个人吗。确认过 _AUTHORITY_RECHECK_SECONDS 秒内不重查；查不到给宽限，查到没权限当场停。

        ⚠ 2026-10-08 用户本机 sr-20261008092556-8PW0MNC7ZW 执行轮 ctr-6da33921cb525b04ae9454ba46caaede（@ui-ux-pro-max
          @office-skills 采购审批方案）：跑了 6 分钟，interrupted / control_run_access_revoked——账号一秒都没被停用过。
          采样期间 guard 每 0.25 秒一次（control_checkpoint.owned_model_sample），每次都查身份库 + 读整份会话，6 分钟一千多次
          打共享库；这一晚那个网关反复回 db-api http 500。authorize_control_run 把「身份库查不到」改写成「被吊销」，
          这里又把任何异常都当「被吊销」——抖一次，正在跑的任务就以「你没权限了」被掐。跟 09-16（project_actor_access 头注）、
          今天运行时工作器（project_runtime_worker._authorize_actor）同一种病，第三处。
          两处一起改：查不到 = 连续不到 _AUTHORITY_BLIP_GRACE_SECONDS 秒只记日志、这一轮放过，超过照旧停；
          查到了、没权限 = 当场停。确认过的 5 秒内不重查：吊销最多晚 5 秒生效，打库少二十倍。
        """
        now = time.time()
        if now - self._authorized_at < _AUTHORITY_RECHECK_SECONDS:
            return
        try:
            self.service.authorize(record["sessionId"], record["ownerId"])
        except Exception as exc:
            if not _authority_lookup_blip(exc):
                raise ControlRunStopped("control_run_access_revoked") from exc
            since = self._authority_blip_since or now
            self._authority_blip_since = since
            if now - since >= _AUTHORITY_BLIP_GRACE_SECONDS:
                log.warning("control authority lookup unavailable for %.0fs, stopping run=%s",
                            now - since, self.record.get("runId"), exc_info=exc)
                raise ControlRunStopped("control_checkpoint_unavailable") from exc
            log.warning("control authority lookup unavailable (%.0fs so far), keeping run=%s: %s",
                        now - since, self.record.get("runId"), type(exc).__name__)
            return
        self._authority_blip_since = None
        self._authorized_at = now

    async def save(self, checkpoint):
        """存一份检查点。存储暂时不可用就退避重试，跟采样期间的 guard 一样（control_checkpoint._guard_sampling）。

        ⚠ 2026-10-07 真机 r108 ctr-cf9f46ef249455f783c441362cbf6f1d（@kpi-dashboard-design 咖啡豆订阅看板）：模型把三个
          流失率口径拆对了（48/400、48/412、48/460），子代理独立复核也回来了（seq 22）——紧接着这一步存档失败，整轮
          interrupted，黄条「控制面未返回结果」。检查点约 200KB，远不到 8MB；同一时段这台机器直连共享库也吃过一次
          db-api http 500。09-19 那次只把**采样期间**的 guard 改成抖动重试，存档这一步还是一次失败就掐死，
          而且什么都不记——这次连原因都只能推断。
        真正的停（租约换手 ControlRunConflict / 被取消 / 换了 worker）照旧立刻停，不重试；超限这类确定性错误也不重试。
        """
        for attempt in range(_SAVE_ATTEMPTS):
            try:
                await asyncio.to_thread(self.guard)
                await asyncio.to_thread(self.service.store.save_checkpoint,
                    self.record["runId"], self.service.worker_id,
                    self.record["generation"], checkpoint)
                break
            except ControlRunStopped as exc:
                if exc.reason != "control_checkpoint_unavailable" or attempt + 1 >= _SAVE_ATTEMPTS:
                    log.warning("control checkpoint save stopped run=%s attempt=%d reason=%s",
                                self.record.get("runId"), attempt + 1, exc.reason)
                    raise
                log.warning("control checkpoint guard unavailable run=%s attempt=%d, retrying",
                            self.record.get("runId"), attempt + 1, exc_info=exc.__cause__)
            except ControlRunConflict as exc:
                raise ControlRunStopped("control_lease_lost") from exc
            except (ValueError, TypeError) as exc:
                log.warning("control checkpoint rejected run=%s: %s", self.record.get("runId"), exc)
                raise ControlRunStopped("control_checkpoint_unavailable") from exc
            except Exception as exc:
                if attempt + 1 >= _SAVE_ATTEMPTS:
                    log.warning("control checkpoint save failed run=%s after %d attempts",
                                self.record.get("runId"), attempt + 1, exc_info=True)
                    raise ControlRunStopped("control_checkpoint_unavailable") from exc
                log.warning("control checkpoint save failed run=%s attempt=%d, retrying",
                            self.record.get("runId"), attempt + 1, exc_info=True)
            await asyncio.sleep(_SAVE_BACKOFF_SECONDS * (attempt + 1))
        self.checkpoint = copy.deepcopy(checkpoint)


#: 操作进了终态。短命操作（runtime.exec / runtime.verify / runtime.patch）
#: 只有这一种「做完了」。
_OPERATION_TERMINAL = frozenset({"completed", "failed", "cancelled"})


def operation_released_the_goal(operation) -> bool:
    """这个操作还需不需要目标继续等它。

    ⚠ 2026-09-16 整个 test_project_composition_authority.py（6 条）全红查出来的。

    起因是 `_produce` 收尾把 `awaitingOperationIds` 当硬闸：里面任何一个操作
    没进终态就 `wait_for_operations` + suspend。而那些 id 是 `control_tool_result`
    一律记下来的（见 `_produce` 里那段，注释明说 "this bookkeeping does not
    dispatch a second loop"——它本来只是**记账**，给刷新后的前端说明「在等什么」
    用的）。记账被当成闸，就出了这个：

        project_start 的操作是一个**正在服务的运行时**，
        它只有被空闲回收才进 completed —— 于是「等异步工作做完」实际是「等沙盒死」。

    真机形态：点了启动工程，那一轮的流挂到空闲超时（默认 300 秒）才收，
    模型在沙盒服务期间不往下做——而那恰恰是工程模式的全部意义。
    判据侧的形态更毒：等回来时运行时已经被回收、`runtime.status` 不再是 ready，
    `available` 永远为假，**这条路径上判据不可能绿**，怎么改判据都没用。

    实测（压 `SLIDERULE_PROJECT_IDLE_SECONDS` 一压就动，分毫不差）：

        idle=300（默认）  →  单条用例 call 301 秒
        idle=30           →  单条用例 call 30.79 秒

    所以对 `runtime.start` 改成**以 ready 为准**：模型等的是「应用起来了」，
    不是「沙盒死了」。短命操作行为不变——`run_command` 结尾就是
    `finish("completed", ...)`，它们会自然结束，等它们是对的。

    ⚠ 这个判断有两个调用点（`_requeue_settled_goals` 的唤醒侧、`_produce` 收尾的
      挂起侧）。**只改一个 = 一半不生效且不报错**：要么挂起侧不挂了而唤醒侧还按
      老规矩，要么挂了没人叫醒。所以这里只有一个函数，两处都调它（CLAUDE.md §4）。
    """
    if getattr(operation, "status", None) in _OPERATION_TERMINAL:
        return True
    if getattr(operation, "kind", None) != "runtime.start":
        return False
    runtime = getattr(operation, "runtime", None)
    return getattr(runtime, "status", None) == "ready"


def goal_released_by(project_store, operation, owner_id) -> bool:
    """目标还要不要等这个操作——`operation_released_the_goal` 再加一条排队规则。

    ⚠ 2026-09-27 隔离真机第 33 轮（番茄钟网页 + 追问加暗色模式）：模型改完代码发
      `npm run build`，排在正在服务的开发服务器（runtime.start，ready）后面。回执
      说了「它不停，这条就不会开始」，模型没停它，写完收尾就交了。收尾侧看见
      awaitingOperationIds 里那条 build 还是 queued，挂起等它——它要等开发服务器
      被空闲回收（300 秒）才轮得到。左栏 4 分 43 秒一个字没有，跟上面 2026-09-16
      那次是同一个病：等的其实是「沙盒死」。

    排在常驻开发服务器后面的操作，跟那台服务器本身一样放行：挡路的不会让路，
    等它就是等回收。判断复用回执那一侧的 `queue_blocker`（neverYields），
    不另抄一份——回执说「不会开始」和这里放行必须是同一个结论。

    挂起侧（`_produce` 收尾）和唤醒侧（`_requeue_settled_goals`）都走这里（§4）。
    """
    if operation_released_the_goal(operation):
        return True
    if getattr(operation, "status", None) != "queued":
        return False
    try:
        blocker = queue_blocker(SimpleNamespace(store=project_store, owner_id=owner_id),
                                operation.operationId)
    except Exception:
        return False
    return bool(blocker and blocker["neverYields"])


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
        # 绕过 __init__ 的那一份也得有组：它不领单，但谁误调了 list_*/claim，按本进程的组过滤，不是 AttributeError。
        store.pool = current_pool()
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
            # ⚠ 2026-10-04：本地连线上库时，执行阶段被谁领走只能拿库里的 lease_owner 对这一行——
            #   以前不打，本地被线上工作器抢单查了半天才确认。pool=None 是默认组（线上）。
            print(f"[control] worker={self.worker_id} pool={self.store.pool}", flush=True)
            self._scanner = asyncio.create_task(self._scan())

    async def submit(self, payload, owner_id, idempotency_key):
        validate_control_turn_body(payload)
        # AWS StandardRetry：熔断开着只关重试；冷却未结束连第一发都不排队。
        # ⚠ 2026-09-20 真机 524 accounts exhausted 之后脚本立刻再 POST，
        #   525 把门焊死。host 产品路径不许在冷却期内再 enqueue。
        blocked = reject_reason()
        if blocked:
            raise ControlRunUnavailable(blocked)
        session_id = str(payload["sessionId"]).strip()
        state = await asyncio.to_thread(self.authorize, session_id, owner_id)
        if self._stopping:
            raise ControlRunConflict("control_worker_stopping")
        # 六字段 POST 没有业务目标 / runtimeKind。不盖进去，durable goal
        # 就会把「批准计划并执行」当成目标，kind 永远停在 conversation。
        stamped = stamp_control_goal_payload(payload, state)
        # ⚠ 2026-09-25 luna 隔离真机 sr-20260925011309-62DQZAH83G：批准那一发
        #   工程还没建，会话 runtimeKind 是 html-prototype，目标落成 conversation；
        #   只有这一回合里真调了 project_create 才会升级。模型那回走了工厂、
        #   没建工程——四跳零产出，run 却记成 completed：对话目标不问交付证据，
        #   不续跑、没有结果卡。执行已批准的 write_plan 计划就是工程目标，由
        #   服务端按批准状态定，不看前端传的 runtimeKind。只动目标类型，不改
        #   payload 里的 runtimeKind（那个字段还有别的读者）。
        stamped.pop("objectiveKind", None)  # 只认服务端这一处，不收前端带来的
        # ⚠ 2026-09-25 第三轮真机 sr-20260925020530-S3ZKS8EM8P：上一版只认「已经
        #   批准」。可「批准并执行」这一发本身就是批准——toolAnswer
        #   {kind: plan_approval, outcome: approved, reqId}，由回合里的
        #   _accept_plan_answer 才写进库。提交那一刻还没批准，目标照旧落成
        #   conversation，run 又记成 completed。判据当时用的是「已批准好的」
        #   夹具，正好绕开了真机时序（CLAUDE.md 一之二）。
        if latest_control_plan(state) and (
            plan_execution_authorized(state) or _approves_pending_plan(stamped, state)
        ):
            stamped["objectiveKind"] = "project"
        # ⚠ 2026-09-22 RFZYDAVHG9 的修法是让 submit 自己 claim（插入时就写租约），
        #   再直接 `create_task(self._produce(record))`。2026-09-23 revert：
        #     · 接单进程一崩，这一发冻满一个租约周期没人能接（崩溃恢复判据红）；
        #     · 这条路径绕过 _scan 的 `available = max_workers - len(self._tasks)`，
        #       N 个并发 POST 就是 N 条并发模型循环，不是 max_workers 条。
        #   领单只走 _scan → store.claim 这一条路。
        record = await asyncio.to_thread(self.store.submit, session_id, owner_id,
                                        idempotency_key, stamped)
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
                # Cleanup mode may keep the runtime supervisor alive while the
                # project rollout is disabled.  In that state this service is
                # still useful for durable observation/cancellation, but it
                # must not claim queued control runs (claiming would execute
                # new model work after a rollback).  Existing project
                # resources are reconciled by the runtime supervisor instead.
                if not rollout_readiness().get("configured", False):
                    await asyncio.wait_for(self._wake.wait(), timeout=self.poll_seconds)
                    continue
                await self._requeue_settled_goals()
                await self._requeue_stalled_goals()
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

    async def _requeue_settled_goals(self):
        """Wake the same durable control run after its project operation settles.

        This is a scheduler hook around the existing producer. It only changes
        a waiting run back to ``queued``; the normal ``_produce`` path claims
        it and resumes its saved checkpoint. No second model loop is created.
        """
        for record in await asyncio.to_thread(self.store.list_waiting_operation):
            ids = (record.get("goal") or {}).get("awaitingOperationIds") or []
            if not ids:
                continue
            settled = True
            for operation_id in ids:
                try:
                    operation = await asyncio.to_thread(
                        self.project_store.get_operation, operation_id,
                        owner_id=record["ownerId"])
                except Exception:
                    settled = False
                    break
                if not await asyncio.to_thread(
                        goal_released_by, self.project_store, operation, record["ownerId"]):
                    settled = False
                    break
            if settled:
                try:
                    await asyncio.to_thread(self.store.requeue_waiting, record["runId"], operation_ids=ids)
                except ControlRunConflict:
                    continue
                self._wake.set()

    def _recorded_command_receipts(self, record, checkpoint) -> dict:
        """挂着的命令类调用 → 库里按键查到的那条工程操作的回执正文。查不到 / 查失败的不放进来（照旧对账）。"""
        calls = checkpoint.get("pendingCalls") if isinstance(checkpoint, dict) else None
        wanted = [call for call in calls or [] if isinstance(call, dict)
                  and call.get("name") in RECONCILABLE_COMMAND_TOOLS and control_call_operation_key(call.get("id"))]
        if not wanted:
            return {}
        try:
            project = self.project_store.get_project_for_session(record["sessionId"], owner_id=record["ownerId"])
        except Exception:
            return {}
        if project is None:
            return {}
        tools = ProjectTools(self.project_store, self.project_supervisor, record["ownerId"])
        out = {}
        for call in wanted:
            try:
                operation = self.project_store.operation_by_key(
                    project.projectId, control_call_operation_key(call["id"]), owner_id=record["ownerId"])
                if operation is None:
                    continue
                body = {"tool": call["name"], "ok": True, **tools._snapshot(operation.operationId),
                        "recoveredAfterRestart": True}
            except Exception:
                continue
            out[str(call["id"])] = bound_tool_result(body, call["name"])
        return out

    async def _goal_is_done(self, record) -> bool:
        """目标达没达到可交付状态——**问证据，不问模型**。

        ⚠ 这是 §7 的分界：让模型自己声明「我做完了」就是伪造绿灯，正是本仓
          禁止的那件事。这里读的是 `ProjectDeliveryService.status()` 的
          `eligible`，跟真正解锁交付的是同一个判断。

        ⚠ fail-closed：读不出来就当**没做完**（返回 False）。这会让它多续一次
          而不是提前收工——多跑一轮的代价远小于把没做完的东西宣布成完成。
          续跑次数另有预算兜底，不会因此失控。
        """
        session_id = record.get("sessionId")
        owner_id = record.get("ownerId")
        try:
            authority = await asyncio.to_thread(self.authorize, session_id, owner_id)
            # ⚠ 2026-09-20 真机 sr-20260920051924-QA0YXX59Q0：办公文件目标
            #   被 tasks delivery.eligible 续跑进登录/CRUD。类别在批准计划上，
            #   必须先于 ProjectDeliveryService 判断。没有文件证据就没做完。
            if office_file_uses_task_delivery(
                    plan_deliverable_kind(latest_control_plan(authority))):
                project = await asyncio.to_thread(
                    self.project_store.get_project_for_session, session_id, owner_id=owner_id)
                if project is None:
                    return False
                try:
                    return await asyncio.to_thread(
                        ProjectOfficeArtifactStore(self.project_store).has_any,
                        project.projectId, owner_id=owner_id)
                except Exception:
                    return False
            project = await asyncio.to_thread(
                self.project_store.get_project_for_session, session_id, owner_id=owner_id)
            if project is None:
                return False
            status = await asyncio.to_thread(
                ProjectDeliveryService(self.project_store, owner_id).status, project.projectId)
            return bool(status.get("eligible"))
        except Exception:
            return False

    async def _repeats_last_notice(self, record: dict, notice: str) -> bool:
        """这一轮什么都没做（一个工具结果都没有），上一轮收尾已经是同一句缺项通知：不再说第二遍。

        ⚠ 2026-09-29 隔离真机第 124 轮 sr-20260929131613-S9YHENH029（喝水记录网页）：追问「这些数据存在哪里？换一台电脑还能看到吗？」，
          模型一个工具没调、照实答了 localStorage——宿主又在后面补一句「这一轮还没有达到可交付：独立浏览器
          验收没能在这个环境里跑起来……再说『继续』也跑不起来」，跟上一轮收尾一字不差。用户问了个问题，
          收到的是一句跟问题无关、上一轮已经说过的缺项。
          目标照旧停成 waiting_user（没交付就是没交付）；只是同一句话不说两遍。这一轮动过工具、或者上一轮
          没说过这句（第一轮、缺项变了），照说。增强类：查不到上一轮就照说（§七）。
        """
        # ⚠ 2026-09-30 隔离真机第 138 轮 sr-20260930025424-FMGS3825MJ（便签墙，追问「刷新页面后撤销记录还在吗？」）：模型为了答准先
        #   project_search / project_read 看了三眼代码——上一版只认「一个工具都没调」，照样把同一句缺项又说一遍。
        #   只读查看改不了目标的证据，跟没调一样；改过东西、跑过命令、提过验收的，照说。
        if any(isinstance(event, dict) and event.get("type") == "control_tool_result"
               and event.get("tool") not in READ_ONLY_TOOLS for event in record.get("events") or []):
            return False
        try:
            previous = await asyncio.to_thread(self.store.previous, record["runId"], record["ownerId"])
        except Exception:
            return False
        said = [event.get("text") for event in (previous or {}).get("events") or []
                if isinstance(event, dict) and event.get("stopReason") == "goal_not_delivered"]
        return bool(said) and said[-1] == notice

    async def _goal_blocked_reasons(self, record) -> list:
        """服务端判定「还缺什么」。拿不到就返回空——不编原因。"""
        try:
            authority = await asyncio.to_thread(
                self.authorize, record.get("sessionId"), record.get("ownerId"))
            if office_file_uses_task_delivery(
                    plan_deliverable_kind(latest_control_plan(authority))):
                try:
                    project = await asyncio.to_thread(
                        self.project_store.get_project_for_session,
                        record.get("sessionId"), owner_id=record.get("ownerId"))
                    if project is None:
                        return ["office_file_not_found"]
                    present = await asyncio.to_thread(
                        ProjectOfficeArtifactStore(self.project_store).has_any,
                        project.projectId, owner_id=record.get("ownerId"))
                    return [] if present else ["office_file_not_found"]
                except Exception:
                    return ["office_file_not_found"]
            project = await asyncio.to_thread(
                self.project_store.get_project_for_session,
                record.get("sessionId"), owner_id=record.get("ownerId"))
            if project is None:
                # 工程目标连工程都没有，这就是缺项——说不出来用户只能猜。
                return ["project_not_created"]
            status = await asyncio.to_thread(
                ProjectDeliveryService(self.project_store, record.get("ownerId")).status,
                project.projectId)
            reasons = status.get("blockedReasons")
            return [str(item) for item in reasons][:6] if isinstance(reasons, list) else []
        except Exception:
            return []

    async def _hand_to_continuation(self, record, run_id, generation, status) -> bool:
        """这一回合结束后要不要自己接着跑。真要续就落成非终态并返回 True。"""
        if not rollout_readiness().get("configured", False):
            return False
        if reject_reason():
            return False
        goal = record.get("goal") if isinstance(record.get("goal"), dict) else {}
        if goal.get("kind") != "project":
            # 便宜地先挡掉对话目标，省一次库查询。判据仍在纯函数里。
            return False
        done = await self._goal_is_done(record)
        blocked = [] if done else await self._goal_blocked_reasons(record)
        wanted, reason = should_continue(
            status=status, goal=goal, events=record.get("events"), goal_done=done,
            blocked_reasons=blocked)
        if not wanted:
            log.info("control goal not continued run=%s reason=%s", run_id, reason)
            return False
        try:
            await asyncio.to_thread(self.store.wait_for_continue, run_id, self.worker_id,
                generation, progress_mark=progress_mark(record.get("events")))
            return True
        except Exception:
            # 交不出去就按原来的终态收口——续跑是增强，不许拖垮主链路（§7）。
            log.exception("control goal continuation handoff failed run=%s", run_id)
            return False

    async def _requeue_stalled_goals(self):
        """把「说完了但没做完」的目标叫回来接着跑。

        跟 `_requeue_settled_goals` 同一个形状、同一条路：只把状态 CAS 翻回
        queued，由原来那个 producer 重新认领、从 checkpoint 继续。**不新建
        第二套 Agent loop，也不重放原来那条 POST。**
        """
        for record in await asyncio.to_thread(self.store.list_waiting_continue):
            goal = record.get("goal") if isinstance(record.get("goal"), dict) else {}
            run_id = record["runId"]
            # 叫醒之前再问一次证据：等待期间别处（比如 operation 落定）可能
            # 已经把目标推到可交付了，那就不该再烧一轮。
            if await self._goal_is_done(record):
                try:
                    await asyncio.to_thread(self.store.update_goal, run_id,
                        self.worker_id, record["generation"], status="completed")
                except Exception:
                    log.exception("control goal settle failed run=%s", run_id)
                continue
            try:
                await asyncio.to_thread(self.store.requeue_continue, run_id,
                    progress_mark=str(goal.get("progressMark") or ""))
            except ControlRunConflict:
                continue
            self._wake.set()

    async def _heartbeat(self, port, finished):
        while not finished.is_set():
            try:
                await asyncio.wait_for(finished.wait(), timeout=self.lease_seconds / 3)
            except asyncio.TimeoutError:
                try:
                    await asyncio.to_thread(self.store.heartbeat, port.record["runId"],
                        self.worker_id, port.record["generation"], self.lease_seconds)
                except ControlRunConflict:
                    port.stop_reason = "control_lease_lost"
                    return
                except Exception:
                    # 存档抖动不许把正在采样的 run 判死。下一拍再续。
                    # 真丢了租约会在下一拍 ControlRunConflict，或 guard 看见过期。
                    log.exception("control heartbeat deferred run=%s", port.record["runId"])

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
        promoted = (record.get("goal") or {}).get("kind") == "project"
        try:
            await asyncio.to_thread(port.guard)
            # A crash after recording a terminal failure is not permission to
            # sample the model again, including before its final state event.
            error = _record_failure(record)
            if error is not None:
                status = "failed"
                return
            if any(event.get("type") == "complete" for event in record["events"]):
                status = "waiting_user" if any(event.get("type") in {
                    "control_ask_user", "control_plan_approval", "control_clarify"
                } for event in record["events"]) else "completed"
                return
            checkpoint = port.checkpoint
            if checkpoint is not None and checkpoint.get("schemaVersion") != 1:
                raise ControlRunStopped("control_reconciliation_required")
            if checkpoint and checkpoint.get("phase") == "provider_failed":
                status, error = "failed", "llm_unavailable"
                return
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
            # 自动续跑那一轮的**显式标记**。
            #
            # ⚠ 必须是标记，不能靠认话。前端 `isContinuationTurn` 原来是匹配
            #   机器排的那几句（「假设已确认」「续播上一轮推演」…），而自动
            #   续跑**没有用户文本**——`isContinuationTurn("")` 直接 false，
            #   折叠会静默失效，左栏退回「每轮从头演一遍开场」。见
            #   client/src/pages/sliderule/turn-continuation.ts 头注。
            #
            # 两件事一起做，缺一不可：
            #   1) 发事件 → 前端认标记折叠，用户看见的是一条连续的工作流
            #   2) 往 checkpoint 的对话里追一句 → 模型知道自己为什么又醒了，
            #      内容由服务端算出的 blockedReasons 生成，不是「请继续」
            attempt = (record.get("goal") or {}).get("continuations") or 0
            emitted = sum(1 for e in record["events"]
                          if e.get("type") == "control_continuation")
            if attempt > emitted:
                blocked = await self._goal_blocked_reasons(record)
                notice = continuation_notice(blocked, attempt)
                # ⚠ 2026-09-13 真机第一趟红在这里（control_reconciliation_required）：
                #   上一回合是**正常收尾**的（phase="settling"），而下面那道
                #   resume 守卫只认 model/tools——那是「回合中途被打断」的形态。
                #   续跑要开的是新一轮，必须先把 checkpoint 转成新一轮的起点。
                resumed = continuation_checkpoint(checkpoint, notice)
                if resumed is not None:
                    await port.save(resumed)
                    checkpoint = resumed
                await asyncio.to_thread(self.store.append_event, run_id,
                    self.worker_id, generation,
                    {"type": "control_continuation", "attempt": attempt,
                     "reason": "goal_not_delivered", "blockedReasons": blocked[:6]})
            awaiting = (record.get("goal") or {}).get("awaitingOperationIds") or []
            if (
                checkpoint is not None
                and checkpoint.get("phase") == "settling"
                and awaiting
            ):
                # ⚠ 2026-09-18 真机（问账号密码那轮）：
                #   模型 text-only 收尾留下 phase="settling"，shell_exec 还在
                #   queued，wait_for_operations 叫醒后走这里。原来直接
                #   control_reconciliation_required，host 黄条「控制面未返回结果」。
                #
                #   抄 grok-build auto-wake：后台任务结束是**新一轮合成提示**，
                #   不是把已经收尾的 checkpoint 当「回合中途被打断」去续。
                #   只在「真的在等操作」时转。目标续跑走上面 attempt>emitted
                #   那条；entry / dispatching 仍对账，不许借这条重放不确定副作用。
                op_rows = []
                for operation_id in awaiting:
                    try:
                        op_rows.append(await asyncio.to_thread(
                            self.project_store.get_operation,
                            operation_id, owner_id=record["ownerId"]))
                    except Exception:
                        continue
                resumed = continuation_checkpoint(
                    checkpoint, operation_settled_notice(op_rows))
                if resumed is not None:
                    await port.save(resumed)
                    checkpoint = resumed
            if checkpoint is not None and checkpoint.get("phase") == "sampling":
                # ⚠ 2026-09-19 真机 ctr-372375…：checkpoint 停在 sampling，
                #   resume 守卫只认 model/tools → control_reconciliation_required。
                #   抄 grok MidTurnAbort：不重放那次 HTTP POST，补齐 dangling
                #   tool result，开新一轮。dispatching 仍对账，不许借这条
                #   重放已经发出去的工具。
                resumed = sampling_interrupted_checkpoint(checkpoint)
                if resumed is not None:
                    await port.save(resumed)
                    checkpoint = resumed
            if checkpoint is not None and checkpoint.get("phase") == "dispatching":
                # 挂着命令：按调用 id 定下的键查库里那条操作，查到了拿真实状态当回执（不重放）。
                # 查不到的照旧对账（dispatching_reconciled_checkpoint 头注）。
                receipts = await asyncio.to_thread(self._recorded_command_receipts, record, checkpoint)
                resumed = dispatching_reconciled_checkpoint(checkpoint, receipts)
                if resumed is not None:
                    await port.save(resumed)
                    checkpoint = resumed
            if checkpoint is not None and checkpoint.get("phase") == "dispatching":
                # 挂着的全是只读工具：补齐、开新一轮（dispatching_readonly_checkpoint 头注，第 127 轮）。
                resumed = dispatching_readonly_checkpoint(checkpoint)
                if resumed is not None:
                    await port.save(resumed)
                    checkpoint = resumed
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
                    failure = _event_failure(event)
                    if failure is not None:
                        status, error = "failed", error or failure
                    elif status != "failed" and event.get("type") in {"control_ask_user", "control_plan_approval", "control_clarify"}:
                        status = "waiting_user"
                        await asyncio.to_thread(self.store.update_goal, run_id, self.worker_id,
                            generation, status="waiting_user")
                    elif event.get("type") == "control_tool_result" and event.get("operationId"):
                        # Record asynchronous work independently of the model
                        # transcript so a refreshed client can explain what it
                        # is waiting for. The existing loop still owns polling;
                        # this bookkeeping does not dispatch a second loop.
                        await asyncio.to_thread(self.store.update_goal, run_id, self.worker_id,
                            generation, status="waiting_operation",
                            operation_ids=[str(event["operationId"])])
                    elif event.get("type") == "control_tool_start":
                        await asyncio.to_thread(self.store.update_goal, run_id, self.worker_id,
                            generation, status="active")
                    if not promoted and project_goal_promotion(event):
                        # 工程是这一回合里才创建的：提交时 kind 还是 conversation。
                        # 不升成 project，续跑入口会直接挡掉。
                        try:
                            authority = await asyncio.to_thread(
                                self.authorize, record["sessionId"], record["ownerId"])
                        except Exception:
                            authority = None
                        inherited = session_goal_text(authority) if authority is not None else ""
                        await asyncio.to_thread(
                            self.store.update_goal, run_id, self.worker_id, generation,
                            status="active", kind="project",
                            text=inherited or None)
                        promoted = True
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
                elif completion is not None and status in {"completed", "waiting_user", "failed"} and not abandoned:
                    latest_record = self.store.get(run_id, record["ownerId"])
                    goal = latest_record.get("goal") or {}
                    waiting_ids = (goal or {}).get("awaitingOperationIds") or []
                    pending = False
                    if status == "completed" and waiting_ids:
                        for operation_id in waiting_ids:
                            try:
                                operation = await asyncio.to_thread(
                                    self.project_store.get_operation,
                                    operation_id, owner_id=record["ownerId"])
                            except Exception:
                                pending = True
                                break
                            if not await asyncio.to_thread(
                                    goal_released_by, self.project_store, operation,
                                    record["ownerId"]):
                                pending = True
                                break
                    if pending:
                        await asyncio.to_thread(self.store.wait_for_operations, run_id,
                            self.worker_id, generation, waiting_ids)
                        suspend = True
                    elif await self._hand_to_continuation(latest_record, run_id, generation, status):
                        # 交给续跑调度：**非终态**，scanner 会把它叫回来。
                        # 判断与护栏在 control_goal_continuation 里，这里只负责
                        # 「按判断结果落库」，不在这儿重新推一遍规则。
                        suspend = True
                    else:
                        # 时间片到了但目标没交付：不许把 run/goal 写成 completed。
                        # 2026-09-14 真机 wall_clock 之后两边都是 completed。
                        done = await self._goal_is_done(latest_record)
                        if unfinished_slice_waits_for_user(
                                status=status, events=latest_record.get("events"),
                                goal_done=done) or unfinished_cap_waits_for_user(
                                status=status, events=latest_record.get("events"),
                                goal_done=done):
                            status = "waiting_user"
                        elif unfinished_project_waits_for_user(
                                status=status, goal=goal, goal_done=done):
                            # 见 unfinished_project_waits_for_user 头注。停下时把
                            # 「还缺什么」用人话告诉用户（C 保证最后一句露在外面）。
                            status = "waiting_user"
                            blocked = await self._goal_blocked_reasons(latest_record)
                            notice = undelivered_notice(blocked)
                            if not await self._repeats_last_notice(latest_record, notice):
                                await asyncio.to_thread(self.store.append_event, run_id,
                                    self.worker_id, generation,
                                    {"type": "control_text", "text": notice,
                                     "stopReason": "goal_not_delivered"})
                        goal_status = "failed" if status == "failed" else ("waiting_user" if status == "waiting_user" else "completed")
                        await asyncio.to_thread(self.store.update_goal, run_id, self.worker_id,
                            generation, status=goal_status)
                        completion = complete_with_provider_failure(
                            completion, latest_record.get("events"))
                        # ⚠ 2026-09-21 349E2KVH7G：control_text stop=llm_unavailable，
                        #   落库 complete 仍 idle/stop=None。run status 已经
                        #   failed，信封必须同一份。
                        if status == "failed":
                            completion = dict(completion or {"type": "complete"})
                            completion["type"] = "complete"
                            if error and not completion.get("stopReason"):
                                completion["stopReason"] = error
                            st = dict(completion.get("state") or {}) if isinstance(completion.get("state"), dict) else {}
                            if st.get("runtimePhase") in (None, "idle") and not st.get("awaitReason"):
                                st["runtimePhase"] = "failed"
                                st["awaitReason"] = "error"
                                st["awaitDetail"] = str(error or "control_loop_failed")
                            completion["state"] = st
                        await asyncio.to_thread(self.store.complete, run_id, self.worker_id,
                            generation, status, completion, error)
                elif not abandoned:
                    goal_status = ("cancelled" if status == "cancelled" else
                                   "waiting_user" if status == "waiting_user" else "failed")
                    await asyncio.to_thread(self.store.update_goal, run_id, self.worker_id,
                        generation, status=goal_status)
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
                    if (
                        event.get("type") == "complete"
                        and record.get("status") == "failed"
                    ):
                        event = complete_with_provider_failure(
                            event, record.get("events"))
                        st = event.get("state") if isinstance(event.get("state"), dict) else {}
                        if st.get("runtimePhase") in (None, "idle") and not st.get("awaitReason"):
                            event = dict(event)
                            st = dict(st)
                            st["runtimePhase"] = "failed"
                            st["awaitReason"] = "error"
                            st["awaitDetail"] = str(record.get("error") or "llm_unavailable")
                            event["state"] = st
                            if record.get("error") and not event.get("stopReason"):
                                event["stopReason"] = record.get("error")
                    yield event
            if record["status"] in TERMINAL:
                public = public_control_run(record)
                yield {"type": "control_run_settled", "controlRunId": run_id,
                       "status": public["status"], "error": public["error"], "lastSeq": record["lastSeq"]}
                return
            await asyncio.sleep(min(self.poll_seconds, 0.25))
