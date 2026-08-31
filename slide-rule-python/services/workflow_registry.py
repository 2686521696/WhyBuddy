"""Named workflow presets. Live PC/mobile selection is the capability plan.

日历从范围卡上的 原型×设备 派生，不看话题词。`select_workflow` 没有
`goal` 参数——加回去等于再给关键词分流开口。

⚠ 2026-08-31：第一版按「手表 / 游戏 / 巡检」关键词分流，真机户外手表话题
被带去 game-prototype。PC / 手机先只接通能力计划，其它原型不从这里选。
"""

from __future__ import annotations

from dataclasses import dataclass
from threading import RLock
from typing import Dict, Iterable, Optional, Tuple

from .capability_plan import PRODUCT_REHEARSAL, TOOLS


@dataclass(frozen=True)
class WorkflowPreset:
    """A workflow's stable identity and ordered stage contract."""

    name: str
    stages: Tuple[str, ...]
    description: str = ""
    tools: Tuple[str, ...] = TOOLS


_LOCK = RLock()
_PRESETS: Dict[str, WorkflowPreset] = {}


def _normalize(name: str) -> str:
    return "-".join(str(name or "").strip().lower().replace("_", "-").split())


def register_workflow(preset: WorkflowPreset, *, replace: bool = False) -> None:
    """Register a preset; duplicate names fail unless explicitly replaced."""
    key = _normalize(preset.name)
    if not key or key != preset.name:
        raise ValueError("workflow name must be normalized kebab-case")
    if not preset.stages or len(set(preset.stages)) != len(preset.stages):
        raise ValueError("workflow stages must be non-empty and unique")
    with _LOCK:
        if key in _PRESETS and not replace:
            raise ValueError(f"workflow already registered: {key}")
        _PRESETS[key] = preset


def workflow_for(name: str) -> WorkflowPreset:
    key = _normalize(name)
    with _LOCK:
        try:
            return _PRESETS[key]
        except KeyError as exc:
            raise KeyError(f"unknown workflow: {name}") from exc


def workflow_names() -> Tuple[str, ...]:
    with _LOCK:
        return tuple(sorted(_PRESETS))


def register_builtin_workflows() -> None:
    """Install the PC/mobile product-rehearsal preset from the capability plan."""
    from .capability_plan import product_rehearsal_plan

    plan = product_rehearsal_plan()
    preset = WorkflowPreset(
        name=PRODUCT_REHEARSAL,
        stages=plan.ids,
        description="Default evidence-backed product rehearsal for desktop and phone.",
        tools=plan.tools,
    )
    with _LOCK:
        if PRODUCT_REHEARSAL in _PRESETS:
            return
    register_workflow(preset)


def select_workflow(
    *,
    archetype: str = "",
    device: str = "desktop",
    refine: bool = False,
    tools: Optional[Iterable[str]] = None,
) -> WorkflowPreset:
    """PC / 手机的能力计划。原型×设备决定默认菜，话题词不进这个函数。

    函数体里取 product_rehearsal_plan / allowed_tools，好让测试能替换。
    顶层绑定会让打孔测试假绿。
    """
    from .archetype_legal import DEFAULT_ARCHETYPE, UnknownArchetype, allowed_tools
    from .capability_plan import normalize_tools, product_rehearsal_plan

    arch = str(archetype or "").strip() or DEFAULT_ARCHETYPE
    if tools is None:
        try:
            tools = allowed_tools(arch, device)
        except UnknownArchetype:
            tools = allowed_tools(DEFAULT_ARCHETYPE, device)
    plan = product_rehearsal_plan(
        device=device,
        refine=refine,
        tools=normalize_tools(tools),
    )
    return WorkflowPreset(
        name=plan.name,
        stages=plan.ids,
        description="Default evidence-backed product rehearsal for desktop and phone.",
        tools=plan.tools,
    )


register_builtin_workflows()


__all__ = [
    "WorkflowPreset",
    "register_workflow",
    "workflow_for",
    "workflow_names",
    "select_workflow",
]
