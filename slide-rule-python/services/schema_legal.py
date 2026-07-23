"""五系统模型合法域——单一真相源加载器（E40.1）。

背景：此前"什么写法是合法的"记在四处——结构门的常量、修复器的本地拷贝、
生成契约手写的枚举串、客户端渲染器的手抄版。四本账靠人肉对齐，E37 的
根因（charts/stats 的 metric 合法域不对称、修复器不知情）就是漏账的代价。

本模块是唯一入口：五系统枚举账本 `five_system_legal.json` 与体验区块账本
`experience_block_catalog.json` 都从这里加载，四方全部从这里派生——
  - 结构门 v5_model_gate：常量改为从此 import（对外名字不变，老引用零改动）
  - 修复器 v5_model_repair：经门的 re-export 自动跟随
  - 生成契约 v5_llm_generate：_SCHEMA_INSTRUCTION 的枚举段由 enum_str() 渲染
  - 客户端 live-runtime：构建期直接 import 同一 JSON（vite 全仓上下文），
    并有 vitest parity 测试锁死（见 legal-domains parity 测试）
加枚举 = 只改 JSON；哪一方没消费到，parity 测试当场红。

参考：阿里低代码引擎《物料协议》的"一份物料描述、编辑器/渲染器/校验器
共同消费"（docs/specs/material-spec）——同一思想的最小实现。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

_LEGAL_PATH = Path(__file__).resolve().parent / "data" / "five_system_legal.json"
_BLOCK_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "experience_block_catalog.json"

with _LEGAL_PATH.open(encoding="utf-8") as _f:
    _LEGAL: Dict[str, object] = json.load(_f)

with _BLOCK_CATALOG_PATH.open(encoding="utf-8") as _f:
    _BLOCK_CATALOG: Dict[str, object] = json.load(_f)


def _tuple(key: str) -> tuple:
    value = _LEGAL.get(key)
    if not isinstance(value, list) or not value:
        raise ValueError(f"five_system_legal.json 缺失或为空: {key}")
    return tuple(str(v) for v in value)


LEGAL_VERSION: int = int(_LEGAL.get("version", 0))

FIELD_TYPES = _tuple("fieldTypes")
FIELD_TONES = _tuple("fieldTones")
NUMBER_FORMATS = _tuple("numberFormats")
STRING_FORMATS = _tuple("stringFormats")
STAT_FORMATS = _tuple("statFormats")
PAGE_KINDS = _tuple("pageKinds")
CHART_TYPES = _tuple("chartTypes")
METRIC_BARE = _tuple("metricBare")
CHART_METRIC_PREFIXES = _tuple("chartMetricPrefixes")
STAT_METRIC_PREFIXES = _tuple("statMetricPrefixes")
# E40.2 应用身份段：主题/图标/导航形态的封闭枚举
IDENTITY_THEMES = _tuple("identityThemes")
IDENTITY_ICONS = _tuple("identityIcons")
IDENTITY_NAVS = _tuple("identityNavs")
# Step 9：视觉配方封闭集（人工调好的配方，模型只选不自由生成）。
# 配方只管密度/布局/深浅色，不选主色——主色由 identity.theme（8 套）独立决定，
# 两者叠加使用。id/取值来自对一批真实产品原型截图的视觉聚类（2026-07-23 校订，
# 原先 compact-dark/warm-orange/cool-blue/soft-neutral 几个名字实际在挑颜色，
# 和 identity.theme 职责重叠，已废弃改名）。
DESIGN_RECIPES = (
    "default",           # 跟随主题默认密度，不做覆盖
    "spacious-guided",   # 宽松留白、分步引导（AI 工具/向导式产品）
    "compact-dense",     # 紧凑高密度、浅色（数据监控/竞品分析类）
    "content-cards",     # 圆角卡片感更强（内容创作/知识管理类）
    "dark-monitoring",   # 深色 + 紧凑（运维大屏/监控场景）
    "high-contrast",     # 边框加深、字号略增（无障碍场景）
)


def _catalog_tuple(key: str) -> tuple:
    value = _BLOCK_CATALOG.get(key)
    if not isinstance(value, list) or not value:
        raise ValueError(f"experience_block_catalog.json 缺失或为空: {key}")
    return tuple(str(v) for v in value)


def _load_experience_blocks() -> tuple:
    """读取并自检区块目录；坏目录在服务启动时直接失败，不带病进入 Gate。"""
    raw_blocks = _BLOCK_CATALOG.get("blocks")
    if not isinstance(raw_blocks, list) or not raw_blocks:
        raise ValueError("experience_block_catalog.json 缺失或为空: blocks")

    legal_slots = set(_catalog_tuple("allowedSlots"))
    legal_data_kinds = set(_catalog_tuple("dataKinds"))
    legal_events = set(_catalog_tuple("eventTypes"))
    blocks: List[Dict[str, Any]] = []
    seen_types: set = set()
    seen_renderers: set = set()
    for index, raw in enumerate(raw_blocks):
        if not isinstance(raw, dict):
            raise ValueError(f"experience_block_catalog.json blocks[{index}] 不是对象")
        block_type = str(raw.get("type") or "").strip()
        renderer_key = str(raw.get("rendererKey") or "").strip()
        if not block_type or not renderer_key:
            raise ValueError(f"experience_block_catalog.json blocks[{index}] 缺 type/rendererKey")
        if block_type in seen_types:
            raise ValueError(f"experience_block_catalog.json 重复区块 type: {block_type}")
        if renderer_key in seen_renderers:
            raise ValueError(f"experience_block_catalog.json 重复 rendererKey: {renderer_key}")
        if not isinstance(raw.get("description"), str) or not str(raw.get("description")).strip():
            raise ValueError(f"experience_block_catalog.json {block_type} 缺 description")
        if not isinstance(raw.get("propsSchema"), dict):
            raise ValueError(f"experience_block_catalog.json {block_type} 缺 propsSchema")
        for key, legal in (
            ("dataKinds", legal_data_kinds),
            ("allowedSlots", legal_slots),
            ("events", legal_events),
        ):
            values = raw.get(key)
            # dataKinds may be empty for action-only blocks (e.g. QuickActionPanel)
            # that require no entity data; allowedSlots and events must be non-empty.
            if key == "dataKinds":
                if not isinstance(values, list):
                    raise ValueError(f"experience_block_catalog.json {block_type}.{key} 缺失或为空")
            else:
                if not isinstance(values, list) or not values:
                    raise ValueError(f"experience_block_catalog.json {block_type}.{key} 缺失或为空")
            unknown = {str(v) for v in values} - legal
            if unknown:
                raise ValueError(
                    f"experience_block_catalog.json {block_type}.{key} 含目录外值: {sorted(unknown)}"
                )
        seen_types.add(block_type)
        seen_renderers.add(renderer_key)
        blocks.append(json.loads(json.dumps(raw)))
    return tuple(blocks)


EXPERIENCE_BLOCK_CATALOG_VERSION: int = int(_BLOCK_CATALOG.get("version", 0))
EXPERIENCE_BLOCK_ALLOWED_SLOTS = _catalog_tuple("allowedSlots")
EXPERIENCE_BLOCK_DATA_KINDS = _catalog_tuple("dataKinds")
EXPERIENCE_BLOCK_EVENT_TYPES = _catalog_tuple("eventTypes")
EXPERIENCE_BLOCKS = _load_experience_blocks()
EXPERIENCE_BLOCK_TYPES = tuple(str(block["type"]) for block in EXPERIENCE_BLOCKS)
EXPERIENCE_BLOCK_RENDERER_KEYS = tuple(
    str(block["rendererKey"]) for block in EXPERIENCE_BLOCKS
)


def enum_str(*keys: str) -> str:
    """把一个或多个枚举键渲染成生成契约用的 "a|b|c" 串（顺序=账本顺序）。"""
    values: List[str] = []
    for key in keys:
        values.extend(_tuple(key))
    return "|".join(values)


def legal_snapshot() -> Dict[str, object]:
    """账本原文快照（测试/审计用，防外部改动内部状态返回深拷贝）。"""
    return json.loads(json.dumps(_LEGAL))


def experience_block_catalog_snapshot() -> Dict[str, object]:
    """体验区块目录原文快照（测试/审计用）。"""
    return json.loads(json.dumps(_BLOCK_CATALOG))


def experience_block_prompt_block() -> str:
    """把目录压成给 LLM 的封闭选材说明；不另写第二份区块清单。"""
    lines = [
        "EXPERIENCE BLOCK CATALOG (closed set):",
        "The page.blocks schema below is validated end-to-end, but the client-side renderer for it is NOT shipped yet — "
        "any block emitted via page.blocks currently displays as an inert placeholder to real users. "
        "DO NOT emit page.blocks for production pages. ALWAYS use the existing stats/charts/rankings/feeds fields instead; "
        "this catalog exists for schema/gate testing only until the renderer lands.",
        "If you emit page.blocks anyway (e.g. explicitly requested for schema testing), every block type MUST be one of the catalog entries below.",
    ]
    for block in EXPERIENCE_BLOCKS:
        lines.append(
            f"- {block['type']}: {block['description']} "
            f"data={','.join(block['dataKinds'])}; slots={','.join(block['allowedSlots'])}; "
            f"events={','.join(block['events'])}"
        )
    lines.append(
        "When emitting page.blocks, include a binding object specifying entityRef (required), "
        "aggregate (count/sum:<fieldId>/avg:<fieldId>), timeDimensionRef+timeGrain for trends, "
        "sortByRef+limit for rankings, timeFieldRef for feeds. "
        "entityRef MUST match a datamodel entity id exactly."
    )
    lines.append(
        "Pages MAY include an actions array with instances of: "
        "navigate (targetPageRef), openDetail (entityRef), createRecord (entityRef), "
        "updateRecord (entityRef), changeFilter (targetBlockRef), drillDown (targetBlockRef). "
        "Each action MUST have a permissionRef matching an entry in page.actionPermissions. "
        "Blocks MAY include eventBindings mapping event names to action ids defined in the same page."
    )
    lines.append(
        "Step 7 — Page layout: pages MAY declare a layout object with slots "
        "summary/primary/secondary/activity/content, each containing an ordered list of block ids. "
        "Every block id in layout MUST exist in page.blocks. "
        "Use layout to differentiate dashboards (large primary chart) from workbenches (summary+content table)."
    )
    lines.append(
        "Step 8 — Shell and device: appbundle MAY include experienceShell "
        "{mode: 'navigation'|'focus', navigation: 'side'|'top'} and preferredDevice 'desktop'|'tablet'|'phone'. "
        "Use experienceShell instead of appIdentity.nav for new models. "
        "mode MUST be 'navigation' for now — 'focus' (full-screen single-purpose tools like a report "
        "viewer or document editor) is schema-legal but has NO client renderer yet; declaring it renders "
        "as an ordinary navigation shell, not the immersive full-screen layout the name implies."
    )
    lines.append(
        f"Step 9 — Design recipe: appbundle.appIdentity MAY include designRecipeRef "
        f"from: {', '.join(DESIGN_RECIPES)}. "
        "Recipes control density/layout/dark-mode ONLY — they do NOT pick colors; "
        "primary color is a separate, independent choice via appIdentity.theme. "
        "spacious-guided = generous spacing for step-by-step wizard tools; "
        "compact-dense = tight spacing for monitoring/competitive-analysis dashboards; "
        "content-cards = larger rounded cards for content/knowledge tools; "
        "dark-monitoring = dark background + compact spacing for ops dashboards; "
        "high-contrast = darker borders and larger text for accessibility. "
        "default = no override, follows the theme's own spacing. "
        "Do not free-generate colors or CSS — only reference a recipe by id."
    )
    return "\n".join(lines)
