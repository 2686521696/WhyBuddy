"""
Python port of G_READY + G_CONFIRM / route selection / reject route + user intervention invalidation and stale cascade.

Port of shared/blueprint/sliderule-interactive-gates.ts slices for interactive gates (P0 V5.1/V5.2).
Pure functions + minimal state mutators.

Classification:
  G_READY (prior): TS_RUNTIME_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
  G_CONFIRM + route selection/reject (prev): TS_RUNTIME_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
  user intervention invalidation + stale cascade (this task): TS_RUNTIME_OWNED (client runtime invalidateForIntervention + intake) -> PYTHON_AUTHORITY (general targetArtifactId/targetNodeId/targetDecisionId + depGraph cascade walk for all three including decision->artifacts + monotonic stale union + node challenge + set userIntervention + drive integration)
Python owns the general UserIntervention invalidation, target+downstream stale via dependencyGraph cascade, related state/ledger semantics. Route reject remains special text case. No Node fallback hiding. Direct pytest + mojibake.

Smallest slice added: invalidate_for_intervention (target + cascade + union), apply_user_intervention_invalidation, drive param+call; focused intervention tests.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime

from models.v5_state import V5SessionState, CoverageGap, UserIntervention, DependencyEdge


READINESS_CLARIFICATION_CAPS = {"question.expand", "gap.ask", "intent.clarify"}


def _get_attr(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _get_list(state: Any, key: str) -> List[Any]:
    val = _get_attr(state, key, []) or []
    return list(val)


def is_vague_goal(goal_text: str) -> bool:
    t = (goal_text or "").strip()
    if not t:
        return True
    import re
    if re.match(r"^(做一个|做个|搞一个|设计一个|开发一个).{0,12}(系统|工具|产品|方案|平台)?[。.]?$", t):
        return True
    if len(t) < 10 and not re.search(r"权限|RBAC|企业|用户|数据|安全|审计|合规", t):
        return True
    return False


def open_blocking_gap_count(state: Any) -> int:
    contract = _get_attr(state, "coverageContract") or {}
    blocking = set(_get_attr(contract, "blockingGapIds", []) or [])
    gaps = _get_list(state, "coverageGaps")
    return sum(
        1
        for g in gaps
        if _get_attr(g, "status") == "open" and (len(blocking) == 0 or _get_attr(g, "id") in blocking)
    )


def open_human_question_gap_count(state: Any) -> int:
    """Open questions that require human answer (open_question kind). Core for G_READY."""
    contract = _get_attr(state, "coverageContract") or {}
    blocking = set(_get_attr(contract, "blockingGapIds", []) or [])
    gaps = _get_list(state, "coverageGaps")
    return sum(
        1
        for g in gaps
        if _get_attr(g, "status") == "open"
        and _get_attr(g, "kind") == "open_question"
        and (len(blocking) == 0 or _get_attr(g, "id") in blocking)
    )


def user_clears_readiness(user_text: str, state: Any) -> bool:
    t = (user_text or "").strip()
    if len(t) < 14:
        return False
    import re
    if re.search(r"面向|RBAC|权限|用户群|场景|企业|内部|范围|约束|目标|受众|部署|合规|边界|补充|明确", t):
        return True
    return open_human_question_gap_count(state) == 0 and len(t) >= 18


def user_picks_route(user_text: str) -> bool:
    """User explicitly picks a route branch (port of TS userPicksRoute for G_CONFIRM)."""
    t = (user_text or "").strip()
    if not t:
        return False
    import re
    return bool(re.search(r"选(择)?\s*方案|方案\s*[ABCabc123一二三四]|路线\s*[ABCabc12]|选\s*[ABCabc12]|采用|就用|倾向", t))


def user_rejects_route_selection(user_text: str) -> bool:
    """User rejects compared routes and asks to regenerate (port of TS; triggers stale + re-compare)."""
    t = (user_text or "").strip()
    if not t:
        return False
    import re
    return bool(re.search(r"都不行|重新(出|生成|对比)|退回|换一(条|种)|不满意", t))


def user_expresses_route_selection(user_text: str) -> bool:
    """Picks or rejects (used to clear G_CONFIRM park and prevent re-park on re-compare turn)."""
    return user_picks_route(user_text) or user_rejects_route_selection(user_text)


def evaluate_readiness_gate_after_commit(
    state: Any, ctx: Dict[str, Any]
) -> Dict[str, Any]:
    cap_id = ctx.get("capabilityId") or ""
    if cap_id not in READINESS_CLARIFICATION_CAPS:
        return {"park": False}
    open_q = open_human_question_gap_count(state)
    if open_q == 0:
        return {"park": False}
    user_text = ctx.get("turnUserText") or ctx.get("userText", "")
    if user_clears_readiness(user_text, state):
        return {"park": False}
    return {
        "park": True,
        "gate": "ready",
        "detail": f"{open_q} 项待回答问题 · 补充后经 INTAKE 续跑",
    }


def evaluate_confirm_gate_after_commit(state: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    if ctx.get("capabilityId") != "route.compare":
        return {"park": False}
    user_text = ctx.get("turnUserText") or ctx.get("userText", "")
    if user_expresses_route_selection(user_text):
        return {"park": False}
    arts = _get_list(state, "artifacts")
    has_route = any(
        _get_attr(_get_attr(a, "producedBy", {}) or {}, "capabilityId") in ("route.generate", "route.compare")
        for a in arts
    )
    if not has_route:
        return {"park": False}
    return {
        "park": True,
        "gate": "confirm",
        "detail": "路线已对比 · 请选择方案或说明调整方向（禁止 LLM 代答确认）",
    }


def evaluate_interactive_gate_after_commit(
    state: Any, ctx: Dict[str, Any]
) -> Dict[str, Any]:
    if not ctx.get("committed"):
        return {"park": False}
    confirm = evaluate_confirm_gate_after_commit(state, ctx)
    if confirm.get("park"):
        return confirm
    return evaluate_readiness_gate_after_commit(state, ctx)


# --- Resolve helpers (port from sliderule-readiness-chain.ts) ---

def resolve_readiness_gaps_from_user_text(state: Any, user_text: str) -> Any:
    if not user_clears_readiness(user_text, state):
        return state
    now = datetime.now().isoformat()
    gaps = _get_list(state, "coverageGaps")
    changed = False
    new_gaps: List[Any] = []
    for g in gaps:
        if _get_attr(g, "status") == "open" and _get_attr(g, "kind") == "open_question":
            changed = True
            if isinstance(g, dict):
                ng = {**g, "status": "resolved", "updatedAt": now}
            else:
                ng = g.model_copy(update={"status": "resolved", "updatedAt": now}) if hasattr(g, "model_copy") else g
                if hasattr(ng, "status"):
                    ng.status = "resolved"
            new_gaps.append(ng)
        else:
            new_gaps.append(g)
    if changed:
        state.coverageGaps = new_gaps
    return state


def resolve_readiness_gaps_by_ids(state: Any, answered_gap_ids: List[str]) -> Any:
    if not answered_gap_ids:
        return state
    target = set(answered_gap_ids)
    now = datetime.now().isoformat()
    gaps = _get_list(state, "coverageGaps")
    changed = False
    new_gaps: List[Any] = []
    for g in gaps:
        gid = _get_attr(g, "id")
        if _get_attr(g, "status") == "open" and _get_attr(g, "kind") == "open_question" and gid in target:
            changed = True
            if isinstance(g, dict):
                ng = {**g, "status": "resolved", "updatedAt": now}
            else:
                ng = g.model_copy(update={"status": "resolved", "updatedAt": now}) if hasattr(g, "model_copy") else g
                if hasattr(ng, "status"):
                    ng.status = "resolved"
            new_gaps.append(ng)
        else:
            new_gaps.append(g)
    if changed:
        state.coverageGaps = new_gaps
    return state


# --- Small gap materialization from gap.ask content (to feed G_READY) ---

def _extract_blocking_questions(content: str) -> List[str]:
    lines = [l.strip() for l in (content or "").splitlines() if l.strip()]
    out: List[str] = []
    import re
    for line in lines:
        if re.match(r"^[-*•]\s+", line) and ("?" in line or "？" in line):
            out.append(re.sub(r"^[-*•]\s+", "", line)[:200])
        elif re.match(r"^\d+[.)]\s+", line) and ("?" in line or "？" in line):
            out.append(re.sub(r"^\d+[.)]\s+", "", line)[:200])
        elif re.match(r"^【.+问题", line) or re.match(r"^问题\s*\d", line):
            out.append(line[:200])
    if not out and (content or "").strip():
        out.append((content or "").strip()[:200])
    return out[:5]


def gaps_from_gap_ask_content(content: str, turn_id: str, artifact_id: str) -> List[Dict[str, Any]]:
    now = datetime.now().isoformat()
    questions = _extract_blocking_questions(content)
    return [
        {
            "id": f"gap-q-{turn_id}-{i}",
            "kind": "open_question",
            "label": q,
            "status": "open",
            "reason": f"gap.ask artifact {artifact_id}",
            "createdAt": now,
        }
        for i, q in enumerate(questions)
    ]


def merge_gap_ask_into_state(state: Any, gaps: List[Dict[str, Any]]) -> Any:
    if not gaps:
        return state
    existing = _get_list(state, "coverageGaps")
    contract = _get_attr(state, "coverageContract") or {}
    merged = list(existing)
    new_ids = []
    for g in gaps:
        if not any(_get_attr(x, "id") == g["id"] for x in merged):
            merged.append(g)
            new_ids.append(g["id"])
    blocking = set(_get_attr(contract, "blockingGapIds", []) or [])
    for nid in new_ids:
        blocking.add(nid)
    if new_ids:
        if isinstance(contract, dict) or contract is None:
            contract = {**(contract or {}), "blockingGapIds": list(blocking)}
            # A partial contract dict (e.g. seeded here from None/{}) must still round-trip
            # through V5SessionState.server_load on persistence read-back — CoverageContract
            # requires id + requiredCapabilities, so a bare {"blockingGapIds": [...]} would
            # corrupt the durable store (store_corrupt/invalid_session on every later read).
            contract.setdefault("id", f"cov-gap-ask-{_get_attr(state, 'lastTurnId', None) or 'seed'}")
            contract.setdefault("requiredCapabilities", [])
            state.coverageContract = contract
        else:
            # model
            try:
                if hasattr(contract, "blockingGapIds"):
                    contract.blockingGapIds = list(blocking)
            except Exception:
                pass
        state.coverageGaps = merged
    return state


def apply_resolve_and_clear_readiness(state: Any, user_text: str) -> Any:
    """INTAKE entry: resolve by text + clear awaitReason when cleared."""
    state = resolve_readiness_gaps_from_user_text(state, user_text)
    if _get_attr(state, "awaitReason") == "ready":
        if open_human_question_gap_count(state) == 0 or user_clears_readiness(user_text, state):
            state.awaitReason = None
            state.awaitDetail = None
    return state


def apply_route_selection_resolution(state: Any, user_text: str) -> Any:
    """INTAKE for G_CONFIRM route: on pick clear await; on reject stale the route.* artifacts (gen/compare or kind=route_options) then clear await so re-pick/rerun happens without re-parking."""
    if _get_attr(state, "awaitReason") != "confirm":
        return state
    if user_rejects_route_selection(user_text):
        stale = set(_get_list(state, "staleArtifactIds") or [])
        for a in _get_list(state, "artifacts") or []:
            pb = _get_attr(a, "producedBy", {}) or {}
            pid = _get_attr(pb, "capabilityId", "") or ""
            kind = ( _get_attr(a, "kind", "") or "" ).lower()
            if "route" in pid or kind == "route_options" or pid in ("route.generate", "route.compare"):
                aid = _get_attr(a, "id")
                if aid:
                    stale.add(aid)
        # preserve list type
        if hasattr(state, "staleArtifactIds"):
            state.staleArtifactIds = list(stale)
        else:
            state["staleArtifactIds"] = list(stale) if isinstance(state, dict) else list(stale)
        state.awaitReason = None
        state.awaitDetail = None
    elif user_picks_route(user_text):
        state.awaitReason = None
        state.awaitDetail = None
    return state


def _resolve_artifacts_for_node(state: Any, node_id: str) -> List[str]:
    """Resolve targetNodeId to its produced artifact id(s).
    Prefer node.producedArtifactId; else match node.capabilityRunId / producedRunId to artifact.producedBy.capabilityRunId.
    Returns list of artifact ids (never node id). Used to seed depGraph cascade for targetNodeId interventions.
    """
    if not node_id:
        return []
    graph = _get_attr(state, "graph") or {}
    nodes = list(_get_attr(graph, "nodes") or [])
    target_node = None
    for n in nodes:
        if _get_attr(n, "id") == node_id:
            target_node = n
            break
    if not target_node:
        return []
    # explicit producedArtifactId on node (enriched binding)
    prod = _get_attr(target_node, "producedArtifactId")
    if prod:
        return [prod]
    # resolve via run id
    n_run = _get_attr(target_node, "capabilityRunId") or _get_attr(target_node, "producedRunId")
    if n_run:
        arts = _get_list(state, "artifacts") or []
        matches = []
        for a in arts:
            pb = _get_attr(a, "producedBy") or {}
            if _get_attr(pb, "capabilityRunId") == n_run:
                aid = _get_attr(a, "id")
                if aid:
                    matches.append(aid)
        return matches
    return []


def _resolve_artifacts_for_decision(state: Any, decision_id: str) -> List[str]:
    """Resolve targetDecisionId to its affected artifact id(s) via turn/chose.
    Matches capabilityRuns by turnId -> outputs, or artifacts via producedBy run prefix / chose capIds.
    Returns artifact ids only (never decision id). Used to seed depGraph cascade for decision interventions
    so that targetDecisionId triggers the same target+downstream stale semantics as artifact/node targets.
    """
    if not decision_id:
        return []
    ledger = _get_list(state, "decisionLedger") or []
    dec = None
    for d in ledger:
        if _get_attr(d, "id") == decision_id:
            dec = d
            break
    if not dec:
        return []
    turn = _get_attr(dec, "turnId") or ""
    chose = _get_attr(dec, "chose") or []
    matches: List[str] = []
    # Primary: runs whose turnId matches the decision's turn -> their output artifacts
    runs = _get_list(state, "capabilityRuns") or []
    for r in runs:
        if turn and _get_attr(r, "turnId") == turn:
            outs = _get_attr(r, "outputs") or []
            for o in outs:
                if o and o not in matches:
                    matches.append(o)
    # Fallback: artifacts produced in turn-ish or by chose capabilities
    if not matches:
        arts = _get_list(state, "artifacts") or []
        for a in arts:
            pb = _get_attr(a, "producedBy") or {}
            runid = _get_attr(pb, "capabilityRunId") or ""
            capid = _get_attr(pb, "capabilityId") or ""
            if (turn and runid.startswith(turn)) or (capid in chose):
                aid = _get_attr(a, "id")
                if aid and aid not in matches:
                    matches.append(aid)
    return matches


# --- User intervention invalidation + stale cascade (PYTHON_AUTHORITY for this task) ---
# Implements general handling for UserIntervention (targetArtifactId / targetNodeId / targetDecisionId + intent/text)
# using dependencyGraph for downstream cascade. Monotonic union into staleArtifactIds (never shrink here).
# Marks affected graph nodes challenged; records userIntervention; handles decision ledger challenge.
# targetDecisionId resolves to artifacts (via _resolve_artifacts_for_decision) then participates in full depGraph cascade.
# Smallest slice: port core of TS invalidateForIntervention without extras.
# Classification: TS_RUNTIME_OWNED -> PYTHON_AUTHORITY (this task); called from drive on intake.
# No Node fallback; Python owns the invalidation + cascade behavior for V5.2 re-entry.

def invalidate_for_intervention(state: Any, intervention: Any) -> Any:
    """Core cascade: target + downstream via depGraph -> union staleArtifactIds; mark nodes; set intervention.
    Supports general targetArtifactId / targetNodeId / targetDecisionId (universal invalidation semantics).
    targetDecisionId: resolve via decision.turnId/chose to produced artifacts then full cascade (not ledger-only).
    For targetNodeId: resolve to produced artifact id(s) via producedArtifactId or capabilityRunId match;
    seed depGraph cascade with *artifact ids only* (never write node id to staleArtifactIds); mark the target node + downstream by run.
    """
    if not intervention:
        return state
    if hasattr(intervention, "model_dump"):
        interv = intervention.model_dump()
    elif isinstance(intervention, dict):
        interv = intervention
    else:
        return state

    target_artifact_id = interv.get("targetArtifactId")
    target_node_id = interv.get("targetNodeId")
    target_decision_id = interv.get("targetDecisionId")

    # Record the intervention on state (durable, for parity + ledger semantics)
    try:
        ui = UserIntervention(
            targetArtifactId=target_artifact_id,
            targetNodeId=target_node_id,
            targetReportSectionId=interv.get("targetReportSectionId"),
            targetDecisionId=target_decision_id,
            intent=interv.get("intent", "challenge"),
            text=interv.get("text", "") or "",
            answeredGapIds=interv.get("answeredGapIds") or [],
        )
        if hasattr(state, "userIntervention"):
            state.userIntervention = ui
        else:
            if isinstance(state, dict):
                state["userIntervention"] = interv
    except Exception:
        # best effort; do not drop cascade
        if isinstance(state, dict):
            state["userIntervention"] = interv
        elif hasattr(state, "__dict__"):
            try:
                setattr(state, "userIntervention", interv)
            except Exception:
                pass

    # Decision-level challenge (targetDecisionId): mark ledger entry challenged
    if target_decision_id:
        ledger = _get_list(state, "decisionLedger")
        for i, d in enumerate(ledger):
            if _get_attr(d, "id") == target_decision_id:
                now = datetime.now().isoformat()
                if isinstance(d, dict):
                    nd = {**d, "status": "challenged", "challengedAt": now, "challengeText": interv.get("text") or d.get("challengeText")}
                    ledger[i] = nd
                else:
                    try:
                        if hasattr(d, "status"):
                            d.status = "challenged"
                        if hasattr(d, "challengedAt"):
                            d.challengedAt = now
                    except Exception:
                        pass
                break
        if hasattr(state, "decisionLedger"):
            state.decisionLedger = ledger
        elif isinstance(state, dict):
            state["decisionLedger"] = ledger

    # Resolve effective artifact ids for stale cascade (targetNodeId must not leak node id into stale)
    # targetDecisionId is resolved to artifacts (turn/chose/runs) and participates in same general cascade.
    initial_art_targets: set = set()
    if target_artifact_id:
        initial_art_targets.add(target_artifact_id)
    if target_node_id:
        for aid in _resolve_artifacts_for_node(state, target_node_id):
            if aid:
                initial_art_targets.add(aid)
    if target_decision_id:
        for aid in _resolve_artifacts_for_decision(state, target_decision_id):
            if aid:
                initial_art_targets.add(aid)

    # Collect + cascade via dependencyGraph using only artifact ids
    stale = set(_get_list(state, "staleArtifactIds") or [])
    affected: set = set(initial_art_targets)
    if affected:
        dep_graph = _get_list(state, "dependencyGraph") or []
        changed = True
        while changed:
            changed = False
            for edge in dep_graph:
                from_id = _get_attr(edge, "fromArtifactId")
                to_id = _get_attr(edge, "toArtifactId")
                if from_id in affected and to_id and to_id not in affected:
                    affected.add(to_id)
                    changed = True

        # union monotonically (preserve prior stales)
        for aid in affected:
            if aid:
                stale.add(aid)

        if hasattr(state, "staleArtifactIds"):
            state.staleArtifactIds = list(stale)
        else:
            if isinstance(state, dict):
                state["staleArtifactIds"] = list(stale)

    # Mark corresponding graph nodes as challenged:
    # - exact targetNodeId match (for node-only intervention)
    # - runId match against affected artifacts (downstream cascade)
    # - also target artifact's run
    graph = _get_attr(state, "graph") or {}
    nodes = list(_get_attr(graph, "nodes") or [])
    if nodes:
        arts = _get_list(state, "artifacts") or []
        # target run from explicit target art if present
        target_run = None
        if target_artifact_id:
            t_art = next((a for a in arts if _get_attr(a, "id") == target_artifact_id), None)
            if t_art:
                pb = _get_attr(t_art, "producedBy") or {}
                target_run = _get_attr(pb, "capabilityRunId")

        new_nodes = []
        for node in nodes:
            matches = False
            nid = _get_attr(node, "id")
            # direct node id match for targetNodeId interventions
            if target_node_id and nid == target_node_id:
                matches = True
            else:
                n_run = _get_attr(node, "capabilityRunId") or _get_attr(node, "producedRunId")
                if n_run:
                    if target_run and n_run == target_run:
                        matches = True
                    if not matches:
                        for aff_id in affected:
                            for a in arts:
                                if _get_attr(a, "id") == aff_id:
                                    apb = _get_attr(a, "producedBy") or {}
                                    if _get_attr(apb, "capabilityRunId") == n_run:
                                        matches = True
                                        break
                            if matches:
                                break
            if matches:
                if isinstance(node, dict):
                    node = {**node, "status": "challenged"}
                else:
                    try:
                        if hasattr(node, "status"):
                            node.status = "challenged"
                    except Exception:
                        pass
            new_nodes.append(node)

        if isinstance(graph, dict):
            graph = {**graph, "nodes": new_nodes}
            if hasattr(state, "graph"):
                state.graph = graph
            elif isinstance(state, dict):
                state["graph"] = graph

        # update projectionDirtyNodeIds for downstream consumers
        dirty = set(_get_list(state, "projectionDirtyNodeIds") or [])
        for n in new_nodes:
            if _get_attr(n, "status") == "challenged":
                nid = _get_attr(n, "id")
                if nid:
                    dirty.add(nid)
        if hasattr(state, "projectionDirtyNodeIds"):
            state.projectionDirtyNodeIds = list(dirty)
        elif isinstance(state, dict):
            state["projectionDirtyNodeIds"] = list(dirty)

    return state


def apply_user_intervention_invalidation(state: Any, intervention: Any) -> Any:
    """INTAKE wrapper: apply general intervention invalidation (target+stale cascade).
    Called for any UserIntervention (not just route text). Preserves prior state semantics.
    """
    if not intervention:
        return state
    return invalidate_for_intervention(state, intervention)


# --- Browser contract helper (smallest slice for awaitReason + runtimePhase receive) ---
# Hardens Python-owned park so drive returns state that frontend runtime receives
# (awaitReason + phase) instead of silent no-op / dropped signals.
# Classification for this slice: PYTHON_AUTHORITY (drive/park); thin TS consumer below.
def set_await_for_browser(state: Any, reason: str, detail: Optional[str] = None) -> Any:
    """Set awaiting + awaitReason (and optional detail) for V5.2 browser contract.
    Ensures returned session state to frontend carries runtimePhase+await* .
    Used by drive to avoid overwrite paths dropping the park for UI.
    """
    if hasattr(state, "runtimePhase"):
        state.runtimePhase = "awaiting"
    elif isinstance(state, dict):
        state["runtimePhase"] = "awaiting"
    if hasattr(state, "awaitReason"):
        state.awaitReason = reason
    elif isinstance(state, dict):
        state["awaitReason"] = reason
    if detail is not None:
        if hasattr(state, "awaitDetail"):
            state.awaitDetail = detail
        elif isinstance(state, dict):
            state["awaitDetail"] = detail
    return state
