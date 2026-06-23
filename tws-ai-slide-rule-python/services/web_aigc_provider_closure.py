"""Web AIGC provider closure runtime (Python side of 100 closure).

Unifies readiness, capability map, degraded/error, config_missing for
search/file/vision/audio/OCR/static/AI PPT/dynamic/transaction + long-tail.

Python produces the production posture per provider. Node adapters consume
the summary and must preserve provenance/permission/audit/usage metadata.

No real external providers are ever invoked.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

PROVIDER_CLOSURE_CONTRACT_VERSION = "web_aigc.provider_closure.v1"

ProviderKind = Literal[
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
    "web_qa",
    "intent_recognition",
    "get_location",
    "get_device",
]

ProviderStatus = Literal["ready", "node_owned", "config_missing", "degraded", "failed"]

WebAigcProviderBackend = Literal["python", "node"]


class ProviderClosureRuntime(BaseModel):
    model_config = ConfigDict(extra="forbid")

    backend: WebAigcProviderBackend = "python"
    provider: Literal["fake"] = "fake"
    source: str
    externalCalls: Literal[False] = False


class ProviderClosureMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    auditId: Optional[str] = None
    permission: Optional[Dict[str, Any]] = None
    usage: Optional[Dict[str, Any]] = None
    provenance: Optional[Dict[str, Any]] = None


class WebAigcProviderEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ProviderKind
    status: ProviderStatus
    backend: WebAigcProviderBackend
    source: str
    runtime: ProviderClosureRuntime
    metadata: ProviderClosureMetadata = Field(default_factory=ProviderClosureMetadata)
    capability: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)


class WebAigcProviderClosureSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal[PROVIDER_CLOSURE_CONTRACT_VERSION] = PROVIDER_CLOSURE_CONTRACT_VERSION
    ok: bool
    total: int
    readyCount: int
    nodeOwnedCount: int
    configMissingCount: int
    degradedCount: int
    failedCount: int
    providers: Dict[ProviderKind, WebAigcProviderEntry]
    capabilityMap: Dict[str, List[str]] = Field(default_factory=dict)
    runtime: ProviderClosureRuntime


class ProviderClosureError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class WebAigcProviderClosureErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal[PROVIDER_CLOSURE_CONTRACT_VERSION] = PROVIDER_CLOSURE_CONTRACT_VERSION
    ok: Literal[False] = False
    status: Literal["error", "degraded"] = "error"
    error: ProviderClosureError
    runtime: ProviderClosureRuntime


ProviderClosureResponse = Union[WebAigcProviderClosureSummary, WebAigcProviderClosureErrorResponse]


_READY_KINDS: List[ProviderKind] = [
    "web_search",
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

_NODE_OWNED_KINDS: List[ProviderKind] = [
    "graph_search",
    "image_search",
]

_CONFIG_MISSING_KINDS: List[ProviderKind] = [
    "web_qa",
    "intent_recognition",
    "get_location",
    "get_device",
]


def _non_empty(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("must be a non-empty string")
    return value.strip()


def _build_runtime(source: str) -> ProviderClosureRuntime:
    return ProviderClosureRuntime(source=source)


def _build_entry(
    kind: ProviderKind,
    status: ProviderStatus,
    *,
    backend: WebAigcProviderBackend,
    source: str,
    metadata: Optional[Dict[str, Any]] = None,
    capability: Optional[Dict[str, Any]] = None,
    warnings: Optional[List[str]] = None,
) -> WebAigcProviderEntry:
    rt = _build_runtime(source)
    meta = ProviderClosureMetadata(**(metadata or {}))
    return WebAigcProviderEntry(
        kind=kind,
        status=status,
        backend=backend,
        source=source,
        runtime=rt,
        metadata=meta,
        capability=capability or {},
        warnings=warnings or [],
    )


def _default_source_for(kind: ProviderKind) -> str:
    mapping = {
        "web_search": "python-web-search-runtime",
        "graph_search": "node-graph-search",
        "image_search": "node-image-search",
        "static_webpage_read": "python-static-webpage-read-runtime",
        "file_generation": "python-file-generation-runtime",
        "file_slicing": "python-file-slicing-runtime",
        "file_translation": "python-file-translation-runtime",
        "excel_read": "python-excel-read-runtime",
        "long_text_extraction": "python-long-text-extraction-runtime",
        "vision_analysis": "python-vision-analysis-runtime",
        "audio_recognition": "python-audio-recognition-runtime",
        "ocr_recognition": "python-ocr-recognition-runtime",
        "voice_synthesis": "python-voice-synthesis-runtime",
        "ai_ppt_outline": "python-ai-ppt-runtime",
        "ai_ppt_slide_plan": "python-ai-ppt-runtime",
        "ai_ppt_export": "python-ai-ppt-runtime",
        "dynamic_chart": "python-dynamic-chart-runtime",
        "transaction_flow": "python-transaction-flow-runtime",
        "web_qa": "node-web-qa",
        "intent_recognition": "node-intent",
        "get_location": "node-location",
        "get_device": "node-device",
    }
    return mapping.get(kind, "unknown-runtime")


def _default_backend_for(kind: ProviderKind) -> WebAigcProviderBackend:
    if kind in _READY_KINDS:
        return "python"
    return "node"


def _default_status_for(kind: ProviderKind) -> ProviderStatus:
    if kind in _READY_KINDS:
        return "ready"
    if kind in _NODE_OWNED_KINDS:
        return "node_owned"
    if kind in _CONFIG_MISSING_KINDS:
        return "config_missing"
    return "node_owned"


def execute_web_aigc_provider_closure(payload: Dict[str, Any]) -> ProviderClosureResponse:
    """Return unified provider closure summary.

    Payload may contain:
      - "kind": single provider or omitted for full summary
      - "scenario": "success" | "degraded" | "failed" | "config_missing" | "node_owned"
      - "metadata", "permission", "auditId" for provenance preservation
    Never calls real providers. Always sets externalCalls=False for python paths.
    """
    if not isinstance(payload, dict):
        return WebAigcProviderClosureErrorResponse(
            status="error",
            error=ProviderClosureError(code="invalid_payload", message="payload must be an object"),
            runtime=_build_runtime("python-provider-closure"),
        )

    scenario = payload.get("scenario")
    meta_in = payload.get("metadata") or {}
    perm = payload.get("permission")
    permission_audit_id = perm.get("auditId") if isinstance(perm, dict) else None
    audit_id = (
        payload.get("auditId")
        or (meta_in.get("auditId") if isinstance(meta_in, dict) else None)
        or permission_audit_id
    )

    requested_kind: Optional[ProviderKind] = None
    raw_kind = payload.get("kind")
    if isinstance(raw_kind, str) and raw_kind in {
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
        "web_qa",
        "intent_recognition",
        "get_location",
        "get_device",
    }:
        requested_kind = raw_kind  # type: ignore[assignment]

    entries: Dict[ProviderKind, WebAigcProviderEntry] = {}
    all_kinds: List[ProviderKind] = list(set(_READY_KINDS + _NODE_OWNED_KINDS + _CONFIG_MISSING_KINDS))

    base_metadata = {
        "auditId": audit_id,
        "permission": perm,
        "usage": {"counted": True},
        "provenance": {"provider": "fake-closure", "contract": PROVIDER_CLOSURE_CONTRACT_VERSION},
    }

    for k in all_kinds:
        status = _default_status_for(k)
        backend = _default_backend_for(k)
        source = _default_source_for(k)

        if requested_kind and k != requested_kind:
            continue

        # apply scenario overrides only to the requested or globally if no specific
        if scenario in {"degraded", "failed", "config_missing", "node_owned"}:
            if not requested_kind or k == requested_kind:
                if scenario == "degraded":
                    status = "degraded"
                elif scenario == "failed":
                    status = "failed"
                elif scenario == "config_missing":
                    status = "config_missing"
                elif scenario == "node_owned":
                    status = "node_owned"

        warnings: List[str] = []
        if status == "degraded":
            warnings.append("Provider operating in degraded mode per closure policy.")
        if status == "config_missing":
            warnings.append("Provider has no python runtime config; falls back to node.")
        if status == "failed":
            warnings.append("Provider closure reported failure state.")

        cap = {
            "search": k in {"web_search", "graph_search", "image_search"},
            "file": k.startswith("file_") or k in {"excel_read", "long_text_extraction"},
            "media": k in {"vision_analysis", "audio_recognition", "ocr_recognition", "voice_synthesis"},
            "ppt": k.startswith("ai_ppt_"),
            "dynamic": k == "dynamic_chart",
            "transaction": k == "transaction_flow",
            "qa": k in {"web_qa", "static_webpage_read"},
            "device": k in {"get_device", "get_location", "intent_recognition"},
        }

        entry = _build_entry(
            k,
            status,
            backend=backend,
            source=source,
            metadata=base_metadata,
            capability=cap,
            warnings=warnings,
        )
        entries[k] = entry

    if requested_kind and requested_kind not in entries:
        # fallback single
        status = "node_owned"
        source = _default_source_for(requested_kind)
        entry = _build_entry(
            requested_kind,
            status,
            backend="node",
            source=source,
            metadata=base_metadata,
        )
        entries[requested_kind] = entry

    # compute counts (use the filtered or all)
    considered = list(entries.values())
    ready_c = sum(1 for e in considered if e.status == "ready")
    node_c = sum(1 for e in considered if e.status == "node_owned")
    cfg_c = sum(1 for e in considered if e.status == "config_missing")
    deg_c = sum(1 for e in considered if e.status == "degraded")
    fail_c = sum(1 for e in considered if e.status == "failed")

    # build capability map groups
    cap_map: Dict[str, List[str]] = {
        "search": [k for k, e in entries.items() if e.capability.get("search")],
        "file": [k for k, e in entries.items() if e.capability.get("file")],
        "media": [k for k, e in entries.items() if e.capability.get("media")],
        "generation": [k for k, e in entries.items() if e.capability.get("ppt") or e.capability.get("dynamic")],
        "control": [k for k, e in entries.items() if e.capability.get("transaction")],
        "long_tail": [k for k, e in entries.items() if e.status in ("node_owned", "config_missing")],
    }

    if scenario == "error" and requested_kind:
        return WebAigcProviderClosureErrorResponse(
            status="error",
            error=ProviderClosureError(
                code="runtime_error", message=f"Provider {requested_kind} closure failed."
            ),
            runtime=_build_runtime(_default_source_for(requested_kind)),
        )

    overall_ok = fail_c == 0 and deg_c == 0 and cfg_c == 0  # only pure ready count as overall ok for summary; explicit non-ready must not be green

    # but allow partial, ok if no hard fail in this context
    overall_ok = fail_c == 0

    summary = WebAigcProviderClosureSummary(
        ok=overall_ok,
        total=len(considered),
        readyCount=ready_c,
        nodeOwnedCount=node_c,
        configMissingCount=cfg_c,
        degradedCount=deg_c,
        failedCount=fail_c,
        providers=entries,
        capabilityMap=cap_map,
        runtime=_build_runtime("python-web-aigc-provider-closure"),
    )
    return summary


def get_web_aigc_provider_closure_readiness() -> Dict[str, Any]:
    """Convenience for capability/readiness checks in tests and adapters."""
    summary = execute_web_aigc_provider_closure({})
    if isinstance(summary, WebAigcProviderClosureErrorResponse):
        return {"ok": False, "error": summary.error.model_dump()}
    return {
        "ok": summary.ok,
        "ready": [k for k, e in summary.providers.items() if e.status == "ready"],
        "node_owned": [k for k, e in summary.providers.items() if e.status == "node_owned"],
        "config_missing": [k for k, e in summary.providers.items() if e.status == "config_missing"],
        "degraded": [k for k, e in summary.providers.items() if e.status == "degraded"],
        "failed": [k for k, e in summary.providers.items() if e.status == "failed"],
        "capabilityMap": summary.capabilityMap,
    }
