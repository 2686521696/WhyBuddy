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
PAGE_PRESENTATIONS = _tuple("pagePresentations")
PAGE_SURFACE_TYPES = _tuple("pageSurfaceTypes")
PAGE_SURFACE_DENSITIES = _tuple("pageSurfaceDensities")
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
    legal_field_types = set(_tuple("fieldTypes"))
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
        # rendererStatus = 事实（前端 block-registry.tsx 登记的是真渲染器还是
        # ExistingContentAdapter 惰性占位）；generationEnabled = 灰度决定（准不准
        # 让 LLM 往 page.blocks 里写这个类型）。分两个字段是因为它们会各自独立
        # 变化：渲染器先落地、放开是后一步的决定。
        # slotsRationale（可选，2026-08-01）：只给"限制不显然"的类型写一句
        # **为什么**。三轮真跑里模型把 WorkflowTimeline 放进 secondary 共 5 次，
        # 是最稳定的一类结构门失败——它按"流程条是辅助信息"的语义直觉摆，而真实
        # 依据是宽度（横向流程条塞不进 1/3 窄栏）。只丢一张 slots 表模型无从
        # 推断，下次照样按直觉猜；本仓库反复验证过措辞/理由决定行为。
        # 放在这里而不是 prompt 文案里：理由与它约束的 allowedSlots 同处一行，
        # 谁改约束都会看见。
        slots_rationale = raw.get("slotsRationale")
        if slots_rationale is not None and (
            not isinstance(slots_rationale, str) or not slots_rationale.strip()
        ):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.slotsRationale 必须是非空字符串（或整个省略）"
            )
        renderer_status = raw.get("rendererStatus")
        if renderer_status not in ("real", "placeholder"):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.rendererStatus 必须是 real/placeholder"
            )
        generation_enabled = raw.get("generationEnabled")
        if not isinstance(generation_enabled, bool):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.generationEnabled 必须是布尔值"
            )
        # 不变式：占位渲染器绝不能放开生成。这正是历史上那条一刀切禁令要
        # 挡的事故——放开了，用户看到的是"区块已登记，内容将在下一阶段接入"
        # 的死卡片。宁可 fail-fast 在启动期，也不要带病进 prompt。
        if generation_enabled and renderer_status != "real":
            raise ValueError(
                f"experience_block_catalog.json {block_type} 放开了生成但渲染器仍是"
                f" {renderer_status}——会渲染成惰性占位卡"
            )
        for key, legal in (
            ("dataKinds", legal_data_kinds),
            ("allowedSlots", legal_slots),
            ("events", legal_events),
        ):
            values = raw.get(key)
            # dataKinds may be empty for action-only blocks (e.g. QuickActionPanel)
            # that require no entity data; events may be empty for blocks with no
            # interactive events yet (e.g. FreeformInsight，静态展示卡)；
            # allowedSlots must always be non-empty.
            if key in ("dataKinds", "events"):
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
        binding_schema = raw.get("bindingSchema")
        if not isinstance(binding_schema, dict):
            raise ValueError(f"experience_block_catalog.json {block_type} 缺 bindingSchema")
        _validate_binding_schema(block_type, binding_schema, legal_field_types)
        seen_types.add(block_type)
        seen_renderers.add(renderer_key)
        blocks.append(json.loads(json.dumps(raw)))
    return tuple(blocks)


def _validate_binding_schema(
    block_type: str, schema: Dict[str, Any], legal_field_types: set
) -> None:
    """bindingSchema 自检：坏账本在服务启动时直接失败，不带病进入 Gate/Prompt。"""
    required = schema.get("required", [])
    optional = schema.get("optional", [])
    if not isinstance(required, list) or not isinstance(optional, list):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.required/optional 必须是数组")
    known_fields = set(required) | set(optional)
    enums = schema.get("enums", {})
    if not isinstance(enums, dict):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.enums 必须是对象")
    for field, values in enums.items():
        if field not in known_fields:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.enums 引用了未声明字段: {field}")
        if not isinstance(values, list) or not values:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.enums.{field} 缺失或为空")
    entity_field_refs = schema.get("entityFieldRefs", {})
    if not isinstance(entity_field_refs, dict):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefs 必须是对象")
    for field, field_type in entity_field_refs.items():
        if field not in known_fields:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefs 引用了未声明字段: {field}")
        if field_type not in legal_field_types:
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefs.{field} "
                f"字段类型 '{field_type}' 不在合法域内"
            )
    # entityFieldRefLists：值是**字段 id 数组**的绑定键（如 ActivityFeed 宽行档
    # 的 detailFieldRefs）。跟 entityFieldRefs 的区别只有两条——值是数组、且不限
    # 定字段类型（明细列展示什么都行，数字/日期/枚举都是合法的一列）。类型收窄
    # 交给 fieldType 可选键，没写就是"任意类型"。
    ref_lists = schema.get("entityFieldRefLists", {})
    if not isinstance(ref_lists, dict):
        raise ValueError(
            f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists 必须是对象"
        )
    for field, spec in ref_lists.items():
        if field not in known_fields:
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists "
                f"引用了未声明字段: {field}"
            )
        if not isinstance(spec, dict):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists.{field} 必须是对象"
            )
        max_items = spec.get("maxItems")
        if max_items is not None and (not isinstance(max_items, int) or max_items < 1):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists.{field}"
                ".maxItems 必须是正整数"
            )
        field_type = spec.get("fieldType")
        if field_type is not None and field_type not in legal_field_types:
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists.{field}"
                f".fieldType '{field_type}' 不在合法域内"
            )
    ranges = schema.get("ranges", {})
    if not isinstance(ranges, dict):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.ranges 必须是对象")
    for field, bounds in ranges.items():
        if field not in known_fields:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.ranges 引用了未声明字段: {field}")
        if not isinstance(bounds, list) or len(bounds) != 2:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.ranges.{field} 必须是 [min, max]")
    aggregate_fields = schema.get("aggregateFields", [])
    if not isinstance(aggregate_fields, list):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.aggregateFields 必须是数组")
    for field in aggregate_fields:
        if field not in known_fields:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.aggregateFields 引用了未声明字段: {field}")


EXPERIENCE_BLOCK_CATALOG_VERSION: int = int(_BLOCK_CATALOG.get("version", 0))
EXPERIENCE_BLOCK_ALLOWED_SLOTS = _catalog_tuple("allowedSlots")
# 页面区域词汇（2026-08-08 第三轮收编）。
#
# 此前区域语法只有 page_archetypes.py 有，前端 REGION_LAYOUT 是手抄的第二份。
# 收进目录之后两边同读一份：Python 从这里，前端从 vite 的 @experience-blocks。
#
#   PAGE_REGIONS        区域目录：叫什么、摆哪条带、在 pro-blocks 里的出处
#   PAGE_ARCHETYPES_RAW 范式语法：哪个范式有哪些区域、多重、必不必填、收什么
#   PAGE_REGION_BANDS   带的取值域
#
# 拆两张表是因为前者是全局事实（main 永远在正文带），后者按范式各有一套
# （列表页的 main 收 entityRows，结果页的 main 收 outcome）。
PAGE_REGIONS: Dict[str, Dict[str, Any]] = dict(_BLOCK_CATALOG.get("pageRegions") or {})
PAGE_ARCHETYPES_RAW: Dict[str, Dict[str, Any]] = dict(
    _BLOCK_CATALOG.get("pageArchetypes") or {}
)
PAGE_REGION_BANDS = _catalog_tuple("pageRegionBands")
EXPERIENCE_BLOCK_DATA_KINDS = _catalog_tuple("dataKinds")
EXPERIENCE_BLOCK_EVENT_TYPES = _catalog_tuple("eventTypes")
# FreeformInsight（2026-07-23）的安全原子积木白名单——Python 深校验、Prompt、
# 前端渲染器共用同一份，见 freeform_block.py / block-registry.tsx。
FREEFORM_ALLOWED_TAGS = _catalog_tuple("freeformAllowedTags")
FREEFORM_ALLOWED_ICON_REFS = _catalog_tuple("freeformAllowedIconRefs")
FREEFORM_ALLOWED_STYLE_PROPS = _catalog_tuple("freeformAllowedStyleProps")
# 图标合法域（2026-07-26 收编）：形状正则 + legacy kebab 别名映射此前在
# freeform_block.py 与前端 block-registry.tsx 各手抄一份、无对账哨兵——
# 目录里的 freeformAllowedIconRefs 早已退化成 prompt 建议清单，真正的合法
# 域漂在两份平行实现里。现在两侧都从目录这两个字段派生，改一处两端同步。
FREEFORM_ICON_NAME_PATTERN: str = str(_BLOCK_CATALOG.get("freeformIconNamePattern") or "")
FREEFORM_LEGACY_ICON_ALIASES: Dict[str, str] = dict(
    _BLOCK_CATALOG.get("freeformLegacyIconAliases") or {}
)
def _load_page_kind_presets(blocks: tuple) -> Dict[str, tuple]:
    """页面形态预设：**每种页面的 2~3 套"已经排好的积木组合"**。

    ## 为什么要有它

    此前给模型的是"13 个积木 + 一句自己组织"。用户的判断（2026-08-07）：
    「首先让 AI 去设计，感觉有点不现实，因为他也搞不出来很好的组件」——
    症结不在积木不够，在于**从零编排**这件事对模型太难，而且每次结果都不一样。

    对照阿里 lowcode-engine 的物料协议，它比我们多的正是这一样：`snippets`
    ——"用户从组件面板拖入组件时会向页面 schema 中插入 snippets 中定义的
    低代码 schema"。也就是**拖进来的不是一个裸组件，是一段排好的片段**。

    这里照这个思路做成页面级的：模型先挑一套预设，再把每个积木绑到真实
    实体/字段上。选型这一步从"发明"降级成"挑选"，而绑定那一步本来就有
    bindingSchema 与门禁把关。

    ## 为什么在启动时自检

    预设是**手写**的，而它引用的每个 (type, slot) 都必须同时满足三件事：
    区块放开了生成、这种页面允许它、这个槽位允许它。手写的东西会漂——
    今天改了某个区块的 allowedSlots，明天预设就在推荐一个门禁必拦的组合，
    而模型会照着抄。那种失败很难查：模型"照做了"，却每次都被门禁打回。

    所以坏预设**在服务启动时直接失败**，跟 bindingSchema 自检同一条纪律：
    不带病进入 Prompt。
    """
    raw = _BLOCK_CATALOG.get("pageKindPresets")
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("experience_block_catalog.json pageKindPresets 必须是对象")
    by_type = {str(b["type"]): b for b in blocks}
    legal_kinds = set(PAGE_KINDS)
    out: Dict[str, tuple] = {}
    for kind, presets in raw.items():
        if kind not in legal_kinds:
            raise ValueError(f"pageKindPresets 含目录外页面形态: {kind}")
        if not isinstance(presets, list) or not presets:
            raise ValueError(f"pageKindPresets.{kind} 必须是非空数组")
        seen_ids: set = set()
        for ps in presets:
            pid = str((ps or {}).get("id") or "").strip()
            if not pid:
                raise ValueError(f"pageKindPresets.{kind} 有预设缺 id")
            if pid in seen_ids:
                raise ValueError(f"pageKindPresets.{kind} 重复预设 id: {pid}")
            seen_ids.add(pid)
            for key in ("name", "when"):
                if not str(ps.get(key) or "").strip():
                    raise ValueError(f"pageKindPresets.{kind}.{pid} 缺 {key}")
            items = ps.get("blocks")
            if not isinstance(items, list) or not items:
                raise ValueError(f"pageKindPresets.{kind}.{pid}.blocks 必须是非空数组")
            for it in items:
                btype = str((it or {}).get("type") or "").strip()
                slot = str((it or {}).get("slot") or "").strip()
                entry = by_type.get(btype)
                if entry is None:
                    raise ValueError(f"pageKindPresets.{kind}.{pid} 引用了未知区块 {btype}")
                if not entry.get("generationEnabled"):
                    raise ValueError(
                        f"pageKindPresets.{kind}.{pid} 推荐了未放开生成的区块 {btype}"
                        "——模型照做会被门禁拦下"
                    )
                if kind not in entry.get("pageKinds", []):
                    raise ValueError(
                        f"pageKindPresets.{kind}.{pid}: {btype} 不允许出现在 {kind} 页"
                        f"（允许 {entry.get('pageKinds')}）"
                    )
                if slot not in entry.get("allowedSlots", []):
                    raise ValueError(
                        f"pageKindPresets.{kind}.{pid}: {btype} 不允许放在 {slot}"
                        f"（允许 {entry.get('allowedSlots')}）"
                    )
        out[kind] = tuple(presets)
    return out


EXPERIENCE_BLOCKS = _load_experience_blocks()
EXPERIENCE_BLOCK_TYPES = tuple(str(block["type"]) for block in EXPERIENCE_BLOCKS)
EXPERIENCE_BLOCK_RENDERER_KEYS = tuple(
    str(block["rendererKey"]) for block in EXPERIENCE_BLOCKS
)
# type -> bindingSchema；Gate 的 binding 深校验按类型查表用（同一份账本，见 v5_model_gate）。
EXPERIENCE_BLOCK_BINDING_SCHEMAS: Dict[str, Dict[str, Any]] = {
    str(block["type"]): block["bindingSchema"] for block in EXPERIENCE_BLOCKS
}
# type -> allowedSlots；Gate 校验 page.layout 时按类型查表，确认区块放的槽位是
# 目录里给它开放的槽位，而不只是"槽位名合法 + 区块 id 存在"（此前 layout 深
# 校验只查这两条，槽位与区块类型的搭配完全没人管，见 Puck DropZone 的
# allow/disallow 思路——目录数据其实早就够用，只是没人拿它去查 layout）。
PAGE_KIND_PRESETS: Dict[str, tuple] = _load_page_kind_presets(EXPERIENCE_BLOCKS)

EXPERIENCE_BLOCK_ALLOWED_SLOTS_BY_TYPE: Dict[str, tuple] = {
    str(block["type"]): tuple(block["allowedSlots"]) for block in EXPERIENCE_BLOCKS
}
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


def _format_binding_schema(schema: Dict[str, Any]) -> str:
    """把一个 block 的 bindingSchema 结构渲染成给 LLM 看的一行说明；
    Gate 校验用的是同一份 schema（见 v5_model_gate），改一处两边同步。"""
    required = list(schema.get("required", []))
    optional = list(schema.get("optional", []))
    if not required and not optional:
        # 不能写成裸的 "none"。真跑撞过：prompt 里那行长成
        # `binding=none (不使用 binding；…)`，模型把 "none" 当成**要填的值**，
        # 产出 `"binding": {"entityRef": "none"}`，四个 QuickActionPanel 全中，
        # 门禁报 4 条 entityRef 悬挂。哨兵词长得像值就会被当成值——改成祈使句。
        note = schema.get("note")
        omit = "OMIT — this block takes no binding; do NOT emit a `binding` key at all"
        return f"{omit}. ({note})" if note else omit
    enums = schema.get("enums", {})
    entity_field_refs = schema.get("entityFieldRefs", {})
    ranges = schema.get("ranges", {})
    ref_lists = schema.get("entityFieldRefLists", {})
    aggregate_fields = set(schema.get("aggregateFields", []))

    def annotate(field: str) -> str:
        if field in aggregate_fields:
            return f"{field}(count|sum:<fieldId>|avg:<fieldId>)"
        if field in enums:
            return f"{field}({'|'.join(enums[field])})"
        if field in entity_field_refs:
            return f"{field}({entity_field_refs[field]} field)"
        if field in ref_lists:
            spec = ref_lists[field]
            want = spec.get("fieldType")
            cap = spec.get("maxItems")
            bits = [f"{want} fieldId" if want else "fieldId"]
            if cap:
                bits.append(f"max {cap}")
            return f"{field}([{', '.join(bits)}])"
        if field in ranges:
            lo, hi = ranges[field]
            return f"{field}({lo}-{hi})"
        return field

    parts = []
    if required:
        parts.append(f"required={','.join(annotate(f) for f in required)}")
    if optional:
        parts.append(f"optional={','.join(annotate(f) for f in optional)}")
    note = schema.get("note")
    if note:
        parts.append(f"note={note}")
    return "; ".join(parts)


def experience_block_prompt_block() -> str:
    """把目录压成给 LLM 的封闭选材说明；不另写第二份区块清单。"""
    lines = [
        "EXPERIENCE BLOCK CATALOG (closed set):",
    ]
    # 放开名单从目录派生，不在这里手写——历史事故：渲染器 07-22/07-23 陆续
    # 接上了，prompt 里那句"渲染器还没上线，不要输出 page.blocks"却留在原地，
    # 于是 WorkflowTimeline 这类已经能用的区块一次都没被渲染过。现在这句话
    # 由 generationEnabled 决定，改目录即改 prompt，不会再各说各话。
    enabled = [b for b in EXPERIENCE_BLOCKS if b.get("generationEnabled")]
    if enabled:
        # 措辞是祈使式，不是许可式（2026-07-28 实测定的）。此前写的是
        # "You MAY emit page.blocks ... an unnecessary block is worse than none"
        # 外加一句"Use the existing stats/charts/rankings/feeds fields instead"，
        # 通电了七个区块，模型仍然一个都不用——同一目标连跑三次，全是 0。
        # 排除过的其它假设：往 JSON 骨架里补 blocks 键（补了照样 0）、
        # CHANNEL OWNERSHIP 规则挤掉了积木（拿掉也是 0）。只把这两句换成
        # 下面的祈使式，其余一字未动，同目标跑两次得到 9 个 / 8 个积木，
        # 业务页覆盖 3/3、4/4，方案 C 零越界。
        # 关窍在于说清"不用的代价"：模型默认走它熟悉的 stats/charts 老路，
        # 除非明确告诉它空着的业务页是残次交付。
        lines.append(
            "page.blocks is how you compose a page beyond its table. Renderable today: "
            + ", ".join(str(b["type"]) for b in enabled)
            + ". Compose each page with the blocks it needs. A workbench / kanban / "
            "calendar / wizard page that ships with NO blocks renders as a bare table — "
            "that is an incomplete deliverable, not a safe default. Typically 1-3 blocks "
            "per business page."
        )
        # 2026-07-31：monitor 页此前被这条祈使句**漏在外面**——上一句只点名了
        # workbench/kanban/calendar/wizard，加上下面 CHANNEL OWNERSHIP 那条
        # "monitor 页照常声明 stats/charts"，两处合起来读就是"总览页不用积木"。
        # 实测后果：19 个真实页面里 page.blocks 声明数 **0**，其中 4 个 monitor
        # 页一个积木都没有，QuickActionPanel / WorkflowTimeline 这两个
        # generationEnabled=true、rendererStatus=real 的区块从未被生成过。
        #
        # 这直接决定了总览页的骨架形状：喂给 freeformOverview 设计环节的内容
        # 永远是"N 个标量 + M 个分布 + 可选一组逐行记录"这三档，排布几乎被内容
        # 定死。放开这一处，输入的内容类型才可能变，版式才跟着变。
        #
        # 措辞照上一句的教训走**祈使式**：07-28 记过，写成许可式（"You MAY
        # emit…"）时七个通电区块一个都没被用，同目标连跑三次全是 0；换成祈使
        # 式并说清"不用的代价"之后才有产出。所以这里也说清代价。
        # 2026-08-01 追加排除 FilterBar：它在总览页**驱动不了任何东西**。
        # 实测链路：filterState 全仓只有 FilterBarRenderer 自己读（用来显示当前
        # 筛选态），变更经 onFilterChange 进页面级过滤态，只影响页面自有视图
        # （Table/看板/日历，走筛过的 rows）；而积木与 freeform 设计树拿到的是
        # entityRows = state.entities，**未筛的全量**。总览页没有 Table/看板/
        # 日历，于是那条筛选栏按下去什么都不会变。
        # 这也正是 blockRef 白名单一直不收它的理由（test_freeform_blockref 的
        # 用例注释原文："FilterBar 在总览页筛不动东西"）——既然嵌不进设计、
        # 又驱动不了内容，就不该在总览页把它摆出来当选项：模型真的会照单声明
        # （2026-08-01 基线轮，dashboard 页声明了 analytics_filter），结果是
        # 一个按不动的控件掉在设计区外面。
        # 只从推荐清单里拿掉是**不够的**：2026-08-01 实测，把 FilterBar 从
        # monitor_ok 移除后重跑，dashboard 页照样声明了 analytics_filters——
        # 目录里它仍是通电区块，没有任何一句话说总览页不许用。所以下面补一条
        # 显式禁令。四个一起禁（不只 FilterBar）：另外三个此前同样只是"不推荐"
        # 而无硬禁，是同一个洞，只是还没撞上。
        MONITOR_FORBIDDEN = ("MetricGrid", "TrendChart", "DataTable", "FilterBar")
        monitor_ok = [
            str(b["type"]) for b in enabled
            if str(b["type"]) not in MONITOR_FORBIDDEN
        ]
        monitor_forbidden_live = [t for t in MONITOR_FORBIDDEN if t in {str(b["type"]) for b in enabled}]
        if monitor_forbidden_live:
            # 逐条给理由而不是只列名单：本仓库反复验证过措辞决定行为（许可式
            # 让七个通电区块一个都没被用；binding 哨兵词 "none" 被当成值）。
            # 只丢一张禁用表，模型下次照样按语义直觉去猜"这页是不是该有个筛选条"。
            lines.append(
                "On monitor / dashboard pages, NEVER emit these blocks: "
                + ", ".join(monitor_forbidden_live)
                + ". Each is inert there, not merely discouraged. MetricGrid and "
                "TrendChart would render the same numbers a second time — an overview's "
                "KPIs and charts are already declared as page.stats / page.charts and "
                "get laid out by the design pass. DataTable needs full width and a "
                "second entity to be worth anything on an overview. FilterBar cannot "
                "filter ANYTHING on an overview: its state only reaches this page's own "
                "table / kanban / calendar views, and an overview has none of them — "
                "the blocks and the designed layout read the unfiltered rows, so the "
                "control would sit there doing nothing. Put the filter on the business "
                "page that actually lists records instead."
            )
        if monitor_ok:
            lines.append(
                "monitor / dashboard pages are NOT exempt from this. Their stats and "
                "charts answer 'how are the numbers', but an overview whose ONLY "
                "content is numbers is a report, not a workbench — the user opens it "
                "to act. Where this business's overview genuinely leads with something "
                "beyond numbers, declare it as a block: "
                + ", ".join(monitor_ok)
                + ". Pick by what THIS operation actually does first — a panel of the "
                "actions this role starts the day with, the stage bar of the process "
                "the business runs on, a live stream of what just happened, a top-N "
                "that drives a real decision. Declaring none is correct only when the "
                "overview truly is read-only; declaring one you cannot justify from "
                "the domain is worse than none."
            )
        schema_only = [b for b in EXPERIENCE_BLOCKS if not b.get("generationEnabled")]
        if schema_only:
            lines.append(
                "Only these are schema-only (renderer not shipped) — never emit them: "
                + ", ".join(str(b["type"]) for b in schema_only)
                + ". Everything else listed above is live and SHOULD be used where it fits."
            )
    else:
        lines.append(
            "No block type is renderable yet — DO NOT emit page.blocks for production pages. "
            "ALWAYS use the existing stats/charts/rankings/feeds fields instead."
        )
    # ── 页面形态预设（2026-08-07）────────────────────────────────────────
    # 用户的判断："首先让 AI 去设计，感觉有点不现实"。此前给的是一堆散积木
    # 加一句"自己组织"，模型每次都得从零发明一遍排布。这里给出**已经排好的
    # 组合**，选型从"发明"降级成"挑选"。做法照 lowcode-engine 的 snippets
    # （拖进来的不是裸组件，是一段排好的片段），只是做在页面这一层。
    #
    # 措辞仍走本文件反复验证过的那条：**祈使 + 说清不照做的代价**。写成
    # "here are some examples you may consider" 这类许可式，按 07-28 的实测
    # 记录，模型会当没看见。
    #
    # 同时明说"预设是起点不是枷锁"——业务真需要别的组合时照常自己排，
    # 否则会把模型逼进只会抄预设的另一个极端。
    if PAGE_KIND_PRESETS:
        lines.append(
            "PROVEN LAYOUTS — start from one of these instead of composing from scratch. "
            "Each has already been checked against the catalog: every block is live, "
            "allowed on that page kind, and allowed in that slot. Pick the one whose "
            "'use when' matches THIS page's job, then bind each block to real entities "
            "and fields. Composing your own set is allowed and expected when the "
            "business genuinely needs something else — but an invented layout that "
            "merely re-derives one of these wastes a turn and usually lands in a slot "
            "the gate rejects."
        )
        for kind in PAGE_KINDS:
            presets = PAGE_KIND_PRESETS.get(kind)
            if not presets:
                continue
            for ps in presets:
                combo = " + ".join(
                    f"{it['type']}@{it['slot']}" for it in ps["blocks"]
                )
                lines.append(f"  {kind} · {ps['name']}: {combo} — use when {ps['when']}")

    lines.append(
        "Whenever you do emit page.blocks, every block type MUST be one of the catalog entries below."
    )
    # 归属划分（2026-07-28）：KPI/图表在一页里只能由一条路负责，否则同一个指标
    # 会被画两次。总览页的 stats/charts 会被后续增强步骤重新设计成一块整体版式
    # （每个应用长得不一样，是展示面的主角）；业务页没有那一步，走积木更整齐
    # 可预期。渲染层已经硬隔离（写错了也不会画两遍），这里说清楚是为了让模型
    # 一开始就写对通道，而不是靠下游兜。
    lines.append(
        "CHANNEL OWNERSHIP for KPIs and charts — one page, one channel:\n"
        "  - monitor / dashboard pages: declare page.stats and page.charts as usual. "
        "Do NOT emit MetricGrid or TrendChart blocks there; they would duplicate the "
        "same numbers the overview already shows. This ban covers KPI/trend blocks "
        "ONLY — it is not a ban on page.blocks for overview pages (see above: action "
        "panels, stage bars, streams and top-N belong there when the domain leads "
        "with them).\n"
        "  - all other page kinds (workbench / kanban / calendar / wizard): use "
        "MetricGrid / TrendChart blocks when the page needs KPIs or trends, and leave "
        "page.stats / page.charts empty on those pages.\n"
        "  - RankedList / ActivityFeed are not affected by this split; "
        "they may be used on any page kind where they fit.\n"
        "  - DataTable: every page ALREADY renders its own primary entity as a full "
        "table (localized column headers, enum tags, sorting, filtering, paging, row "
        "actions). Do NOT emit a DataTable bound to the page's own primary entity — it "
        "renders the very same rows a second time, and worse. Emit DataTable ONLY for a "
        "DIFFERENT entity than the page's primary one (e.g. a supplier table on an "
        "inventory page)."
    )
    for block in EXPERIENCE_BLOCKS:
        # slots 后面紧跟这一类的槽位理由（只有限制不显然的类型才有）。
        # 只给一张 slots 表，模型无从推断"为什么不行"，会按语义直觉去猜——
        # WorkflowTimeline 被摆进 secondary 在三轮真跑里复发 5 次就是这么来的。
        rationale = str(block.get("slotsRationale") or "").strip()
        slots_part = f"slots={','.join(block['allowedSlots'])}"
        if rationale:
            slots_part += f" ({rationale})"
        lines.append(
            f"- {block['type']}: {block['description']} "
            f"data={','.join(block['dataKinds'])}; {slots_part}; "
            f"events={','.join(block['events'])}; "
            f"binding={_format_binding_schema(block['bindingSchema'])}"
        )
    lines.append(
        "binding.entityRef (when required or provided) MUST match a datamodel entity id exactly; "
        "every other *Ref field in binding is a bare field id scoped to that same entity "
        "(datamodel.entities[entityRef].fields[].id), not an 'entity.field' qualified string."
    )
    lines.append(
        "Pages MAY include an actions array with instances of: "
        "navigate (targetPageRef), openDetail (entityRef), createRecord (entityRef), "
        "updateRecord (entityRef), changeFilter (targetBlockRef), drillDown (targetBlockRef). "
        "Each action MUST have a permissionRef matching an entry in page.actionPermissions. "
        "Blocks MAY include eventBindings mapping event names to action ids defined in the same page."
    )
    # 槽位的**实际形态**（2026-08-01）。此前提示词从头到尾只给槽位**名字**，
    # 从没说过它们渲染成什么样——模型不知道 content 在页面最下面、secondary
    # 只有 1/3 宽，于是只能按名字的字面意思猜（"content 听起来就是放内容的"）。
    # 那一类违规反复复发、只是换主角：WorkflowTimeline→secondary（5 次）、
    # FilterBar→content（2 次）、QuickActionPanel→content（3 次）。
    # 逐块补 slotsRationale 是在治单点，这一句才是治这一类：把判据交给模型，
    # 它才谈得上自己推。数值取自 AppRuntimeScreen 的实际渲染。
    lines.append(
        "What the slots actually look like when rendered (top to bottom): "
        "summary = a horizontal wrapping row across the very top; "
        "primary and secondary = two columns side by side under it, primary is "
        "twice as wide as secondary (2/3 vs 1/3); "
        "activity then content = full-width rows below those columns. "
        "So the reading order is summary → primary/secondary → activity → content, "
        "and secondary is the only narrow slot. Anything the user must see or act on "
        "BEFORE the page's content belongs in summary, not in activity/content — "
        "those render after the very things they would act on."
    )
    lines.append(
        "Step 7 — Page layout: pages MAY declare a layout object whose OWN KEYS ARE THE SLOT NAMES — "
        "summary/primary/secondary/activity/content — each mapping to an ordered list of block ids, "
        'exactly like "layout": {"summary": ["kpi_grid"], "content": ["order_table"]}. '
        'Do NOT nest them under a wrapper key: "layout": {"slots": {...}} is WRONG and the whole layout '
        "will be discarded. "
        "Every block id in layout MUST exist in page.blocks, AND each block MUST be placed only in one "
        "of the slots listed for its type above (slots=... in the catalog entry) — e.g. a RankedList "
        "(slots=primary,secondary) placed in the activity slot is a violation, even though the block id "
        "itself exists. Use layout to differentiate dashboards (large primary chart) from workbenches "
        "(summary+content table)."
    )
    lines.append(
        "Step 7b — Responsive business-page grid (preferred for workbench/kanban/calendar/wizard): "
        "layout.grid is an object with optional desktop/tablet/phone arrays. Column counts are "
        "desktop=12, tablet=8, phone=4. Every array item has exactly blockRef/x/y/w/h; all coordinates "
        "and sizes are integers, x/y are non-negative, w/h are positive, and x+w must fit the breakpoint. "
        "blockRef is either an id from page.blocks or the reserved value page-content, which means this "
        "page's real table/kanban/calendar/wizard data surface. Use one placement per blockRef per breakpoint. "
        "Phone layouts must be a single reading-order column (x=0,w=4). When a smaller breakpoint is omitted, "
        "runtime falls back to the nearest larger layout. Example: "
        '"layout":{"grid":{"desktop":[{"blockRef":"filter","x":0,"y":0,"w":12,"h":1},'
        '{"blockRef":"page-content","x":0,"y":1,"w":9,"h":3},'
        '{"blockRef":"feed","x":9,"y":1,"w":3,"h":3}],'
        '"phone":[{"blockRef":"filter","x":0,"y":0,"w":4,"h":1},'
        '{"blockRef":"page-content","x":0,"y":1,"w":4,"h":2},'
        '{"blockRef":"feed","x":0,"y":2,"w":4,"h":1}]}}. '
        "Do not emit both a grid placement and a second copy of the same content through another block."
    )
    lines.append(
        "Step 8 — Shell and device: appbundle MAY include experienceShell "
        "{mode: 'navigation'|'focus', navigation: 'side'|'top'} and MUST include preferredDevice 'desktop'|'phone'. "
        "Use experienceShell instead of appIdentity.nav for new models. "
        "mode MUST be 'navigation' for now — 'focus' (full-screen single-purpose tools like a report "
        "viewer or document editor) is schema-legal but has NO client renderer yet; declaring it renders "
        "as an ordinary navigation shell, not the immersive full-screen layout the name implies."
    )
    # 2026-07-30：preferredDevice 此前只声明了合法域、没给任何判据，结果实测
    # 9 个真实应用 9 个 desktop——这个字段是死的。而下游拿它决定要不要多花
    # 一次调用去设计手机版式（enrich_monitor_page_overviews）。现在它是新生成模型
    # 的单一权威选择：按完整产品与操作姿态选一档，判不清也走确定性单端兜底。
    lines.append(
        "Step 8b — How to choose preferredDevice. You MUST choose exactly one supported device; "
        "NEVER omit the field, request both devices, or emit tablet. Judge by the "
        "user's POSTURE while operating, not by keywords in the request:\n"
        "  · 'phone' — standing, walking, one-handed, on-site, reporting in the moment: scanning, "
        "photographing, clocking in, signing, jotting a quick record; or an individual using it in "
        "daily life.\n"
        "  · 'desktop' — seated, long sessions, multi-column comparison, batch operations, approvals "
        "and configuration: dashboards, back-office, analysis, reconciliation, scheduling, permission "
        "matrices.\n"
        "  · When posture is ambiguous, inspect the complete five-system model, landing-page shape, "
        "and primary operation, then still choose exactly one device.\n"
        "Two traps (both judged by WHO operates it in WHAT state, not by the words present): "
        "'courier dispatch board' contains 'courier' but the operator is a dispatcher at a desk → "
        "desktop; 'inspection work order, worker photographs on site and submits' contains 'work order' "
        "but the operator is walking around → phone. If the request names a device explicitly "
        "(app / mobile / mini-program / PC / web / 'on the computer'), follow that.\n"
        # 2026-08-03：姿态判据本身没错，但它可能跟**你自己产出的东西**打架。
        # 真机案例：「鱼眼图像辨别水产新鲜度」——采样确实是站着拍照，姿态判 phone，
        # 按上面的规则一点没判错；可这个应用真正生成出来的是一整套后台（新鲜度
        # 评分仪表盘、样品占比环图、各品类平均评分柱状图、批次台账），一个 9:16
        # 的窄条根本装不下，作品墙上那张卡也因此是竖的、糊的。
        #
        # 采集动作往往只是**整套系统里的一个页面**，而首页决定的是整个应用的形态。
        # 所以补一条压在姿态之上：先看你打算产出什么，再看谁在什么状态下用。
        "OVERRIDE (this outranks posture): judge by WHAT YOU ARE ABOUT TO BUILD first. "
        "If this app's landing page is an overview/dashboard — KPI tiles, charts, cross-entity "
        "aggregates, batch review or reconciliation — choose 'desktop' EVEN IF the request "
        "describes on-site capture (photographing, scanning, clocking in). Capture is usually one "
        "page inside the system; the landing page decides the shape of the whole app, and a 9:16 "
        "column cannot hold a multi-column dashboard. Choose 'phone' only when capture-in-the-moment "
        "is essentially the WHOLE product and there is no back-office side to it."
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
