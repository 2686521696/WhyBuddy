# -*- coding: utf-8 -*-
"""工作流主机：往叶子注册表里登记本产品的配方。

抄 grok：`xai-workflow` 是叶子引擎（谁都不依赖），具体脚本由 host 注入。
`select_workflow` 是 host，不是引擎——它读能力计划 / 原型政策，所以不能
住在 workflow_registry 里，否则叶子立刻依赖编排。

抄 grok `WorkflowTool`：日历是可挑选的 WRITE 工具，按 **name** 取已登记
配方。`select_workflow` 没有 `goal` 参数——加回去等于再给关键词分流开口。

⚠ 2026-09-02：第一版每次 select 都 `register_workflow(replace=True)` 把
product-rehearsal 覆盖成这一趟的减菜。下一趟 `workflow_for` 拿到的是被
冲掉的日历，唯一配方自己咬自己。注册表只登记配方，本趟计划只从函数
返回值走。
"""

from __future__ import annotations

from typing import Iterable, Optional

from services.workflow_registry import WorkflowPreset, register_workflow, workflow_for

PAGES_PREVIEW = "pages-preview"
PAGES_PREVIEW_TOOLS = ("spec", "pages", "closure")


def select_workflow(
    *,
    name: str = "",
    archetype: str = "",
    device: str = "desktop",
    refine: bool = False,
    tools: Optional[Iterable[str]] = None,
) -> WorkflowPreset:
    """按已登记名字取日历。话题词不进这个函数。

    函数体里取 product_rehearsal_plan / allowed_tools / expand_tools，
    好让测试能替换。顶层绑定会让打孔测试假绿。
    """
    from services.archetype_legal import DEFAULT_ARCHETYPE, UnknownArchetype, allowed_tools
    from services.capability_plan import (
        PRODUCT_REHEARSAL,
        expand_tools,
        normalize_tools,
        product_rehearsal_plan,
    )

    key = "-".join(str(name or "").strip().lower().replace("_", "-").split())
    if key and key != PRODUCT_REHEARSAL:
        try:
            base = workflow_for(key)
        except KeyError:
            base = None
        if base is not None:
            legal = base.tools or ()
            if tools is None:
                chosen = legal or normalize_tools(None)
            else:
                wanted = set(normalize_tools(tools))
                chosen = tuple(item for item in legal if item in wanted) or legal
            if not refine and "spec" not in chosen:
                chosen = ("spec",) + tuple(item for item in chosen if item != "spec")
            return WorkflowPreset(
                name=base.name,
                stages=expand_tools(chosen, refine=bool(refine)),
                description=base.description,
                tools=chosen,
            )

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


def register_product_rehearsal() -> None:
    """兼容旧测试：注册表里要能 workflow_for('product-rehearsal')。"""
    register_workflow(select_workflow(), replace=True)


def register_pages_preview() -> None:
    """先出页面、不打权限孔。控制面 `workflow` 工具按名字挑选。"""
    reduced = select_workflow(tools=PAGES_PREVIEW_TOOLS)
    register_workflow(
        WorkflowPreset(
            name=PAGES_PREVIEW,
            stages=reduced.stages,
            description=(
                "先出页面，不跑 structure/bind。"
                "用户说只要看板、先看一眼、先不权限时用。"
            ),
            tools=PAGES_PREVIEW_TOOLS,
        ),
        replace=True,
    )


register_product_rehearsal()
register_pages_preview()
