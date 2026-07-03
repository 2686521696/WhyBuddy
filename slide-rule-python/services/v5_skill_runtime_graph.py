"""Pure schema and derive for skillRuntimeGraph in Python /drive-full.

Compatible with TypeScript CrossRuntimeGraph shape from client/src/lib/skills/orchestrator.ts:
  { edges: [{sourceSkill, targetSkill, state, evidenceKey?, raw}], bySkill, evidenceBySkill }

Focus: /drive-full schema + deterministic pass-through. No network/DB/provider calls.
Preserves degraded/error states by returning None (fail-closed).
"""
from typing import Any, Dict, List, Optional

from models.v5_state import V5SessionState


def _as_dict(value: Any) -> Dict[str, Any]:
    """Adapter for /drive-full: accepts Pydantic model_dump results or plain dicts for capability results.
    Degraded checks and graph build fail-closed on error/latest degraded (no masking).
    """
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        dumped = value.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    return {}


def _is_degraded(run: Dict[str, Any]) -> bool:
    rd = _as_dict(run)
    res = _as_dict(rd.get("result"))
    if rd.get("error") is not None:
        return True
    if res.get("degraded") is True:
        return True
    if res.get("error"):
        return True
    return False


def _build_graph_from_edges(raw_edges: Any, evidence_list: Any = None) -> Optional[Dict[str, Any]]:
    edges_in: List[Any] = raw_edges if isinstance(raw_edges, (list, tuple)) else []
    ev_in: List[Any] = evidence_list if isinstance(evidence_list, (list, tuple)) else []
    if not edges_in:
        return None

    edges: List[Dict[str, Any]] = []
    by_skill: Dict[str, List[Dict[str, Any]]] = {}
    evidence_by: Dict[str, List[str]] = {}

    for idx, raw in enumerate(edges_in):
        if raw is None:
            continue
        s = str(raw)
        # parse "source->target:state" or accept structured
        src = None
        tgt = None
        st = None
        evk = None
        if "->" in s and ":" in s:
            try:
                left, right = s.split(":", 1)
                src, tgt = left.split("->", 1)
                st = right
            except Exception:
                src = None
        if not src:
            # try dict form
            d = _as_dict(raw)
            src = str(d.get("sourceSkill") or d.get("source") or "")
            tgt = str(d.get("targetSkill") or d.get("target") or "")
            st = str(d.get("state") or d.get("status") or "allowed")
            evk = d.get("evidenceKey")
        if not src or not tgt:
            continue
        src = src.strip()
        tgt = tgt.strip()
        st = (st or "allowed").strip()
        evk = evk or (ev_in[idx] if idx < len(ev_in) else None)
        if evk is not None:
            evk = str(evk)

        edge: Dict[str, Any] = {
            "sourceSkill": src,
            "targetSkill": tgt,
            "state": st,
            "raw": s,
        }
        if evk:
            edge["evidenceKey"] = evk

        edges.append(edge)
        by_skill.setdefault(src, []).append(edge)
        by_skill.setdefault(tgt, []).append(edge)
        if evk:
            evidence_by.setdefault(src, []).append(evk)
            evidence_by.setdefault(tgt, []).append(evk)

    if not edges:
        return None

    # dedup evidence lists
    for k in list(evidence_by.keys()):
        seen = set()
        evidence_by[k] = [e for e in evidence_by[k] if not (e in seen or seen.add(e))]

    return {
        "edges": edges,
        "bySkill": by_skill,
        "evidenceBySkill": evidence_by,
    }


def derive_skill_runtime_graph_response(state: V5SessionState) -> Optional[Dict[str, Any]]:
    """Derive skillRuntimeGraph (TS crossRuntimeGraph shape) from drive state.

    Scans reversed capabilityRuns for embedded skillRuntimeGraph / crossRuntimeGraph
    or raw crossSkillRuntimeEdges + runtimeEvidence.

    Returns None (fail-closed) for missing data, degraded runs, or empty edges.
    Deterministic; no external calls.

    Explicit rule for degraded/error: if the *latest* run in capabilityRuns is degraded or errored,
    return None immediately (do not fall back to graphs from prior runs). This preserves
    degraded/error states for the current final_state and prevents stale graph masking.
    Only non-latest runs may be skipped if degraded when searching for usable graph data.
    """
    if state is None:
        return None

    runs = getattr(state, "capabilityRuns", []) or []
    if not runs:
        return None

    # Latest run is authoritative for current final_state. If degraded/error, fail-closed.
    # This directly addresses the case where /drive-full final_state has current run degraded.
    latest = _as_dict(runs[-1])
    if _is_degraded(latest):
        return None

    for run in reversed(runs):
        run_d = _as_dict(run)
        if _is_degraded(run_d):
            # skip older degraded runs; do not return their graph data
            continue

        result = _as_dict(run_d.get("result"))
        # direct embed pass-through (future python caps or appbundle may emit)
        for key in ("skillRuntimeGraph", "crossRuntimeGraph"):
            cand = result.get(key)
            if isinstance(cand, dict):
                if all(k in cand for k in ("edges", "bySkill", "evidenceBySkill")):
                    # already shaped? normalize lightly; but fail-closed on empty edges
                    edges = list(cand.get("edges") or [])
                    if edges:
                        return {
                            "edges": edges,
                            "bySkill": dict(cand.get("bySkill") or {}),
                            "evidenceBySkill": dict(cand.get("evidenceBySkill") or {}),
                        }
                    # empty edges: do not return; fall to fail-closed
                else:
                    built = _build_graph_from_edges(cand.get("edges"))
                    if built:
                        return built
            elif cand:
                built = _build_graph_from_edges(cand)
                if built:
                    return built

        # edges from surface-like result fields (compat with skill surfaces)
        raw_edges = result.get("crossSkillRuntimeEdges") or result.get("runtimeEdges") or result.get("edges")
        ev = result.get("runtimeEvidence") or result.get("evidence")
        built = _build_graph_from_edges(raw_edges, ev)
        if built:
            return built

        # check inside nested runtimeClosure or closure report for graph hints (rare)
        rc = _as_dict(result.get("runtimeClosure"))
        if rc:
            raw2 = rc.get("crossSkillRuntimeEdges") or rc.get("skillRuntimeGraph")
            built2 = _build_graph_from_edges(raw2)
            if built2:
                return built2

    # No usable non-degraded graph data found -> fail closed to None
    return None
