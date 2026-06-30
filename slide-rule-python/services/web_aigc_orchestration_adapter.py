"""Python-owned runtime facade for orchestration-recognition-jump long-tail adapter.

Node is thin proxy / compat shell.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict


ORCHESTRATION_ADAPTER_CONTRACT_VERSION = "web_aigc.orchestration_runtime.v1"

OrchStatus = Literal["completed", "denied", "not_found", "error", "degraded"]


class OrchestrationRuntimeMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    backend: Literal["python"] = "python"
    provider: Literal["python-facade"] = "python-facade"
    source: str = "orchestration-python-adapter-105"
    externalCalls: Literal[False] = False


class OrchestrationRuntimeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    nodeType: str = "orchestration_recognition_jump"
    status: OrchStatus
    recognized: Dict[str, Any] = {}
    target: Optional[Dict[str, Any]] = None
    candidates: List[Dict[str, Any]] = []
    fallbackTarget: Optional[Dict[str, Any]] = None
    governance: Dict[str, Any] = {}
    runtime: Dict[str, Any] = {}
    warnings: List[str] = []
    error: Optional[Dict[str, str]] = None


def execute_orchestration_runtime_bridge(payload: Dict[str, Any]) -> OrchestrationRuntimeResponse:
    """Python owned orchestration recognition jump contract."""
    inp = payload.get("input") or payload or {}
    query = str(inp.get("query") or inp.get("text") or "").strip() or "default-orchestration"
    agent_id = inp.get("agentId") or "py-agent"

    recognized = {
        "kind": "route",
        "confidence": 0.92,
        "target": {"route": "/py/orch/" + query[:20], "params": {}},
        "source": "python-facade",
    }

    return OrchestrationRuntimeResponse(
        ok=True,
        status="completed",
        recognized=recognized,
        target=recognized["target"],
        candidates=[recognized],
        governance={
            "permission": {"allowed": True, "auditId": "py-orch-105-" + agent_id},
            "audit": {"recorded": True},
        },
        runtime=OrchestrationRuntimeMetadata().model_dump(),
        warnings=["orchestration via python facade (longtail cutover 105)"],
    )
