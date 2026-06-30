"""Python-owned runtime facade for Web AIGC open-page / open-report / open-dashboard long-tail adapters.

Node acts as thin proxy.
"""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, field_validator


OPEN_ADAPTER_CONTRACT_VERSION = "web_aigc.open_runtime.v1"

OpenKind = Literal["open_page", "open_report", "open_dashboard"]
OpenStatus = Literal["completed", "denied", "not_found", "error"]


def _non_empty(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("must be non-empty string")
    return value.strip()


class OpenRuntimeMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    backend: Literal["python"] = "python"
    provider: Literal["python-facade"] = "python-facade"
    source: str = "open-python-adapter-105"
    externalCalls: Literal[False] = False


class OpenRuntimeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    nodeType: str
    status: OpenStatus
    kind: OpenKind
    title: str
    mode: str = "push"
    resource: str
    target: Dict[str, Any] = {}
    context: Dict[str, Any] = {}
    governance: Dict[str, Any] = {}
    runtime: Dict[str, Any] = {}
    warnings: list[str] = []
    error: Optional[Dict[str, str]] = None


def execute_open_runtime_bridge(payload: Dict[str, Any]) -> OpenRuntimeResponse:
    """Python owned for open-* paths."""
    node_type = str(payload.get("nodeType") or "open_page")
    inp = payload.get("input") or payload or {}
    kind: OpenKind = "open_page"
    if "report" in node_type or "reportType" in inp:
        kind = "open_report"
    elif "dashboard" in node_type:
        kind = "open_dashboard"

    page_id = inp.get("pageId") or inp.get("route") or "home"
    title = inp.get("title") or f"Python open {kind} {page_id}"
    mode = inp.get("openMode") or "push"

    return OpenRuntimeResponse(
        ok=True,
        nodeType=node_type,
        status="completed",
        kind=kind,
        title=title,
        mode=mode,
        resource=str(page_id),
        target={
            "kind": "internal_route" if kind == "open_page" else "report",
            "href": f"/py/{kind}/{page_id}",
            "apiHref": f"/api/py-open/{kind}/{page_id}",
        },
        context={"pythonFacade": True, "input": inp},
        governance={"permission": {"allowed": True, "auditId": f"py-open-105-{kind}"}},
        runtime=OpenRuntimeMetadata(source=f"open-{kind}-105").model_dump(),
        warnings=[],
    )
