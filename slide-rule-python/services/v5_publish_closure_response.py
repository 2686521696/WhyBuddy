"""Pure schema and derive for publishClosure/runtimeClosure response payloads in Python /drive-full.

Schema matches AppBundleRuntimeClosureReport shape (from TS evaluateAppBundleRuntimeClosure)
with pass-through summary for drive-full response payload:
  {
    blocked, blockerCount, evidencePresentCount, skillCount, versionPinsChecked,
    closureId, closureHash, stableDigest,
    tierCounts: {hard_blocker, warning, info},
    perSkillEvidence, topBlockers
  }

Focus: /drive-full schema + deterministic pass-through. No network/DB/provider calls.
Preserves degraded/error states by returning None (fail-closed).
Missing declared Skill evidence (skill in skillsChecked with evidencePresent=false) yields blocked=true in report (no green fake).
See also derive in routes for drive-full/drive-marathon.
Compatible with client/pages/sliderule/derive-cross-runtime-summary.ts PublishClosureSummary (python side provides authoritative).
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from models.v5_state import V5SessionState


class PublishClosureTopBlocker(BaseModel):
    """Typed blocker entry for topBlockers (subset for response payload)."""
    code: str = ""
    path: str = ""
    affectedSkill: Optional[str] = None
    ref: Optional[str] = None


class PublishClosureTierCounts(BaseModel):
    """Typed tier counts for findingsByTier summary."""
    hard_blocker: int = 0
    warning: int = 0
    info: int = 0


class PublishClosureResponse(BaseModel):
    """Typed schema (Pydantic) for the publishClosure response payload returned by /drive-full.

    This is the Python-authored contract for AppBundle publish/runtime closure response.
    Used to validate shape when deriving from capability run results containing runtimeClosure.
    Exported for review, tests, and cross-runtime parity.
    """
    blocked: bool
    blockerCount: int
    evidencePresentCount: int
    skillCount: int
    versionPinsChecked: bool
    closureId: Optional[str] = None
    closureHash: Optional[str] = None
    stableDigest: Optional[str] = None
    tierCounts: PublishClosureTierCounts
    perSkillEvidence: Dict[str, Any] = Field(default_factory=dict)
    topBlockers: List[PublishClosureTopBlocker] = Field(default_factory=list)


def _as_dict(value: Any) -> Dict[str, Any]:
    """Adapter for /drive-full: accepts Pydantic model_dump results or plain dicts for capability results
    (and nested runtimeClosure). Supports model or dict pass-through while preserving fail-closed None.
    """
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        dumped = value.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    return {}


def _tier_count(report: Dict[str, Any], tier: str) -> int:
    findings = _as_dict(report.get("findingsByTier")).get(tier)
    return len(findings) if isinstance(findings, list) else 0


def _to_publish_closure_summary(report: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    runtime = _as_dict(report.get("runtimeClosure"))
    if not runtime:
        return None

    per_skill = _as_dict(report.get("perSkillEvidence"))
    skills_checked = runtime.get("skillsChecked")
    if not isinstance(skills_checked, list):
        skills_checked = list(per_skill.keys())

    blockers = report.get("blockers")
    blocker_items = blockers if isinstance(blockers, list) else []
    top_blockers: List[Dict[str, Any]] = []
    for blocker in blocker_items[:3]:
        blocker_dict = _as_dict(blocker)
        top_blockers.append({
            "code": str(blocker_dict.get("code") or ""),
            "path": str(blocker_dict.get("path") or ""),
            "affectedSkill": str(blocker_dict.get("affectedSkill") or ""),
            "ref": str(blocker_dict.get("ref") or ""),
        })

    summary: Dict[str, Any] = {
        "blocked": bool(report.get("blocked")),
        "blockerCount": len(blocker_items),
        "evidencePresentCount": sum(
            1 for item in per_skill.values()
            if _as_dict(item).get("evidencePresent") is True
        ),
        "skillCount": len(skills_checked),
        "versionPinsChecked": bool(runtime.get("versionPinsChecked")),
        "closureId": report.get("closureId"),
        "closureHash": report.get("closureHash"),
        "stableDigest": report.get("stableDigest"),
        "tierCounts": {
            "hard_blocker": _tier_count(report, "hard_blocker"),
            "warning": _tier_count(report, "warning"),
            "info": _tier_count(report, "info"),
        },
        "perSkillEvidence": per_skill,
        "topBlockers": top_blockers,
    }
    # Enforce typed schema (positive evidence of schema); raises on shape violation.
    PublishClosureResponse.model_validate(summary)
    return summary


def derive_publish_closure_response(state: V5SessionState) -> Optional[Dict[str, Any]]:
    """Derive publishClosure response payload from drive state.

    Scans reversed capabilityRuns for embedded runtimeClosure report (from appbundle.runtimeClosure cap)
    or direct result shape.

    Returns dict shaped per PublishClosureResponse (or None for fail-closed).
    Deterministic; no external calls.

    Fail-closed rules:
    - If no capabilityRuns or no runtimeClosure data found: return None
    - Degraded/error states in run are not special-filtered here (unlike graph); the presence of
      valid runtimeClosure inside result is what triggers return. Degraded full states are handled
      upstream by driver (e.g. publishClosure may be omitted or partial in caller). Preserves semantics.
    """
    if state is None:
        return None
    for run in reversed(getattr(state, "capabilityRuns", []) or []):
        run_data = _as_dict(run)
        result = _as_dict(run_data.get("result"))
        for candidate in (
            _as_dict(result.get("runtimeClosure")),
            result,
        ):
            summary = _to_publish_closure_summary(candidate)
            if summary is not None:
                return summary
    return None


# Public exports for typed schema (reviewable symbols)
__all__ = [
    "derive_publish_closure_response",
    "PublishClosureResponse",
    "PublishClosureTopBlocker",
    "PublishClosureTierCounts",
]
