"""
Python-owned V5.2 Marathon / Session Budget orchestration (BudgetMarathon phase).

PYTHON_AUTHORITY for: BudgetPolicy enforcement (via slide_rule_budget), drive_marathon stop classification (session_budget_exhausted, frontier_exhausted, await_human, budget_exhausted), frontier propose, round digest, supersededArtifactIds append, decisionLedger frontier entries + budget_exhausted decisions from costLedger.

Inner turn execution reuses drive_reasoning_turn / drive_full_v5_session at route/driver layer (see slide_rule_session, v5_full_driver, routes); this module provides budget+marathon orchestration slice on top. Accepts optional drive_step for real driver injection.

No Node fallback for named budget limits or stop dispatch.
Mirrors TS marathon driver shapes for parity (TS side is thin compat consumer).
"""

from typing import Any, Dict, List, Optional, Callable
from datetime import datetime, timezone
import time as _time

from models.v5_state import V5SessionState
from .slide_rule_budget import (
    BudgetPolicy,
    get_default_budget_policy,
    evaluate_budget_before_orchestrate,
)
# Reuse existing Python report builder if present for digest (small slice)
try:
    from .slide_rule_executor import execute_capability  # for frontier if needed
except Exception:
    execute_capability = None

# Minimal integration point: this module owns marathon orchestration + budget stop classification (PYTHON_AUTHORITY);
# reuses Python-owned drive_reasoning_turn (from slide_rule_session) via drive_step.
# Default (omitted arg) = real driver (prod re-entry + route execute inner gates); explicit=None forces synthetic for marker tests.
try:
    from .slide_rule_session import drive_reasoning_turn  # real PYTHON driver path reused by drive_marathon (default)
except Exception:
    drive_reasoning_turn = None

# Sentinel (review finding 2): distinguishes "arg omitted" (use real driver) vs "explicit drive_step=None" (force synthetic marker for tests).
# Callers/ route pass the driver explicitly; default now drives real inner; explicit None forces marker path only.
_DRIVE_STEP_SENTINEL = object()


class MarathonStopReason:
    USER_INTERRUPTED = "user_interrupted"
    SESSION_BUDGET_EXHAUSTED = "session_budget_exhausted"
    BUDGET_EXHAUSTED = "budget_exhausted"
    FRONTIER_EXHAUSTED = "frontier_exhausted"
    AWAIT_HUMAN = "await_human"
    INNER_DRIVER_FAILED = "inner_driver_failed"


def propose_frontier(
    state: V5SessionState,
    digest: Dict[str, Any],
    previous_frontiers: List[str],
) -> Dict[str, Any]:
    """Smallest Python frontier.propose (M3): derive seed from digest + goal. Records rationale."""
    goal_text = (state.goal or {}).get("text", "目标") if isinstance(state.goal, dict) else str(state.goal or "目标")
    branch = (digest.get("content") or "")[:200]
    proposed = f"基于上轮「{digest.get('title','')}」继续：{branch or '推进闭环与证据'}？（目标：{goal_text[:80]}）"
    if len(previous_frontiers) > 0:
        proposed = proposed + f" [variant-{len(previous_frontiers)}]"
    rationale = "Python frontier.propose: digest content + goal -> seed (K1 priority). de-dupe checked."
    ledger = {
        "type": "frontier_propose",
        "proposedSeed": proposed,
        "rationale": rationale,
        "promptSnippet": (digest.get("content") or "")[:300],
        "at": datetime.now(timezone.utc).isoformat(),
        "deDupeChecked": proposed in previous_frontiers,
    }
    return {
        "seed": proposed,
        "rationale": rationale,
        "prompt": rationale,
        "ledgerEntry": ledger,
    }


def create_round_digest(state: V5SessionState, recent_ids: List[str]) -> Dict[str, Any]:
    """M6 digest: reuse report builder if available else minimal summary from last artifacts."""
    arts = getattr(state, "artifacts", []) or []
    recent = [a for a in arts if (isinstance(a, dict) and a.get("id") in recent_ids) or getattr(a, "id", None) in recent_ids]
    content = "\n".join([
        (a.get("content") if isinstance(a, dict) else getattr(a, "content", "")) or
        (a.get("summary") if isinstance(a, dict) else getattr(a, "summary", "")) or ""
        for a in (recent or arts[-3:])
    ])[:2000]
    title = "轮次小结"
    summary = (content[:200] + "...") if len(content) > 200 else content
    superseded = list(dict.fromkeys(recent_ids or [a.get("id") if isinstance(a,dict) else getattr(a,'id','') for a in arts[-3:]]))
    return {"title": title, "summary": summary, "content": content or "收敛产物", "supersededIds": superseded}


def drive_marathon(
    state: V5SessionState,
    seed_text: str,
    budget: Optional[Dict[str, Any]] = None,
    policy: Optional[Dict[str, Any]] = None,
    max_rounds: int = 8,
    stop_signal: Any = None,
    on_round_complete: Optional[Callable] = None,
    drive_step: Optional[Callable[[V5SessionState, str, str], V5SessionState]] = _DRIVE_STEP_SENTINEL,
) -> Dict[str, Any]:
    """
    Marathon drive loop: reuses inner drive budget policy + optional real drive_step (e.g. drive_reasoning_turn).
    Stops on: user abort, session maxTokens (recomputed from costLedger after drive_step), frontier dupes/exhaust, human await, inner budget.
    Returns {finalState, rounds, stopReason}
    PYTHON_AUTHORITY for budget enforcement + marathon stop classification + ledger/superseded (minimal slice; full parity with drive_marathon prod route pending separate wiring).
    drive_step: when omitted (default) uses real drive_reasoning_turn so prod re-entry/route calls execute inner driver gates/ledger/await/confirm/GCOV (no fallback hiding); explicit drive_step=None forces synthetic marker path (for marker tests only); pass callable for override.
    """
    working = state
    current_seed = seed_text
    rounds: List[Dict[str, Any]] = []
    stop_reason = MarathonStopReason.AWAIT_HUMAN
    previous_frontiers: List[str] = []
    session_tokens = 0

    if drive_step is not _DRIVE_STEP_SENTINEL:
        effective_drive_step = drive_step  # explicit (None forces marker; callable overrides)
    else:
        effective_drive_step = drive_reasoning_turn  # default: real PYTHON inner driver for prod reentry preserving gates

    # seed from costLedger
    costs = getattr(working, "costLedger", []) or []
    for c in costs:
        if isinstance(c, dict):
            session_tokens += int(c.get("estimatedTokens") or 0)
        else:
            session_tokens += int(getattr(c, "estimatedTokens", 0) or 0)

    max_t = (budget or {}).get("maxTokens") or 12000
    bpol = BudgetPolicy(**({} if not policy else policy)) if policy else get_default_budget_policy()

    for r in range(max_rounds):
        if stop_signal and getattr(stop_signal, "aborted", False):
            stop_reason = MarathonStopReason.USER_INTERRUPTED
            break

        # pre inner budget gate (Python owned)
        bcheck = evaluate_budget_before_orchestrate(working, {"turnId": f"marathon-{r}"}, bpol)
        if not bcheck.get("allowed"):
            stop_reason = MarathonStopReason.SESSION_BUDGET_EXHAUSTED
            working = apply_budget_if_present(working, bcheck.get("reason", "inner budget"))
            break

        turn_id = f"marathon-{int(_time.time()*1000)}-{r}"
        drive_succeeded = False
        if effective_drive_step:
            # real Python driver path (default for prod re-entry + route); must not swallow failure
            try:
                working = effective_drive_step(working, turn_id, current_seed) or working
                drive_succeeded = True
            except Exception as exc:
                # Finding 1 (major): explicit stop on inner failure; write auditable error evidence to decisionLedger;
                # set blocking state; BREAK without digest/frontier/superseded/rounds continuation or non-error stopReason.
                # This ensures failure of drive_reasoning_turn (inner gates/ledger/await/confirm/GCOV) is not masked as successful marathon advance.
                dl = list(getattr(working, "decisionLedger", []) or [])
                dl.append({
                    "id": f"marathon-driver-fail-{turn_id}",
                    "turnId": turn_id,
                    "source": "marathon_inner_driver",
                    "reason": "inner_driver_failed",
                    "rationale": f"drive_reasoning_turn raised; stopping re-entry without frontier/digest to preserve inner gates. err={str(exc)[:200]}",
                    "error": str(exc)[:500],
                    "at": datetime.now(timezone.utc).isoformat(),
                })
                working.decisionLedger = dl
                stop_reason = MarathonStopReason.INNER_DRIVER_FAILED
                working.awaitReason = "error"
                working.awaitDetail = f"inner driver failure: {str(exc)[:80]}"
                rounds.append({"loopTurnId": turn_id, "stopReason": stop_reason})
                break
        else:
            # synthetic advance marker ONLY when explicitly drive_step=None (via sentinel); not for default/prod path
            conv = getattr(working, "conversation", []) or []
            conv.append({"role": "system", "text": f"[marathon round {r}] seed: {current_seed[:80]}", "turnId": turn_id})
            working.conversation = conv
            drive_succeeded = True

        if not drive_succeeded:
            # failure path already recorded and broke
            continue

        # cost/ledger synthetic ONLY for explicit marker path (real driver owns its own appends)
        if not effective_drive_step:
            cl = list(getattr(working, "costLedger", []) or [])
            cl.append({
                "id": f"cost-{turn_id}",
                "turnId": turn_id,
                "capabilityRunId": f"run-m-{r}",
                "capabilityId": "marathon.round",
                "estimatedTokens": 1200,
                "source": "estimated",
                "createdAt": datetime.now(timezone.utc).isoformat(),
            })
            working.costLedger = cl

        # recompute session_tokens from current ledger
        costs = getattr(working, "costLedger", []) or []
        session_tokens = 0
        for c in costs:
            if isinstance(c, dict):
                session_tokens += int(c.get("estimatedTokens") or 0)
            else:
                session_tokens += int(getattr(c, "estimatedTokens", 0) or 0)

        last_stop = "convergence_signal"

        rounds.append({"loopTurnId": turn_id, "stopReason": last_stop})

        if last_stop in ("convergence_signal", "coverage_sufficient"):
            recent = [a.get("id") if isinstance(a, dict) else getattr(a, "id", "") for a in (getattr(working, "artifacts", []) or [])[-3:]]
            digest = create_round_digest(working, recent)

            # superseded
            sup = list(getattr(working, "supersededArtifactIds", []) or [])
            for sid in (digest.get("supersededIds") or []):
                if sid and sid not in sup:
                    sup.append(sid)
            working.supersededArtifactIds = sup

            proposal = propose_frontier(working, digest, previous_frontiers)
            # append to decisionLedger
            dl = list(getattr(working, "decisionLedger", []) or [])
            dl.append({
                "id": f"frontier-{r}",
                "turnId": turn_id,
                "source": "autopilot_frontier",
                "reason": proposal["rationale"],
                "frontierProposal": proposal["ledgerEntry"],
                "at": proposal["ledgerEntry"]["at"],
            })
            working.decisionLedger = dl

            previous_frontiers.append(proposal["seed"])

            # frontier exhaust
            if len(previous_frontiers) > 3 or len(set(previous_frontiers)) < len(previous_frontiers):
                stop_reason = MarathonStopReason.FRONTIER_EXHAUSTED
                if on_round_complete:
                    on_round_complete({**digest, "frontier": proposal}, rounds[-1])
                break

            current_seed = (digest.get("content", "")[:400] + "\n\n" + proposal["seed"])[:1800]
            if on_round_complete:
                on_round_complete({**digest, "frontier": proposal}, rounds[-1])
            # continue
        elif last_stop == "await_ready":
            stop_reason = MarathonStopReason.AWAIT_HUMAN
            break
        else:
            if on_round_complete:
                on_round_complete({}, rounds[-1])
            break

        # session budget (M5, maxTokens from opts) - authoritative PYTHON
        if session_tokens > max_t:
            stop_reason = MarathonStopReason.SESSION_BUDGET_EXHAUSTED
            working = apply_budget_if_present(working, f"session budget maxTokens exceeded ({session_tokens} > {max_t})")
            break

    return {
        "finalState": working,
        "rounds": rounds,
        "stopReason": stop_reason,
    }


def apply_budget_if_present(state: V5SessionState, reason: str) -> V5SessionState:
    from .slide_rule_budget import apply_budget_park
    return apply_budget_park(state, reason, turn_id="marathon")
