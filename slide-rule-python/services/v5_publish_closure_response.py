"""Pure response helpers for AppBundle publish/runtime closure."""
from typing import Any, Dict, Optional

from models.v5_state import V5SessionState


def _as_dict(value: Any) -> Dict[str, Any]:
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
    top_blockers = []
    for blocker in blocker_items[:3]:
        blocker_dict = _as_dict(blocker)
        top_blockers.append({
            "code": str(blocker_dict.get("code") or ""),
            "path": str(blocker_dict.get("path") or ""),
            "affectedSkill": str(blocker_dict.get("affectedSkill") or ""),
            "ref": str(blocker_dict.get("ref") or ""),
        })

    return {
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


def derive_publish_closure_response(state: V5SessionState) -> Optional[Dict[str, Any]]:
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
