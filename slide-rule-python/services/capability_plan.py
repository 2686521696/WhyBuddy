"""PC / 手机产品推演的可编排工具。

## 公开工具就这五个

    spec → pages → structure → bind → closure

能力已经在，只是焊死在 `run_spec_first` + `appbundle.runtimeClosure` 一条顺序里。
本文件把它们收成计划：计划说跑哪些；默认顺序仍是今天这条。

内部 `_stage`（design / shell / semantics / assemble / graphscope / pagescope）
是工具的实现细节，不是另一套公开工具。`specfirst.shell` 故意不进进度线。

⚠ 2026-08-31：上一版用关键词分流（手表 → game-prototype），SPEC 被带偏。
本文件**不看话题词**。desktop / phone 永远返回下面这份。其它原型不在这里接通。

## 收口是第五个工具，不在 spec-first 函数体里

spec / pages / structure / bind 的门口在 `run_spec_first`。
closure 的门口在 `execute_v5_capability` 的 runtimeClosure 分支——生成跑完之后
才写发布信封。计划里拿掉 closure，不许补一份绿灯（fail-closed）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Tuple

PRODUCT_REHEARSAL = "product-rehearsal"

#: 公开工具。次序就是今天产品推演的默认编排。
TOOLS: Tuple[str, ...] = (
    "spec",
    "pages",
    "structure",
    "bind",
    "closure",
)

#: 范围卡 / 钟上的人话。键是公开工具，不是 specfirst id。
TOOL_LABELS: Tuple[Tuple[str, str], ...] = (
    ("spec", "起草 SPEC"),
    ("pages", "页面生成"),
    ("structure", "数据结构"),
    ("bind", "权限工作流"),
    ("closure", "完整性检查"),
)

#: 能力，但故意不进进度线（stage_legal 名单外）。
SILENT_CAPABILITIES: Tuple[str, ...] = ("specfirst.shell",)


def normalize_tools(raw: Optional[Iterable[str]]) -> Tuple[str, ...]:
    """只认公开五件套，次序跟 TOOLS 走。空 / 全是生词 → 默认全开。

    规划器可以减菜，不能发明第六道。空清单不许当成「什么都不跑」——
    那会端出一份空成功，正是闭环类 fail-closed 要挡的。
    """
    if raw is None:
        return TOOLS
    wanted = {str(item).strip() for item in raw}
    chosen = tuple(name for name in TOOLS if name in wanted)
    return chosen if chosen else TOOLS


class FactoryToolsRefused(ValueError):
    """规划器点了名，但没有一件落在 legal 里。不许回落整份菜单。"""


def clip_factory_tools(
    proposed: Optional[Iterable[object]],
    legal: Optional[Iterable[str]] = None,
    *,
    refine: bool = False,
) -> Tuple[str, ...]:
    """规划器只能在 legal 里减菜，不能发明、不能换序。

    「没提案」（None）和「提案全不合法」不是一回事：
    前者回落 legal（范围卡那份）；后者拒绝——回落菜单会把一跳一件
    装回不通电的插座（2026-09-02 真机 capabilityPlan=product-rehearsal
    一口气跑完全链）。
    """
    legal_chosen = normalize_tools(legal)
    if proposed is None:
        chosen = legal_chosen
    else:
        items = list(proposed)
        seen: set[str] = set()
        for item in items:
            if isinstance(item, dict):
                cap = str(item.get("capabilityId") or item.get("id") or "").strip()
            else:
                cap = str(item or "").strip()
            if cap in legal_chosen:
                seen.add(cap)
        if not items:
            chosen = legal_chosen
        elif not seen:
            raise FactoryToolsRefused("提案全不合法，拒绝回落整份菜单")
        else:
            chosen = tuple(name for name in TOOLS if name in seen)
    if not refine and "spec" not in chosen:
        chosen = ("spec",) + tuple(name for name in chosen if name != "spec")
    return chosen


#: 不是 spec-first 阶段的 stages 键。断言「实际执行 = tools 展开」时要剥掉。
_STAGES_META = frozenset(
    {
        "capabilityPlan",
        "orphans",
        "qualityNotices",
        "pageIdMatch",
        "refineReuse",
    }
)


def executed_stage_ids(stages: Optional[dict]) -> Tuple[str, ...]:
    """stages 字典里真正跑过的 specfirst.* id。"""
    if not isinstance(stages, dict):
        return ()
    return tuple(
        f"specfirst.{key}" for key in stages if key not in _STAGES_META
    )


#: 精修时没拿到上一版页面，pagescope 会跳过。不许因此把「多跑了整链」放过。
_OPTIONAL_SKIPS = frozenset({"specfirst.pagescope"})


def assert_stages_match_tools(
    tools: Iterable[str],
    stages: Optional[dict],
    *,
    refine: bool = False,
) -> None:
    """clip / 计划出口：不许多跑声明之外的阶段。

    2026-09-02 真机：规划器没点名就回落整份菜单，控制面还以为自己只点了
    spec。盯「多跑了什么」——缺 pagescope（没上一版页面）不是这道闸的目标。
    """
    declared = set(expand_tools(tools, refine=refine))
    actual = set(executed_stage_ids(stages))
    extra = actual - declared
    missing = (declared - _OPTIONAL_SKIPS) - actual
    if extra or missing:
        raise AssertionError(
            "本跳 tools="
            f"{tuple(tools)} 展开 {sorted(declared)} 实际 {sorted(actual)}"
            f" extra={sorted(extra)} missing={sorted(missing)}"
        )


def expand_tools(tools: Iterable[str], *, refine: bool = False) -> Tuple[str, ...]:
    """公开工具展开成 `run_spec_first` 里的 `_stage` id。

    closure 不是 spec-first 阶段，不进这份展开——它的门口在执行器。
    """
    wanted = tuple(tools)
    seen = set(wanted)
    ids: list[str] = []
    if refine and "spec" in seen:
        ids.append("specfirst.graphscope")
    if "spec" in seen:
        ids.extend(("specfirst.spec", "specfirst.design"))
    if refine and "pages" in seen:
        ids.append("specfirst.pagescope")
    if "pages" in seen:
        ids.extend(("specfirst.pages", "specfirst.shell"))
    if "structure" in seen or "bind" in seen:
        # bind 隐含 assemble。子集缺依赖闭包时 bind_pages(pages, None)
        # 会静默把整批打孔归零（2026-09-02 执行单 P1-3）。
        ids.extend(("specfirst.structure", "specfirst.semantics", "specfirst.assemble"))
    if "bind" in seen:
        ids.append("specfirst.bind")
    return tuple(ids)


# 新建一轮。顺序必须跟 run_spec_first 里 `_stage` 出现的次序一致。
NEW_RUN: Tuple[str, ...] = expand_tools(TOOLS, refine=False)

# 精修一轮。graphscope 在 spec 之前——2026-08-18 把插座挪过，别搬回去。
REFINE_RUN: Tuple[str, ...] = expand_tools(TOOLS, refine=True)


@dataclass(frozen=True)
class CapabilityPlan:
    """一份本轮要跑的能力清单。tools 是公开编排，ids 是内部阶段。"""

    name: str
    ids: Tuple[str, ...]
    device: str = "desktop"
    tools: Tuple[str, ...] = TOOLS

    def includes(self, capability_id: str) -> bool:
        if capability_id in self.tools:
            return True
        return capability_id in self.ids

    def visible_ids(self) -> Tuple[str, ...]:
        """进度线用：去掉故意不报的能力。"""
        silent = set(SILENT_CAPABILITIES)
        return tuple(cap for cap in self.ids if cap not in silent)


def product_rehearsal_plan(
    *,
    device: str = "desktop",
    refine: bool = False,
    tools: Optional[Iterable[str]] = None,
) -> CapabilityPlan:
    """PC / 手机的默认计划。device 只作记录，不改变工具清单。"""
    chosen = normalize_tools(tools)
    if not refine and "spec" not in chosen and len(chosen) != 1:
        # 多件菜单漏了 spec 就补根。单跳 host 已经选定 pages/bind/closure
        # 时不要塞回去——否则「上一跳 SPEC」被这一跳重写成又起草一遍。
        chosen = ("spec",) + tuple(name for name in chosen if name != "spec")
    ids = expand_tools(chosen, refine=bool(refine))
    return CapabilityPlan(
        name=PRODUCT_REHEARSAL,
        ids=ids,
        device=str(device or "desktop"),
        tools=chosen,
    )


__all__ = [
    "PRODUCT_REHEARSAL",
    "TOOLS",
    "NEW_RUN",
    "REFINE_RUN",
    "SILENT_CAPABILITIES",
    "TOOL_LABELS",
    "CapabilityPlan",
    "expand_tools",
    "executed_stage_ids",
    "assert_stages_match_tools",
    "normalize_tools",
    "clip_factory_tools",
    "FactoryToolsRefused",
    "product_rehearsal_plan",
]
