"""Audit durable store and retention takeover 104 (bounded Python slice).

Python provides a narrow classification and safe evidence slice for audit:
- auditDurableStore and retention remain node-retained (per prior boundary).
- externalAuditPlatform is external-owned.
- auditEvidenceSlice (classify/decision/export) is python-owned (thin synthetic slice only).
- Supports classify one safe audit evidence slice or explicitly retain/export it (synthetic, side-effect free).
- productionTakeover is always false.
- Does not perform real durable writes, does not own retention/export in production sense.
- External platform and node retention safeguards untouched.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

CONTRACT_VERSION = "audit-durable-store-retention-takeover.v1"
PROVENANCE = "python-audit-durable-store-retention-takeover-104"

TAKEOVER_STATUSES = (
    "ready",
    "python-owned",
    "node-retained",
    "external-owned",
    "out-of-scope",
    "blocked",
    "skipped-live",
)

AuditDurableRetentionStatus = str

AuditEvidenceOperation = Literal["classify", "retain", "export"]
AuditEvidenceStatus = Literal["classified", "retained", "exported", "denied", "degraded", "error"]


def _is_record(v: Any) -> bool:
    return isinstance(v, dict)


def _clean_str(v: Any, default: str = "") -> str:
    if v is None:
        return default
    s = str(v).strip()
    return s or default


def _error_envelope(status: str, code: str, message: str) -> Dict[str, Any]:
    return {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": False,
        "error": {"code": code, "message": message},
        "runtime": {"owner": "python", "mode": "audit_durable_retention_slice"},
        "ownership": {
            "auditDurableStore": "blocked",
            "retention": "blocked",
            "externalAuditPlatform": "blocked",
            "auditEvidenceSlice": "blocked",
        },
        "productionTakeover": False,
    }


def _success_envelope(
    status: str,
    ownership: Dict[str, str],
    extra: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    res: Dict[str, Any] = {
        "status": status,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": status in ("ready", "python-owned"),
        "runtime": {"owner": "python", "mode": "audit_durable_retention_slice"},
        "ownership": ownership,
        "productionTakeover": False,
    }
    if extra:
        res.update(extra)
    return res


def execute_audit_durable_store_retention_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return audit durable store + retention ownership classification.

    Defaults:
      - auditDurableStore: "node-retained"
      - retention: "node-retained"
      - externalAuditPlatform: "external-owned"
      - auditEvidenceSlice: "python-owned"  # thin classify/retain/export slice

    simulate:
      - block / forceNodeRetained
      - area
    """
    if payload is None or not _is_record(payload):
        return _error_envelope("blocked", "invalid_payload", "payload must be object")

    simulate = payload.get("simulate") if _is_record(payload.get("simulate")) else {}
    area = _clean_str(payload.get("area") or payload.get("op") or "all")

    ownership: Dict[str, str] = {
        "auditDurableStore": "node-retained",
        "retention": "node-retained",
        "externalAuditPlatform": "external-owned",
        "auditEvidenceSlice": "python-owned",
    }

    if simulate.get("forceNodeRetained") or simulate.get("allRetained"):
        for k in list(ownership.keys()):
            ownership[k] = "node-retained"
        ownership["externalAuditPlatform"] = "external-owned"
    if simulate.get("block") or simulate.get("blocked"):
        for k in list(ownership.keys()):
            ownership[k] = "blocked"
        return _success_envelope("blocked", ownership)

    if area in ("auditDurableStore", "retention"):
        # keep node-retained explicitly
        pass
    elif area == "auditEvidenceSlice":
        ownership["auditEvidenceSlice"] = "python-owned"
    elif area == "externalAuditPlatform":
        ownership["externalAuditPlatform"] = "external-owned"
    elif area not in ("all", ""):
        # out of scope keeps defaults but marks
        pass

    overall = "python-owned" if any(v == "python-owned" for v in ownership.values()) else "ready"
    if any(v == "blocked" for v in ownership.values()):
        overall = "blocked"

    extra: Dict[str, Any] = {
        "boundaries": {
            "auditDurableStoreOwner": "node",
            "retentionOwner": "node",
            "externalAuditPlatformOwner": "external",
            "auditEvidenceSliceOwner": "python",
        },
        "retainedResponsibilities": [
            "audit durable WAL / append-only storage",
            "retention policy application and archive",
            "export and compliance reporting",
            "anomaly and full history integrity",
        ],
        "slices": {
            "auditEvidenceSlice": "python classify / retain / export (synthetic safe evidence only)",
        },
    }
    if area == "all":
        extra["areas"] = dict(ownership)

    result = _success_envelope(overall, ownership, extra)
    result["area"] = area if area else "all"
    result["reason"] = "node-retained durable/retention; python thin evidence slice only"
    result["fallback"] = "node"
    return result


def classify_audit_evidence_slice(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Classify/store/export one safe audit evidence slice (synthetic).

    Never writes real audit records. Operates only on provided payload.
    Supports operations: classify, retain, export -> returns retained/exported or error statuses.
    External emit always false; delegates durable to node.
    """
    if payload is None or not _is_record(payload):
        return {
            "ok": False,
            "status": "error",
            "operation": "classify",
            "reason": "invalid_payload",
            "contractVersion": CONTRACT_VERSION,
            "provenance": PROVENANCE,
            "productionTakeover": False,
            "evidence": None,
            "exported": False,
        }

    op = _clean_str(payload.get("operation") or "classify")
    if op not in ("classify", "retain", "export"):
        op = "classify"

    simulate = payload.get("simulate") if _is_record(payload.get("simulate")) else {}
    evidence = payload.get("evidence") or payload.get("slice") or {}
    event_id = _clean_str(evidence.get("eventId") or payload.get("eventId") or "audit-slice-104")

    if simulate.get("block") or simulate.get("denied"):
        return {
            "ok": False,
            "status": "denied",
            "operation": op,
            "reason": "denied by simulate",
            "contractVersion": CONTRACT_VERSION,
            "provenance": PROVENANCE,
            "productionTakeover": False,
            "evidence": {"eventId": event_id},
            "exported": False,
            "retained": False,
        }

    if simulate.get("degraded") or simulate.get("error"):
        return {
            "ok": False,
            "status": "degraded" if simulate.get("degraded") else "error",
            "operation": op,
            "reason": "degraded slice",
            "contractVersion": CONTRACT_VERSION,
            "provenance": PROVENANCE,
            "productionTakeover": False,
            "evidence": {"eventId": event_id},
            "exported": False,
            "retained": False,
        }

    # successful safe slice
    if op == "export":
        return {
            "ok": True,
            "status": "exported",
            "operation": "export",
            "contractVersion": CONTRACT_VERSION,
            "provenance": PROVENANCE,
            "productionTakeover": False,
            "evidence": {"eventId": event_id, "synthetic": True},
            "exported": True,
            "manifest": {
                "manifestId": f"slice-export-{event_id}",
                "format": "json",
                "entryCount": 1,
                "eventIds": [event_id],
                "externalEmit": False,
                "hash": "sha256-synthetic-evidence-slice",
            },
            "retained": False,
        }

    if op == "retain" or op == "classify":
        decision = "keep" if not simulate.get("expire") else "drop"
        reason = "within_retention" if decision == "keep" else "retention_expired"
        return {
            "ok": True,
            "status": "retained" if op == "retain" or decision == "keep" else "classified",
            "operation": "retain" if op == "retain" else "classify",
            "contractVersion": CONTRACT_VERSION,
            "provenance": PROVENANCE,
            "productionTakeover": False,
            "evidence": {"eventId": event_id, "synthetic": True},
            "exported": False,
            "retained": decision == "keep",
            "retention": {
                "decision": decision,
                "reason": reason,
                "eventId": event_id,
                "externalDelete": False,
            },
        }

    return {
        "ok": True,
        "status": "classified",
        "operation": op,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "productionTakeover": False,
        "evidence": {"eventId": event_id},
        "exported": False,
        "retained": True,
    }


# aliases
get_audit_durable_store_retention_takeover = execute_audit_durable_store_retention_takeover
process_audit_evidence_slice = classify_audit_evidence_slice

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "TAKEOVER_STATUSES",
    "execute_audit_durable_store_retention_takeover",
    "classify_audit_evidence_slice",
    "get_audit_durable_store_retention_takeover",
    "process_audit_evidence_slice",
]
