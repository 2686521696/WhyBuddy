"""
Python port of G_READY + G_CONFIRM / route selection / reject route (userPicksRoute, userRejectsRouteSelection, stale on reject, clear await on pick).

Port of shared/blueprint/sliderule-interactive-gates.ts slices for interactive gates (P0 V5.1/V5.2).
Pure functions + minimal state mutators.

Classification:
  G_READY (prior): TS_RUNTIME_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
  G_CONFIRM + route selection/reject (this task): TS_RUNTIME_OWNED (in client runtime + shared) -> PYTHON_COMPAT (partial park in evaluate_confirm) -> PYTHON_AUTHORITY (named funcs + apply staling/clear + gate uses expresses + drive resolve + focused tests)
Python owns the G_CONFIRM park, user pick/reject named behavior, selected route via clear, reject route via stale+reroute in Python drive/state. No Node fallback hiding. Direct pytest + mojibake.

Smallest slice added: user_*_route funcs, update evaluate_confirm, apply_route_selection_resolution (stale route arts on reject, clear on pick), integration in session drive.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime

from models.v5_state import V5SessionState, CoverageGap


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
            if contract is None:
                contract = {"blockingGapIds": list(blocking)}
            else:
                contract = {**contract, "blockingGapIds": list(blocking)}
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
