"""Node-bridge production adapters for skill.invoke / mcp.call.

绞杀者迁移（strangler）：Python 拥有 skill/mcp 的运行时边界与错误语义，
真实执行暂时桥接到 Node 现有端点；换成 Python 原生实现时只需替换适配器，
调用方（slide_rule_executor / execute-capability）不感知。

- skill.invoke -> POST {node}/api/skills/{skill_id}/execute
- mcp.call    -> POST {node}/api/mcp/nodes/execute

权限语义：mcp.call 的 PDP 判定仍由 Node 适配器内部执行（executeMcpNode 自带
permission gate），桥接侧的 permission checker 只声明"已委托"，并把 Node 的
denied / approval_required 结果翻译回 Python 的错误语义，不做 allow-all 旁路。
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional, Tuple
from urllib import error as urllib_error
from urllib import request as urllib_request

from config.settings import settings
from services.mcp_runtime import (
    McpAdapterError,
    McpAdapterUnavailable,
    McpPermissionDecision,
    McpPermissionRequest,
    McpRuntime,
    McpToolInvokeRequest,
    McpToolInvokeResult,
    McpToolNotFoundError,
    create_mcp_runtime,
    get_mcp_runtime,
    set_mcp_runtime,
)
from services.skill_runtime import (
    SkillInvokeRequest,
    SkillInvokeResult,
    SkillNotFoundError,
    SkillRuntime,
    SkillRuntimeError,
    SkillRuntimeUnavailable,
    create_skill_runtime,
    get_skill_runtime,
    set_skill_runtime,
)

NODE_BRIDGE_RUNTIME_NAME = "node-bridge"
NODE_BRIDGE_SKILL_PROVENANCE = "python-node-bridge-skill"
NODE_BRIDGE_MCP_PROVENANCE = "python-node-bridge-mcp"
NODE_BRIDGE_PERMISSION_PROVENANCE = "python-node-bridge-permission"

_DEFAULT_TIMEOUT_S = 30.0


class NodeBridgeMcpDenied(McpAdapterError):
    """Node PDP denied (or requires approval for) the mcp.call."""

    error_type = "permission_denied"
    error_code = "mcp_permission_denied"


def _post_json(
    url: str, payload: Dict[str, Any], timeout_s: float
) -> Tuple[int, Dict[str, Any]]:
    """POST JSON and return (status, parsed body). Non-2xx does not raise here."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib_request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib_request.urlopen(req, timeout=timeout_s) as resp:  # noqa: S310
            status = int(resp.getcode() or 0)
            body = resp.read().decode("utf-8", errors="replace")
    except urllib_error.HTTPError as exc:  # non-2xx is still a response
        status = int(exc.code)
        body = exc.read().decode("utf-8", errors="replace")
    try:
        parsed = json.loads(body) if body else {}
    except json.JSONDecodeError:
        parsed = {"raw": body[:500]}
    if not isinstance(parsed, dict):
        parsed = {"value": parsed}
    return status, parsed


def _node_base_url() -> str:
    return settings.NODE_BRIDGE_BASE_URL.rstrip("/")


class NodeBridgeSkillAdapter:
    def __init__(self, *, base_url: Optional[str] = None, timeout_s: float = _DEFAULT_TIMEOUT_S, post=_post_json):
        self._base_url = base_url
        self._timeout_s = timeout_s
        self._post = post

    def invoke(self, request: SkillInvokeRequest) -> SkillInvokeResult:
        base = (self._base_url or _node_base_url()).rstrip("/")
        url = f"{base}/api/skills/{request.skill_id}/execute"
        payload: Dict[str, Any] = {
            "input": {"text": request.input, "arguments": request.arguments},
            "stage": "python_node_bridge",
        }
        try:
            status, body = self._post(url, payload, self._timeout_s)
        except urllib_error.URLError as exc:
            raise SkillRuntimeUnavailable(f"node bridge unreachable: {exc}") from exc
        except OSError as exc:
            raise SkillRuntimeUnavailable(f"node bridge unreachable: {exc}") from exc

        if status == 404:
            raise SkillNotFoundError(
                str(body.get("error") or f"skill {request.skill_id} not found")
            )
        if status >= 500:
            raise SkillRuntimeUnavailable(
                str(body.get("error") or f"node bridge returned HTTP {status}")
            )
        if status >= 400:
            raise SkillRuntimeError(
                str(body.get("error") or f"node bridge returned HTTP {status}")
            )

        output = body.get("output")
        if not isinstance(output, str):
            output = json.dumps(body, ensure_ascii=False)
        return SkillInvokeResult(
            output=output,
            response=body,
            runtime=NODE_BRIDGE_RUNTIME_NAME,
            provenance=NODE_BRIDGE_SKILL_PROVENANCE,
        )


class NodeBridgeMcpAdapter:
    def __init__(self, *, base_url: Optional[str] = None, timeout_s: float = _DEFAULT_TIMEOUT_S, post=_post_json):
        self._base_url = base_url
        self._timeout_s = timeout_s
        self._post = post

    def invoke(self, request: McpToolInvokeRequest) -> McpToolInvokeResult:
        base = (self._base_url or _node_base_url()).rstrip("/")
        url = f"{base}/api/mcp/nodes/execute"
        payload: Dict[str, Any] = {
            "nodeType": "mcp",
            "input": {
                "serverId": request.server_id,
                "toolName": request.tool_name,
                "input": request.input or json.dumps(request.arguments, ensure_ascii=False),
                "arguments": request.arguments,
                "workflowId": request.session_id or None,
            },
        }
        try:
            status, body = self._post(url, payload, self._timeout_s)
        except urllib_error.URLError as exc:
            raise McpAdapterUnavailable(f"node bridge unreachable: {exc}") from exc
        except OSError as exc:
            raise McpAdapterUnavailable(f"node bridge unreachable: {exc}") from exc

        output_payload = body.get("output") if isinstance(body.get("output"), dict) else {}
        node_status = output_payload.get("status")
        if status in (403, 409) or node_status in ("denied", "approval_required"):
            raise NodeBridgeMcpDenied(
                str(
                    output_payload.get("reason")
                    or body.get("error")
                    or f"mcp.call {node_status or status} by node PDP"
                )
            )
        if status == 404:
            raise McpToolNotFoundError(
                str(body.get("error") or f"mcp tool {request.tool_name} not found")
            )
        if status >= 500 or node_status == "failed":
            raise McpAdapterError(
                str(body.get("error") or output_payload.get("error") or f"node bridge returned HTTP {status}")
            )
        if status >= 400:
            raise McpAdapterError(
                str(body.get("error") or f"node bridge returned HTTP {status}")
            )

        text = output_payload.get("text") or output_payload.get("output")
        if not isinstance(text, str):
            text = json.dumps(body, ensure_ascii=False)
        return McpToolInvokeResult(
            output=text,
            response=body,
            provenance=NODE_BRIDGE_MCP_PROVENANCE,
        )


class NodeBridgeMcpPermissionChecker:
    """PDP 判定委托给 Node 适配器内部的 permission gate（见模块 docstring）。"""

    def check(self, request: McpPermissionRequest) -> McpPermissionDecision:
        return McpPermissionDecision(
            allowed=True,
            reason="delegated to node mcp adapter permission gate",
            provenance=NODE_BRIDGE_PERMISSION_PROVENANCE,
            details={"serverId": request.server_id, "toolName": request.tool_name},
        )


def create_node_bridge_skill_runtime(**adapter_kwargs: Any) -> SkillRuntime:
    return create_skill_runtime(
        adapter=NodeBridgeSkillAdapter(**adapter_kwargs),
        runtime=NODE_BRIDGE_RUNTIME_NAME,
        provenance=NODE_BRIDGE_SKILL_PROVENANCE,
    )


def create_node_bridge_mcp_runtime(**adapter_kwargs: Any) -> McpRuntime:
    return create_mcp_runtime(
        adapter=NodeBridgeMcpAdapter(**adapter_kwargs),
        permission_checker=NodeBridgeMcpPermissionChecker(),
    )


def configure_node_bridge_runtimes(*, force: bool = False) -> bool:
    """Install node-bridge runtimes at startup unless disabled or already set."""
    if not settings.NODE_BRIDGE_RUNTIME_ENABLED:
        return False
    installed = False
    if force or get_skill_runtime() is None:
        set_skill_runtime(create_node_bridge_skill_runtime())
        installed = True
    if force or get_mcp_runtime() is None:
        set_mcp_runtime(create_node_bridge_mcp_runtime())
        installed = True
    return installed
