"""Web AIGC real provider readiness (101).

Python outputs explicit readiness matrix for:
- search (web, graph, image, static)
- file (generation, slicing, translation, excel, long-text)
- vision/audio
- ocr/static
- ai-ppt (outline, slide-plan, export)
- chart (dynamic)
- transaction

Statuses: ready | skipped-live | blocked | degraded | unsupported

- ready: synthetic/python-internal path without external real provider
- skipped-live: would require real external paid/live provider keys; synthetic/mock used instead
- blocked / degraded / unsupported: explicit non-readiness

NEVER treats skipped-live / synthetic / mock as real provider takeover.
Node consumes matrix for observability only; does not promote to prod wiring.
No real external calls, no keys.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

CONTRACT_VERSION = "web_aigc.real_provider_readiness.v1"
PROVENANCE = "python-web-aigc-real-provider-readiness"

WebAigcRealProviderStatus = Literal["ready", "skipped-live", "blocked", "degraded", "unsupported"]

# Categories from task
CATEGORIES = ["search", "file", "vision", "audio", "ocr", "static", "ai_ppt", "chart", "transaction"]

# Provider kinds used for matrix
READINESS_KINDS: List[str] = [
    "web_search",
    "graph_search",
    "image_search",
    "static_webpage_read",
    "file_generation",
    "file_slicing",
    "file_translation",
    "excel_read",
    "long_text_extraction",
    "vision_analysis",
    "audio_recognition",
    "ocr_recognition",
    "voice_synthesis",
    "ai_ppt_outline",
    "ai_ppt_slide_plan",
    "ai_ppt_export",
    "dynamic_chart",
    "transaction_flow",
]

# Default classification for real vs synthetic:
# - python synthetic/local = ready (no live external)
# - real external providers (would need keys) = skipped-live
_DEFAULT_STATUS: Dict[str, WebAigcRealProviderStatus] = {
    # search: real external would be live search APIs
    "web_search": "skipped-live",
    "graph_search": "skipped-live",
    "image_search": "skipped-live",
    "static_webpage_read": "skipped-live",
    # file: python internal/synthetic file handling ready
    "file_generation": "ready",
    "file_slicing": "ready",
    "file_translation": "ready",
    "excel_read": "ready",
    "long_text_extraction": "ready",
    # vision/audio/ocr: real would need vision/audio keys
    "vision_analysis": "skipped-live",
    "audio_recognition": "skipped-live",
    "ocr_recognition": "skipped-live",
    "voice_synthesis": "skipped-live",
    # ai ppt: synthetic outline plan ready
    "ai_ppt_outline": "ready",
    "ai_ppt_slide_plan": "ready",
    "ai_ppt_export": "ready",
    # chart/transaction: internal/synthetic ready
    "dynamic_chart": "ready",
    "transaction_flow": "ready",
}


def _build_entry(
    kind: str,
    status: WebAigcRealProviderStatus,
    *,
    reason: str,
    category: str,
) -> Dict[str, Any]:
    return {
        "kind": kind,
        "status": status,
        "category": category,
        "reason": reason,
        "backend": "python",
        "externalCalls": False,
        "synthetic": status == "ready",
    }


def _categorize(kind: str) -> str:
    if kind in ("web_search", "graph_search", "image_search", "static_webpage_read"):
        return "search"
    if kind.startswith("file_") or kind in ("excel_read", "long_text_extraction"):
        return "file"
    if kind in ("vision_analysis",):
        return "vision"
    if kind in ("audio_recognition", "voice_synthesis"):
        return "audio"
    if kind in ("ocr_recognition",):
        return "ocr"
    if kind in ("static_webpage_read",):  # already search, but static listed
        return "static"
    if kind.startswith("ai_ppt_"):
        return "ai_ppt"
    if kind == "dynamic_chart":
        return "chart"
    if kind == "transaction_flow":
        return "transaction"
    return "other"


def execute_web_aigc_real_provider_readiness(payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Return Web AIGC real provider readiness matrix.

    payload:
      - "simulate": {"status": "...", "kinds": ["web_search"], "force": "skipped-live" }
      - allows test to force ready/skipped-live/blocked/degraded/unsupported
    Never performs live provider calls.
    """
    payload = payload or {}
    simulate = payload.get("simulate") or {}
    force_status = simulate.get("status")
    force_kinds = simulate.get("kinds") or []
    if not isinstance(force_kinds, list):
        force_kinds = []

    providers: Dict[str, Dict[str, Any]] = {}
    for kind in READINESS_KINDS:
        status: WebAigcRealProviderStatus = _DEFAULT_STATUS.get(kind, "unsupported")
        reason = "synthetic python runtime (no real external provider)"
        if kind in force_kinds and force_status in ("ready", "skipped-live", "blocked", "degraded", "unsupported"):
            status = force_status  # type: ignore[assignment]
            reason = f"forced {status} by simulate for test"

        if status == "skipped-live":
            reason = "requires real external provider key/credentials; using synthetic only; skipped-live"
        elif status == "unsupported":
            reason = "not implemented in this slice"
        elif status == "blocked":
            reason = "explicitly blocked for real provider"
        elif status == "degraded":
            reason = "degraded synthetic path"

        cat = _categorize(kind)
        providers[kind] = _build_entry(kind, status, reason=reason, category=cat)

    # apply global force if no specific kinds
    if force_status and not force_kinds:
        for k in providers:
            providers[k]["status"] = force_status
            providers[k]["reason"] = f"forced {force_status} by simulate"

    counts = {
        "ready": sum(1 for e in providers.values() if e["status"] == "ready"),
        "skippedLive": sum(1 for e in providers.values() if e["status"] == "skipped-live"),
        "blocked": sum(1 for e in providers.values() if e["status"] == "blocked"),
        "degraded": sum(1 for e in providers.values() if e["status"] == "degraded"),
        "unsupported": sum(1 for e in providers.values() if e["status"] == "unsupported"),
    }

    # matrix by category
    matrix: Dict[str, List[str]] = {c: [] for c in CATEGORIES}
    for k, e in providers.items():
        cat = e["category"]
        if cat in matrix:
            matrix[cat].append(k)
        else:
            matrix.setdefault(cat, []).append(k)

    overall_ok = counts["ready"] > 0 and counts["skippedLive"] == 0 and counts["blocked"] == 0 and counts["degraded"] == 0

    return {
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": overall_ok,
        "total": len(providers),
        "counts": counts,
        "providers": providers,
        "matrix": matrix,
        "runtime": {
            "owner": "python",
            "mode": "real_provider_readiness",
            "externalCalls": False,
        },
        "note": "skipped-live and synthetic entries MUST NOT be treated as real production provider takeover.",
    }


def get_web_aigc_real_provider_readiness_matrix() -> Dict[str, Any]:
    """Convenience entry for adapters/bridges/tests."""
    return execute_web_aigc_real_provider_readiness({})
