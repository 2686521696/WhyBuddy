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

#: 开始推演一口气跑完的产出链。closure 是判定，留给迭代。
#: 2026-09-03 用户（团子）：一跳一停手点 structure/bind，画布块之间
#: 的关联关系看不见。首轮必须把数据模型、权限工作流、绑定做完。
FIRST_PASS_TOOLS: Tuple[str, ...] = ("spec", "pages", "structure", "bind")

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


def first_pass_tools(legal: Optional[Iterable[str]] = None) -> Tuple[str, ...]:
    """开始推演的菜单：产出链 ∩ 范围卡减菜。

    空 / 生词回落整份首轮，不许端出空成功。closure 即使勾了也不进首轮。
    """
    if legal is None:
        return FIRST_PASS_TOOLS
    wanted = {str(item).strip() for item in legal}
    chosen = tuple(name for name in FIRST_PASS_TOOLS if name in wanted)
    return chosen if chosen else FIRST_PASS_TOOLS


def remaining_first_pass_tools(
    legal: Optional[Iterable[str]] = None,
    *,
    has_spec: bool = False,
    has_pages: bool = False,
) -> Tuple[str, ...]:
    """假设卡确认继续：首轮还没跑完的产出跳。"""
    skip = set()
    if has_spec:
        skip.add("spec")
    if has_pages:
        skip.add("pages")
    return tuple(name for name in first_pass_tools(legal) if name not in skip)


def is_first_pass_chain(tools: Optional[Iterable[str]]) -> bool:
    """goal.tools 是两件及以上的首轮产出链（不是 host 一跳一件）。"""
    chosen = tuple(str(item).strip() for item in (tools or ()) if str(item).strip())
    if len(chosen) < 2:
        return False
    allowed = set(FIRST_PASS_TOOLS)
    return all(name in allowed for name in chosen)


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
    floor: Optional[Iterable[str]] = None,
    has_spec: bool = False,
) -> Tuple[str, ...]:
    """规划器只能在 legal 里减菜，不能发明、不能换序。

    「没提案」（None）和「提案全不合法」不是一回事：
    前者回落 legal（范围卡那份）；后者拒绝——回落菜单会把一跳一件
    装回不通电的插座（2026-09-02 真机 capabilityPlan=product-rehearsal
    一口气跑完全链）。

    ## floor：产品裁决写进边界，不指望模型自觉（2026-09-04）

    `FIRST_PASS_TOOLS` 上面钉着一条用户裁决：

        2026-09-03 用户（团子）：一跳一停手点 structure/bind，画布块之间的
        关联关系看不见。**首轮必须把数据模型、权限工作流、绑定做完。**

    节点内 ReAct 通电（v5_full_driver 那个剖面排除去掉）之后，真机
    sr-20260904041125 第 2 跳模型就把它摘了：

        规则给的 pages,structure,bind → 模型选的 pages
        理由：聚焦页面绘制与视觉原型，跳过数据实体建模与权限工作流打孔

    那一趟终态没坏（19 节点、6/6 bound），但**不是因为有护栏，是因为后面
    又跳了两次、控制面 LLM 恰好把 structure 捡了回来**。用户在页面出来那一刻
    收手，拿到的就是一份没绑定的原型——正是团子那条抱怨。

    ⚠ 病根不只是「少做一件」，是**减菜会把首轮链的身份抹掉**：
      stamp 成 `['pages']` 之后 `is_first_pass_chain` 变 False（len < 2），
      「首轮必须做完」这条不变量连载体都没了，后面全靠运气。

    所以 floor 里的工具**只要 legal 里有，就必须留在结果里**。模型在首轮链上
    因此没有减菜空间——这是产品裁决本来就没留空间，不是护栏过严；它的自由
    仍在一跳一件、pages-preview 这类别的配方、以及精修轮上。
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
    # 产品裁决兜底：floor ∩ legal 一件都不许少。放在补根之前——
    # 补根那条会看 len(chosen)，先把地板垫上，判断的才是最终清单。
    # ⚠ 不许走 normalize_tools：它「空 / 全是生词 → 默认全开」（见其头注），
    #   于是 floor=None / () 会被当成「五件全是地板」，把一跳一件也强行补成
    #   整条链。本文件第一版就栽在这，是下面三条反向判据逮出来的：
    #   `clip_factory_tools([pages], (pages,structure,bind))` 本该原样返回
    #   ('pages',)，实测返回了 ('spec','pages','structure','bind')。
    _floor_raw = tuple(str(item).strip() for item in (floor or ()) if str(item or "").strip())
    floor_chosen = tuple(
        name for name in TOOLS if name in set(_floor_raw) and name in legal_chosen
    )
    if floor_chosen:
        kept = set(chosen) | set(floor_chosen)
        chosen = tuple(name for name in TOOLS if name in kept)
    # 多件菜单漏了 spec 就补根。单跳（len==1）看会话前置，不在菜单里塞
    # spec——否则 ['bind'] 进 run_spec_first 没有 SPEC 直接抛（建设单 O-4）。
    # 空会话单跳由 _factory_hop_blocker 说人话。
    #
    # ⚠ 2026-09-04：**会话已经有 SPEC 就没有根要补**，而且补了会出事。
    #   真机 sr-20260904050038（洗衣店）：加了 floor 之后剩余链从 ('pages',)
    #   变成 ('pages','structure','bind')，len != 1 于是这里补上 spec →
    #   spec_first_pipeline:1436 的去根判据是「spec 不在 _requested 里」，
    #   一带上 spec 就不去根 → **整跳预算烧在重起草一份不一样的 SPEC 上**
    #   （5 页 16 节点 → 4 页 13 节点），页面落库 0 份，25 分钟白跑。
    #
    #   这正是 b6e0ab3 修过的那个事故原样复发：那次靠的是模型减到单件、
    #   len==1 侥幸绕开补根，不是真的挡住了。地板把侥幸拿掉，病就露出来。
    #   补根的前提本来就是「没有 SPEC」，现在把这个前提写出来。
    if not refine and not has_spec and "spec" not in chosen and len(chosen) != 1:
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
        # 伴随式澄清当场停：这是标记，不是跑过的阶段。
        "assumptionsHeld",
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
#: 这些阶段"该跑没跑"不算违规——它们各自还有前置条件，展开时判不出来。
#: ⚠ graphscope（2026-09-04 补）：展开只看 `refine and "spec" in tools`，
#:   而流水线要 `refine and reuse_model and _shadow_on`（spec_first_pipeline:1507）。
#:   精修但没有上一版模型时，声明有、实跑没有 → 这道闸把整条链判死，
#:   31 条判据一起红。跟 pagescope 是同一形状（"没上一版页面"）。
#:   这道闸的目标写在下面的 docstring 里：盯"多跑了什么"。
#:   反向不空：`test_refine_graph_scope.py:460+` 钉着"带上一版模型时
#:   graphscope 必须真的跑、decider 必须对"，放宽这里不会让它静默消失。
_OPTIONAL_SKIPS = frozenset({"specfirst.pagescope", "specfirst.graphscope"})

#: 假设卡一出就停在 SPEC：design 及之后本跳不再跑，选完下一跳再跑。
_HELD_OPTIONAL_SKIPS = frozenset(
    {
        "specfirst.design",
        "specfirst.pagescope",
        "specfirst.pages",
        "specfirst.shell",
        "specfirst.structure",
        "specfirst.semantics",
        "specfirst.assemble",
        "specfirst.bind",
    }
)


def assert_stages_match_tools(
    tools: Iterable[str],
    stages: Optional[dict],
    *,
    refine: bool = False,
) -> None:
    """clip / 计划出口：不许多跑声明之外的阶段。

    2026-09-02 真机：规划器没点名就回落整份菜单，控制面还以为自己只点了
    spec。盯「多跑了什么」——缺 pagescope（没上一版页面）不是这道闸的目标。

    2026-09-03：伴随式澄清出卡后本跳停在 SPEC，design 及之后允许缺。
    pages 单跳在上一跳没定风格时会补跑 design（不在展开里），允许多。
    """
    declared = set(expand_tools(tools, refine=refine))
    actual = set(executed_stage_ids(stages))
    extra = actual - declared
    optional = set(_OPTIONAL_SKIPS)
    if isinstance(stages, dict) and stages.get("assumptionsHeld"):
        optional |= _HELD_OPTIONAL_SKIPS
    tool_names = {str(item or "").strip() for item in (tools or ())}
    # spec 单跳被假设卡停住 → 下一跳 pages 必须能定风格。展开不含
    # design（以免整链 spec+pages 跑两遍），所以这里允许多跑这一份。
    if (
        "specfirst.design" in extra
        and "pages" in tool_names
        and "spec" not in tool_names
    ):
        extra.discard("specfirst.design")
    missing = (declared - optional) - actual
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
    "FIRST_PASS_TOOLS",
    "first_pass_tools",
    "remaining_first_pass_tools",
    "is_first_pass_chain",
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
