"""Python-owned runtime facade for get-device-info and get-location-info long-tail.

Thin proxy in Node; Python owns normalization and privacy summary responses.
"""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict


DEVICE_LOCATION_CONTRACT_VERSION = "web_aigc.device_location_runtime.v1"

DeviceStatus = Literal["completed", "degraded", "error"]
LocationStatus = Literal["completed", "denied", "not_found", "error"]


class DeviceLocationRuntimeMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    backend: Literal["python"] = "python"
    provider: Literal["python-facade"] = "python-facade"
    source: str = "device-location-python-105"
    externalCalls: Literal[False] = False


class DeviceLocationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    nodeType: str
    status: str
    runtime: Dict[str, Any] = {}
    client: Optional[Dict[str, Any]] = None
    location: Optional[Dict[str, Any]] = None
    privacy: Dict[str, Any] = {}
    warnings: list[str] = []
    metadata: Dict[str, Any] = {}


def execute_device_location_runtime_bridge(payload: Dict[str, Any]) -> DeviceLocationResponse:
    """Python facade for device + location unified."""
    node_type = str(payload.get("nodeType") or "get_device_info")
    inp = payload.get("input") or payload or {}
    privacy = inp.get("privacy") or {}
    client_hints = inp.get("clientHints") or {}

    if "device" in node_type or node_type == "get_device_info":
        runtime = {
            "runtime": "python",
            "platform": "python-facade",
            "arch": "facade",
            "nodeVersion": "n/a-py",
        }
        client = None
        if client_hints:
            client = {
                "platform": client_hints.get("platform"),
                "browserFamily": "PythonClient",
                "osFamily": client_hints.get("platform", "Unknown"),
            }
        return DeviceLocationResponse(
            ok=True,
            nodeType="get_device_info",
            status="completed",
            runtime=runtime,
            client=client,
            privacy={
                "collectionMode": "summary_only",
                "rawUserAgentStored": False,
                "retention": privacy.get("retention", "ephemeral"),
            },
            warnings=["device summary via python facade"],
            metadata={"pythonOwned": True},
        )

    # location
    coarse = inp.get("coarseLocation") or {}
    return DeviceLocationResponse(
        ok=True,
        nodeType="get_location_info",
        status="completed",
        location={
            "status": "granted",
            "latitude": coarse.get("latitude", 0.0),
            "longitude": coarse.get("longitude", 0.0),
            "accuracy": "python-facade",
            "source": "facade",
        },
        privacy={
            "authorization": inp.get("authorization", "not_requested"),
            "retention": "ephemeral",
        },
        warnings=["location via python facade"],
        metadata={"pythonOwned": True},
    )
