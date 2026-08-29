"""
Complete V5 driver ported from Node's session-driver.ts, mini-session.ts, and client runtime.

This replaces the entire Node V5 loop with Python RAG-backed execution.
All capabilities now produce real evidence via RAG, no templates, no degraded, no su8 issues.
"""

from .stage_legal import describe as _stage_describe
from .stage_legal import labels_with_eta as _stage_labels_with_eta
from .archetype_legal import required_evidence as _required_evidence
import os
import time
from typing import Dict, Any, AsyncGenerator, List, Literal, Optional
from datetime import datetime, timezone
from models.v5_state import V5SessionState, ProducedBy, SchedulingDecision
from .slide_rule_orchestrator import orchestrate_plan
from .engine_scheduling import pick_next_capabilities, pick_repair_capabilities, commit_artifact, append_reasoning_event, append_replay_event


def _has_pending_delivery_picks(state, user_instruction: str) -> bool:
    """交付意图下是否还有未提交的交付能力可选（用于门通过后的继续判定）。"""
    from .engine_scheduling import _is_delivery_intent

    if not _is_delivery_intent(user_instruction or ""):
        return False
    try:
        return bool(pick_next_capabilities(state, user_instruction or ""))
    except Exception:
        return False
from .v5_capability_executor import execute_v5_capability
from .persistence import (
    PersistClosedError,
    pending_goal_key,
    persist_state,
    record_pending_run,
)
from .slide_rule_coverage import (
    evaluate_coverage_gate,
    reconcile_coverage,
    resolve_coverage_gaps_from_state,
)
from .v5_publish_closure_response import derive_publish_closure_response
from .v5_skill_runtime_graph import derive_skill_runtime_graph_response
from . import env_flags as _env_flags


def persist_pending_capability(
    state: V5SessionState,
    capability_id: str,
    loop: int = 0,
    selected=None,
    status: str = "ok",
    run_id: Optional[str] = None,
):
    """能力结束落 pendingRuns 并落盘。走本模块 persist_state，测试才能 mock。

    ⚠ 写失败抛 PersistClosedError，调用方不许接着跑下一个能力——
    假装存了 = 崩溃后重跑已完成的 LLM，白烧钱。
    """
    record_pending_run(state, capability_id, loop, selected, status, run_id)
    result = persist_state(state)
    # 非 dict / None 也是没写成。假装 ok 是 fail-open：mock 或以后改返回值
    # 会让调用方接着跑下一个能力，崩溃后再烧一遍 LLM。
    if not isinstance(result, dict) or not result.get("ok"):
        reason = "pending_write_failed"
        message = "persist_state returned no result"
        if isinstance(result, dict):
            reason = str(result.get("reason") or reason)
            message = str(result.get("message") or "")
        raise PersistClosedError(reason, message)
    return result


def _result_to_dict(result: Any) -> Dict[str, Any]:
    """Normalize executor results from Pydantic model_dump() or plain dict capability results.
    This is the core adapter for /drive-full compat (task 119-04): keeps drive_full_v5_session
    and downstream pass-through working whether caps return ExecuteCapabilityResult (pydantic)
    or legacy/plain dicts. Deterministic; never triggers provider. Degraded/error results are
    passed through as-is (upper layers and error recording preserve fail-closed).
    """
    if isinstance(result, dict):
        return result
    if hasattr(result, "model_dump"):
        try:
            dumped = result.model_dump()
        except Exception:
            return {}
        normalized = dumped if isinstance(dumped, dict) else {}
        for key, value in getattr(result, "__dict__", {}).items():
            if key.startswith("_") or key in normalized:
                continue
            normalized[key] = value
        return normalized
    if hasattr(result, "__dict__"):
        return {
            key: value
            for key, value in getattr(result, "__dict__", {}).items()
            if not key.startswith("_")
        }
    return {}


def _commit_capability_result(
    state: V5SessionState,
    *,
    capability_id: str,
    role_id: str,
    turn_id: str,
    run_id: str,
    artifact_id: str,
    result_data: Dict[str, Any],
    duration_ms: int,
    parallel: Optional[bool] = None,
) -> None:
    produced = ProducedBy(capabilityRunId=run_id, capabilityId=capability_id, roleId=role_id)
    kind = "evidence" if "evidence" in capability_id or capability_id in ["mcp.call", "skill.invoke"] else ("report" if "report" in capability_id else "risk")
    commit_artifact(
        state,
        id=artifact_id,
        kind=kind,
        content=result_data.get("content", ""),
        summary=result_data.get("summary", ""),
        title=result_data.get("title"),
        provenance=result_data.get("provenance", "python-rag"),
        producedBy=produced,
        inputArtifactIds=[],
        turnId=turn_id,
        sources=result_data.get("sources", []),
    )
    if getattr(state, "capabilityRuns", None):
        last = state.capabilityRuns[-1]
        if hasattr(last, "result"):
            last.result = result_data
        elif isinstance(last, dict):
            last["result"] = result_data
        if hasattr(last, "timing"):
            timing: Dict[str, Any] = {"durationMs": duration_ms}
            if parallel is not None:
                # Timing telemetry marker: attribute this measurement to the
                # parallel batch path (absent on the untouched serial path).
                timing["parallel"] = parallel
            last.timing = timing


# ---------------------------------------------------------------------------
# Parallel capability batch (SLIDERULE_PARALLEL_CAPS)
#
# Product decision: no artificial speed-ups (no lower-quality shortcuts) — we
# only remove engineering waste. Within one drive loop each selected capability
# makes an INDEPENDENT provider call; serializing them wastes wall time.
#
# Design: "parallel execute, deterministic commit".
#   Phase A (visibility): capability_start reasoning/replay events for ALL
#     selected caps are appended + persisted BEFORE the batch runs, so pollers
#     see what's in flight.
#   Phase B (execute):    execute_v5_capability runs concurrently. It is
#     read-only on state (reads state.goal; appbundle/runtimeClosure caps also
#     read state.artifacts — those are commit-order sensitive and therefore run
#     as serial barriers at their original position, after preceding commits).
#   Phase C (commit):     commit_artifact / capabilityRuns / dependencyGraph /
#     error recording are applied SEQUENTIALLY in the original selection order,
#     so artifact/run ordering and execution-chain edges are byte-identical to
#     serial mode for the same results. State is never mutated concurrently.
#
# The serial code path below stays intact (reference semantics) and is chosen
# whenever the flag is explicitly false (or a single capability is selected).
#
# ⚠ persist-before-next-LLM（A/B 跑完再挂、恢复不重烧 A/B）要串行：
# SLIDERULE_PARALLEL_CAPS=false。默认 ON 先把整组 LLM 花掉再顺序 commit；
# gather 中途崩会整组重烧，commit 之间崩只跳过已经落 pending 的。
# ---------------------------------------------------------------------------

def _parallel_caps_enabled() -> bool:
    """SLIDERULE_PARALLEL_CAPS: env wins (dynamic), settings next, default ON.

    Explicit "false"/"0"/"no"/"off" selects the untouched serial path.
    """
    env = os.getenv("SLIDERULE_PARALLEL_CAPS")
    if env is not None and str(env).strip() != "":
        return str(env).strip().lower() not in _env_flags.OFF
    try:
        from config.settings import settings as _settings
        return bool(getattr(_settings, "SLIDERULE_PARALLEL_CAPS", True))
    except Exception:
        return True


def _repeat_allows(state: "V5SessionState", pick: Dict[str, Any]) -> bool:
    """max_repeat_guard 的单条判据：这个提案还能不能跑。

    两种放行：没跑满，或者提案门读了 `why` 之后凭理由放行过（`repeatGranted`）。
    后者仍然受硬顶约束——理由再充分也不能无限重复，见 repeat_policy。

    ⚠ 必须认 `repeatGranted`。不认的话，提案门刚凭理由放行的，转头就被这道门
    拦掉——那正是 2026-08-05 之前"两道门各判各的、算法还不一样"的老毛病。
    """
    from .repeat_policy import is_over_ceiling, is_repeat_exhausted

    cap = pick.get("capabilityId", "")
    if not is_repeat_exhausted(state, cap):
        return True
    return bool(pick.get("repeatGranted")) and not is_over_ceiling(state, cap)


def _is_closure_cap(capability_id: str) -> bool:
    """这条能力是不是"发布收口"本身。

    跟下面的 `_is_commit_order_sensitive_cap` 分开写：那个还包含 synthesis /
    report（它们同样要当屏障），而"本轮收过口没有"必须只认收口本身——
    多认一个就会把没收口的轮次也标成已收口。
    """
    cap = (capability_id or "").lower()
    return "appbundle" in cap or "runtimeclosure" in cap


def _contains_closure_pick(picks: list) -> bool:
    return any(_is_closure_cap(item.get("capabilityId", "")) for item in picks)


def _is_commit_order_sensitive_cap(capability_id: str) -> bool:
    """Caps whose EXECUTOR reads committed artifacts (not just goal text).

    execute_v5_capability's appbundle/runtimeClosure branch derives per-skill
    evidence from state.artifacts, so in serial mode it observes the commits of
    caps earlier in the same batch. Such caps must run as barriers.
    """
    cap = (capability_id or "").lower()
    if "appbundle" in cap or "runtimeclosure" in cap:
        return True
    # E17：综合/报告类的 prompt 注入上游产物（build_evidence_context），
    # 并行批里必须作为屏障段——等同轮前段 commit 后再执行，才能吃到
    # 同轮的风险/证据产物
    return "synthesis" in cap or "report" in cap


def _split_parallel_segments(selected: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """Split the selection into maximal parallel-safe groups; commit-order
    sensitive caps become single-element barrier segments at their position."""
    segments: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    for sel in selected:
        if _is_commit_order_sensitive_cap(sel.get("capabilityId", "")):
            if current:
                segments.append(current)
                current = []
            segments.append([sel])
        else:
            current.append(sel)
    if current:
        segments.append(current)
    return segments


def _llm_round_caps_enabled() -> bool:
    """轮内推理能力（risk.analyze / counter.argue / synthesis.merge / report.write…）
    是否走真 LLM。显式 SLIDERULE_LLM_ROUND_CAPS=0/false 关闭；默认跟随"是否配置了
    LLM 通道"——配置了就真调（每一步的想法可流式观测），没配置走确定性 RAG。"""
    env = os.getenv("SLIDERULE_LLM_ROUND_CAPS")
    if env is not None and str(env).strip() != "":
        return str(env).strip().lower() not in _env_flags.OFF
    try:
        from sliderule_llm.config import get_llm_config

        return bool(get_llm_config().api_key)
    except Exception:
        return False


def _execute_round_capability(cap: str, state: V5SessionState, role: str, turn_id: str) -> Any:
    """执行一个轮内能力：LLM 通道已配置且能力原生支持时走真 LLM（内容增量经
    capabilities 模块的 delta sink 实时流出），任何失败回落确定性 RAG 路径。
    回落结果 provenance 保持 python-rag（诚实标注），真 LLM 结果是 python-llm。"""
    if _llm_round_caps_enabled():
        try:
            from sliderule_llm.capabilities import (
                execute_capability as _native_execute,
                is_python_native_capability,
            )

            if is_python_native_capability(cap):
                goal = state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal or "")
                # E17 证据上下文管道：上游已过门产物注入 prompt（用户裁决
                # 2026-07-16）。此前 payload 只送 goal——「综合各方结论」
                # 综合的不是各方结论。失败/停用回落空串，不挡执行。
                upstream = ""
                try:
                    from sliderule_llm.evidence_context import (
                        build_evidence_context,
                        evidence_context_enabled,
                    )

                    if evidence_context_enabled():
                        artifact_dicts = [
                            a if isinstance(a, dict) else a.model_dump()
                            for a in (getattr(state, "artifacts", []) or [])
                        ]
                        upstream = build_evidence_context(
                            artifact_dicts,
                            set(getattr(state, "staleArtifactIds", []) or []),
                            capability_id=cap,
                        )
                except Exception as ctx_exc:  # noqa: BLE001 — 注入失败不挡推演
                    print(f"[v5_full_driver] evidence context skipped: {str(ctx_exc)[:120]}")
                # USER_MESSAGE 槽位本来就在（capabilities.py:259 的 prompt
                # 模板是 "GOAL: …\nUSER_MESSAGE: …" 两槽结构，与 CrewAI 的
                # role_playing/task 同形），此前却被写死成 goal —— 于是"用户
                # 这一轮说了什么"这一格里装的永远是会话话题。
                #
                # 新建会话里两者相同，看不出来；**fork 出来的副本里 goal 是
                # 源应用的旧话题**，用户提了新要求也进不来，推演过程整篇答非
                # 所问（2026-08-06 用户实测「我发布的是从文献到引用的话题，
                # 回答的是电动车方面的内容」）。
                #
                # `or goal` 兜底：引擎自推的轮次没有用户输入，保持旧行为
                # 逐字节不变。
                from .v5_capability_executor import current_turn_instruction

                payload = {
                    "capabilityId": cap,
                    "state": {"goal": {"text": goal}},
                    "userText": current_turn_instruction() or goal,
                    "roleId": role,
                    "turnId": turn_id,
                    "upstreamEvidence": upstream,
                }
                if cap == "evidence.search":
                    from sliderule_llm.evidence import execute_evidence_runtime

                    return _native_execute(payload, evidence_retriever=execute_evidence_runtime)
                return _native_execute(payload)
        except Exception as exc:  # noqa: BLE001 — LlmError/transport 都回落，一步失败不许沉掉整场推演
            print(f"[v5_full_driver] native LLM cap {cap} failed, fallback to RAG: {str(exc)[:160]}")
            # 回退 RAG 也是降级：能力的原生结果没拿到，产出质量已经打折。
            # 影响面看是哪个能力——推演类退兜底只是结论粗糙，收口类才伤成品。
            from .run_degradation import (
                REASON_CAPABILITY_LLM_FALLBACK,
                impact_for_capability,
                mark_degraded,
            )
            mark_degraded(
                state,
                reason=REASON_CAPABILITY_LLM_FALLBACK,
                message=f"能力 {cap} 的 LLM 执行失败，回退 RAG：{str(exc)[:120]}",
                impact=impact_for_capability(cap),
            )
    return execute_v5_capability(cap, state, [], role, turn_id)


def _timed_execute(cap: str, state: V5SessionState, role: str, turn_id: str) -> Dict[str, Any]:
    """Execute one capability, catching its error (per-cap try/except identical
    to the serial path — one failure must not sink the batch). Read-only on state."""
    t0 = time.time()
    try:
        result = _execute_round_capability(cap, state, role, turn_id)
        return {
            "ok": True,
            "result_data": _result_to_dict(result),
            "error": None,
            "durationMs": int((time.time() - t0) * 1000),
        }
    except Exception as cap_exc:  # noqa: BLE001 — mirrors serial per-cap recovery
        return {
            "ok": False,
            "result_data": None,
            "error": cap_exc,
            "durationMs": int((time.time() - t0) * 1000),
        }


def _execute_group_parallel(state: V5SessionState, group: List[Dict[str, Any]], turn_id: str) -> List[Dict[str, Any]]:
    """Run a parallel-safe group concurrently; results aligned with group order.
    Max workers = number of selected caps in the group (picker caps selection at 5)."""
    if len(group) == 1:
        sel = group[0]
        return [_timed_execute(sel["capabilityId"], state, sel.get("roleId", "agent"), turn_id)]
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(len(group), 5)) as pool:
        futures = [
            pool.submit(_timed_execute, sel["capabilityId"], state, sel.get("roleId", "agent"), turn_id)
            for sel in group
        ]
        return [f.result() for f in futures]


def _emit_batch_capability_starts(state: V5SessionState, selected: List[Dict[str, Any]], loop: int) -> None:
    """Phase A: pre-emit capability_start reasoning/replay events for the whole
    batch and persist once, so stream watchers/pollers see what's in flight."""
    turn_id = f"loop-{loop}"
    for sel in selected:
        cap = sel["capabilityId"]
        role = sel.get("roleId", "agent")
        run_id = f"run-{loop}-{cap}"
        append_reasoning_event(
            state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_start",
            text=f"capability_started: {cap}", roleId=role, order=1,
        )
        append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=cap, capabilityRunId=run_id)
    persist_state(state)


def _apply_pending_run_skips(
    state: V5SessionState, selected: List[Dict[str, Any]], loop: int
) -> List[Dict[str, Any]]:
    """崩溃恢复：跳过 pendingRuns 里已经完成的能力，避免重烧 LLM。

    ⚠ 2026-08-27：一轮 5 能力挂在第 4 个时，旧路径整轮重跑，前 3 个 LLM
    白烧。pendingRuns 是工厂循环内部的 crash-recovery 台账，不是挑战级
    局部重跑 UI，也不是 GET /runs/{id}/stream 那种 HTTP 续播。

    同一批（**同一个目标** + selected 集合相同 + 尚未全部完成）才跳过；
    换目标、整批完成后或选材变了就开新台账，免得下一轮正当重跑被误跳。

    ⚠ 2026-08-27 评审：原来只看 selected 集合。spec-first 那批选材在相邻
      两轮经常一模一样，于是：停掉一轮 → 换个目标再发 → 选材相同 →
      上一轮**为旧目标**完成的能力被当成本轮已完成跳掉。用户看到的是新
      需求的推演里混着上一单的产物，而且没有任何报错。

    ⚠ **不能拿 turnId 当这个键**（第一版就是这么写的，被
      `test_crash_after_b_resume_skips_completed_caps` 当场咬红）：崩溃恢复
      是一次**新的 drive**，`_advance_turn_version` 一进来就把 lastTurnId
      步进一格，所以恢复那趟的 turnId 必然对不上写台账那趟的——按 turnId
      判等于把崩溃恢复整个关掉，前面烧掉的 LLM 全部白烧。
      跨轮流通、且"同一件活"必然相同的只有**目标文本**，所以键取它。

    ⚠ 老存档没有 `goal` 键：`None != goal_text` → 当成新批，整批重跑一次。
      多烧一轮，但不会把旧目标的产物错认成新目标的——这一类要 fail 向
      "重做"，不是 fail 向"复用"（第七条）。
    """
    ids = [s.get("capabilityId") for s in selected if s.get("capabilityId")]
    pending = getattr(state, "pendingRuns", None)
    if not isinstance(pending, dict):
        pending = {}
    goal_text = pending_goal_key(state)
    prev_selected = [c for c in (pending.get("selected") or []) if c]
    prev_completed = [c for c in (pending.get("completed") or []) if isinstance(c, dict)]
    done_ids = {c.get("capabilityId") for c in prev_completed if c.get("capabilityId")}
    same_batch = (
        pending.get("goal") == goal_text
        and set(prev_selected) == set(ids)
        and bool(done_ids)
        and not done_ids >= set(ids)
    )
    if not same_batch:
        state.pendingRuns = {
            "turnId": getattr(state, "lastTurnId", None),
            "goal": goal_text,
            "loop": loop,
            "selected": ids,
            "completed": [],
        }
        return list(selected)
    return [s for s in selected if s.get("capabilityId") not in done_ids]


def _commit_executed_outcome(
    state: V5SessionState,
    *,
    sel: Dict[str, Any],
    loop: int,
    outcome: Dict[str, Any],
    parallel: bool = True,
    selected: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Phase C: apply one capability's state mutations (sequential, selection order).

    Success: commit_artifact + run result/timing + capability_complete (same as serial).
    Error: record_capability_run_error + degraded awaitDetail (same as serial) — an
    errored capability never prevents the other caps' commits.

    `selected` is the full batch (not `[sel]`). pending.selected 必须记下整组，
    崩溃恢复才认同一批；只传当前这一条会把台账缩成单能力。
    """
    cap = sel["capabilityId"]
    role = sel.get("roleId", "agent")
    turn_id = f"loop-{loop}"
    run_id = f"run-{loop}-{cap}"
    batch = selected if selected else [sel]
    if outcome["ok"]:
        _commit_capability_result(
            state,
            capability_id=cap,
            role_id=role,
            turn_id=turn_id,
            run_id=run_id,
            artifact_id=f"art-{loop}-{cap}",
            result_data=outcome["result_data"] or {},
            duration_ms=outcome["durationMs"],
            parallel=parallel,
        )
        append_reasoning_event(
            state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_complete",
            text=f"capability_completed: {cap}", roleId=role, order=2,
        )
        persist_pending_capability(
            state, cap, loop, batch, "ok", run_id,
        )
    else:
        from .engine_scheduling import record_capability_run_error

        err = {"code": "capability_execution_failed", "message": str(outcome["error"])[:200], "capabilityId": cap}
        record_capability_run_error(
            state,
            capabilityId=cap,
            turnId=turn_id,
            error=err,
            roleId=role,
            timing={"durationMs": outcome["durationMs"], "parallel": parallel},
        )
        append_reasoning_event(
            state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_complete",
            text=f"capability_completed: {cap} (error)", roleId=role, order=2,
        )
        persist_pending_capability(
            state, cap, loop, batch, "error", run_id,
        )
        state.awaitDetail = (getattr(state, "awaitDetail", None) or "") + f"; degraded cap {cap}"


def _append_loop_timing_event(state: V5SessionState, loop: int, caps: int, wall_ms: int) -> None:
    """Per-loop wall-duration telemetry with the parallel marker, so before/after
    measurements are attributable in the persisted reasoning ledger."""
    append_reasoning_event(
        state, turnId=f"loop-{loop}", capabilityRunId=f"loop-{loop}-timing", capabilityId="driver",
        kind="think", text=f"loop_timing: loop={loop} caps={caps} wallMs={wall_ms} parallel=true", order=3,
    )


def _run_selected_batch_parallel(state: V5SessionState, selected: List[Dict[str, Any]], loop: int) -> None:
    """Sync driver's parallel batch: pre-emit starts, execute concurrently,
    commit sequentially in the original selection order."""
    t_loop = time.time()
    turn_id = f"loop-{loop}"
    _emit_batch_capability_starts(state, selected, loop)
    for group in _split_parallel_segments(selected):
        outcomes = _execute_group_parallel(state, group, turn_id)
        for sel, outcome in zip(group, outcomes):
            _commit_executed_outcome(
                state, sel=sel, loop=loop, outcome=outcome, parallel=True, selected=selected,
            )
    _append_loop_timing_event(state, loop, len(selected), int((time.time() - t_loop) * 1000))
    persist_state(state)


def _ensure_runtime_closure_evidence(
    state: V5SessionState,
    user_instruction: str,
    loop: int,
    repair: bool = False,
    closure_attempted: bool = False,
    evidence_tag: Optional[str] = None,
) -> V5SessionState:
    """Append Python-owned AppBundle closure evidence for replay when a real command ran.

    The UI can derive preview surfaces, but reload requires persisted Python evidence.
    This keeps the route fail-closed: if AppBundle reports missing skill evidence, the
    derived publishClosure is blocked rather than fabricated green.
    """
    goal_text = state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal or "")
    # E37：指令为空但话题在场时不再静默跳过——一轮跑完却连 blocked 闭环都
    # 没有，右侧是一块假装无事发生的空看板。空指令回落 goal 原文照常收口。
    instruction = (user_instruction or "").strip() or (goal_text or "").strip()
    if not instruction:
        return state
    if closure_attempted and not repair:
        return state
    existing_closure = derive_publish_closure_response(state)
    _refine_set = False
    if existing_closure is not None and derive_skill_runtime_graph_response(state) is not None:
        blocked = bool(existing_closure.get("blocked")) if isinstance(existing_closure, dict) else bool(getattr(existing_closure, "blocked", False))
        # E29 增量迭代：闭环已收口 + 用户带来新的补充指令 → 精修模式，
        # 在现有五系统模型上做最小增量修改（同一结构闸把关），
        # 不再整轮白跑/模型原地不动。指令与话题原文相同（重新推演）不精修。
        current_model = extract_model_from_closure(existing_closure)
        wants_refine = bool(
            instruction
            and instruction != (goal_text or "").strip()
            and current_model is not None
        )
        # ⚠ 这里**不能**再挂在 `if not blocked` 之下（2026-08-16 线上实测）。
        #
        # 真机证据（sr-20260816095147，"步伴 AI 拐杖"）：第一轮闭环因
        # CLOSURE_GOAL_RELEVANCE_FAILED 判 blocked=True——那道闸把营销标题
        # 「【硬件+社会公益】步伴 AI 拐杖——这一次，我们重新定义智能拐杖！」
        # 按标点切成三个伪业务点，再拿页面名去比，必然 0%。用户随后发了
        # 「菜单的显示看着有问题」，而精修分支被 blocked 挡在门外：
        #
        #   set_refine_context 从未调用
        #     → 执行器里 _refine_active=False
        #     → 走"整轮重建"，_try_llm_generate_evidence(goal, …) 拿的还是原话题
        #     → 页面重画 204.8 秒，产出与上一版等价
        #     → awaitReason=no_progress，streak 2
        #
        # **用户明确说出口的话，不该因为上一轮的闸红了就被丢掉。**
        # blocked 该决定的是"要不要重建"，不是"要不要听用户说话"。
        #
        # 真正防住"没有模型可精修"的是 `current_model is not None`——
        # 证据真缺失（0/6）时 extract_model_from_closure 返回 None，
        # wants_refine 自然为 False，照旧走重建。fail-closed 语义不变。
        if wants_refine:
            from .v5_llm_generate import set_refine_context

            # 老会话没有版本史：先把现有模型记为 v1，精修后的才是 v2，
            # 否则「回退」无处可回
            if not (getattr(state, "modelVersions", None) or []):
                record_model_version(
                    state, existing_closure,
                    goal_text or "初始版本",
                )
            # ⚠ 2026-08-29 真机：**调用方已经摆好模型时，这里不许再盖一遍。**
            #
            #   版本回退（routes/sliderule_full._restore_model_version_locked）
            #   进来之前会先 set_model_override(目标版本模型) +
            #   set_refine_context(目标版本模型, "回退到版本 mv-1")。而这一行
            #   紧接着按 **current_model**（当前闭环承载的那个，也就是要被回退
            #   掉的那一版）重设精修上下文，把调用方的意图整个盖掉：
            #
            #       重建出来的还是当前模型
            #         → D8 判 extract_model_from_closure(closure) != target.model
            #         → 409 closure_rebuild_mismatch，回退**永远失败**
            #
            #   真机 sr-it-C-073213（mv-1≠mv-2）：409。sr-it-B-072108 之所以
            #   "成功"，只是因为那一轮精修产出的四个核心段与 mv-1 逐字节相同，
            #   D8 比什么都相等——那是假绿，不是回退真的生效了。
            #
            #   这就是 CLAUDE.md 第一条：插座是通的，插头被下一行拔了。
            #   model_override 非空 = 调用方在做直供，它自己会在 finally 里清，
            #   所以这里也**不置 _refine_set**（谁设的谁清）。
            from .v5_llm_generate import get_model_override

            if get_model_override() is None:
                set_refine_context(
                    refine_model_of(state, current_model), instruction,
                    pages=refine_pages_of(state),
                )
                _refine_set = True
        elif not blocked:
            return state
        # blocked 的闭环允许在新一轮重建（例如 LLM 瞬时失败导致 0/6）：
        # fail-closed 语义不变——证据真缺失时重建后依然 blocked。

    import time as _time

    capability_id = "appbundle.runtimeClosure"
    role_id = "appbundle"
    # ⚠ 2026-08-29：**id 命名空间决定这轮证据能不能落库。**
    #
    #   commit_artifact 是无条件 append（允许重名 id），而单调守卫的同轮进展
    #   判据 _is_same_turn_progress 数的是 **id 集合的大小**。于是一轮重建
    #   如果把 id 撞在已有那批上——run / artifact / reasoningEvent 全撞——
    #   集合一个都没变大，守卫判「没进展」，把整个核心退回旧值：
    #   这一轮的证据**连同结果一起被丢掉**。
    #
    #   版本回退正是这么翻的车：路由固定传 loop=0，于是 ids 与首轮那次闭环
    #   逐字相同。结果是 publishClosure（在豁免名单里）活了下来、
    #   capabilityRuns（不在）被退回——两个来源从此各说各话：
    #
    #       落库的 state.publishClosure          → 承载 mv-1（回退目标）
    #       derive_publish_closure_response(runs) → 承载 mv-2（回退掉的那版）
    #
    #   而 derive 那份才是权威（模块头：fail-closed，闭环判决只认它）。真机
    #   sr-it-D-074734：回退到 mv-1 之后紧接着精修一次，产出的 mv-3 的 rbac
    #   段与 **mv-2** 相同、与 mv-1 不同——**回退被下一轮精修静默撤销了**。
    #
    #   所以需要重建证据的调用方（回退、重开工作区）必须给一个独立的命名空间。
    #   不传 = 与从前逐字一致（主循环各轮的 loop 天然不同，不受影响）。
    _ns = f"{loop}-{evidence_tag}" if evidence_tag else f"{loop}"
    turn_id = f"loop-{_ns}-closure"
    run_id = f"run-{_ns}-{capability_id}"
    append_reasoning_event(
        state,
        turnId=turn_id,
        capabilityRunId=run_id,
        capabilityId=capability_id,
        kind="capability_start",
        text=f"capability_started: {capability_id}",
        roleId=role_id,
        order=1,
    )
    append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=capability_id, capabilityRunId=run_id)
    persist_state(state)
    t0 = _time.time()
    try:
        result = execute_v5_capability(capability_id, state, [], role_id, turn_id)
        result_data = _result_to_dict(result)
        _commit_capability_result(
            state,
            capability_id=capability_id,
            role_id=role_id,
            turn_id=turn_id,
            run_id=run_id,
            artifact_id=f"art-{_ns}-{capability_id}",
            result_data=result_data,
            duration_ms=int((_time.time() - t0) * 1000),
        )
        append_reasoning_event(
            state,
            turnId=turn_id,
            capabilityRunId=run_id,
            capabilityId=capability_id,
            kind="capability_complete",
            text=f"capability_completed: {capability_id}",
            roleId=role_id,
            order=2,
        )
        persist_state(state)
    except Exception as cap_exc:
        from .engine_scheduling import record_capability_run_error

        # E37 fail-closed 兜底：闭环重建炸掉也要落一个确定性 blocked 闭环
        # （挂在 error run 的 result 上，derive 能扫到）——回合结束后
        # publishClosure 不允许为 null，用户看到的是「发布检查未通过 +
        # 真实失败原因」，不是一块空看板。
        fallback_result = None
        try:
            from .v5_capability_executor import build_fallback_blocked_closure

            fallback_result = build_fallback_blocked_closure(state, goal_text, str(cap_exc)[:200])
        except Exception as fb_exc:  # noqa: BLE001 — 兜底失败不遮蔽原始错误
            print(f"[v5_full_driver] fallback blocked closure failed: {str(fb_exc)[:120]}")
        record_capability_run_error(
            state,
            capabilityId=capability_id,
            turnId=turn_id,
            error={"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": capability_id},
            roleId=role_id,
            timing={"durationMs": int((_time.time() - t0) * 1000)},
            result=fallback_result,
        )
        append_reasoning_event(
            state,
            turnId=turn_id,
            capabilityRunId=run_id,
            capabilityId=capability_id,
            kind="capability_complete",
            text=f"capability_completed: {capability_id} (error)",
            roleId=role_id,
            order=2,
        )
        persist_state(state)
    if _refine_set:
        from .v5_llm_generate import set_refine_context

        set_refine_context(None)
    return state






def trusted_closure_decision(
    state: "V5SessionState", user_instruction: str = "", *, repair: bool = False
) -> str:
    """Return the deterministic transition after a runtime closure.

    This is the local equivalent of a LangGraph conditional edge to END and
    Temporal's USE_EXISTING workflow-ID policy: a successful closure for the
    current turn and goal is terminal. Only an explicit repair or a genuinely
    new instruction may schedule more work.
    """
    if repair:
        return "repair"

    goal = getattr(state, "goal", None) or {}
    goal_text = str(goal.get("text") or "").strip() if isinstance(goal, dict) else str(goal).strip()
    instruction = str(user_instruction or "").strip()
    if instruction and goal_text and instruction != goal_text:
        return "continue"

    closure = getattr(state, "publishClosure", None)
    if not isinstance(closure, dict) or closure.get("blocked") is not False:
        return "continue"
    if int(closure.get("evidencePresentCount") or 0) < int(closure.get("skillCount") or 6):
        return "continue"
    return "end" if reusable_model_for_turn(state) is not None else "continue"


def ensure_closure_pick_by_deadline(
    state: "V5SessionState",
    picks: list,
    *,
    loop_index: int,
    repair: bool,
    closure_attempted: bool = False,
) -> list:
    """第二轮仍未首次收口时，把闭环加入当前并行批次。

    第一轮保留给意图、结构、路线和风险等基础能力。第二轮开始，闭环与证据、
    批判、综合并行；五系统模型由明确目标生成，不需要再等待一整轮重复规划。
    """
    if (
        repair
        or closure_attempted
        or loop_index < 1
        or isinstance(getattr(state, "publishClosure", None), dict)
    ):
        return picks
    if any(_is_closure_cap(str(item.get("capabilityId") or "")) for item in picks):
        return picks
    closure_pick = {"capabilityId": "appbundle.runtimeClosure", "roleId": "综合"}
    return [*picks[:4], closure_pick]


def terminal_phase_decision(
    state: "V5SessionState", gate: Dict[str, Any], publish_closure: Optional[Dict[str, Any]]
) -> tuple[str, Optional[str]]:
    """Resolve the final runtime phase from one authoritative closure verdict."""
    if not isinstance(publish_closure, dict):
        return "awaiting", "closure_missing"
    if publish_closure.get("blocked") is True:
        return "awaiting", "closure_blocked"
    goal = getattr(state, "goal", None) or {}
    goal_clear = isinstance(goal, dict) and goal.get("status") == "clear"
    if bool((gate or {}).get("passed")) or goal_clear:
        return "done", None
    return "awaiting", "coverage"


def apply_terminal_phase_decision(
    state: "V5SessionState", gate: Dict[str, Any], publish_closure: Optional[Dict[str, Any]]
) -> tuple[str, Optional[str]]:
    """Apply the authoritative terminal verdict without creating an invalid state."""
    phase, reason = terminal_phase_decision(state, gate, publish_closure)
    state.runtimePhase = phase
    state.awaitReason = reason
    return phase, reason


def extract_model_from_closure(closure) -> "Optional[Dict[str, Any]]":
    """从闭环 perSkillEvidence 的 modelSection 还原五系统模型（缺任一段返回 None）。"""
    per_skill = (
        closure.get("perSkillEvidence") if isinstance(closure, dict)
        else getattr(closure, "perSkillEvidence", None)
    ) or {}
    model: Dict[str, Any] = {}
    # ⚠ 2026-08-30：这里曾是第 12 处手抄，且顺序与另外 11 处不同
    #   （workflow/rbac 调换）——正因为顺序不同，"搜同一串字面量"的复查会漏掉它。
    #   本函数只是按 key 取段建 dict，顺序无关。
    for skill in _required_evidence():
        ev = per_skill.get(skill) or {}
        section = ev.get("modelSection") if isinstance(ev, dict) else getattr(ev, "modelSection", None)
        if section is None:
            return None
        model[skill] = section
    return model


def refine_pages_of(state: "V5SessionState") -> "Optional[Dict[str, Any]]":
    """取上一版页面 HTML `{pageId: html}`，给按需重画用（2026-08-17）。

    ⚠ **`set_refine_context` 有两个调用点**（wants_refine 分支 + enter_refine_mode），
      提成函数是因为只改一个必然静默失效：两处谁后跑谁覆盖，漏传的那次会把
      pages 抹成 None，于是模型到了、页面没到，表现是"按需重画不生效"而
      日志里什么都不缺。真机第一次跑就是这么翻的车——`按需重画` 那行一次
      都没出现，`精修 id 冻结` 却好好的（那条只依赖 model）。
      判据见 tests/test_refine_page_scope.py::Test两个调用点都要带页面。

    ⚠ 这两处是**唯二**拿得到 state 的地方；executor 那层只有请求域上下文
      （见 _cache_spec_first_pages 的说明）。
    """
    prev = getattr(state, "specFirstPages", None)
    if isinstance(prev, dict):
        pages = prev.get("pages")
        if isinstance(pages, dict) and pages:
            return pages
    # ⚠ 2026-08-18 过夜：首轮 spec-first 回落 GEN5，mv-1「页面：无」，
    # state.specFirstPages 空。下一轮按需重画拿不到旧页就全量，图判再
    # 扩到整张图。版本史里若有带页的一版，用它——比空页起步诚实。
    for v in reversed(list(getattr(state, "modelVersions", None) or [])):
        if not isinstance(v, dict):
            continue
        blob = v.get("specFirstPages")
        if not isinstance(blob, dict):
            continue
        pages = blob.get("pages")
        if isinstance(pages, dict) and pages:
            return pages
    return None


#: ⚠ 2026-08-29：模型版本记账搬到了 services/model_versions。
#:   原因是 v5_capability_executor 也要用它们，而本模块顶层又 import 执行器——
#:   最核心的那一对互相 import，是个真的循环依赖，两边只好把 import 藏进函数体。
#:   同名转出保留：仓里 10 个测试文件、5 个 services 模块按
#:   `from services.v5_full_driver import ...` 引用它们，判据也钉在这些名字上。
from services.model_versions import (  # noqa: F401
    _PAGES_KEPT_VERSIONS,
    goal_digest,
    record_model_snapshot,
    reusable_model_for_turn,
)


def refine_model_of(state: "V5SessionState", model: "Optional[Dict[str, Any]]") -> "Optional[Dict[str, Any]]":
    """把上一版的 styleBrief / designLanguage 合回精修模型（2026-08-18）。

    ⚠ 病灶：extract_model_from_closure 只从闭环证据拼**六段**，应用级附加键
      （styleBrief/designLanguage）天生不在里面。executor 读的是
      `model["styleBrief"]`（那边的注释以为"随 model 落库读回来就行"），
      于是设计语言的沿用**从出生起没通过电**——2026-08-18 真机三轮
      specfirst.design 全是 mode=llm 重新生成，每轮白烧 ~10s，还冒着
      「精修一次配色整个换掉」的风险（design_language 模块头量过的那个病）。

    附加键的真实载体是 state.specFirstPages（spec_first_pipeline 的
    _last_pages_var 顺路捎带，随会话持久化、随版本快照回退）。

    ⚠ 跟 refine_pages_of 同一条纪律：set_refine_context 有**两个**调用点，
      两处都必须包这一层，只包一处必然静默失效。
      判据见 tests/test_refine_page_scope.py::Test设计段随精修上下文回流。

    ⚠ 不覆盖已有键：模型里真带着 styleBrief 时（直调场景）以模型为准。
    """
    if not isinstance(model, dict):
        return model
    prev = getattr(state, "specFirstPages", None)
    if not isinstance(prev, dict):
        return model
    extras = {
        k: prev.get(k)
        for k in ("styleBrief", "designLanguage")
        if isinstance(prev.get(k), dict) and model.get(k) is None
    }
    return {**model, **extras} if extras else model


def enter_refine_mode(state: "V5SessionState", user_instruction: str) -> bool:
    """轮次**开始前**判定这一轮是不是精修，是就把上下文设好。返回是否设了。

    ## 为什么必须在循环之前

    真机证据（2026-08-16，两组对照 sr-20260816165447 / sr-20260816170934）：
    用户只说「预警消息中心那一页的消息流是空的，给它加一些模拟数据」，产出的
    mv-2 **六段指纹全变、保留 0 段**，菜单四个名字全换，其中一组页面还从 4 掉到 3
    ——用户提到的那一页直接不存在了。

    根因是时序，不是提示词：

        while 主循环:
            execute_v5_capability(...)        ← 五系统模型在这里生成
            ...                                 此时 refine context 是**空的**
        循环结束
        _ensure_runtime_closure_evidence(...) ← 到这里才设 refine context

    也就是说，模型生成时**压根不知道自己在做精修**；等上下文设好，模型已经被
    从零重写并记成新版本了。之前两次修复（48ffe604 让 blocked 时也能设、
    0f5686e5 让精修提示词不自相矛盾）都作用在循环之后那一步，打偏了。

    ## 做法取自 Aider

    Aider 的 edit format（whole / diff / udiff）是**请求进来时就选定**、全程生效的，
    不是跑到一半才想起来。这里同理：精修是一种**模式**，在轮次入口判定一次，
    整轮带着走。设好之后 ``skip_planning_loop_for_refine`` 会跳过
    intent.parse / risk / handoff，直进收口——2026-08-18 篮球馆那场
    每轮 pick 两圈覆盖同一 art-0-*，就是判定设了、循环还在跑。

    ## 基线可以来自版本史，不只是闭环

    `extract_model_from_closure` 要求闭环六段齐全，缺一段返回 None。而用户来精修
    的场景恰恰常常是"上一轮没收好口"（真机那条会话闭环一直是 blocked）。所以闭环
    取不到时回落到 `modelVersions[-1]`——精修的基线是"上一版模型"，它不必须是一个
    完整闭环。

    取不到任何基线才返回 False（那是真的没东西可精修，照旧从零生成）。
    """
    instruction = (user_instruction or "").strip()
    if not instruction:
        return False
    goal_text = state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal or "")
    if instruction == (goal_text or "").strip():
        return False  # 指令与话题原文相同 = 重新推演，不是精修

    model = None
    closure = derive_publish_closure_response(state)
    if closure is not None:
        model = extract_model_from_closure(closure)
    if not isinstance(model, dict) or not model:
        versions = list(getattr(state, "modelVersions", None) or [])
        if versions and isinstance(versions[-1], dict):
            candidate = versions[-1].get("model")
            if isinstance(candidate, dict) and candidate:
                model = candidate
    if not isinstance(model, dict) or not model:
        return False

    from .v5_llm_generate import set_refine_context

    set_refine_context(
        refine_model_of(state, model), instruction, pages=refine_pages_of(state)
    )
    return True


def skip_planning_loop_for_refine(*, repair: bool = False) -> bool:
    """精修轮不跑 intent.parse / risk / handoff，直进收口。

    2026-08-18 篮球馆半场预约（sr-20260818033315）：每轮精修仍走规划循环，
    agentic pick 两圈覆盖同一 ``art-0-*`` → ``no_progress``，说明书改了、
    页没动。Aider 的 ``/code`` 是进门就定 edit，不先把仓库 re-plan 一遍
    （``enter_refine_mode`` 头注同一出处）。

    ``repair`` 仍走循环：覆盖门决定修什么，不给精修短路。
    首轮（指令==话题 / 无基线）``enter_refine_mode`` 为假，这里也是假。
    """
    if repair:
        return False
    from .v5_llm_generate import get_refine_context

    ctx = get_refine_context() or {}
    return bool(str(ctx.get("instruction") or "").strip())


def record_refine_skip_planning(
    state: "V5SessionState", user_instruction: str
) -> None:
    """台账留痕：这一轮选了收口、跳过了规划。删掉必让精修再黑成 pick 两圈。"""
    now = datetime.now(timezone.utc).isoformat()
    dl = getattr(state, "decisionLedger", []) or []
    dl.append(SchedulingDecision(
        id="dec-0-refine-skip-planning",
        turnId="loop-0",
        saw=["refine.mode", (user_instruction or "")[:80]],
        chose=["appbundle.runtimeClosure"],
        skipped=[
            {"capabilityId": "planning", "reason": "refine_skip_planning"},
            {"capabilityId": "intent.parse", "reason": "refine_skip_planning"},
            {"capabilityId": "risk.analyze", "reason": "refine_skip_planning"},
            {"capabilityId": "handoff.package", "reason": "refine_skip_planning"},
        ],
        rationale="精修模式：跳过规划循环，直进收口（Aider：进门就定 edit）",
        createdAt=now,
        source="local_heuristic",
    ))
    state.decisionLedger = dl
    append_reasoning_event(
        state,
        turnId="loop-0",
        capabilityRunId="refine-skip-planning",
        capabilityId="driver",
        kind="think",
        text="refine_skip_planning: 跳过规划循环，直进 appbundle.runtimeClosure",
        order=0,
    )


def record_model_version(state: "V5SessionState", publish_closure, instruction: str) -> None:
    """E29 版本快照：闭环携带完整模型且与上一版本不同 → 追加 modelVersions。"""
    model = extract_model_from_closure(publish_closure)
    if model is None:
        return
    record_model_snapshot(state, model, instruction)






_TRANSIENT_ERROR_MARKERS = (
    "timeout", "timed out", "connection", "connect", "reset", "unreachable",
    "dns", "proxy", "temporarily", "rate limit", "502", "503", "504",
    "网络", "超时",
)


def transient_blocked_signal(state: "V5SessionState") -> bool:
    """E26 自动补救判据：闭环 blocked 且失败样貌是「瞬时故障」（超时/连接类）
    才值得自动补救一次。检索成功但结果不相关不算——重试救不回来，
    交给用户点「补齐缺口」。看两处：本轮能力报错信息、闭环 blocker 的
    LLM 生成诊断（网关超时也会落在这里）。"""
    closure = getattr(state, "publishClosure", None)
    if closure is None:
        return False
    blocked = bool(closure.get("blocked")) if isinstance(closure, dict) else bool(getattr(closure, "blocked", False))
    if not blocked:
        return False

    def _is_transient(text: str) -> bool:
        low = (text or "").lower()
        return any(m in low for m in _TRANSIENT_ERROR_MARKERS)

    for r in (getattr(state, "capabilityRuns", []) or [])[-12:]:
        err = r.get("error") if isinstance(r, dict) else getattr(r, "error", None)
        if not err:
            continue
        msg = err.get("message") if isinstance(err, dict) else getattr(err, "message", "")
        if _is_transient(str(msg or "")):
            return True

    blockers = closure.get("blockers") if isinstance(closure, dict) else getattr(closure, "blockers", None)
    for b in blockers or []:
        code = str((b.get("code") if isinstance(b, dict) else getattr(b, "code", "")) or "")
        ref = str((b.get("ref") if isinstance(b, dict) else getattr(b, "ref", "")) or "")
        if code == "LLM_GENERATE_FAILED" and _is_transient(ref):
            return True
    return False


def _advance_turn_version(state: "V5SessionState") -> None:
    """一次 drive = 一个 turn：把 state.lastTurnId 步进一格。

    持久化守卫以 lastTurnId 为单调版本（同 turn 不可覆盖核心字段）。驱动器
    若不推进它，drive 开始时那笔"goal 还没写进"的快照就成了该版本的终点，
    之后所有含 goal/conversation/runtimePhase 的落盘全被静默拒绝——只剩
    append-only 的 artifacts 进盘，重启后会话"失忆"。实测踩过，勿删。

    ## 序号必须**不锚定行尾**地取（2026-08-10 修）

    原来是 `_re.search(r"(\d+)\s*$", raw)` —— 只认结尾的数字。而这条链路上
    真实流通的 lastTurnId 有好几种形状，其中两种**结尾不是数字**：

        turn-3                      ← 本函数产出，结尾是数字，能读
        turn-stream-3-drive-full    ← 流式驱动收尾时写的（本文件 1960 行）
        turn-4-drive-full           ← routes 的 _advance_drive_full_turn_id

    后两种匹配不上，`seq` 落到 1，于是 **每次 drive 开头都把版本重置成
    `turn-1`**。线上实测（sr-20260810012732）：一趟 drive 跑完 lastTurnId 是
    `turn-stream-3-drive-full`，下一趟开头又变回 `turn-1`。

    两个后果都不响：

      · **持久化守卫失效** —— 本函数存在的全部理由就是推进这个单调版本
        （见上文"实测踩过，勿删"）。它卡在 1，含 goal/conversation/runtimePhase
        的落盘就可能被同版本判定挡下，只剩 append-only 的 artifacts 进盘。
      · **模型复用的轮次作用域塌掉** —— `reusable_model_for_turn` 拿
        `modelVersions[-1].turnId == lastTurnId` 当键。两边都恒等于 `turn-1`
        之后，用户**下一条消息会拿到上一轮的旧模型**，正是那个函数文档里
        写明要防的事（"跨轮复用会让用户补充需求之后仍然拿到旧模型"）。

    routes 那边的两个读者（`_turn_seq_for_drive_full` / PUT 的 `_turn_seq`）
    用的都是**不锚定**的 `re.search(r"(\d+)")`，读 `turn-stream-3-drive-full`
    得 3。也就是说同一个字符串，两个读者理解不一致——统一到不锚定这一侧。

    取**最大**的那个数而不是第一个：形如 `turn-stream-3-drive-full` 只有一个
    数字，但万一将来出现多段编号，取最大才保证单调。
    """
    import re as _re

    raw = str(getattr(state, "lastTurnId", None) or "")
    nums = [int(n) for n in _re.findall(r"\d+", raw)]
    seq = (max(nums) + 1) if nums else 1
    state.lastTurnId = f"turn-{seq}"


def drive_full_v5_session(initial_state: V5SessionState, max_loops: int = 10, user_instruction: str = "") -> V5SessionState:
    """
    Full replacement for Node's driveReasoningSession.
    Uses orchestrate + execute in loop until converge or budget.
    PYTHON_AUTHORITY for full path: real user_instruction flows to orchestrate_plan / pick_next_capabilities,
    driving capability selection, artifact/commit (via execute), GCOV evaluation, and phase to awaiting/done.
    Stop conditions (locked for test): coverage passed, empty picks from pick_next_capabilities, max_loops, no_progress (2 consecutive loops without new artifact or resolved gap progress), or max_repeat_guard (per-cap repeat limit excluded remaining candidates).
    no_progress and max_repeat_guard also append auditable SchedulingDecision entries to decisionLedger (stop reason, loop, evidence).
    Classification: PYTHON_AUTHORITY (user instruction -> artifacts, GCOV, await/done).
    Note: pick_next_capabilities end fallbacks often add picks; use max_loops and coverage for reliable stop in tests.
    All evidence from stable RAG.
    Implements V5.2 phase transitions (idle/orchestrating/awaiting/failed/done) as PYTHON_AUTHORITY.
    """
    from . import enrich_timing as _enrich_timing
    from .v5_capability_executor import turn_instruction as _turn_instruction

    # 本轮用户说的话对整趟推演可见 —— 能力执行会把它和会话话题**并排**
    # 送进 prompt（compose_capability_topic，照 CrewAI / LangChain 的形状）。
    # 此前能力只看 state.goal，fork 出来的副本里那是源应用的旧话题，于是
    # 推演过程整篇答非所问。ExitStack 是为了在函数任何一条返回路径上都复位。
    from contextlib import ExitStack as _ExitStack

    _turn_ctx = _ExitStack()
    _turn_ctx.enter_context(_turn_instruction(user_instruction))
    from .cost_ledger import bind_cost_session

    _turn_ctx.enter_context(bind_cost_session(initial_state))
    _budget_token = _enrich_timing.begin_run_budget()
    state = initial_state
    _advance_turn_version(state)
    # 步骤记录跟版本史用同一个 turnId（drive 开头那格）。收尾改名
    # turn-N-drive-full 只服务持久化守卫；叙述对不上版本就会再铺一个空气泡。
    drive_turn_id = str(state.lastTurnId or "")
    events_cursor = len(getattr(state, "reasoningEvents", None) or [])
    drive_started = time.monotonic()
    # ★ 精修判定必须在主循环**之前**（见 enter_refine_mode 的文档）。
    #   放在这里，循环里的模型生成才带得上基线和"只改这一处"的约束。
    if enter_refine_mode(state, user_instruction):
        from .v5_llm_generate import set_refine_context as _clear_refine

        _turn_ctx.callback(lambda: _clear_refine(None))
    state.runtimePhase = "orchestrating"
    turn_base = f"full-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    append_replay_event(state, kind="decision", turnId=f"loop-0", decisionId=f"phase-orchestrating-full")
    append_reasoning_event(state, turnId=f"loop-0", capabilityRunId="phase-full-0", capabilityId="driver", kind="think", text="phase_changed: orchestrating (full drive)", order=0)
    # Immediate persist after phase start so polling GET sees orchestrating before first loop execs
    persist_state(state)
    loop = 0
    plan = type("P", (), {"selected": []})()  # safe default for phase decision on early error
    picks = []
    closure_attempted = False
    executed_loops = 0
    no_progress_streak = 0
    from .repeat_policy import max_repeat_per_cap

    MAX_REPEAT_PER_CAP = max_repeat_per_cap()  # 阈值与窗口见 services/repeat_policy.py
    try:
        prev_art_count = len(getattr(state, "artifacts", []) or [])
        # simple resolved count from coverageGaps (status resolved)
        def _count_resolved(st):
            gaps = getattr(st, "coverageGaps", []) or []
            return sum(1 for g in gaps if (g.get("status") if isinstance(g, dict) else getattr(g, "status", None)) == "resolved")
        prev_resolved = _count_resolved(state)
        while loop < max_loops:
            ui = user_instruction or ""
            if skip_planning_loop_for_refine(repair=False):
                record_refine_skip_planning(state, ui)
                persist_state(state)
                break
            if trusted_closure_decision(state, ui, repair=False) == "end":
                state = resolve_coverage_gaps_from_state(state)
                gate = evaluate_coverage_gate(state)
                if gate.get("passed") and isinstance(state.goal, dict):
                    state.goal["status"] = "clear"
                now = datetime.now(timezone.utc).isoformat()
                dl = getattr(state, "decisionLedger", []) or []
                dl.append(SchedulingDecision(
                    id=f"dec-{loop}-trusted-closure-end",
                    turnId=f"loop-{loop}",
                    saw=["appbundle.runtimeclosure"],
                    chose=[],
                    skipped=[{"capabilityId": "planning", "reason": "trusted_closure_reused"}],
                    rationale="trusted current-turn closure is terminal; deterministic coverage check only",
                    createdAt=now,
                    source="local_heuristic",
                ))
                state.decisionLedger = dl
                break
            plan = orchestrate_plan(state, f"loop-{loop}", ui)
            # PYTHON_AUTHORITY: use explicit pick_next_capabilities for V5.2 selection semantics + fallbacks
            # (pick is sole authority; empty means converge; no fallback to plan.selected)
            picks = pick_next_capabilities(state, ui)
            # E32 agentic pick（默认 on，SLIDERULE_AGENTIC_PICK=off 关）：
            # LLM 看全局提案替换非空规则选材——收敛权仍归规则（规则版为空
            # 照旧收敛，LLM 无权续命），词表封闭+重复护栏在提案侧验收，
            # 决策进台账（source="llm"）可审计可挑战。失败静默回落规则版。
            if picks:
                from .v5_agentic_pick import agentic_pick_next_capabilities
                _proposal = agentic_pick_next_capabilities(state, ui, loop_index=loop, max_loops=max_loops)
                if _proposal:
                    _now = datetime.now(timezone.utc).isoformat()
                    _dl = getattr(state, "decisionLedger", []) or []
                    _dl.append(SchedulingDecision(
                        id=f"dec-{loop}-agentic-pick",
                        turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in picks],
                        chose=[p["capabilityId"] for p in _proposal["picks"]],
                        skipped=[],
                        rationale=f"agentic pick: {_proposal['rationale']}",
                        createdAt=_now,
                        source="llm",
                    ))
                    state.decisionLedger = _dl
                    picks = _proposal["picks"]
                else:
                    # 回落规则版 = 本轮降级。记一条 Condition，闭环判定据此
                    # 拒发合格证——此前这里只在 stderr 打一行，闭环完全看不见。
                    from .run_degradation import (
                        IMPACT_REASONING,
                        REASON_AGENTIC_PICK_FALLBACK,
                        mark_degraded,
                    )
                    mark_degraded(
                        state,
                        reason=REASON_AGENTIC_PICK_FALLBACK,
                        message=f"第 {loop} 轮 LLM 选材未成，回落规则版选能力",
                        # 只决定「这轮挑哪几件活儿干」，挑出来的活儿照样认真执行，
                        # 做出来的东西不因此变差——显式写出来，不靠默认值猜
                        impact=IMPACT_REASONING,
                    )
            picks = ensure_closure_pick_by_deadline(
                state,
                picks,
                loop_index=loop,
                repair=False,
                closure_attempted=closure_attempted,
            )
            state = reconcile_coverage(state)
            selected = picks
            closure_attempted = closure_attempted or _contains_closure_pick(selected)

            # max_repeat_guard: filter candidates by run count; stop if had picks but all filtered
            if picks:
                filtered = [p for p in picks if _repeat_allows(state, p)]
                if len(picks) > 0 and len(filtered) == 0:
                    # auditable ledger entry for max_repeat_guard
                    now = datetime.now(timezone.utc).isoformat()
                    dec = SchedulingDecision(
                        id=f"dec-{loop}-max_repeat_guard",
                        turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in picks],
                        chose=[],
                        skipped=[{"capabilityId": p["capabilityId"], "reason": "max_repeat_guard"} for p in picks],
                        rationale=f"max_repeat_guard triggered at loop {loop} (counts >= {MAX_REPEAT_PER_CAP})",
                        createdAt=now,
                        source="local_heuristic",
                    )
                    dl = getattr(state, "decisionLedger", []) or []
                    dl.append(dec)
                    state.decisionLedger = dl
                    state.awaitReason = "max_repeat_guard"
                    state.awaitDetail = f"max_repeat_guard: all remaining candidates excluded after {MAX_REPEAT_PER_CAP} repeats"
                    break
                selected = filtered if filtered else picks

            if not selected:
                # no_progress via consecutive no-pick (empty after rules) without progress
                no_progress_streak += 1
                if no_progress_streak >= 2:
                    now = datetime.now(timezone.utc).isoformat()
                    dec = SchedulingDecision(
                        id=f"dec-{loop}-no_progress",
                        turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in (picks or [])],
                        chose=[],
                        skipped=[],
                        rationale=f"no_progress: {no_progress_streak} consecutive loops with no state progress (empty pick)",
                        createdAt=now,
                        source="local_heuristic",
                    )
                    dl = getattr(state, "decisionLedger", []) or []
                    dl.append(dec)
                    state.decisionLedger = dl
                    state.awaitReason = "no_progress"
                    state.awaitDetail = f"no_progress after {no_progress_streak} loops (empty picks, no art/gap advance)"
                    break
                picks = selected  # for final reason
                break  # converged per pick semantics (empty after all rules)
            # execute selected
            import time as _time
            # SLIDERULE_PARALLEL_CAPS (default ON): overlap the independent per-cap
            # provider calls; commits stay sequential in selection order. Explicit
            # false (or a single-cap batch) takes the serial reference path below.
            to_run = _apply_pending_run_skips(state, selected, loop)
            if _parallel_caps_enabled() and len(to_run) > 1:
                _run_selected_batch_parallel(state, to_run, loop)
                serial_selected = []
            else:
                serial_selected = to_run
            for sel in serial_selected:
                cap = sel["capabilityId"]
                role = sel.get("roleId", "agent")
                turn_id = f"loop-{loop}"
                t0 = _time.time()
                run_id = f"run-{loop}-{cap}"
                # Emit start + replay for visibility (phase/cap events in state for browser)
                append_reasoning_event(
                    state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_start",
                    text=f"capability_started: {cap}", roleId=role, order=1
                )
                append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=cap, capabilityRunId=run_id)
                # Immediate persist before execute: cap_start visible to session GET pollers during long capability exec (review finding 2)
                persist_state(state)
                try:
                    # Execute via full migrated executor - always real（LLM 通道配置时轮内能力走真 LLM）
                    result = _execute_round_capability(cap, state, role, turn_id)
                    result_data = _result_to_dict(result)
                    # Use Python-owned commitArtifact (artifact+run+gate+dependencyGraph updates)
                    art_id = f"art-{loop}-{cap}"
                    produced = ProducedBy(capabilityRunId=run_id, capabilityId=cap, roleId=role)
                    kind = "evidence" if "evidence" in cap or cap in ["mcp.call", "skill.invoke"] else ("report" if "report" in cap else "risk")
                    commit_artifact(
                        state,
                        id=art_id,
                        kind=kind,
                        content=result_data.get("content", ""),
                        summary=result_data.get("summary", ""),
                        title=result_data.get("title"),
                        provenance=result_data.get("provenance", "python-rag"),
                        producedBy=produced,
                        inputArtifactIds=[],
                        turnId=turn_id,
                        sources=result_data.get("sources", []),
                    )
                    # best-effort timing attach on success run (last appended)
                    dur = int((_time.time() - t0) * 1000)
                    if getattr(state, "capabilityRuns", None):
                        last = state.capabilityRuns[-1]
                        if hasattr(last, "result"):
                            last.result = result_data
                        elif isinstance(last, dict):
                            last["result"] = result_data
                        if hasattr(last, "timing"):
                            last.timing = {"durationMs": dur}
                    # Emit complete
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_complete",
                        text=f"capability_completed: {cap}", roleId=role, order=2
                    )
                    cap_status = "ok"
                except Exception as cap_exc:
                    # Record capability error without whole drive fail or state corruption
                    cap_status = "error"
                    dur = int((_time.time() - t0) * 1000)
                    err = {"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": cap}
                    # import here to keep top minimal; use the record from session (PYTHON slice)
                    from .engine_scheduling import record_capability_run_error
                    record_capability_run_error(
                        state,
                        capabilityId=cap,
                        turnId=turn_id,
                        error=err,
                        roleId=role,
                        timing={"durationMs": dur},
                    )
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_complete",
                        text=f"capability_completed: {cap} (error)", roleId=role, order=2
                    )
                    state.awaitDetail = (getattr(state, "awaitDetail", None) or "") + f"; degraded cap {cap}"
                    # continue to next cap or stop decision; error run is auditable record
                # ⚠ 写失败不许接着跑下一个——假装存了 = 崩溃后重烧已完成的 LLM。
                persist_pending_capability(state, cap, loop, selected, cap_status, run_id)
            executed_loops += 1
            # 同步驱动同款写回——理由见流式驱动那处的长注释。
            # 两条路径都得改：这个 bug 在提示词层，跟走哪条驱动无关。
            if any(_is_closure_cap(p.get("capabilityId", "")) for p in selected):
                _round_closure = derive_publish_closure_response(state)
                if _round_closure is not None:
                    state.publishClosure = _round_closure
                    record_model_version(state, _round_closure, user_instruction)
                    persist_state(state)
            # update progress for no_progress detection
            now_art = len(getattr(state, "artifacts", []) or [])
            now_res = _count_resolved(state)
            if now_art > prev_art_count or now_res > prev_resolved:
                no_progress_streak = 0
            else:
                no_progress_streak += 1
            prev_art_count = now_art
            prev_resolved = now_res
            if no_progress_streak >= 2:
                now = datetime.now(timezone.utc).isoformat()
                dec = SchedulingDecision(
                    id=f"dec-{loop}-no_progress",
                    turnId=f"loop-{loop}",
                    saw=[p["capabilityId"] for p in (picks or [])],
                    chose=[p["capabilityId"] for p in selected],
                    skipped=[],
                    rationale=f"no_progress: {no_progress_streak} consecutive loops with no new artifact or resolved gap progress",
                    createdAt=now,
                    source="local_heuristic",
                )
                dl = getattr(state, "decisionLedger", []) or []
                dl.append(dec)
                state.decisionLedger = dl
                state.awaitReason = "no_progress"
                state.awaitDetail = f"no_progress streak {no_progress_streak} (no art/gap advance)"
                break
            # Check GCOV (resolve first: committed trusted caps close their gaps)
            state = resolve_coverage_gaps_from_state(state)
            gate = evaluate_coverage_gate(state)
            if gate.get("passed"):
                state.goal["status"] = "clear"
                # 交付意图：门通过但交付清单未出全时继续循环（单轮限选 5 个能力，
                # picker 会跳过已提交项），让一轮"打包交付"产出全部交付物。
                if _has_pending_delivery_picks(state, user_instruction):
                    loop += 1
                    persist_state(state)
                    continue
                break
            loop += 1
            persist_state(state)
        state = _ensure_runtime_closure_evidence(
            state, user_instruction, loop, False, closure_attempted
        )
        # Final phase: done if clear/coverage, else awaiting (converged or budget)
        state = resolve_coverage_gaps_from_state(state)
        gate = evaluate_coverage_gate(state)
        final_closure = derive_publish_closure_response(state)
        final_phase, final_reason = terminal_phase_decision(state, gate, final_closure)
        if final_phase == "done":
            if gate.get("passed") and isinstance(state.goal, dict):
                state.goal["status"] = "clear"  # 最终门通过时 phase/status 保持一致
            state.runtimePhase = "done"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end", capabilityId="driver", kind="think", text="phase_changed: done", order=10)
            persist_state(state)
        else:
            state.runtimePhase = "awaiting"
            if getattr(state, "awaitReason", None) in ("no_progress", "max_repeat_guard"):
                pass  # already set with ledger
            elif loop >= max_loops:
                state.awaitReason = "max_loops"
            elif not picks:
                state.awaitReason = "convergence"
            elif final_reason in ("closure_blocked", "closure_missing"):
                state.awaitReason = final_reason
            else:
                state.awaitReason = "coverage"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end", capabilityId="driver", kind="think", text=f"phase_changed: awaiting ({state.awaitReason or 'coverage'})", order=10)
            persist_state(state)
    except Exception as exc:
        state.runtimePhase = "failed"
        state.awaitReason = "ready"
        state.awaitDetail = f"drive error: {str(exc)[:120]}"
        append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end", capabilityId="driver", kind="think", text=f"phase_changed: failed", order=10)
        persist_state(state)
    # 驱动器自己写步骤。只靠客户端 PUT 的话，旁路 drive / 刷新水合都是 0 步
    # （2026-08-18 社区工具屋 sr-20260818172818：四轮画了页，turnNarrations=[]）。
    # 闭环派生失败不许拖垮主链路——步骤是展示投影，fail-open。
    try:
        if not getattr(state, "publishClosure", None):
            state.publishClosure = derive_publish_closure_response(state)
    except Exception:
        pass
    from .turn_narration import stamp_drive_narration

    stamp_drive_narration(
        state,
        turn_id=drive_turn_id,
        user=user_instruction,
        events_cursor=events_cursor,
        started_monotonic=drive_started,
    )
    persist_state(state)
    _enrich_timing.reset_run_budget(_budget_token)
    _turn_ctx.close()
    return state


# ---------------------------------------------------------------------------
# Skill-ID mapping  (capability_id → one of the 6 front-end skill keys)
# ---------------------------------------------------------------------------

_CAP_SKILL_MAP: Dict[str, str] = {
    "data.model": "dataModel", "entity.model": "dataModel", "schema.design": "dataModel",
    "workflow.design": "workflow", "process.map": "workflow", "flow.chart": "workflow", "workflow.analyze": "workflow",
    "rbac.design": "rbac", "role.design": "rbac", "permission.model": "rbac", "access.control": "rbac",
    "page.design": "page", "ux.preview": "page", "ui.wireframe": "page", "page.layout": "page",
    "aigc.design": "aigc", "prompt.design": "aigc", "ai.feature": "aigc", "outcome.visualize": "aigc",
    "appbundle.runtimeClosure": "appBundle", "publish.bundle": "appBundle", "app.bundle": "appBundle",
}

_CAP_PREFIX_SKILL: list = [
    ("data.", "dataModel"), ("entity.", "dataModel"), ("schema.", "dataModel"),
    ("workflow.", "workflow"), ("process.", "workflow"), ("flow.", "workflow"),
    ("rbac.", "rbac"), ("role.", "rbac"), ("permission.", "rbac"),
    ("page.", "page"), ("ux.", "page"), ("ui.", "page"),
    ("aigc.", "aigc"), ("prompt.", "aigc"),
    ("appbundle.", "appBundle"), ("publish.", "appBundle"), ("bundle.", "appBundle"),
]


def _cap_to_skill_id(cap: str) -> str:
    """Map a capability_id to one of the 6 skill keys. Defaults to 'appBundle'."""
    direct = _CAP_SKILL_MAP.get(cap)
    if direct:
        return direct
    cap_lower = cap.lower()
    for prefix, skill in _CAP_PREFIX_SKILL:
        if cap_lower.startswith(prefix):
            return skill
    return "appBundle"


# 闭环之后按什么顺序点亮各系统（跨技能依赖序：datamodel 是 SSOT 根，
# appbundle 是装配根），与闭环边同向，UI 才能按因果顺序亮。
#
# ⚠ 2026-08-30：原来是写死的六个字面量，而 `turn_narration.py:89` 还有**第二份
#   同名常量**——两份手抄，改一份不改另一份不会报错，只会让左栏和 SSE 的点亮
#   顺序悄悄错开（第四条）。现在两份都从产品原型账本派生。
_SKILL_EMIT_ORDER = _required_evidence()

# publishClosure.perSkillEvidence uses lowercase keys; the frontend SkillId type
# uses camelCase. Map so skill_start/skill_result carry the frontend-facing id.
_CLOSURE_KEY_TO_SKILL_ID = {
    "datamodel": "dataModel",
    "rbac": "rbac",
    "workflow": "workflow",
    "page": "page",
    "aigc": "aigc",
    "appbundle": "appBundle",
}


# ---------------------------------------------------------------------------
# SSE streaming driver
# ---------------------------------------------------------------------------

#: 体验层阶段 → 给人看的说法 + 实测耗时区间（2026-08-04 真机）。
#:
#: 带上"大概多久"是这条改动的重点，不是装饰：生参照图那一步在物理上没法流式
#: （图片一次性返回），屏幕上唯一能给的就是"在做什么 + 正常要多久"。有了这个
#: 区间，用户能自己判断"还在正常范围"还是"真卡了"；只给一个转圈图标的话，
#: 等 30 秒和等 3 分钟看起来一模一样。
#:
#: 区间取自实测：monitor.sheet 104.9s / monitor.palette 19.1s /
#: monitor.design 59.5s（同一轮，社区消防巡检）。写成范围而不是точ值——
#: 不同题目的内容量差得多，给个准数反而会让"稍微超一点"看着像出事。
#:
#: 只列**用户该看见的**三段。block.refimage / freeform.total 这些是内部子步骤，
#: 报出来只会把一条清晰的进度线拆成一堆看不懂的碎片。
#: model.generate 是 2026-08-05 补的，补的是**这条线上最长的一个洞**：
#: 真机一轮里 234.6s → 445.6s 之间 211 秒没有任何事件，正好夹在"选中收口"
#: 和"生成首页参照图"中间。上面三段之所以先被埋，是因为它们在最末尾、最显眼；
#: 而这一段比它们任何一段都长，只是没人想到去量它。
#: 区间按**实测分布**重新校准（2026-08-05）。原来的数是从"某一轮"抄的单次值，
#: 攒够样本之后看，偏窄得多：
#:
#:     monitor.sheet   n=20  42 / 78 / 84 / 105 / 266 秒   (min/p25/中位/p75/max)
#:     monitor.design  n=27  30 / 54 / 75 /  98 / 277 秒
#:
#: 同一轮里同一个页面 design 跑出过 93 秒和 276 秒两个数。区间写窄了，等到
#: 第 200 秒时用户看到的是"早就超了"——而这条提示存在的全部意义就是让人
#: 分得清"正常"和"卡了"。写窄的提示比不写更糟：它把正常说成异常。
#: 所以取 p25~p75 当"通常"，另说一句上限，别让长尾看着像故障。
#: ⚠ 2026-08-30：曾是写死的 9 条（人话 + 耗时），与
#: `turn_narration._SPEC_FIRST_LABELS` 逐字重复。现在同源于阶段账本。
#: 形状保持 Dict[str, tuple]——老调用方是 `label, eta = TABLE[name]`，
#: 换成 dict 会静默解包出两个 key 名而不是报错。
#:
#: ⚠ 耗时区间是**实测标定**（08-14 端到端那趟），`bind` 原写「3~4 分钟」
#: 实测 9.2 分钟。改数字要连实测一起重跑（第六条）。区间在账本里。
_ENRICH_STAGE_LABELS: Dict[str, tuple] = _stage_labels_with_eta()


def _enrich_stage_event(phase: str, name: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """体验层阶段 → SSE 事件；名单外的阶段返回 None（不报内部子步骤）。

    复用 reasoning_step / reasoning_step_result 这对既有事件，而不是新造一种
    类型：前端已经会把它们渲染成"一条正在进行的步骤"，新类型意味着前端也要跟着
    改，而这次要解决的问题（黑屏）在后端补齐就够了。
    """
    entry = _ENRICH_STAGE_LABELS.get(name)
    if entry is None:
        return None
    label, hint = entry
    # ⚠ 2026-08-30：补上 group / order / of，前端就不再需要自己的步骤表。
    #   `sequence` 传本轮真实要跑的阶段——账本里含两个精修专用步，
    #   拿账本绝对位置当序号对哪一轮都不准（实测出过 order=8 of=7）。
    _desc = _stage_describe(name, sequence=fields.get("sequence"))
    common = {
        "stageGroup": _desc.get("group"),
        "stageOrder": _desc.get("order"),
        "stageOf": _desc.get("of"),
        "pageId": fields.get("page"),
        "device": fields.get("device"),
        "current": fields.get("current"),
        "total": fields.get("total"),
        "elapsedMs": 0 if phase == "start" else fields.get("ms", 0),
    }
    if phase == "start":
        return {
            "type": "reasoning_step",
            "label": label,
            "hint": hint,
            "stage": name,
            **common,
        }
    return {
        "type": "reasoning_step_result",
        "label": label,
        "stage": name,
        "ms": fields.get("ms"),
        **common,
        "skippedReason": fields.get("skippedReason"),
        # got=0 是"这一步跳过了/没产出"（比如没配生图 key），不是失败——
        # ok 才是失败标志。两者混同的话，未配置生图的环境会满屏红叉。
        "error": not fields.get("ok", True),
    }


def _progress_heartbeat_event(active: Dict[str, Any], *, elapsed_ms: int) -> Dict[str, Any]:
    return {
        "type": "progress_heartbeat",
        "stage": active.get("stage"),
        "label": active.get("label"),
        "pageId": active.get("pageId"),
        "device": active.get("device"),
        "current": active.get("current"),
        "total": active.get("total"),
        "elapsedMs": elapsed_ms,
    }


def _truthy_scope_flag(value: Any) -> bool:
    if value is True:
        return True
    if isinstance(value, str):
        return value.strip().lower() in _env_flags.ON
    return False


def _scope_opted_in(state: "V5SessionState", *keys: str) -> bool:
    """范围卡勾了取证 / 可行性报告才把散文能力加回短清单。

    最后一张 scope_card 说了算。goal 只在还没有范围卡时回落（测试直
    接 seed、或 copy 写进 persist-as-authority 之后卡被清掉的情况）。
    ⚠ 2026-08-27 评审：第一版把 scope_confirmed 当旗标行并 break——
    确认行不带勾选，transcript 回落全死，goal 残留 True 还能压过
    新卡缺字段。缺字段 = 没勾 = 跳过。
    """
    for row in reversed(list(getattr(state, "controlTranscript", None) or [])):
        if not isinstance(row, dict) or row.get("kind") != "scope_card":
            continue
        return any(_truthy_scope_flag(row.get(key)) for key in keys)
    goal = getattr(state, "goal", None) or {}
    if isinstance(goal, dict):
        for key in keys:
            if _truthy_scope_flag(goal.get(key)):
                return True
    return False


def _app_profile_short_picks(state: "V5SessionState") -> list:
    """产品 rehearse 短清单：可选取证 → spec-first 收口。

    ⚠ 2026-08-27 M18：工厂点火前不再跑 critique/risk/report 散文。
    只改规则 pick 不改 agentic pick = 一半不生效；短清单在生成器循环里
    替换那两处调用点，不改 pick_next_capabilities 词表。
    """
    picks: list = []
    if _scope_opted_in(state, "wantEvidence", "includeEvidence"):
        picks.append({"capabilityId": "evidence.search", "roleId": "接地"})
    if _scope_opted_in(state, "wantFeasibilityReport", "includeFeasibilityReport"):
        picks.extend(
            [
                {"capabilityId": "risk.analyze", "roleId": "安全"},
                {"capabilityId": "critique.generate", "roleId": "挑刺"},
                {"capabilityId": "report.write", "roleId": "综合"},
            ]
        )
    picks.append({"capabilityId": "appbundle.runtimeClosure", "roleId": "综合"})
    return picks


async def drive_full_v5_session_stream(
    initial_state: "V5SessionState",
    max_loops: int = 10,
    user_instruction: str = "",
    repair: bool = False,
    profile: Literal["full", "app"] = "full",
) -> AsyncGenerator[Dict[str, Any], None]:
    """Async generator mirroring drive_full_v5_session but yielding SSE dicts.

    Event shapes:
        {"type": "phase_change",  "phase": str}
        {"type": "skill_start",   "skill": str, "label": str}
        {"type": "skill_result",  "skill": str, "label": str, "error": bool,
                                  "modelSection": dict|None, "mermaid": str|None}
        {"type": "publish_closure", "data": dict}
        {"type": "complete",      "state": dict}

    E26 repair=True（缺口修复轮）：选材换成 pick_repair_capabilities——只重跑
    覆盖门标红的能力（开放缺口/合约缺失/接地不足），已 PASS 的产物与五系统
    模型原样复用（闭环重建本就先匹配既有产物，非 blocked 闭环直接返回）。
    agentic pick 不参与（修什么以门说了算），轮数收紧到 2。

    profile 由信封 helper 透传（rehearse 传 "app"）。禁止把 factoryProfile
    做成 HTTP 旗标。profile=="app" 时跳过 orchestrate_plan + 规则 pick +
    agentic pick，改走短清单；repair 仍走 pick_repair_capabilities。
    """
    import asyncio
    import queue as _queue
    import contextlib as _contextlib
    import time as _time

    from sliderule_llm import capabilities as _caps

    from . import enrich_timing as _enrich_timing
    from . import v5_llm_generate as _gen

    # 本轮装上去的所有 sink 都进这个栈：**装的那一行自带卸的动作**，栈在
    # finally 里一次性关掉，顺序自动倒着来。
    #
    # 抄的标准答案：grok-build `xai-grok-pager/src/memory_trace.rs::SinkGuard`
    #     /// Returns a guard restoring the previous sink on drop.
    # 口径与两条要害见 sliderule_llm/scoped.py 头注。
    #
    # ⚠ 上一版是「第 1972 行装、第 2610 行卸」，中间隔着六百行和整轮推演。
    #   功能上 finally 兜住了，但谁加第六根 sink 都得记得跑到六百行外补一行，
    #   忘了不报错、只是那根 sink 漏着不卸。现在忘不掉：enter_context 那一下
    #   就把卸的动作交给栈了。
    _sinks = _contextlib.ExitStack()

    # 全程共享的带标签 LLM 增量队列（label, chunk）：轮内能力（risk.analyze /
    # counter.argue / report.write…）与五系统起草的实时输出都汇到这里，由各
    # 执行点旁边的排水循环冲成 SSE llm_delta 事件。
    #
    # ⚠ 这里原来写着「sink 是模块级单例……并发多会话时增量会交织（本地单人
    #   dev 可接受）」——**那句话早就过期了**。2026-08-06 这几个 sink 全部从
    #   模块级全局改成了请求域 ContextVar，起因正是真机实测「用户 A 生成的
    #   内容实时出现在用户 B 的页面上」（见 sliderule_llm/capabilities.py 头
    #   注）。注释没跟着改，读的人会以为并发串台仍然是已知可接受的现状。
    _delta_q: "_queue.Queue[tuple[str, str]]" = _queue.Queue()
    _sinks.enter_context(
        _caps.capability_delta_sink_scope(
            lambda cap_id, chunk: _delta_q.put((cap_id, chunk))
        )
    )
    _sinks.enter_context(
        _gen.generate_delta_sink_scope(
            lambda chunk: _delta_q.put(("five-system-model", chunk))
        )
    )

    # 体验层（ENRICH）阶段事件（2026-08-04）。
    #
    # 真机量到这三段在 SSE 上是一个 **165.8 秒的洞**——比选材那六段加起来还长，
    # 而且落在最难受的位置：用户已经等了七八分钟、眼看要出结果，突然黑三分钟。
    # 后端本来就有 enrich-timing 埋点，数是现成的，只是从来没往前端送。
    #
    # ⚠ 其中生参照图那 ~105 秒**在物理上没法流式**——图片没有"逐字"这回事，
    # 它是画完一次性返回。这类操作能做的只有报告"在做什么 + 大概多久"：
    # 用户能判断"这是正常的"还是"卡了"，比一个转圈图标强得多。
    _stage_q: "_queue.Queue[tuple[str, str, dict]]" = _queue.Queue()
    _sinks.enter_context(
        _enrich_timing.stage_sink_scope(
            lambda phase, name, fields: _stage_q.put((phase, name, dict(fields)))
        )
    )

    # spec-first 第 3 步的页面（2026-08-14）。
    #
    # 新链路产出的是**一整份能直接打开的 HTML**，而第 3 步在整轮的第二分钟就
    # 有第一页。此前它一直攒到最后才随模型一起交——右侧那四五分钟纯转圈，
    # 而东西其实早就在内存里了。
    #
    # ⚠ 只在开关开着时才会有事件（sink 装着但没人叫它）。装 sink 这件事本身
    #   不判断开关：判断开关的地方只该有一处，多一处就多一次漂移的机会。
    # 第 5 位 bound 默认 False：第 3 步素颜页不带它，3.5/6.5 的重发才带
    # （见 spec_first_pipeline._reemit_pages）。默认值兜住老调用方。
    # 第 6 位 device（2026-08-14 竖屏加）：管道在开头认一次设备并注进每次
    # sink 调用（spec_first_pipeline._with_device），前端拿它选画布视口。
    _page_q: "_queue.Queue[tuple[str, str, int, int, bool, str]]" = _queue.Queue()
    _spec_first_scope = None
    try:
        from .spec_first_pipeline import page_sink_scope as _spec_first_scope
    except Exception:  # noqa: BLE001 — 新模块缺失不该打死整条流
        pass
    if _spec_first_scope is not None:
        _sinks.enter_context(
            _spec_first_scope(
                lambda pid, html, done, total, bound=False, device="desktop": _page_q.put(
                    (pid, html, done, total, bool(bound), str(device))
                )
            )
        )
    # 伴随式澄清（2026-08-27）：spec-first 第 2 步替用户定下的事。
    #
    # 跟上面那条页面流同一个模子、同一个泵、同一处装卸——理由也一样：
    # 它们发生在同一段时间里，分开泵只会让"第 2 步在报进度"和"第 2 步说
    # 它把登录定成了手机号"在前端的先后不可预期。
    #
    # ⚠ 这是**增强**（本仓第七条）：模块缺失、sink 没装、里头炸了，都不许
    #   拖垮一条已经跑了两分钟的推演。所以 import 和 emit 两侧都吞异常。
    _assumption_q: "_queue.Queue[list]" = _queue.Queue()
    _spec_assumption_scope = None
    try:
        from .spec_first_pipeline import assumption_sink_scope as _spec_assumption_scope
    except Exception:  # noqa: BLE001 — 新模块缺失不该打死整条流
        pass
    if _spec_assumption_scope is not None:
        _sinks.enter_context(
            _spec_assumption_scope(lambda rows: _assumption_q.put(list(rows or [])))
        )
    _budget_token = _enrich_timing.begin_run_budget()
    # 与同步入口同一件事：让能力执行看得见本轮用户说了什么。
    # 流式是主路径（前端走 SSE），两条都要接，否则只有回退路径改好了——
    # 这个坑刚在身份透传上踩过一次。
    from .v5_capability_executor import turn_instruction as _turn_instruction

    _turn_token = _turn_instruction(user_instruction)
    _turn_token.__enter__()
    from .cost_ledger import bind_cost_session

    _cost_cm = bind_cost_session(initial_state)
    _cost_cm.__enter__()

    async def _pump_llm_deltas(task: "asyncio.Task"):
        """任务运行期间持续排水：把队列里的（标签, 增量）按相邻同标签聚合成
        llm_delta 事件（150ms 批量，防逐 token 事件风暴）。先记完成标志再排水，
        保证任务结束瞬间到达的尾部增量也被冲出，不会滞留队列。"""
        active_stage: Optional[Dict[str, Any]] = None
        active_started = 0.0
        last_heartbeat = 0.0
        heartbeat_seconds = 15.0
        while True:
            finished = task.done()
            batches: List[tuple] = []
            try:
                while True:
                    label, chunk = _delta_q.get_nowait()
                    if batches and batches[-1][0] == label:
                        batches[-1][1].append(chunk)
                    else:
                        batches.append((label, [chunk]))
            except _queue.Empty:
                pass
            for label, chunks in batches:
                # ⚠ 2026-08-30：`label` 一直是**机器 id**（specfirst.design 之类），
                # 人话在前端 `useSlideRuleSession.SPEC_FIRST_LLM_LABELS` 里手抄
                # 一份。那张表自己的注释写着病灶：「同一份词汇的两半，隔着一条
                # SSE，谁也编译不到谁；漏一个的后果不是报错，是左栏冒出
                # 'LLM 正在执行 specfirst.design'」——2026-08-19 安康随访通就这么漏的。
                # 现在事件自带人话（抄 grok 的 typed session events），前端那张表可以删。
                # `label` 保持原样不动：既有判据与埋点按它认阶段。
                _d = _stage_describe(label)
                yield {
                    "type": "llm_delta",
                    "text": "".join(chunks),
                    "label": label,
                    **({"stageLabel": _d["label"], "stageGroup": _d["group"]} if _d else {}),
                }
            # 体验层阶段事件跟增量走同一个排水循环：它们发生在同一段时间里，
            # 分开两个泵只会让顺序不可预期。
            try:
                while True:
                    phase, name, fields = _stage_q.get_nowait()
                    ev = _enrich_stage_event(phase, name, fields)
                    if ev is not None:
                        now = _time.perf_counter()
                        if phase == "start":
                            active_stage = ev
                            active_started = now
                            last_heartbeat = now
                        yield ev
                        if phase == "end" and active_stage is not None:
                            active_stage = None
            except _queue.Empty:
                pass
            # spec-first 的页面跟上面两条走同一个泵，理由同上：它们发生在
            # 同一段时间里，分开泵只会让"第 3 步在报进度"和"第 3 步交出了
            # 第二页"在前端的先后不可预期。
            try:
                while True:
                    _pid, _html, _done, _total, _bound, _device = _page_q.get_nowait()
                    yield {
                        "type": "spec_page",
                        "pageId": _pid,
                        "html": _html,
                        "current": _done,
                        "total": _total,
                        # 同一页会到达多次：第 3 步素颜页（bound=False）→
                        # 3.5 外壳统一后重发（仍 False，菜单已按 spec 锚定）→
                        # 6.5 打完 data-* 孔重发（True）。前端按 pageId 覆盖。
                        "bound": _bound,
                        # desktop 横屏 / phone 竖屏——前端选画布视口用
                        "device": _device,
                    }
            except _queue.Empty:
                pass
            # 伴随式澄清：第 2 步替用户定下的事，跟上面三条走同一个泵。
            try:
                while True:
                    _rows = _assumption_q.get_nowait()
                    if _rows:
                        yield {"type": "spec_assumption", "items": _rows}
            except _queue.Empty:
                pass
            now = _time.perf_counter()
            if (
                active_stage is not None
                and now - last_heartbeat >= heartbeat_seconds
            ):
                yield _progress_heartbeat_event(
                    active_stage,
                    elapsed_ms=int((now - active_started) * 1000),
                )
                last_heartbeat = now
            if finished:
                break
            await asyncio.sleep(0.15)

    state = initial_state
    if repair:
        max_loops = min(max_loops, 2)
    _advance_turn_version(state)
    drive_turn_id = str(state.lastTurnId or "")
    events_cursor = len(getattr(state, "reasoningEvents", None) or [])
    drive_started = _time.monotonic()
    state.runtimePhase = "orchestrating"
    append_replay_event(state, kind="decision", turnId="loop-0", decisionId="phase-orchestrating-full")
    append_reasoning_event(
        state, turnId="loop-0", capabilityRunId="phase-full-0",
        capabilityId="driver", kind="think",
        text=f"phase_changed: orchestrating ({'repair drive' if repair else 'full drive'})", order=0,
    )
    await asyncio.to_thread(persist_state, state)
    yield {"type": "phase_change", "phase": "orchestrating", "repair": repair}

    loop = 0
    picks: list = []
    closure_attempted = False
    no_progress_streak = 0
    from .repeat_policy import max_repeat_per_cap

    MAX_REPEAT_PER_CAP = max_repeat_per_cap()  # 阈值与窗口见 services/repeat_policy.py

    # ★ 流式是主路径（前端走 SSE），同步那条改了这条也必须改——否则只有回退
    #   路径修好了。清理由末尾已有的 set_refine_context(None) 负责。
    enter_refine_mode(state, user_instruction)

    try:
        prev_art_count = len(getattr(state, "artifacts", []) or [])

        def _count_resolved(st: "V5SessionState") -> int:
            gaps = getattr(st, "coverageGaps", []) or []
            return sum(
                1 for g in gaps
                if (g.get("status") if isinstance(g, dict) else getattr(g, "status", None)) == "resolved"
            )

        prev_resolved = _count_resolved(state)
        # 整轮共用一个恢复账本：「只自动一次」是按**这一轮**算的，每次进
        # 循环新建一个等于每轮都能再自动一次，那条上限就形同虚设。
        try:
            from .run_pause import RecoveryLedger as _RL

            _pause_ledger = _RL()
        except Exception:  # noqa: BLE001
            _pause_ledger = None

        while loop < max_loops:
            # ── 安全点：用户按过「先别往下跑」就停在这儿等（2026-08-28）──
            #
            # ⚠ 只装在**流式**这一条循环上（同步那条在 1386 行）。流式是前端
            #   主路径，两条都改才叫改完；这次只接流式，同步那条保持原样——
            #   它是脚本/测试入口，没有前端按暂停这回事。
            #
            # 位置照 run_cancel 同一条纪律：步与步之间、最贵的活开始之前。
            # 这一层的意义是"别再开始下一件大活儿"，不是把当前这件切碎。
            #
            # ⚠ 正常路径零成本：没人按暂停时 pause_here 一次字典读取就返回。
            # ⚠ 三种结局都往下跑，**没有一种把这一轮判死**：
            #     人答了    → 接着跑
            #     超时/跳过  → 按模型自己定的做（spec-assumptions 认定的合法结局）
            #     没人在场   → 同上，只是如实报 no_operator 而不是"用户跳过"
            #   会抛的只有取消，那时取消赢（RunCancelled 一路上抛）。
            # ⚠ take_hold + wait 分两步，不用 pause_here 那个合体版：
            #   前端要在**开始等之前**就知道"停住了"才能把卡片变成拦路形态，
            #   而合体版把取闸和等待包在一起，中间没有 yield 的缝。
            _pause_res = None
            try:
                from .run_pause import finish_hold, recover_from, take_hold

                _pause_gate = take_hold()
            except Exception as _pause_exc:  # noqa: BLE001
                # 暂停是增强（第七条）：它自己炸了不许拖垮跑了两分钟的推演
                print(
                    f"[v5_full_driver] ⚠ 暂停闸异常，按不暂停继续："
                    f"{str(_pause_exc)[:160]}"
                )
                _pause_gate = None
            if _pause_gate is not None:
                yield {"type": "run_pause_started", "where": f"loop-{loop}"}
                try:
                    _pause_res = await _pause_gate.wait(f"loop-{loop}")
                finally:
                    # 等完就把"正在等"清掉，否则下一轮的 release 会打到一个
                    # 已经结束的闸上，返回 released=true 却什么也没发生。
                    finish_hold()
            if _pause_res is not None:
                # ⚠ 恢复信息**并进这一条**，不另发一个 `recovery` 事件
                #   （2026-08-28 事件对账查出来的）：前端的 switch 对不认识的
                #   类型是 `default: return "continue"`——**静默丢弃、连日志都
                #   没有**。第一版就那么发了一条没人听的 recovery，等于
                #   "我替你做了个决定"这件事发进了虚空，而 claw-code 那条配方的
                #   全部意义就是让人知道。一条通道、一处处理，比再加个监听好。
                _recovered = None
                if not _pause_res.answered and _pause_ledger is not None:
                    _act = recover_from(_pause_res, _pause_ledger)
                    if _act is not None:
                        _recovered = _act.event
                yield {
                    "type": "run_pause_ended",
                    "where": _pause_res.where,
                    "outcome": _pause_res.outcome.value,
                    "waitedSeconds": _pause_res.waited_seconds,
                    "recovery": _recovered,
                }
            ui = user_instruction or ""
            if skip_planning_loop_for_refine(repair=repair):
                record_refine_skip_planning(state, ui)
                yield {"type": "reasoning_step", "label": "refine", "loop": 0}
                await asyncio.to_thread(persist_state, state)
                break
            if trusted_closure_decision(state, ui, repair=repair) == "end":
                state = await asyncio.to_thread(resolve_coverage_gaps_from_state, state)
                gate = await asyncio.to_thread(evaluate_coverage_gate, state)
                if gate.get("passed") and isinstance(state.goal, dict):
                    state.goal["status"] = "clear"
                now = datetime.now(timezone.utc).isoformat()
                dl = getattr(state, "decisionLedger", []) or []
                dl.append(SchedulingDecision(
                    id=f"dec-{loop}-trusted-closure-end",
                    turnId=f"loop-{loop}",
                    saw=["appbundle.runtimeclosure"],
                    chose=[],
                    skipped=[{"capabilityId": "planning", "reason": "trusted_closure_reused"}],
                    rationale="trusted current-turn closure is terminal; deterministic coverage check only",
                    createdAt=now,
                    source="local_heuristic",
                ))
                state.decisionLedger = dl
                await asyncio.to_thread(persist_state, state)
                break
            # ⚠ 规划信号必须发在**整段规划之前**，不是发在 agentic pick 之前。
            #
            # 2026-08-04 第一版发晚了：信号在 agentic pick 前面，可它前面还有
            # orchestrate_plan 和规则版 pick_next_capabilities。真机量到每轮
            # 仍有 8~10s 黑屏（六轮合计 57.6s），只是把黑屏从"整段"缩成了"前半段"。
            # 这也是"光看代码以为修好了、跑一遍才知道只填了一半"的典型——
            # 所以现在从进入这一轮就报，一直报到真开始干活。
            yield {"type": "reasoning_step", "label": "planning", "loop": loop}
            _planning_ok = True
            # ⚠ 2026-08-27 M18：产品 rehearse 短清单。规则 pick 和 agentic pick
            # 必须在同一分支跳过——只改一条等于一半不生效（Claude.md §4）。
            # repair 仍走门标红项，禁止短路到 app 短清单。
            if repair:
                await asyncio.to_thread(orchestrate_plan, state, f"loop-{loop}", ui)
                picks = await asyncio.to_thread(
                    lambda st, _ui: pick_repair_capabilities(st),
                    state, ui,
                )
            elif profile == "app":
                picks = _app_profile_short_picks(state)
            else:
                await asyncio.to_thread(orchestrate_plan, state, f"loop-{loop}", ui)
                picks = await asyncio.to_thread(pick_next_capabilities, state, ui)
            from .v5_agentic_pick import (
                agentic_pick_next_capabilities,
                should_run_agentic_pick,
            )
            if picks and should_run_agentic_pick(profile, repair=repair):
                _proposal = await asyncio.to_thread(
                    agentic_pick_next_capabilities, state, ui, loop_index=loop, max_loops=max_loops
                )
                _planning_ok = _proposal is not None
                if _proposal:
                    _now = datetime.now(timezone.utc).isoformat()
                    _dl = getattr(state, "decisionLedger", []) or []
                    _dl.append(SchedulingDecision(
                        id=f"dec-{loop}-agentic-pick",
                        turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in picks],
                        chose=[p["capabilityId"] for p in _proposal["picks"]],
                        skipped=[],
                        rationale=f"agentic pick: {_proposal['rationale']}",
                        createdAt=_now,
                        source="llm",
                    ))
                    state.decisionLedger = _dl
                    picks = _proposal["picks"]
                else:
                    # 同步驱动同款：回落规则版 = 本轮降级，闭环据此拒发合格证。
                    from .run_degradation import (
                        IMPACT_REASONING,
                        REASON_AGENTIC_PICK_FALLBACK,
                        mark_degraded,
                    )
                    mark_degraded(
                        state,
                        reason=REASON_AGENTIC_PICK_FALLBACK,
                        message=f"第 {loop} 轮 LLM 选材未成，回落规则版选能力",
                        # 只决定「这轮挑哪几件活儿干」，挑出来的活儿照样认真执行，
                        # 做出来的东西不因此变差——显式写出来，不靠默认值猜
                        impact=IMPACT_REASONING,
                    )
            picks = ensure_closure_pick_by_deadline(
                state,
                picks,
                loop_index=loop,
                repair=repair,
                closure_attempted=closure_attempted,
            )
            state = await asyncio.to_thread(reconcile_coverage, state)
            selected = picks
            closure_attempted = closure_attempted or _contains_closure_pick(selected)
            # 规划段收尾。**必须在这里发**，不能等到执行批次里去发——
            # 下面 max_repeat_guard / no_progress 两条都会 break 出循环，
            # 那两条路上如果没有 result，前端那条 planning 会一直转到流结束。
            yield {
                "type": "reasoning_step_result",
                "label": "planning",
                "loop": loop,
                "error": not _planning_ok,
            }

            # max_repeat_guard
            if picks:
                filtered = [p for p in picks if _repeat_allows(state, p)]
                if filtered:
                    selected = filtered
                else:
                    # all repeats exhausted
                    now = datetime.now(timezone.utc).isoformat()
                    dec = SchedulingDecision(
                        id=f"dec-{loop}-max_repeat_guard", turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in picks], chose=[], skipped=[
                            {"capabilityId": p["capabilityId"], "reason": "max_repeat_guard"} for p in picks
                        ],
                        rationale=f"max_repeat_guard at loop {loop}",
                        createdAt=now, source="local_heuristic",
                    )
                    dl = getattr(state, "decisionLedger", []) or []
                    dl.append(dec)
                    state.decisionLedger = dl
                    state.awaitReason = "max_repeat_guard"
                    state.awaitDetail = f"max_repeat_guard: all candidates excluded after {MAX_REPEAT_PER_CAP} repeats"
                    break

            if not selected:
                no_progress_streak += 1
                if no_progress_streak >= 2:
                    now = datetime.now(timezone.utc).isoformat()
                    dec = SchedulingDecision(
                        id=f"dec-{loop}-no_progress", turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in (picks or [])],
                        chose=[], skipped=[],
                        rationale=f"no_progress: {no_progress_streak} loops",
                        createdAt=now, source="local_heuristic",
                    )
                    dl = getattr(state, "decisionLedger", []) or []
                    dl.append(dec)
                    state.decisionLedger = dl
                    state.awaitReason = "no_progress"
                    state.awaitDetail = f"no_progress after {no_progress_streak} loops"
                    break
                picks = selected
                break

            # Execute selected
            # SLIDERULE_PARALLEL_CAPS (default ON): pre-emit ALL capability_start
            # events (persisted) + reasoning_step SSE events, run the independent
            # provider calls concurrently, then commit sequentially in selection
            # order and emit reasoning_step_result per cap as commits land — so
            # step-event pairing stays coherent for stream watchers. Explicit
            # false (or single-cap batch) takes the serial reference path below.
            to_run = _apply_pending_run_skips(state, selected, loop)
            batch_parallel = _parallel_caps_enabled() and len(to_run) > 1
            if batch_parallel:
                t_loop = _time.time()
                turn_id = f"loop-{loop}"
                await asyncio.to_thread(_emit_batch_capability_starts, state, to_run, loop)
                for sel in to_run:
                    yield {"type": "reasoning_step", "label": sel["capabilityId"], "loop": loop}
                for group in _split_parallel_segments(to_run):
                    batch_task = asyncio.ensure_future(asyncio.gather(*[
                        asyncio.to_thread(
                            _timed_execute, sel["capabilityId"], state, sel.get("roleId", "agent"), turn_id
                        )
                        for sel in group
                    ]))
                    # 并行批执行期间排水：各能力的 LLM 想法带标签实时流出
                    #（并发时不同能力的增量按标签分事件，前端各自归位）。
                    async for _delta_event in _pump_llm_deltas(batch_task):
                        yield _delta_event
                    outcomes = batch_task.result()
                    for sel, outcome in zip(group, outcomes):
                        await asyncio.to_thread(
                            _commit_executed_outcome,
                            state,
                            sel=sel,
                            loop=loop,
                            outcome=outcome,
                            parallel=True,
                            selected=to_run,
                        )
                        yield {
                            "type": "reasoning_step_result",
                            "label": sel["capabilityId"],
                            "error": not outcome["ok"],
                            "summary": (outcome["result_data"] or {}).get("summary") if outcome["ok"] else None,
                        }
                _append_loop_timing_event(state, loop, len(to_run), int((_time.time() - t_loop) * 1000))
                await asyncio.to_thread(persist_state, state)
            for sel in ([] if batch_parallel else to_run):
                cap = sel["capabilityId"]
                role = sel.get("roleId", "agent")
                turn_id = f"loop-{loop}"
                run_id = f"run-{loop}-{cap}"

                append_reasoning_event(
                    state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap,
                    kind="capability_start", text=f"capability_started: {cap}", roleId=role, order=1,
                )
                append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=cap, capabilityRunId=run_id)
                await asyncio.to_thread(persist_state, state)

                # These are REASONING-engine capabilities (evidence.search, risk.analyze,
                # synthesis.merge ...), NOT the 5 skill-system capabilities. Emit them as
                # reasoning_step so the UI can show "thinking" progress without mislabeling
                # them as skills. The real 5-system skill sequence is emitted after the
                # closure computes (see per-skill emission below).
                yield {"type": "reasoning_step", "label": cap, "loop": loop}

                t0 = _time.time()
                result_data: Dict[str, Any] = {}
                cap_error = False
                try:
                    exec_task = asyncio.ensure_future(
                        asyncio.to_thread(_execute_round_capability, cap, state, role, turn_id)
                    )
                    # 串行执行期间排水：这一步的 LLM 想法带标签实时流出。
                    async for _delta_event in _pump_llm_deltas(exec_task):
                        yield _delta_event
                    result = exec_task.result()
                    result_data = _result_to_dict(result)
                    art_id = f"art-{loop}-{cap}"
                    produced = ProducedBy(capabilityRunId=run_id, capabilityId=cap, roleId=role)
                    kind_art = (
                        "evidence" if ("evidence" in cap or cap in ["mcp.call", "skill.invoke"])
                        else ("report" if "report" in cap else "risk")
                    )
                    commit_artifact(
                        state, id=art_id, kind=kind_art,
                        content=result_data.get("content", ""),
                        summary=result_data.get("summary", ""),
                        title=result_data.get("title"),
                        provenance=result_data.get("provenance", "python-rag"),
                        producedBy=produced, inputArtifactIds=[],
                        turnId=turn_id, sources=result_data.get("sources", []),
                    )
                    dur = int((_time.time() - t0) * 1000)
                    if getattr(state, "capabilityRuns", None):
                        last = state.capabilityRuns[-1]
                        if hasattr(last, "result"):
                            last.result = result_data
                        elif isinstance(last, dict):
                            last["result"] = result_data
                        if hasattr(last, "timing"):
                            last.timing = {"durationMs": dur}
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap,
                        kind="capability_complete", text=f"capability_completed: {cap}", roleId=role, order=2,
                    )

                except Exception as cap_exc:
                    cap_error = True
                    dur = int((_time.time() - t0) * 1000)
                    err = {"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": cap}
                    from .engine_scheduling import record_capability_run_error
                    record_capability_run_error(
                        state, capabilityId=cap, turnId=turn_id, error=err, roleId=role,
                        timing={"durationMs": dur},
                    )
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap,
                        kind="capability_complete", text=f"capability_completed: {cap} (error)", roleId=role, order=2,
                    )
                    state.awaitDetail = (getattr(state, "awaitDetail", None) or "") + f"; degraded cap {cap}"

                # ⚠ 写失败不许接着跑下一个。必须在 per-cap except 外面：
                # PersistClosedError 若被当成能力失败吞掉，C 仍会开跑。
                await asyncio.to_thread(
                    persist_pending_capability,
                    state,
                    cap,
                    loop,
                    selected,
                    "error" if cap_error else "ok",
                    run_id,
                )

                yield {
                    "type": "reasoning_step_result",
                    "label": cap,
                    "error": cap_error,
                    "summary": result_data.get("summary") if not cap_error else None,
                }

            # 本轮真收过口 → 立刻把闭环结果写回 state（2026-08-05）。
            #
            # 不写回的话，下一轮的状态摘要读 state.publishClosure 读到 None，
            # `_closure_line` 报「尚未收口」——**刚刚成功收完口的那一轮也一样**。
            # 模型据此再收一次，一次收口是整套重来：重新生成五系统模型、生参照图、
            # 取色、设计版式、落库。真机实测这一趟 472 秒。
            #
            # 之前 state.publishClosure 只在**循环全部结束之后**才赋值（本文件
            # 末尾），也就是说那条防重复收口的提示词在流式驱动里从来没生效过。
            # 单元测试是绿的，因为它自己手搓了一个带 publishClosure 的 state
            # （test_agentic_pick_closure_pressure.py 的 `_state`）——这正是
            # "测试钉住了措辞、没钉住数据从哪来"的典型缺口。
            #
            # 只在收口能力真的跑过的轮次写回。E37 之后 derive_* 永不返回 None
            # （拿不到证据就回落成 blocked 闭环），无条件赋值会让没收过口的轮次
            # 也报「blocked 0/6，可以再收一次」，把"还没做"说成"做了没成"。
            if any(_is_closure_cap(p.get("capabilityId", "")) for p in selected):
                _round_closure = derive_publish_closure_response(state)
                if _round_closure is not None:
                    state.publishClosure = _round_closure
                    # 版本快照也必须当场记（2026-08-05）。
                    #
                    # 它是 `reusable_model_for_turn` 的**唯一数据来源**：那把
                    # 会话级的锁 2026-08-04 就写好了，专治的正是"同一轮收两次口、
                    # 第二次从头重生成"。可它读 state.modelVersions，而
                    # record_model_version 原本只在循环结束后才调一次——循环里
                    # 那份永远是空的，锁一次都没合上过。
                    #
                    # 真机代价：第二次收口全价重跑，建模 200s + 生图 113s +
                    # 取色 14s + 设计 277s = 608 秒，占整轮 45%。
                    #
                    # 跟上面 publishClosure 那条是同一个结构性错误、同一段代码、
                    # 隔着两行：**该在循环里更新的状态写在了循环外**。防重复的
                    # 提示词和省时间的复用锁都因此失灵，只剩最粗的计数器兜底。
                    record_model_version(state, _round_closure, user_instruction)
                    await asyncio.to_thread(persist_state, state)

            # progress tracking
            #
            # ⚠ 2026-08-14：**产物变多不再算进展**，只有"缺口有新解决"才算。
            #
            # 真机现象：一轮跑到 max_loops 还不收口，用户报「执行闭环不了，
            # 都执行 9 轮了」。查下来闭环其实是成的（blocked=False、证据 6/6），
            # 卡住的是覆盖门里一条 `gap-evidence-turn-1`——外部证据缺口，
            # `capabilityId=None`，**没有任何能力负责解它**。
            #
            # 而每轮 evidence.search 都会产出一条新产物，于是 `now_art >
            # prev_art_count` 恒成立、计数器每轮清零，"没进展就停"这道兜底
            # 一次都没机会触发。
            #
            # 判据查的是"有没有在干活"，不是"有没有在向门前进"——**产出产物
            # 本身不是进展**，解开缺口才是。这跟本仓数了十次的那个形状是同一个：
            # 只查"产出的对不对"，不查"该有的在不在"。
            #
            # ⚠ 收严的代价是可能比以前早两轮停。那是对的：连着两轮一个缺口都
            #   没解开，再跑十轮也解不开——现在停下来至少把已有的产出交出去，
            #   而不是烧十轮 LLM 之后交同样的东西。
            now_art = len(getattr(state, "artifacts", []) or [])
            now_res = _count_resolved(state)
            if now_res > prev_resolved:
                no_progress_streak = 0
            else:
                no_progress_streak += 1
            prev_art_count = now_art
            prev_resolved = now_res

            if no_progress_streak >= 2:
                now = datetime.now(timezone.utc).isoformat()
                dec = SchedulingDecision(
                    id=f"dec-{loop}-no_progress", turnId=f"loop-{loop}",
                    saw=[p["capabilityId"] for p in (picks or [])],
                    chose=[p["capabilityId"] for p in selected],
                    skipped=[],
                    rationale=f"no_progress streak {no_progress_streak}",
                    createdAt=now, source="local_heuristic",
                )
                dl = getattr(state, "decisionLedger", []) or []
                dl.append(dec)
                state.decisionLedger = dl
                state.awaitReason = "no_progress"
                state.awaitDetail = f"no_progress streak {no_progress_streak}"
                break

            state = await asyncio.to_thread(resolve_coverage_gaps_from_state, state)
            gate = await asyncio.to_thread(evaluate_coverage_gate, state)
            if gate.get("passed"):
                state.goal["status"] = "clear"
                # 交付意图：门通过但交付清单未出全时继续循环（同步驱动同款逻辑）。
                # app 短清单不走作文交付链，继续循环只会把 runtimeclosure 再跑一遍。
                if profile != "app" and await asyncio.to_thread(
                    _has_pending_delivery_picks, state, user_instruction
                ):
                    loop += 1
                    await asyncio.to_thread(persist_state, state)
                    continue
                break
            loop += 1
            await asyncio.to_thread(persist_state, state)

        # 闭环证据重建里藏着最长的一步：新颖意图的五系统 LLM 生成（60~100s）。
        # 等待线程期间持续排水（共享带标签队列），把 LLM 的实时输出以
        # llm_delta 事件推给前端（Claude 式"看得见的想法"）。
        closure_task = asyncio.ensure_future(
            asyncio.to_thread(
                _ensure_runtime_closure_evidence,
                state,
                user_instruction,
                loop,
                repair,
                closure_attempted,
            )
        )
        async for _delta_event in _pump_llm_deltas(closure_task):
            yield _delta_event
        state = closure_task.result()

        state = await asyncio.to_thread(resolve_coverage_gaps_from_state, state)
        gate = await asyncio.to_thread(evaluate_coverage_gate, state)
        final_closure = derive_publish_closure_response(state)
        final_phase, final_reason = terminal_phase_decision(state, gate, final_closure)
        if final_phase == "done":
            if gate.get("passed") and isinstance(state.goal, dict):
                state.goal["status"] = "clear"  # 最终门通过时 phase/status 保持一致
            state.runtimePhase = "done"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end",
                capabilityId="driver", kind="think", text="phase_changed: done", order=10)
            await asyncio.to_thread(persist_state, state)
        else:
            state.runtimePhase = "awaiting"
            if getattr(state, "awaitReason", None) not in ("no_progress", "max_repeat_guard"):
                if loop >= max_loops:
                    state.awaitReason = "max_loops"
                elif not picks:
                    state.awaitReason = "convergence"
                elif final_reason in ("closure_blocked", "closure_missing"):
                    state.awaitReason = final_reason
                else:
                    state.awaitReason = "coverage"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end",
                capabilityId="driver", kind="think",
                text=f"phase_changed: awaiting ({state.awaitReason or 'coverage'})", order=10)
            await asyncio.to_thread(persist_state, state)

    except Exception as exc:
        state.runtimePhase = "failed"
        state.awaitReason = "ready"
        state.awaitDetail = f"drive error: {str(exc)[:120]}"
        append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end",
            capabilityId="driver", kind="think", text="phase_changed: failed", order=10)
        await asyncio.to_thread(persist_state, state)
        yield {"type": "phase_change", "phase": "failed", "detail": state.awaitDetail}
    finally:
        # 注销本轮装上去的所有 sink：本次流之后的 LLM 调用不再往（已废弃的）
        # 队列里灌。这里只剩一行——每根 sink 的卸载动作在**装它的那一行**就
        # 交给栈了（抄 grok 的 SinkGuard，见 sliderule_llm/scoped.py）。
        # 加第六根 sink 不需要回来改这里。
        _sinks.close()
        _enrich_timing.reset_run_budget(_budget_token)
        _turn_token.__exit__(None, None, None)
        _cost_cm.__exit__(None, None, None)
        # E29：精修/直供上下文兜底清理（异常路径防泄漏到下一轮）
        _gen.set_refine_context(None)
        _gen.set_model_override(None)

    # 旁路 drive 没有客户端 PUT。这里不写，刷新就是「1 阶段 · 0 步」。
    from .turn_narration import stamp_drive_narration

    stamp_drive_narration(
        state,
        turn_id=drive_turn_id,
        user=user_instruction,
        events_cursor=events_cursor,
        started_monotonic=drive_started,
    )
    await asyncio.to_thread(persist_state, state)

    # Compute publish closure + skill graph (the REAL 5-system evidence).
    publish_closure = derive_publish_closure_response(state)
    skill_graph = derive_skill_runtime_graph_response(state)

    # Emit the real 5-system skill sequence, in cross-skill dependency order,
    # derived from perSkillEvidence. THIS is the authentic "which system is
    # being resolved" axis (the reasoning loop above is a different axis).
    # Each skill: skill_start -> (brief pause for UI animation) -> skill_result
    # carrying its evidence presence + graph edges + mermaid projection.
    if publish_closure is not None:
        per_skill = publish_closure.get("perSkillEvidence") or {}
        graph_by_skill = (skill_graph or {}).get("bySkill") or {}
        for closure_key in _SKILL_EMIT_ORDER:
            skill_id = _CLOSURE_KEY_TO_SKILL_ID.get(closure_key, "appBundle")
            ev = per_skill.get(closure_key) or {}
            present = ev.get("evidencePresent") is True
            edges = graph_by_skill.get(closure_key) or []

            yield {"type": "skill_start", "skill": skill_id, "label": closure_key}
            # Small yield-point so SSE consumers can animate the highlight in sequence.
            await asyncio.sleep(0.12)
            yield {
                "type": "skill_result",
                "skill": skill_id,
                "label": closure_key,
                "error": not present,
                "evidencePresent": present,
                "evidenceRef": ev.get("evidenceRef"),
                "artifactId": ev.get("artifactId"),
                "digest": ev.get("digest"),
                "edges": edges,
                "mermaid": _skill_edges_to_mermaid(closure_key, edges),
                # Gate-PASSED five-system model section for this skill (LLM path).
                # None on deterministic domains — the client degrades honestly.
                # Payload only: never consulted for trust/closure decisions.
                "modelSection": ev.get("modelSection"),
            }

    # Emit full closure payload after the per-skill walk.
    if publish_closure is not None:
        # 方案 B：真 LLM 收口总结——结合推演全程上下文（意图、五系统模型、
        # 风险/反方/综合等真实产出）生成对话总结，增量以 llm_delta
        # label "closure.summary" 实时流出；失败静默回落客户端模板（方案 A）。
        if _llm_round_caps_enabled():
            def _summarize() -> Optional[str]:
                from .v5_closure_summary import generate_closure_chat_summary

                # ⚑ 2026-08-14 补埋点：收尾这一段此前**整段没有耗时记录**。
                #   排查那 821 秒时，六步 specfirst.* 都有 enrich-timing，
                #   唯独收尾没有——只能靠事后单独复跑去排除它（实测 18.4s）。
                #   接进同一套，下次一眼可见。
                with _enrich_timing.stage("closure.summary") as _st:
                    _out = generate_closure_chat_summary(
                        state,
                        publish_closure,
                        on_delta=lambda chunk: _delta_q.put(("closure.summary", chunk)),
                    )
                    _st["chars"] = len(_out or "")
                    return _out

            summary_task = asyncio.ensure_future(asyncio.to_thread(_summarize))
            async for _delta_event in _pump_llm_deltas(summary_task):
                yield _delta_event
            chat_summary = summary_task.result()
            if chat_summary:
                publish_closure["chatSummary"] = chat_summary

        state.publishClosure = publish_closure
        state.skillRuntimeGraph = skill_graph
        # 收尾这一笔也必须**单调递增**（2026-08-10 修）。
        #
        # 原来写的是 `f"turn-stream-{loop}-drive-full"` —— 用的是**本趟的 loop
        # 序号**，不是会话级的单调版本。于是每趟 drive 结束都把版本按各自跑了
        # 几轮盖一遍：跑 3 轮就写 `turn-stream-3-drive-full`，下一趟还跑 3 轮，
        # 又写同一个值。版本原地踏步，而它正是持久化守卫的依据
        # （见 _advance_turn_version 的文档："实测踩过，勿删"）。
        #
        # 同步那条路（routes 的 _advance_drive_full_turn_id）一直是对的：
        # `turn-{seq+1}-drive-full` —— 读出当前序号 +1，保留 -drive-full 标记。
        # 这里照它来，两条路从此同形。
        #
        # 配合 `_advance_turn_version` 改成不锚定取数，整条链就单调了：
        #     drive1 开头 turn-1 → 收尾 turn-2-drive-full
        #     drive2 开头 turn-3 → 收尾 turn-4-drive-full
        # 顺带把模型复用的轮次作用域救回来：drive2 里 lastTurnId 是 turn-3，
        # 而 drive1 存的快照是 turn-1/turn-2-drive-full，对不上 → 不会拿旧模型
        # 回答用户的新消息（那正是 reusable_model_for_turn 要防的）；
        # 而 drive2 内部各 loop 之间 lastTurnId 不变 → 轮内复用照常生效。
        import re as _re_turn

        _prev_seq = [int(_n) for _n in _re_turn.findall(r"\d+", str(state.lastTurnId or ""))]
        state.lastTurnId = f"turn-{(max(_prev_seq) + 1) if _prev_seq else 1}-drive-full"
        # E29：模型变化才追加版本快照（前进/回退按钮的数据源）
        record_model_version(state, publish_closure, user_instruction)
        # 收口总结写进 closure 后再打一次，终局叙述才能带上 chatSummary /
        # refinePaintNote。turnId 仍用 drive 开头那格，对得上版本史。
        stamp_drive_narration(
            state,
            turn_id=drive_turn_id,
            user=user_instruction,
            events_cursor=events_cursor,
            started_monotonic=drive_started,
        )
        await asyncio.to_thread(persist_state, state)
        yield {"type": "publish_closure", "data": publish_closure}

    yield {"type": "phase_change", "phase": state.runtimePhase}
    yield {"type": "complete", "state": state.model_dump()}


def _skill_edges_to_mermaid(skill: str, edges: list) -> str:
    """Render a skill's cross-system edges as a small mermaid flowchart.

    Deterministic; used by the UI's per-system screen. Empty edges -> minimal node.
    """
    lines = ["flowchart LR"]
    if not edges:
        lines.append(f'  {skill}["{skill}"]')
        return "\n".join(lines)
    seen = set()
    for e in edges:
        src = e.get("sourceSkill") if isinstance(e, dict) else None
        tgt = e.get("targetSkill") if isinstance(e, dict) else None
        key = e.get("evidenceKey") if isinstance(e, dict) else None
        state_lbl = e.get("state") if isinstance(e, dict) else None
        if not src or not tgt:
            continue
        edge_sig = f"{src}->{tgt}"
        if edge_sig in seen:
            continue
        seen.add(edge_sig)
        label = (key or state_lbl or "").replace('"', "'")
        lines.append(f'  {src}["{src}"] -->|{label}| {tgt}["{tgt}"]')
    return "\n".join(lines)
