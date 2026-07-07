"""
Complete V5 driver ported from Node's session-driver.ts, mini-session.ts, and client runtime.

This replaces the entire Node V5 loop with Python RAG-backed execution.
All capabilities now produce real evidence via RAG, no templates, no degraded, no su8 issues.
"""

import os
import time
from typing import Dict, Any, AsyncGenerator, List, Optional
from datetime import datetime, timezone
from models.v5_state import V5SessionState, ProducedBy, SchedulingDecision
from .slide_rule_orchestrator import orchestrate_plan
from .slide_rule_session import pick_next_capabilities, commit_artifact, append_reasoning_event, append_replay_event


def _has_pending_delivery_picks(state, user_instruction: str) -> bool:
    """交付意图下是否还有未提交的交付能力可选（用于门通过后的继续判定）。"""
    from .slide_rule_session import _is_delivery_intent

    if not _is_delivery_intent(user_instruction or ""):
        return False
    try:
        return bool(pick_next_capabilities(state, user_instruction or ""))
    except Exception:
        return False
from .v5_capability_executor import execute_v5_capability
from .persistence import persist_state
from .slide_rule_coverage import (
    evaluate_coverage_gate,
    reconcile_coverage,
    resolve_coverage_gaps_from_state,
)
from .v5_publish_closure_response import derive_publish_closure_response
from .v5_skill_runtime_graph import derive_skill_runtime_graph_response


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
# ---------------------------------------------------------------------------

def _parallel_caps_enabled() -> bool:
    """SLIDERULE_PARALLEL_CAPS: env wins (dynamic), settings next, default ON.

    Explicit "false"/"0"/"no"/"off" selects the untouched serial path.
    """
    env = os.getenv("SLIDERULE_PARALLEL_CAPS")
    if env is not None and str(env).strip() != "":
        return str(env).strip().lower() not in ("0", "false", "no", "off")
    try:
        from config.settings import settings as _settings
        return bool(getattr(_settings, "SLIDERULE_PARALLEL_CAPS", True))
    except Exception:
        return True


def _is_commit_order_sensitive_cap(capability_id: str) -> bool:
    """Caps whose EXECUTOR reads committed artifacts (not just goal text).

    execute_v5_capability's appbundle/runtimeClosure branch derives per-skill
    evidence from state.artifacts, so in serial mode it observes the commits of
    caps earlier in the same batch. Such caps must run as barriers.
    """
    cap = (capability_id or "").lower()
    return "appbundle" in cap or "runtimeclosure" in cap


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


def _timed_execute(cap: str, state: V5SessionState, role: str, turn_id: str) -> Dict[str, Any]:
    """Execute one capability, catching its error (per-cap try/except identical
    to the serial path — one failure must not sink the batch). Read-only on state."""
    t0 = time.time()
    try:
        result = execute_v5_capability(cap, state, [], role, turn_id)
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


def _commit_executed_outcome(
    state: V5SessionState,
    *,
    sel: Dict[str, Any],
    loop: int,
    outcome: Dict[str, Any],
    parallel: bool = True,
) -> None:
    """Phase C: apply one capability's state mutations (sequential, selection order).

    Success: commit_artifact + run result/timing + capability_complete (same as serial).
    Error: record_capability_run_error + degraded awaitDetail (same as serial) — an
    errored capability never prevents the other caps' commits.
    """
    cap = sel["capabilityId"]
    role = sel.get("roleId", "agent")
    turn_id = f"loop-{loop}"
    run_id = f"run-{loop}-{cap}"
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
        persist_state(state)
    else:
        from .slide_rule_session import record_capability_run_error

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
        persist_state(state)
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
            _commit_executed_outcome(state, sel=sel, loop=loop, outcome=outcome, parallel=True)
    _append_loop_timing_event(state, loop, len(selected), int((time.time() - t_loop) * 1000))
    persist_state(state)


def _ensure_runtime_closure_evidence(state: V5SessionState, user_instruction: str, loop: int) -> V5SessionState:
    """Append Python-owned AppBundle closure evidence for replay when a real command ran.

    The UI can derive preview surfaces, but reload requires persisted Python evidence.
    This keeps the route fail-closed: if AppBundle reports missing skill evidence, the
    derived publishClosure is blocked rather than fabricated green.
    """
    if not (user_instruction or "").strip():
        return state
    existing_closure = derive_publish_closure_response(state)
    if existing_closure is not None and derive_skill_runtime_graph_response(state) is not None:
        blocked = bool(existing_closure.get("blocked")) if isinstance(existing_closure, dict) else bool(getattr(existing_closure, "blocked", False))
        if not blocked:
            return state
        # blocked 的闭环允许在新一轮重建（例如 LLM 瞬时失败导致 0/6）：
        # fail-closed 语义不变——证据真缺失时重建后依然 blocked。

    import time as _time

    capability_id = "appbundle.runtimeClosure"
    role_id = "appbundle"
    turn_id = f"loop-{loop}-closure"
    run_id = f"run-{loop}-{capability_id}"
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
            artifact_id=f"art-{loop}-{capability_id}",
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
        from .slide_rule_session import record_capability_run_error

        record_capability_run_error(
            state,
            capabilityId=capability_id,
            turnId=turn_id,
            error={"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": capability_id},
            roleId=role_id,
            timing={"durationMs": int((_time.time() - t0) * 1000)},
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
    return state

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
    state = initial_state
    state.runtimePhase = "orchestrating"
    turn_base = f"full-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    append_replay_event(state, kind="decision", turnId=f"loop-0", decisionId=f"phase-orchestrating-full")
    append_reasoning_event(state, turnId=f"loop-0", capabilityRunId="phase-full-0", capabilityId="driver", kind="think", text="phase_changed: orchestrating (full drive)", order=0)
    # Immediate persist after phase start so polling GET sees orchestrating before first loop execs
    persist_state(state)
    loop = 0
    plan = type("P", (), {"selected": []})()  # safe default for phase decision on early error
    picks = []
    executed_loops = 0
    no_progress_streak = 0
    MAX_REPEAT_PER_CAP = 2  # small threshold for guard testability; per V5.2 policy default higher but slice uses 2
    try:
        prev_art_count = len(getattr(state, "artifacts", []) or [])
        # simple resolved count from coverageGaps (status resolved)
        def _count_resolved(st):
            gaps = getattr(st, "coverageGaps", []) or []
            return sum(1 for g in gaps if (g.get("status") if isinstance(g, dict) else getattr(g, "status", None)) == "resolved")
        prev_resolved = _count_resolved(state)
        while loop < max_loops:
            ui = user_instruction or ""
            plan = orchestrate_plan(state, f"loop-{loop}", ui)
            # PYTHON_AUTHORITY: use explicit pick_next_capabilities for V5.2 selection semantics + fallbacks
            # (pick is sole authority; empty means converge; no fallback to plan.selected)
            picks = pick_next_capabilities(state, ui)
            state = reconcile_coverage(state)
            selected = picks

            # max_repeat_guard: filter candidates by run count; stop if had picks but all filtered
            if picks:
                filtered = []
                for p in picks:
                    cid = p["capabilityId"]
                    cnt = sum(1 for r in (getattr(state, "capabilityRuns", []) or []) if (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")) == cid)
                    if cnt < MAX_REPEAT_PER_CAP:
                        filtered.append(p)
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
            if _parallel_caps_enabled() and len(selected) > 1:
                _run_selected_batch_parallel(state, selected, loop)
                serial_selected = []
            else:
                serial_selected = selected
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
                    # Execute via full migrated executor - always real
                    result = execute_v5_capability(cap, state, [], role, turn_id)
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
                    # Persist complete mid so pollers see finish before next cap/loop end
                    persist_state(state)
                except Exception as cap_exc:
                    # Record capability error without whole drive fail or state corruption
                    dur = int((_time.time() - t0) * 1000)
                    err = {"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": cap}
                    # import here to keep top minimal; use the record from session (PYTHON slice)
                    from .slide_rule_session import record_capability_run_error
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
                    # Persist error complete for visibility
                    persist_state(state)
                    state.awaitDetail = (getattr(state, "awaitDetail", None) or "") + f"; degraded cap {cap}"
                    # continue to next cap or stop decision; error run is auditable record
            executed_loops += 1
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
        state = _ensure_runtime_closure_evidence(state, user_instruction, loop)
        # Final phase: done if clear/coverage, else awaiting (converged or budget)
        state = resolve_coverage_gaps_from_state(state)
        gate = evaluate_coverage_gate(state)
        if gate.get("passed") or (state.goal or {}).get("status") == "clear":
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
            else:
                # use last picks (from pick_next_capabilities) for convergence; empty pick owns converge decision
                state.awaitReason = "convergence" if not picks else "coverage"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end", capabilityId="driver", kind="think", text=f"phase_changed: awaiting ({state.awaitReason or 'coverage'})", order=10)
            persist_state(state)
    except Exception as exc:
        state.runtimePhase = "failed"
        state.awaitReason = "ready"
        state.awaitDetail = f"drive error: {str(exc)[:120]}"
        append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end", capabilityId="driver", kind="think", text=f"phase_changed: failed", order=10)
        persist_state(state)
    persist_state(state)
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


# Order in which the 5-system skills are emitted after closure (cross-skill
# dependency order: datamodel is the SSOT root; appbundle is the assembly root).
# Matches RUNTIME_CLOSURE_EDGES direction so the UI lights systems in causal order.
_SKILL_EMIT_ORDER = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]

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

async def drive_full_v5_session_stream(
    initial_state: "V5SessionState",
    max_loops: int = 10,
    user_instruction: str = "",
) -> AsyncGenerator[Dict[str, Any], None]:
    """Async generator mirroring drive_full_v5_session but yielding SSE dicts.

    Event shapes:
        {"type": "phase_change",  "phase": str}
        {"type": "skill_start",   "skill": str, "label": str}
        {"type": "skill_result",  "skill": str, "label": str, "error": bool,
                                  "modelSection": dict|None, "mermaid": str|None}
        {"type": "publish_closure", "data": dict}
        {"type": "complete",      "state": dict}
    """
    import asyncio
    import time as _time

    state = initial_state
    state.runtimePhase = "orchestrating"
    append_replay_event(state, kind="decision", turnId="loop-0", decisionId="phase-orchestrating-full")
    append_reasoning_event(
        state, turnId="loop-0", capabilityRunId="phase-full-0",
        capabilityId="driver", kind="think",
        text="phase_changed: orchestrating (full drive)", order=0,
    )
    persist_state(state)
    yield {"type": "phase_change", "phase": "orchestrating"}

    loop = 0
    picks: list = []
    no_progress_streak = 0
    MAX_REPEAT_PER_CAP = 2

    try:
        prev_art_count = len(getattr(state, "artifacts", []) or [])

        def _count_resolved(st: "V5SessionState") -> int:
            gaps = getattr(st, "coverageGaps", []) or []
            return sum(
                1 for g in gaps
                if (g.get("status") if isinstance(g, dict) else getattr(g, "status", None)) == "resolved"
            )

        prev_resolved = _count_resolved(state)

        while loop < max_loops:
            ui = user_instruction or ""
            await asyncio.to_thread(orchestrate_plan, state, f"loop-{loop}", ui)
            picks = await asyncio.to_thread(pick_next_capabilities, state, ui)
            state = await asyncio.to_thread(reconcile_coverage, state)
            selected = picks

            # max_repeat_guard
            if picks:
                filtered = [
                    p for p in picks
                    if sum(
                        1 for r in (getattr(state, "capabilityRuns", []) or [])
                        if (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")) == p["capabilityId"]
                    ) < MAX_REPEAT_PER_CAP
                ]
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
            batch_parallel = _parallel_caps_enabled() and len(selected) > 1
            if batch_parallel:
                t_loop = _time.time()
                turn_id = f"loop-{loop}"
                await asyncio.to_thread(_emit_batch_capability_starts, state, selected, loop)
                for sel in selected:
                    yield {"type": "reasoning_step", "label": sel["capabilityId"], "loop": loop}
                for group in _split_parallel_segments(selected):
                    outcomes = await asyncio.gather(*[
                        asyncio.to_thread(
                            _timed_execute, sel["capabilityId"], state, sel.get("roleId", "agent"), turn_id
                        )
                        for sel in group
                    ])
                    for sel, outcome in zip(group, outcomes):
                        await asyncio.to_thread(
                            _commit_executed_outcome, state, sel=sel, loop=loop, outcome=outcome, parallel=True
                        )
                        yield {
                            "type": "reasoning_step_result",
                            "label": sel["capabilityId"],
                            "error": not outcome["ok"],
                            "summary": (outcome["result_data"] or {}).get("summary") if outcome["ok"] else None,
                        }
                _append_loop_timing_event(state, loop, len(selected), int((_time.time() - t_loop) * 1000))
                persist_state(state)
            for sel in ([] if batch_parallel else selected):
                cap = sel["capabilityId"]
                role = sel.get("roleId", "agent")
                turn_id = f"loop-{loop}"
                run_id = f"run-{loop}-{cap}"

                append_reasoning_event(
                    state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap,
                    kind="capability_start", text=f"capability_started: {cap}", roleId=role, order=1,
                )
                append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=cap, capabilityRunId=run_id)
                persist_state(state)

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
                    result = await asyncio.to_thread(execute_v5_capability, cap, state, [], role, turn_id)
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
                    persist_state(state)

                except Exception as cap_exc:
                    cap_error = True
                    dur = int((_time.time() - t0) * 1000)
                    err = {"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": cap}
                    from .slide_rule_session import record_capability_run_error
                    record_capability_run_error(
                        state, capabilityId=cap, turnId=turn_id, error=err, roleId=role,
                        timing={"durationMs": dur},
                    )
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap,
                        kind="capability_complete", text=f"capability_completed: {cap} (error)", roleId=role, order=2,
                    )
                    persist_state(state)
                    state.awaitDetail = (getattr(state, "awaitDetail", None) or "") + f"; degraded cap {cap}"

                yield {
                    "type": "reasoning_step_result",
                    "label": cap,
                    "error": cap_error,
                    "summary": result_data.get("summary") if not cap_error else None,
                }

            # progress tracking
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
                if await asyncio.to_thread(_has_pending_delivery_picks, state, user_instruction):
                    loop += 1
                    persist_state(state)
                    continue
                break
            loop += 1
            persist_state(state)

        # 闭环证据重建里藏着最长的一步：新颖意图的五系统 LLM 生成（60~100s）。
        # 注册 delta sink 并在等待线程期间持续排水，把 LLM 的实时输出以
        # llm_delta 事件推给前端（Claude 式"看得见的想法"）。150ms 批量聚合，
        # 避免逐 token 的事件风暴。
        import queue as _queue

        from . import v5_llm_generate as _gen

        _delta_q: "_queue.Queue[str]" = _queue.Queue()
        _gen.set_generate_delta_sink(_delta_q.put)
        try:
            closure_task = asyncio.ensure_future(
                asyncio.to_thread(_ensure_runtime_closure_evidence, state, user_instruction, loop)
            )
            while True:
                # 先记完成标志再排水：保证任务结束瞬间到达的尾部增量也被冲出，
                # 不会在 break 时滞留队列。
                finished = closure_task.done()
                pending: List[str] = []
                try:
                    while True:
                        pending.append(_delta_q.get_nowait())
                except _queue.Empty:
                    pass
                if pending:
                    yield {"type": "llm_delta", "text": "".join(pending)}
                if finished:
                    break
                await asyncio.sleep(0.15)
            state = closure_task.result()
        finally:
            _gen.set_generate_delta_sink(None)

        state = await asyncio.to_thread(resolve_coverage_gaps_from_state, state)
        gate = await asyncio.to_thread(evaluate_coverage_gate, state)
        if gate.get("passed") or (state.goal or {}).get("status") == "clear":
            if gate.get("passed") and isinstance(state.goal, dict):
                state.goal["status"] = "clear"  # 最终门通过时 phase/status 保持一致
            state.runtimePhase = "done"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end",
                capabilityId="driver", kind="think", text="phase_changed: done", order=10)
            persist_state(state)
        else:
            state.runtimePhase = "awaiting"
            if getattr(state, "awaitReason", None) not in ("no_progress", "max_repeat_guard"):
                if loop >= max_loops:
                    state.awaitReason = "max_loops"
                elif not picks:
                    state.awaitReason = "convergence"
                else:
                    state.awaitReason = "coverage"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end",
                capabilityId="driver", kind="think",
                text=f"phase_changed: awaiting ({state.awaitReason or 'coverage'})", order=10)
            persist_state(state)

    except Exception as exc:
        state.runtimePhase = "failed"
        state.awaitReason = "ready"
        state.awaitDetail = f"drive error: {str(exc)[:120]}"
        append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end",
            capabilityId="driver", kind="think", text="phase_changed: failed", order=10)
        persist_state(state)
        yield {"type": "phase_change", "phase": "failed", "detail": state.awaitDetail}

    persist_state(state)

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
        state.publishClosure = publish_closure
        state.skillRuntimeGraph = skill_graph
        state.lastTurnId = f"turn-stream-{loop}-drive-full"
        persist_state(state)
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
