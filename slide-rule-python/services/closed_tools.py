# -*- coding: utf-8 -*-
"""闭集工具词表。抄 grok-build `xai-tool-types`：名字 / 写权限是叶子，
谁都能依赖它，它不依赖 services 里任何其它模块。

运行时谓词（这一轮列不列、批不批准）留在 rehearsal_control——那些要读会话，
搬进来叶子就立刻不是叶子。

⚠ 缺省 Read：新工具不进工厂。要写必须在 TOOL_SCOPE 里显式声明 WRITE。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Tuple


class ToolScope(str, Enum):
    """工具在「能不能造一份新五系统模型」这条轴上的权限。

    抄 grok-build `xai-tool-protocol` ToolScope { Read, Write }。
    Absence is treated as Read.
    """

    READ = "read"
    WRITE = "write"


#: 工厂公开工具。抄 grok：每一跳是一件 WRITE，host 跑完再挑下一件。
FACTORY_HOPS: Tuple[str, ...] = (
    "spec",
    "pages",
    "structure",
    "bind",
    "closure",
)

CLOSED_TOOLS: Tuple[str, ...] = (
    "ask_user",
    "clarify",
    "search_evidence",
    "inspect_model",
    "scope_card",
    "rehearse",
    "workflow",
    *FACTORY_HOPS,
    "refine",
    "challenge",
    "repair",
    "restore_version",
    "fork_variant",
)

# 只列 WRITE。没写的一律 READ。
TOOL_SCOPE: Dict[str, ToolScope] = {
    "rehearse": ToolScope.WRITE,
    "workflow": ToolScope.WRITE,
    "spec": ToolScope.WRITE,
    "pages": ToolScope.WRITE,
    "structure": ToolScope.WRITE,
    "bind": ToolScope.WRITE,
    "closure": ToolScope.WRITE,
    "refine": ToolScope.WRITE,
    "repair": ToolScope.WRITE,
}


class ToolScopeViolation(RuntimeError):
    """READ 权限的工具试图进工厂信封。fail-closed：抛，不降级放行。"""


def resolve_tool_scope(name: Any) -> ToolScope:
    """查权限。没声明的一律 READ（含拼错的、以后新加的）。"""
    return TOOL_SCOPE.get(str(name or "").strip(), ToolScope.READ)


def is_closed_tool(name: Any) -> bool:
    return str(name or "").strip() in CLOSED_TOOLS
