"""
Python-owned V5.2 Budget Policy for maxTurns, maxRuns (capability runs), maxRepeat, maxTokens.

This slice establishes PYTHON_AUTHORITY for the named budget gate policy.
Mirrors TS BudgetPolicy + evaluateBudgetBeforeOrchestrate (from client/src/lib/sliderule-runtime.ts)
without hiding semantics behind Node. Used by drivers for pre-orchestrate gate and marathon session budget.

Counts derived from capabilityRuns (turn groups, per-cap) + costLedger (tokens).
Budget decisions produce auditable awaitReason="budget", ledger entries (callers append).

Classification per required step 1: PYTHON_AUTHORITY (no Node fallback).
"""

from typing import Optional, Dict, Any, List, Tuple
from pydantic import BaseModel, Field
from datetime import datetime, timezone

from models.v5_state import V5SessionState, CapabilityCostRecord


class BudgetPolicy(BaseModel):
    """V5.2 budget policy (ported from TS getDefaultBudgetPolicy)."""
    maxTurns: int = 30
    maxCapabilityRunsPerTurn: int = 5
    maxCapabilityRunsPerSession: int = 120
    maxRepeatPerCapability: int = 6
    maxTokensPerSession: int = 500_000


class BudgetSnapshot(BaseModel):
    turns: int = 0
    capabilityRuns: int = 0
    perCapRuns: Dict[str, int] = Field(default_factory=dict)
    policy: BudgetPolicy
    allowed: bool = True
    reason: Optional[str] = None
    totalEstimatedTokens: int = 0
    perCapTokens: Dict[str, int] = Field(default_factory=dict)
    costRecordCount: int = 0


def get_default_budget_policy() -> BudgetPolicy:
    return BudgetPolicy()


def _compute_counts(state: V5SessionState) -> Tuple[int, int, Dict[str, int], int, Dict[str, int]]:
    runs: List[Dict[str, Any]] = []
    for r in (getattr(state, "capabilityRuns", None) or []):
        if isinstance(r, dict):
            runs.append(r)
        else:
            runs.append(r.model_dump() if hasattr(r, "model_dump") else {"capabilityId": getattr(r, "capabilityId", ""), "turnId": getattr(r, "turnId", "")})

    turn_ids = {r.get("turnId") for r in runs if r.get("turnId")}
    current_turns = len(turn_ids)
    current_runs = len(runs)

    per_cap: Dict[str, int] = {}
    for r in runs:
        cid = r.get("capabilityId") or ""
        if cid:
            per_cap[cid] = per_cap.get(cid, 0) + 1

    per_turn: Dict[str, int] = {}
    for r in runs:
        tid = r.get("turnId") or ""
        if tid:
            per_turn[tid] = per_turn.get(tid, 0) + 1

    costs: List[Dict[str, Any]] = []
    for c in (getattr(state, "costLedger", None) or []):
        if isinstance(c, dict):
            costs.append(c)
        else:
            costs.append(c.model_dump() if hasattr(c, "model_dump") else {"capabilityId": getattr(c, "capabilityId", ""), "estimatedTokens": getattr(c, "estimatedTokens", 0)})

    total_tokens = sum(int(c.get("estimatedTokens") or 0) for c in costs)

    return current_turns, current_runs, per_cap, total_tokens, per_turn


def evaluate_budget_before_orchestrate(
    state: V5SessionState,
    context: Optional[Dict[str, Any]] = None,
    policy: Optional[BudgetPolicy] = None,
) -> Dict[str, Any]:
    """
    Pre-orchestrate budget gate.
    Returns {allowed, snapshot, reason?} matching TS shape.
    On !allowed, callers should park with awaitReason="budget".
    """
    if policy is None:
        policy = get_default_budget_policy()

    current_turns, current_runs, per_cap, total_tokens, per_turn = _compute_counts(state)

    snapshot = BudgetSnapshot(
        turns=current_turns,
        capabilityRuns=current_runs,
        perCapRuns=per_cap,
        policy=policy,
        totalEstimatedTokens=total_tokens,
        perCapTokens={},  # simple; extend if needed
        costRecordCount=len(getattr(state, "costLedger", []) or []),
    )

    allowed = True
    reason: Optional[str] = None

    this_turn = (context or {}).get("turnId")
    turn_ids = set(per_turn.keys())
    entering_new = 1 if this_turn and this_turn not in turn_ids else 0
    if current_turns + entering_new > policy.maxTurns:
        allowed = False
        reason = f"maxTurns exceeded (current {current_turns}+{entering_new} > {policy.maxTurns})"

    if current_runs >= policy.maxCapabilityRunsPerSession:
        allowed = False
        reason = reason or f"maxCapabilityRunsPerSession exceeded ({current_runs} >= {policy.maxCapabilityRunsPerSession})"

    repeat_hit = next(((k, v) for k, v in per_cap.items() if v >= policy.maxRepeatPerCapability), None)
    if repeat_hit:
        allowed = False
        reason = reason or f"maxRepeatPerCapability for {repeat_hit[0]} ({repeat_hit[1]} >= {policy.maxRepeatPerCapability})"

    if total_tokens >= policy.maxTokensPerSession:
        allowed = False
        reason = reason or f"maxTokensPerSession exceeded ({total_tokens} >= {policy.maxTokensPerSession})"

    # maxCapabilityRunsPerTurn enforcement (PYTHON_AUTHORITY hard boundary per turnId)
    if this_turn:
        in_turn = per_turn.get(this_turn, 0)
        if in_turn >= policy.maxCapabilityRunsPerTurn:
            allowed = False
            reason = reason or f"maxCapabilityRunsPerTurn exceeded for {this_turn} ({in_turn} >= {policy.maxCapabilityRunsPerTurn})"

    snapshot.allowed = allowed
    snapshot.reason = reason

    return {
        "allowed": allowed,
        "snapshot": snapshot.model_dump(),
        "reason": reason,
    }


def apply_budget_park(state: V5SessionState, reason: str, turn_id: str = "budget") -> V5SessionState:
    """Helper: park state at budget await (PYTHON_AUTHORITY)."""
    state.runtimePhase = "awaiting"
    state.awaitReason = "budget"
    state.awaitDetail = reason or "budget policy limit"
    # ensure cost record for audit
    now = datetime.now(timezone.utc).isoformat()
    # append minimal cost record for the gate itself (idempotent best effort)
    cl = list(getattr(state, "costLedger", []) or [])
    cl.append(CapabilityCostRecord(
        id=f"{turn_id}-budget-gate",
        turnId=turn_id,
        capabilityRunId=f"budget-gate-{turn_id}",
        capabilityId="budget.gate",
        estimatedTokens=0,
        source="estimated",
        createdAt=now,
    ))
    state.costLedger = cl
    return state
