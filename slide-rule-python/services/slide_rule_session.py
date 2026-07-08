"""
Session management for V5, ported from Node's memory/session-store.ts, sliderule/session-driver.ts, mini-session.ts.

Provides create, load, save, drive loop using stable Python RAG for evidence instead of Node LLM.
"""

from typing import Dict, Any, Optional
from models.v5_state import Artifact, CapabilityRun, ProducedBy, V5SessionState, DependencyEdge, SlideRuleReplayEvent, ReasoningEvent, UserIntervention
from datetime import datetime, timezone
from .slide_rule_orchestrator import orchestrate_plan
from .slide_rule_executor import execute_capability
from .persistence import delete_session_record, load_all, load_session_record, save_session_record
from .slide_rule_coverage import evaluate_coverage_gate
from .slide_rule_interactive_gates import (
    open_human_question_gap_count,
    user_clears_readiness,
    evaluate_interactive_gate_after_commit,
    apply_resolve_and_clear_readiness,
    apply_route_selection_resolution,
    user_picks_route,
    user_rejects_route_selection,
    gaps_from_gap_ask_content,
    merge_gap_ask_into_state,
    apply_user_intervention_invalidation,
    set_await_for_browser,
)

_sessions: Dict[str, V5SessionState] = {}

def _load_sessions():
    global _sessions
    _sessions = load_all()
    return _sessions

# 注意：这里刻意没有"整体 dump 内存缓存到存档"的函数。历史上 create_session
# 调 save_all(_sessions) 整体覆写存档文件——当缓存在别的写入者之后变陈旧时，
# 一次 create 就会把其他会话从磁盘上抹掉（实测踩过：真实话题跨重启失忆的
# 元凶之一）。一切落盘必须走 save_session_record 的单条守卫式合并。

def create_session(goal_text: str, session_id: Optional[str] = None) -> V5SessionState:
    if not session_id:
        session_id = f"sr-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    state = V5SessionState(
        sessionId=session_id,
        goal={"text": goal_text, "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        runtimePhase="idle"
    )
    _sessions[session_id] = state
    save_session_record(state)  # 单条守卫式写入，绝不整体覆写存档
    return state

def load_session(session_id: str) -> Optional[V5SessionState]:
    if not _sessions:
        _load_sessions()
    cached = _sessions.get(session_id)
    if cached is not None:
        return cached
    result = load_session_record(session_id)
    if result.get("ok"):
        state = result["session"]
        _sessions[session_id] = state
        return state
    return None

def save_session(state: V5SessionState) -> V5SessionState:
    # Delegate guard+merge to persistence (replay append-only + monotonic_key lastTurnId+counts guard).
    # Then ALWAYS reconcile _sessions cache from the persistence authoritative result (load after write).
    # This ensures stale/older state passed to service save NEVER stays in the memory authority cache.
    # load_session will see only the guard-protected newer state; fixes review finding 1.
    # Python service save path now respects the persistence guard final result.
    save_session_record(state)
    rec = load_session_record(state.sessionId)
    if rec.get("ok"):
        final = rec["session"]
        _sessions[state.sessionId] = final
        return final
    # rare persist error: fall back (do not leave caller assuming success)
    _sessions[state.sessionId] = state
    return state

def delete_session(session_id: str):
    _sessions.pop(session_id, None)
    return delete_session_record(session_id)

def drive_reasoning_turn(state: V5SessionState, turn_id: str, user_text: str, intervention: Optional[UserIntervention] = None) -> V5SessionState:
    """Main loop: orchestrate + execute caps using Python RAG for stable evidence.
    Implements V5.2 runtimePhase machine: idle -> orchestrating -> awaiting|failed|done
    (PYTHON_AUTHORITY for driver phase transitions per task).
    """
    state.runtimePhase = "orchestrating"
    state.lastTurnId = turn_id
    # Emit phase change + replay so browser polling returned/persisted state sees orchestrating start (non-frozen)
    append_replay_event(state, kind="decision", turnId=turn_id, decisionId=f"phase-orchestrating-{turn_id}")
    append_reasoning_event(
        state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think",
        text=f"phase_changed: orchestrating (turn {turn_id})", order=0
    )
    # Immediate persist after start emit: makes orchestrating visible to GET /sessions poll BEFORE any cap exec (addresses review: no mid-save -> frozen)
    state = save_session(state)
    # G_READY resolution: on user turn intake, resolve open_question gaps from answer text and clear await if cleared.
    # This is the userClearsReadiness + resolveReadinessGaps path (PYTHON_AUTHORITY).
    state = apply_resolve_and_clear_readiness(state, user_text or "")
    # G_CONFIRM + route selection/reject (PYTHON_AUTHORITY): user pick clears confirm await; reject stales route artifacts and clears (enables re-compare without re-park).
    # Named behaviors (userPicksRoute/userRejectsRouteSelection + state writes) now in Python; no Node fallback.
    state = apply_route_selection_resolution(state, user_text or "")
    # User intervention invalidation + stale cascade (PYTHON_AUTHORITY this task): general UserIntervention support.
    # targetArtifactId/targetNodeId/targetDecisionId trigger target + depGraph downstream cascade into staleArtifactIds (monotonic).
    # Sets state.userIntervention; challenges graph nodes; handles decision ledger. Called unconditionally if provided.
    # Classification: was TS_RUNTIME_OWNED (invalidateForIntervention in runtime) now PYTHON_AUTHORITY in drive.
    # No Node fallback hiding semantics. Route text special-case remains orthogonal.
    state = apply_user_intervention_invalidation(state, intervention)
    try:
        plan_result = orchestrate_plan(state, turn_id, user_text)
        # PYTHON_AUTHORITY pick: explicitly invoke pick_next_capabilities; use its result directly.
        # Empty pick means converge per Python-owned fallback rules; no fallback to plan_result.selected (legacy).
        picks = pick_next_capabilities(state, user_text)
        selected = picks
        state.conversation.append({"role": "user", "text": user_text, "turnId": turn_id})
        state.conversation.append({"role": "system", "text": plan_result.rationale, "turnId": turn_id})
        append_replay_event(state, kind="conversation", turnId=turn_id, conversationId=f"c-{turn_id}")

        for sel in selected:
            cap_id = sel["capabilityId"]
            role = sel.get("roleId", "agent")
            import time as _time
            t0 = _time.time()
            run_id = f"run-{turn_id}-{cap_id}"
            # Emit capability_started for browser-visible progress (reasoningEvents visible in returned state / poll)
            append_reasoning_event(
                state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap_id, kind="capability_start",
                text=f"capability_started: {cap_id}", roleId=role, order=1
            )
            append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=cap_id, capabilityRunId=run_id)
            # Immediate persist after start append, BEFORE execute_capability (long cap exec must not block pollers from seeing start)
            state = save_session(state)
            try:
                # Execute with RAG - always brings evidence, no degraded
                exec_result = execute_capability(cap_id, state, [], role, turn_id)
                # Use Python-owned commitArtifact (artifact, run, gate, dependencyGraph updates)
                art_id = f"art-{turn_id}-{cap_id}"
                produced = ProducedBy(capabilityRunId=run_id, capabilityId=cap_id, roleId=role)
                kind = "evidence" if "evidence" in cap_id or cap_id in ["mcp.call", "skill.invoke"] else "report" if cap_id == "report.write" else "risk"
                exec_res_dump = exec_result.model_dump() if hasattr(exec_result, "model_dump") else {"title": getattr(exec_result, "title", ""), "summary": getattr(exec_result, "summary", ""), "content": getattr(exec_result, "content", ""), "sources": getattr(exec_result, "sources", [])}
                # commit_artifact populates art+run (with computed gateResults) + depGraph + ledger
                art, run = commit_artifact(
                    state,
                    id=art_id,
                    kind=kind,
                    content=getattr(exec_result, "content", ""),
                    summary=getattr(exec_result, "summary", ""),
                    title=getattr(exec_result, "title", None),
                    provenance=getattr(exec_result, "provenance", "python-rag"),
                    producedBy=produced,
                    inputArtifactIds=[],
                    turnId=turn_id,
                    payload={"sources": getattr(exec_result, "sources", [])},
                )
                # attach result + timing to the run
                dur = int((_time.time() - t0) * 1000)
                if hasattr(run, "result"):
                    run.result = exec_res_dump
                else:
                    if isinstance(run, dict):
                        run["result"] = exec_res_dump
                if hasattr(run, "timing"):
                    run.timing = {"startedAt": None, "completedAt": None, "durationMs": dur}
                else:
                    if isinstance(run, dict):
                        run["timing"] = {"durationMs": dur}
                # Emit capability_complete so UI sees completion without waiting full drive end
                append_reasoning_event(
                    state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap_id, kind="capability_complete",
                    text=f"capability_completed: {cap_id}", roleId=role, order=2
                )
                # Persist complete immediately so poll sees cap done before next or drive return
                state = save_session(state)

                # G_READY / interactive gate materialization + park (after clarification caps):
                # gap.ask/intent.clarify content -> open_question gaps; then evaluate gate; if park set awaiting+ready and break.
                # Prevents continuing execution past G_READY (no LLM self-answer). User answer will resolve on next drive.
                if cap_id in ("gap.ask", "intent.clarify", "question.expand"):
                    try:
                        content = getattr(exec_result, "content", "") or ""
                        gfs = gaps_from_gap_ask_content(content, turn_id, art_id)
                        if gfs:
                            merge_gap_ask_into_state(state, gfs)
                    except Exception:
                        pass
                ig = evaluate_interactive_gate_after_commit(state, {"capabilityId": cap_id, "turnUserText": user_text or "", "committed": True})
                if ig.get("park"):
                    # use hardened browser-contract helper (PYTHON slice) to set phase+awaitReason
                    state = set_await_for_browser(state, ig.get("gate") or "ready", ig.get("detail", "readiness gate parked for human answer"))
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think",
                        text=f"phase_changed: awaiting ({getattr(state, 'awaitReason', None) or (state.get('awaitReason') if isinstance(state, dict) else None)}) via G_READY gate", order=9
                    )
                    state = save_session(state)
                    return save_session(state)  # direct early return after G_READY park; skips all subsequent phase decision (prevents awaitReason overwrite to user_input)
            except Exception as cap_exc:
                # Record per-capability error run; preserve prior state (append); do not whole-fail here
                dur = int((_time.time() - t0) * 1000)
                timing = {"durationMs": dur}
                err = {"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": cap_id}
                record_capability_run_error(
                    state,
                    capabilityId=cap_id,
                    turnId=turn_id,
                    error=err,
                    roleId=role,
                    timing=timing,
                )
                append_reasoning_event(
                    state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap_id, kind="capability_complete",
                    text=f"capability_completed: {cap_id} (error)", roleId=role, order=2
                )
                # Persist error complete immediately for poll visibility
                state = save_session(state)
                # surface degraded without hiding: set detail, keep phase decision below use current state
                state.awaitDetail = (state.awaitDetail or "") + f"; degraded cap {cap_id}: {str(cap_exc)[:80]}"
                # do not raise, record keeps it auditable, prior artifacts/runs intact

        # Phase decision: coverage or no more selected -> done or awaiting
        # rely on picks (from pick_next_capabilities) to reflect full fallback/selection rules.
        # Empty picks == converge (no legacy plan fallback).
        # G_READY post-turn: if human questions remain, park ready (authoritative, not user_input).
        # Short-circuit BEFORE coverage/picks decision to prevent else branch overwriting awaitReason to "user_input".
        # This ensures Python-owned G_READY park is preserved (no self-answer past readiness gate).
        if open_human_question_gap_count(state) > 0 and not user_clears_readiness(user_text or "", state):
            # use hardened browser-contract helper so frontend receives awaitReason + phase (no silent drop)
            state = set_await_for_browser(state, "ready", f"{open_human_question_gap_count(state)} open human question(s) after turn; awaiting clarification")
            append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text="phase_changed: awaiting (ready) G_READY", order=10)
            state = save_session(state)
            final = save_session(state)
            return final
        from .slide_rule_coverage import resolve_coverage_gaps_from_state
        state = resolve_coverage_gaps_from_state(state)
        gate = evaluate_coverage_gate(state)
        if gate.get("passed") or (state.goal or {}).get("status") == "clear":
            state.runtimePhase = "done"
            append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text="phase_changed: done", order=10)
            state = save_session(state)
        elif not picks:
            state.runtimePhase = "awaiting"
            state.awaitReason = "convergence"
            state.awaitDetail = "no selected capabilities; converged (pick returned empty)"
            append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text="phase_changed: awaiting (convergence)", order=10)
            state = save_session(state)
        else:
            state.runtimePhase = "awaiting"
            state.awaitReason = "user_input"
            state.awaitDetail = "awaiting further input or coverage"
            append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text="phase_changed: awaiting", order=10)
            state = save_session(state)
    except Exception as exc:
        state.runtimePhase = "failed"
        state.awaitReason = "ready"
        state.awaitDetail = f"error: {str(exc)[:120]}"
        append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text=f"phase_changed: failed - {str(exc)[:60]}", order=10)
        state = save_session(state)
    final = save_session(state)
    return final


# --- Error recovery for capability execution (this task) ---
# Per-capability errors must record CapabilityRun with error/timing (and result if partial),
# preserve prior artifacts/runs/ledgers (append-only, no reset), and surface degraded
# without hiding behind outer failed that drops which cap failed.
# Drivers wrap individual cap execution; non-cap crash can still outer-fail.
# Classification (step 1): before this task PYTHON_COMPAT (outer catch, no per-run error), after PYTHON_AUTHORITY.
# No Node fallback.

def record_capability_run_error(
    state: V5SessionState,
    *,
    capabilityId: str,
    turnId: str,
    error: Dict[str, Any],
    roleId: Optional[str] = None,
    timing: Optional[Dict[str, Any]] = None,
    result: Optional[Dict[str, Any]] = None,
) -> CapabilityRun:
    """Record failed capability execution into capabilityRuns as durable error record.
    Appends only; prior state (artifacts, prior runs, ledgers) left intact.
    Sets no whole-state corruption. Callers decide phase (usually await with degraded detail).
    """
    from datetime import datetime, timezone as _tz
    now_iso = datetime.now(_tz.utc).isoformat()
    t = dict(timing) if timing else {}
    if "startedAt" not in t:
        t["startedAt"] = now_iso
    if "completedAt" not in t:
        t["completedAt"] = now_iso
    run_id = f"run-{turnId}-{capabilityId}"
    run = CapabilityRun(
        id=run_id,
        capabilityId=capabilityId,
        turnId=turnId,
        inputs=[],
        outputs=[],
        gateResults=[{"gateId": "execution", "status": "failed"}],
        result=result,
        roleId=roleId,
        timing=t,
        error=dict(error) if error else {"code": "capability_error", "message": "unknown failure"},
    )
    runs = getattr(state, "capabilityRuns", None) or []
    runs.append(run)
    state.capabilityRuns = runs
    return run


# --- Browser-visible reasoning events + replay exposure (PYTHON_AUTHORITY for this slice) ---
# Smallest append-only helpers so drive can emit phase/capability progress into durable lists.
# UI can poll GET session or use returned drive state to see incremental events (no freeze).
# Uses existing model kinds (capability_start / capability_complete / replay capability_run etc).
# Phase changes surfaced via runtimePhase + replay "decision" + reasoning "think" for phase markers.
# No Node fallback; events appended before/after key steps + on save paths.

def append_reasoning_event(
    state: V5SessionState,
    *,
    turnId: str,
    capabilityRunId: str,
    capabilityId: str,
    kind: str,
    text: str,
    roleId: Optional[str] = None,
    order: Optional[int] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> ReasoningEvent:
    """Append a ReasoningEvent for browser-visible substeps (capability boundaries + think markers)."""
    events = getattr(state, "reasoningEvents", None) or []
    next_order = order if order is not None else (len(events) + 1)
    ts = datetime.now(timezone.utc).isoformat()
    ev = ReasoningEvent(
        id=f"{capabilityRunId}-ev-{next_order}",
        turnId=turnId,
        capabilityRunId=capabilityRunId,
        capabilityId=capabilityId,
        kind=kind,  # e.g. "capability_start", "capability_complete", "think"
        roleId=roleId,
        text=text,
        refs=None,
        meta=meta,
        order=next_order,
        ts=ts,
    )
    events.append(ev)
    state.reasoningEvents = events
    return ev


def append_replay_event(
    state: V5SessionState,
    *,
    kind: str,
    turnId: Optional[str] = None,
    capabilityId: Optional[str] = None,
    capabilityRunId: Optional[str] = None,
    decisionId: Optional[str] = None,
    conversationId: Optional[str] = None,
) -> SlideRuleReplayEvent:
    """Append SlideRuleReplayEvent (capability_run / decision / conversation) for durable replay log."""
    log = getattr(state, "sessionReplayLog", None) or []
    idx = len(log) + 1
    ts = datetime.now(timezone.utc).isoformat()
    ev = SlideRuleReplayEvent(
        id=f"replay-{state.sessionId}-{idx}",
        sessionId=state.sessionId,
        at=ts,
        kind=kind,
        turnId=turnId,
        capabilityId=capabilityId,
        capabilityRunId=capabilityRunId,
        decisionId=decisionId,
        conversationId=conversationId,
    )
    log.append(ev)
    state.sessionReplayLog = log
    return ev


# --- Python-owned pickNextCapabilities port (V5.2 semantics + fallback rules) ---
# Moved into allowed file (slide_rule_session.py) for this task to respect Allowed files boundary.
# Faithful port of readiness short-circuit, delivery/report prefix, structure intent+exclude,
# keyword routes/risk/report/clarify/visual, stale risk, kind progression, openQ, skip-ev,
# cold+final fallbacks, complex/game extras, dedup+cap<=5.
# Drivers explicitly call this (not plan.selected) so empty reliably means converge.
# No Node fallback.

from typing import Any  # ensure for helpers


def _is_healthy_artifact_py(artifact: Any, stales: set) -> bool:
    if isinstance(artifact, dict):
        tl = artifact.get("trustLevel") or artifact.get("trust_level")
        aid = artifact.get("id")
    else:
        tl = getattr(artifact, "trustLevel", None) or getattr(artifact, "trust_level", None)
        aid = getattr(artifact, "id", None)
    healthy = (tl == "gated_pass" or tl == "audited")
    return healthy and (aid not in stales)


def has_structure_decompose_intent(user_text: str) -> bool:
    if not user_text:
        return False
    if any(k in user_text for k in ["结构", "分解", "decompose"]):
        return True
    lower = user_text.lower()
    if any(k in lower for k in ["树", "拆解"]):
        return True
    if "spec tree" in lower or "tree" in lower.split():
        return True
    return False


def _has_spec_tree_artifact(state: V5SessionState) -> bool:
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    for a in (getattr(state, "artifacts", []) or []):
        if _is_healthy_artifact_py(a, stales):
            kind = (a.get("kind") if isinstance(a, dict) else getattr(a, "kind", None))
            if kind == "spec_tree" or kind == "spec tree":
                return True
    return False


def _is_delivery_intent(user_text: str) -> bool:
    if not user_text:
        return False
    text = (user_text or "").lower()
    keys = ["handoff", "deliver", "report", "final", "spec", "prompt", "工程", "交付", "报告", "最终", "提示", "文档"]
    return any(k in text for k in keys)


def _is_visual_intent(user_text: str) -> bool:
    if not user_text:
        return False
    t = user_text.lower()
    return "visual" in t or "mermaid" in t or "预览" in t or "效果" in t or "结构图" in t


def _has_grounded_external_evidence_py(state: V5SessionState) -> bool:
    try:
        from .slide_rule_coverage import has_grounded_external_evidence
        return has_grounded_external_evidence(state)
    except Exception:
        # fallback conservative: has any healthy evidence
        stales = set(getattr(state, "staleArtifactIds", []) or [])
        for a in (getattr(state, "artifacts", []) or []):
            if _is_healthy_artifact_py(a, stales):
                kind = (a.get("kind") if isinstance(a, dict) else getattr(a, "kind", ""))
                if kind == "evidence":
                    return True
        return False


def _recent_ungrounded_attempts_py(state: V5SessionState, n: int = 3) -> int:
    runs = (getattr(state, "capabilityRuns", []) or [])[-n*2:]
    count = 0
    for r in reversed(runs):
        cid = (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", ""))
        if "evidence" in cid or "search" in cid:
            count += 1
            if count >= n:
                break
    if not _has_grounded_external_evidence_py(state):
        return min(len(runs), n)
    return 0


def _find_gh_url(lower: str, goal_text: str) -> Optional[str]:
    text = f"{goal_text or ''} {lower}".lower()
    if "github.com" in text or "gitlab.com" in text:
        return "https://github.com/example/repo"
    return None


def _resolve_role_mode(state: V5SessionState, user_text: str) -> str:
    goal = _goal_text(state)
    t = (goal + " " + (user_text or "")).lower()
    if any(k in t for k in ["rpg", "游戏", "multi-agent", "多agent", "多角色", "复杂", "brainstorm"]):
        return "complex"
    gtext = goal or ""
    if len(gtext) > 80:
        return "complex"
    return "single"


def _should_degrade_brainstorm(state: V5SessionState, user_text: str) -> bool:
    return False


def _pick_brainstorm_primers(state: V5SessionState) -> list:
    return [
        {"capabilityId": "critique.generate", "roleId": "产品"},
        {"capabilityId": "synthesis.merge", "roleId": "综合"},
    ]


def _pick_readiness_chain(state: V5SessionState) -> list:
    picks = []
    oq = open_human_question_gap_count(state) or len(getattr(state, "openQuestions", []) or [])
    if oq > 0 or not (getattr(state, "artifacts", []) or []):
        if {"capabilityId": "gap.ask", "roleId": "产品"} not in picks:
            picks.append({"capabilityId": "gap.ask", "roleId": "产品"})
        picks.append({"capabilityId": "intent.clarify", "roleId": "产品"})
        if not _has_spec_tree_artifact(state):
            picks.append({"capabilityId": "structure.decompose", "roleId": "架构"})
    return picks


def _needs_readiness_chain(state: V5SessionState, user_text: str) -> bool:
    oq = open_human_question_gap_count(state) or len(getattr(state, "openQuestions", []) or [])
    arts = len(getattr(state, "artifacts", []) or [])
    ut = (user_text or "").lower()
    if oq > 0:
        return True
    goal = _goal_text(state)
    vague = (len(goal or "") < 8) or ("模糊" in ut) or ("clarif" in ut) or ("vague" in ut)
    return (oq > 0 or (arts == 0 and vague))


def _goal_text(state: V5SessionState) -> str:
    return state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal)


def pick_next_capabilities(state: V5SessionState, user_text: str) -> list[dict]:
    """Python-owned implementation of pickNextCapabilities with all V5.2 fallback rules."""
    lower = (user_text or "").lower()
    picks: list[dict] = []
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    artifacts = getattr(state, "artifacts", []) or []
    healthy_kinds = set()
    for a in artifacts:
        if _is_healthy_artifact_py(a, stales):
            k = (a.get("kind") if isinstance(a, dict) else getattr(a, "kind", None))
            if k:
                healthy_kinds.add(k)
    has_risk = "risk" in healthy_kinds
    has_synth = "synthesis" in healthy_kinds
    has_report = "report" in healthy_kinds
    stale_count = len(stales)
    cap_runs = getattr(state, "capabilityRuns", []) or []
    recent_runs = [(r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")) for r in cap_runs[-6:]]
    recent_ledger = [(r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")) for r in cap_runs[-4:]]
    open_q_count = open_human_question_gap_count(state) or len(getattr(state, "openQuestions", []) or [])
    ungrounded = _recent_ungrounded_attempts_py(state, 3)
    session_grounded = _has_grounded_external_evidence_py(state)
    should_skip_ev = (not session_grounded and ungrounded >= 2)
    art_count = len([a for a in artifacts if _is_healthy_artifact_py(a, stales)])
    is_cold = art_count == 0 and len(cap_runs) == 0

    role_mode = _resolve_role_mode(state, user_text)

    # readiness short-circuit
    if _needs_readiness_chain(state, user_text):
        rdy = _pick_readiness_chain(state)
        picks = [p for p in rdy if p["capabilityId"] not in [x["capabilityId"] for x in picks]]
        if role_mode == "complex" and not _should_degrade_brainstorm(state, user_text):
            primers = [p for p in _pick_brainstorm_primers(state) if p["capabilityId"] not in [x["capabilityId"] for x in picks]]
            if primers:
                picks = primers + picks
        return picks[:5]

    # delivery after clear
    if _is_delivery_intent(user_text) and (state.goal or {}).get("status") == "clear":
        if not has_report:
            picks.append({"capabilityId": "report.write", "roleId": "综合"})
        if has_structure_decompose_intent(user_text) and not _has_spec_tree_artifact(state):
            picks.append({"capabilityId": "structure.decompose", "roleId": "架构"})
        from .slide_rule_coverage import has_trusted_committed_for_cap as _has_committed
        for cap, role in [
            ("document.draft", "工程"),
            ("traceability.matrix", "综合"),
            ("task.write", "产品"),
            ("instruction.package", "工程"),
            ("outcome.visualize", "架构"),
            ("handoff.package", "工程"),
        ]:
            # 已可信提交的交付能力不重复执行：避免重复产物与无谓的 LLM 调用，
            # 也让 5-cap 限制下多轮"打包交付"能推进到未完成的能力（如 handoff）。
            if _has_committed(state, cap):
                continue
            if not any(p["capabilityId"] == cap for p in picks):
                picks.append({"capabilityId": cap, "roleId": role})
        # unified dedup + cap<=5 (addresses review: delivery branch must not bypass final dedup/out[:5];
        # task+comments declare cap<=5 for all paths; now consistent with readiness/visual/final)
        seen = set()
        out = []
        for p in picks:
            key = f"{p['capabilityId']}:{p.get('roleId','')}"
            if key not in seen:
                seen.add(key)
                out.append(p)
        return out[:5]

    # visual
    if _is_visual_intent(user_text):
        vis = []
        if "mermaid" in lower or "结构图" in lower:
            vis.append({"capabilityId": "outcome.visualize", "roleId": "架构"})
        if vis:
            return vis[:5]

    gh = _find_gh_url(lower, _goal_text(state))
    if gh:
        if not any(p["capabilityId"] == "repo.inspect" for p in picks):
            picks.append({"capabilityId": "repo.inspect", "roleId": "工程"})
        if not should_skip_ev and not any(p["capabilityId"] == "evidence.search" for p in picks):
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})

    if "路线" in lower or "route" in lower or "对比" in lower:
        if not any(p["capabilityId"] == "route.generate" for p in picks):
            picks.append({"capabilityId": "route.generate", "roleId": "架构"})
        if not any(p["capabilityId"] == "route.compare" for p in picks):
            picks.append({"capabilityId": "route.compare", "roleId": "工程"})

    if "澄清" in lower or "clarif" in lower or "模糊" in lower:
        if not any(p["capabilityId"] == "intent.clarify" for p in picks):
            picks.append({"capabilityId": "intent.clarify", "roleId": "产品"})

    if "风险" in lower or "安全" in lower or "反驳" in lower:
        if not any(p["capabilityId"] == "risk.analyze" for p in picks):
            picks.append({"capabilityId": "risk.analyze", "roleId": "安全"})
        if not any(p["capabilityId"] == "counter.argue" for p in picks):
            picks.append({"capabilityId": "counter.argue", "roleId": "挑刺"})

    if has_structure_decompose_intent(user_text) and not _has_spec_tree_artifact(state):
        if not any(p["capabilityId"] == "structure.decompose" for p in picks):
            picks.append({"capabilityId": "structure.decompose", "roleId": "架构"})

    if "报告" in lower or "report" in lower or "可行性" in lower or "总结" in lower:
        if not has_risk:
            picks.append({"capabilityId": "risk.analyze", "roleId": "安全"})
            picks.append({"capabilityId": "counter.argue", "roleId": "挑刺"})
        if not has_synth:
            picks.append({"capabilityId": "synthesis.merge", "roleId": "综合"})
        if not has_report:
            picks.append({"capabilityId": "report.write", "roleId": "综合"})

    if "预览" in lower or "效果" in lower or "preview" in lower:
        if not any(p["capabilityId"] == "scenario.simulate" for p in picks):
            picks.append({"capabilityId": "scenario.simulate", "roleId": "工程"})

    if stale_count > 0:
        if not any("risk" in p["capabilityId"] or "argue" in p["capabilityId"] for p in picks):
            picks.append({"capabilityId": "risk.analyze", "roleId": "安全"})
            picks.append({"capabilityId": "counter.argue", "roleId": "挑刺"})

    if has_risk and not has_synth and not has_report:
        if not any(p["capabilityId"] == "synthesis.merge" for p in picks):
            picks.append({"capabilityId": "synthesis.merge", "roleId": "综合"})

    if has_synth and not has_report:
        if not any(p["capabilityId"] == "report.write" for p in picks):
            picks.append({"capabilityId": "report.write", "roleId": "综合"})

    if open_q_count > 0:
        if not any(p["capabilityId"] == "intent.clarify" for p in picks):
            picks.append({"capabilityId": "intent.clarify", "roleId": "产品"})
        if not _has_spec_tree_artifact(state) and not any(p["capabilityId"] == "structure.decompose" for p in picks):
            picks.append({"capabilityId": "structure.decompose", "roleId": "架构"})

    if stale_count == 0 and not should_skip_ev:
        avoid = set(recent_ledger)
        if len(picks) < 3 and "evidence.search" not in avoid and not any(p["capabilityId"] == "evidence.search" for p in picks):
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})

    if is_cold and len(picks) < 3:
        for cap, role in [("intent.clarify", "产品"), ("route.generate", "架构"), ("risk.analyze", "安全")]:
            if not any(p["capabilityId"] == cap for p in picks):
                picks.append({"capabilityId": cap, "roleId": role})
        if not should_skip_ev and not any(p["capabilityId"] == "evidence.search" for p in picks):
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})

    if len(picks) == 0:
        avoid = set(recent_runs + recent_ledger)
        if "intent.parse" not in avoid:
            picks.append({"capabilityId": "intent.parse", "roleId": "产品"})
        if not should_skip_ev and "evidence.search" not in avoid:
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})
        picks.append({"capabilityId": "synthesis.merge", "roleId": "综合"})

    if len(picks) == 0:
        picks.append({"capabilityId": "intent.parse", "roleId": "产品"})
        if not should_skip_ev:
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})
        picks.append({"capabilityId": "synthesis.merge", "roleId": "综合"})

    if role_mode == "complex" and not _should_degrade_brainstorm(state, user_text):
        primers = [p for p in _pick_brainstorm_primers(state) if not any(x["capabilityId"] == p["capabilityId"] for x in picks)]
        if primers:
            picks = primers + picks

    # contract-driven fill: 合约要求但尚未 trusted-committed 的能力必须被选中，
    # 否则启发式规则漏选（如 critique.generate）会导致 max_repeat_guard 死锁（金链路修复）。
    contract = getattr(state, "coverageContract", None)
    contract_reqs = (
        contract.get("requiredCapabilities") if isinstance(contract, dict)
        else getattr(contract, "requiredCapabilities", None)
    ) or []
    if contract_reqs:
        from .slide_rule_coverage import has_trusted_committed_for_cap
        contract_roles = {
            "critique.generate": "挑刺",
            "risk.analyze": "安全",
            "synthesis.merge": "综合",
            "evidence.search": "接地",
            "report.write": "综合",
        }
        for cap in contract_reqs:
            if cap == "report.write":
                continue  # report 收尾由 has_synth/has_report 规则驱动
            if cap == "evidence.search" and should_skip_ev:
                continue
            if has_trusted_committed_for_cap(state, cap):
                continue
            if not any(p["capabilityId"] == cap for p in picks):
                picks.append({"capabilityId": cap, "roleId": contract_roles.get(cap, "agent")})

    # multi agent game
    goal_game = ((_goal_text(state) or "") + " " + (user_text or "")).lower()
    is_game = any(k in goal_game for k in ["rpg", "游戏", "multi-agent", "多agent", "多角色"])
    if is_game and role_mode == "complex":
        if not any(p["capabilityId"] == "evidence.search" for p in picks):
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})
        for c, r in [("mcp.call", "工程"), ("skill.invoke", "工程"), ("structure.decompose", "架构")]:
            if not any(p["capabilityId"] == c for p in picks):
                picks.append({"capabilityId": c, "roleId": r})

    # dedup + slice
    seen = set()
    out = []
    for p in picks:
        key = f"{p['capabilityId']}:{p.get('roleId','')}"
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out[:5]


# Load on import
_load_sessions()


# --- Python-owned commitArtifact (V5.2) ---
# Smallest slice for this task: implemented inside allowed file slide_rule_session.py to respect boundary (no edit to slide_rule_trust.py).
# Provides artifact + run + gateResults (ground gate from content+producedBy, not unconditional) + depGraph updates + ledger record.
# turnId must be passed by caller (full driver uses loop-N, session uses turn_id); no reliance on unset lastTurnId.
# Classification: PYTHON_COMPAT (bypass) -> PYTHON_AUTHORITY for commit semantics in drivers.
# Do not default to trusted.

from typing import Any as _Any, Dict as _Dict, List as _List, Optional as _Optional  # local aliases to avoid shadowing

def commit_artifact(
    state: V5SessionState,
    *,
    id: str,
    kind: str,
    content: str,
    summary: _Optional[str] = None,
    title: _Optional[str] = None,
    provenance: str = "python-rag",
    producedBy: ProducedBy,
    inputArtifactIds: _Optional[_List[str]] = None,
    sources: _Optional[_List[_Any]] = None,
    payload: _Optional[_Dict[str, _Any]] = None,
    turnId: _Optional[str] = None,
) -> tuple[Artifact, CapabilityRun]:
    """Python-owned commitArtifact: creates artifact + run, evaluates gate(s) to justify trustLevel (ground gate based on content+producedBy), records ledger, updates dependencyGraph for traceability.
    Do not default to trusted: gated_pass only if ground gate passes.
    Drivers must pass explicit turnId for full traceability (loop-N or turn); avoids 't' default.
    """
    # ground gate: justified by server execution provenance + non-empty output (not unconditional)
    has_content = bool((content or "").strip() or (summary or "").strip())
    ground_passed = has_content and producedBy is not None
    ground_result: _Dict[str, _Any] = {"gateId": "ground", "status": "passed" if ground_passed else "failed"}
    trust_level = "gated_pass" if ground_passed else "untrusted"
    passed_gates_list: _List[str] = ["ground"] if ground_passed else []

    art = Artifact.server_construct(
        id=id,
        kind=kind,
        provenance=provenance,
        trustLevel=trust_level,
        title=title,
        summary=summary or "",
        content=content,
        producedBy=producedBy,
        payload=payload or ({"sources": sources or []} if sources else None),
        passedGates=passed_gates_list,
    )

    run_id = producedBy.capabilityRunId
    turn = turnId or getattr(state, "lastTurnId", None) or "t"
    run = CapabilityRun(
        id=run_id,
        capabilityId=producedBy.capabilityId,
        turnId=turn,
        inputs=list(inputArtifactIds or []),
        outputs=[id],
        gateResults=[ground_result],
        roleId=producedBy.roleId,
    )

    # mutate state: artifacts + runs
    arts = getattr(state, "artifacts", None) or []
    arts.append(art)
    state.artifacts = arts
    runs = getattr(state, "capabilityRuns", None) or []
    runs.append(run)
    state.capabilityRuns = runs

    # dependencyGraph updates: maintain traceable relations (inputs -> output; chain for loops)
    dep_graph = getattr(state, "dependencyGraph", None) or []
    ins = inputArtifactIds or []
    for inp in ins:
        dep_graph.append(DependencyEdge(fromArtifactId=inp, toArtifactId=id, reason="input-to-output"))
    if not ins and len(getattr(state, "artifacts", []) or []) > 1:
        # link to prior artifact to ensure depGraph mutates in multi-cap loops (traceability)
        prev = state.artifacts[-2]
        prev_id = getattr(prev, "id", None) or (prev.get("id") if isinstance(prev, dict) else None)
        if prev_id and prev_id != id:
            dep_graph.append(DependencyEdge(fromArtifactId=prev_id, toArtifactId=id, reason="execution-chain"))
    state.dependencyGraph = dep_graph

    # record ledger for provenance/trust (required for has_trusted_committed + coverage)
    try:
        from .slide_rule_trust import record_provenance_and_trust_ledger
        record_provenance_and_trust_ledger(state, art, run)
    except Exception:
        pass

    return art, run
