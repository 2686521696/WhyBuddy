"""A2A core route cutover readiness 101.

Python provides narrow cutover readiness classification for A2A/core:
- registry (decision boundary only)
- session (decision boundary only)
- stream (thin bridge only; real transport remains Node)
- cancel (thin bridge only)
- chat (advisory only; full chat/report/analytics stay Node)
- report (advisory only)

Statuses: ready | blocked | degraded | skipped-live

Never promotes this slice as full A2A protocol takeover.
Node bridge retains real A2A invoke/stream/cancel/chat/report ownership.
Existing protocol contract/invoke/stream boundaries remain unchanged.
"""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

CONTRACT_VERSION = "a2a.core-route-cutover.v1"
PROVENANCE = "python-a2a-core-route-cutover"

CUTOVER_STATUSES: tuple[str, ...] = ("ready", "blocked", "degraded", "skipped-live")

A2ACoreRouteCutoverStatus = Literal["ready", "blocked", "degraded", "skipped-live"]

A2A_CORE_ROUTE_COMPONENTS = ("registry", "session", "stream", "cancel", "chat", "report")


def _error_envelope(
    status: A2ACoreRouteCutoverStatus,
    code: str,
    message: str,
) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": False,
        "error": {"code": code, "message": message},
        "runtime": {"owner": "python", "mode": "cutover_readiness"},
    }


def _success_envelope(
    status: A2ACoreRouteCutoverStatus,
    components: Dict[str, str],
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": status == "ready",
        "runtime": {"owner": "python", "mode": "cutover_readiness"},
        "cutoverSummary": {
            "status": status,
            "components": components,
            "metadata": metadata or {},
        },
    }


def execute_a2a_core_route_cutover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return A2A core route cutover readiness decision.

    Components covered:
      registry, session, stream, cancel, chat, report

    simulate supports:
      - {"block": true} -> all blocked
      - {"degrade": true} -> all degraded
      - {"skipLive": true} -> force stream/cancel/chat/report skipped-live
      - {"forceFailed": true} -> blocked
      - {"area": "stream"} etc for targeted

    Default: registry=ready, session=ready, stream=skipped-live, cancel=skipped-live,
             chat=skipped-live, report=skipped-live  (advisory readiness, not 100% ownership)
    """
    if payload is None or not isinstance(payload, dict):
        return _error_envelope("blocked", "invalid_payload", "payload must be object")

    simulate = payload.get("simulate") if isinstance(payload.get("simulate"), dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}

    if simulate.get("forceFailed"):
        return _error_envelope("blocked", "forced_failure", "cutover forced into blocked state")

    if simulate.get("block") or simulate.get("blocked"):
        components: Dict[str, str] = {c: "blocked" for c in A2A_CORE_ROUTE_COMPONENTS}
        return _success_envelope("blocked", components, metadata)

    if simulate.get("degrade") or simulate.get("degraded"):
        components = {c: "degraded" for c in A2A_CORE_ROUTE_COMPONENTS}
        return _success_envelope("degraded", components, metadata)

    # default decisions: core decision surface ready for registry/session, thin for stream/cancel, advisory skipped for chat/report
    registry_dec = "ready"
    session_dec = "ready"
    stream_dec = "skipped-live"
    cancel_dec = "skipped-live"
    chat_dec = "skipped-live"
    report_dec = "skipped-live"

    if simulate.get("skipLive") or simulate.get("skippedLive"):
        stream_dec = "skipped-live"
        cancel_dec = "skipped-live"
        chat_dec = "skipped-live"
        report_dec = "skipped-live"

    area = simulate.get("area")
    if area in A2A_CORE_ROUTE_COMPONENTS:
        # force the specific to skipped-live for boundary test
        if area == "registry":
            registry_dec = "skipped-live"
        elif area == "session":
            session_dec = "skipped-live"
        elif area == "stream":
            stream_dec = "skipped-live"
        elif area == "cancel":
            cancel_dec = "skipped-live"
        elif area == "chat":
            chat_dec = "skipped-live"
        elif area == "report":
            report_dec = "skipped-live"

    components = {
        "registry": registry_dec,
        "session": session_dec,
        "stream": stream_dec,
        "cancel": cancel_dec,
        "chat": chat_dec,
        "report": report_dec,
    }

    has_blocked = any(v == "blocked" for v in components.values())
    has_degraded = any(v == "degraded" for v in components.values())
    if has_blocked:
        overall: A2ACoreRouteCutoverStatus = "blocked"
    elif has_degraded:
        overall = "degraded"
    else:
        overall = "ready"

    return _success_envelope(overall, components, metadata)


# alias for bridge consumption
get_a2a_core_route_cutover = execute_a2a_core_route_cutover
