"""
FreeformInsight 区块的结构化生成与校验（2026-07-23，实验三 Pydantic + reask
机制生产化，记录见 docs/freeform-llm-generation-experiment-2026-07-23.md）。

不引入 instructor 包——本仓网关已经真机验证过会撞 WAF UA 拦截 + Cloudflare
524（docs/OSS_GAP_ANALYSIS.md），instructor SDK 栈默认用 openai SDK 的非流式
HTTP 客户端，两条都会撞。改成在 sliderule_llm.structured 的流式 reask 骨架
（call_llm_with_retry + on_delta 强制流式）上，加一层 Pydantic 深校验——原来
structured_llm_json 只做 shape 级校验（JSON 能解析 + 必需字段非空），这里补
到"标签/样式/图标在白名单内 + 数字类内容必须挂 dataRef 指向真实数据"。
（"数字必须挂 dataRef"这条 2026-07-26 前只写在本段注释里、代码从没真正
执行——LLM 把编造数字写进普通 text 就一路直达渲染。现在由 FreeformNode 的
check_numbers_grounded 校验器真实拦截、错误回喂 reask，guardrails 声明式
validator 同款思路。）

安全边界：LLM 只产出数据（标签/样式/文字/图标引用/dataRef），永远不会被当
代码执行；渲染端只用安全 API 拼装（React createElement），不用 dangerouslySet
InnerHTML/eval。压力测试实测：模型第一次交上来的东西几乎从不完全合规，这层
校验不是极端情况下的兜底，是正常路径。

分层：本模块只管"一个 FreeformInsight 区块的内容"生成与校验，跟
v5_model_gate 校验整个五系统模型是两回事——调用方在重试耗尽时应该把这个
区块降级/拿掉，不能让一个装饰性区块的生成失败拖垮整个应用发布。
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from pathlib import Path

from .palette_guard import extract_hex_colors, palette_report, repair_colors
from .schema_legal import (
    EXPERIENCE_BLOCKS,
    EXPERIENCE_BLOCK_BINDING_SCHEMAS,
    FREEFORM_ALLOWED_ICON_REFS,
    FREEFORM_ALLOWED_STYLE_PROPS,
    FREEFORM_ALLOWED_TAGS,
    FREEFORM_EMBEDDABLE_BLOCK_TYPES,
    FREEFORM_ICON_NAME_PATTERN,
    FREEFORM_LEGACY_ICON_ALIASES,
)

_DANGEROUS_VALUE_RE = re.compile(r"url\(|javascript:|expression\(|import\b|@import", re.I)

# 无单位数字属性——数字值原样输出，不补 px。名单取自 React 源码
# shared/CSSProperty.js 的 isUnitlessNumber（只保留本仓库
# freeformAllowedStyleProps 里真实存在的那些；React 那份还有一堆 SVG/
# 老式 box-flex 属性，我们的白名单里没有，列了也用不上）。
_UNITLESS_STYLE_PROPS = frozenset({
    "flex", "flexGrow", "flexShrink", "fontWeight", "lineHeight",
    "opacity", "zIndex",
})

# 合法的 Ant Design 图标组件名形状：PascalCase + Outlined/Filled/TwoTone 结尾
# （@ant-design/icons 全部图标都遵循这个命名，前端按名字动态解析）。校验只看
# 形状不看具体名字——编造/拼错的名字前端解析不到会渲染成空，优雅降级。
# 2026-07-26：正则与 legacy 别名不再手抄——从 experience_block_catalog.json
# 派生（前端 block-registry.tsx 同源），改目录一处两端同步。
_ANTD_ICON_NAME_RE = re.compile(FREEFORM_ICON_NAME_PATTERN)
# 老模型里可能还有这批 kebab 语义名（放开之前的 12 个白名单），前端保留了
# 同名别名映射，这里也一并放行，历史产物不炸。
_LEGACY_ICON_ALIASES = frozenset(FREEFORM_LEGACY_ICON_ALIASES.keys())


class FreeformGenerationError(RuntimeError):
    """FreeformInsight 内容生成/校验失败（调用方应把这个区块降级/拿掉）。"""


# "数据声明"形状的数字——check_numbers_grounded 只拦这些，不拦结构性数字
# （近7天/Top 5/2026年度/24小时这类标题词，终检实测过的误伤面）：
_NUMERIC_CLAIM_RES = (
    re.compile(r"^\W*[¥$€]?\d[\d,\.]*\s*%?\W*$"),          # 整段就是一个数（"128" "1,234.5%"）
    re.compile(r"[¥$€]\s*\d"),                              # 货币（"¥128,000"）
    re.compile(r"\d+(\.\d+)?\s*%"),                         # 百分比（"3.5%"）
    re.compile(r"\d{1,3}(,\d{3})+"),                        # 千分位（"12,345"）
    re.compile(r"(共|合计|总计|累计)\s*\d"),                 # 计数句式（"共 42 条"）
    re.compile(r"\d[\d,\.]*\s*(条|单|件|个|笔|人|次|元|万|亿)"),  # 数+量词（"328 单"；时间单位天/小时/年不在列）
)


def _NUMERIC_CLAIM_RES_MATCH(text: str) -> bool:
    return any(p.search(text) for p in _NUMERIC_CLAIM_RES)


# 内容树硬上限（micromark/cmark 同款纪律：不可信输入必须带嵌套/规模上限）。
# 超限在这里被 Pydantic 拦下、错误回喂 reask；前端 block-registry.tsx 用同
# 值做纵深防御第二道（持久化快照恢复也走渲染那条路径）。改值两侧要一起改。
FREEFORM_MAX_DEPTH = 12
FREEFORM_MAX_NODES = 300


def _env_budget(name: str, default: int) -> int:
    """读一个非负整数预算 env；不合法/未设走默认。0 = 完全关闭该项开销。"""
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


# 体验层成本笼子（2026-07-26）：每个区块/每个 monitor 页此前都各自独立生一张
# 参考图 + 各起一个一次性 E2B 沙盒截图自检，无缓存、无上限、全部串行——
# 区块多的应用把"过门 → 发布"拖到分钟级。上限按"每次 enrich 调用"计，
# 超出预算的区块退化为纯文字生成（行为与未配生图/沙盒时完全一致，不是
# 静默丢内容）；命中即打日志（no silent caps）。
_ENRICH_MAX_REF_IMAGES_ENV = "SLIDERULE_ENRICH_MAX_REF_IMAGES"
_ENRICH_MAX_SCREENSHOT_VERIFY_ENV = "SLIDERULE_ENRICH_MAX_SCREENSHOT_VERIFY"
_ENRICH_MAX_REF_IMAGES_DEFAULT = 4
_ENRICH_MAX_SCREENSHOT_VERIFY_DEFAULT = 2


def _freeform_tree_bounds(root: Any) -> "tuple[int, int]":
    """迭代遍历（不递归——校验器自己先栈爆就本末倒置了），返回 (最大深度, 节点总数)。

    节点数越过上限两倍就提前止损返回，不为一棵注定被拒的树白遍历到底。
    """
    max_depth = 0
    count = 0
    stack: list[tuple[Any, int]] = [(root, 1)]
    while stack:
        node, depth = stack.pop()
        count += 1
        if depth > max_depth:
            max_depth = depth
        if count > FREEFORM_MAX_NODES * 2:
            break
        children = getattr(node, "children", None) or []
        for child in children:
            stack.append((child, depth + 1))
    return max_depth, count


# 8 套身份主题的色板提示——2026-07-26 起不再手抄前端 identity-themes.ts：
# 与前端同读 data/identity_theme_presets.json（前端经 @identity-themes alias
# 直读同一份文件构建 THEMES），改预设一处两端同步。这里按需挑字段做 prompt
# 色板提示（不含 primaryFg/sidebarText——那两个是渲染细节，提示里用不上）。
_THEME_PRESETS_PATH = Path(__file__).resolve().parent / "data" / "identity_theme_presets.json"
_THEME_PRESETS: dict[str, Any] = json.loads(_THEME_PRESETS_PATH.read_text(encoding="utf-8"))
_HINT_FIELDS = (
    "label", "primary", "primaryHover", "gradTo",
    "contentBg", "accentBg", "accentFg", "charts", "sidebarBg",
)
_THEME_COLOR_HINTS: dict[str, dict[str, Any]] = {
    theme_id: {k: theme[k] for k in _HINT_FIELDS if k in theme}
    for theme_id, theme in (_THEME_PRESETS.get("themes") or {}).items()
}
_DEFAULT_THEME_ID = str(_THEME_PRESETS.get("defaultThemeId") or "azure")

# 生成主题（appIdentity.generatedTheme）的合格契约——与前端
# isValidGeneratedTheme 同读 presets JSON 里的 generatedThemeContract。
# 此前这里只查 8 个键是否存在（不含 sidebarBg/sidebarText/primaryFg、不查
# 格式），前端却是 11 项严校验：错配窗口下 Python 拿生成主题配了卡片色、
# 前端整套弃用回落预设——卡片和侧栏配色对不上，正是升版要治的病。
_GENERATED_THEME_CONTRACT: dict[str, Any] = _THEME_PRESETS.get("generatedThemeContract") or {}
_CONTRACT_HEX_RE = re.compile(str(_GENERATED_THEME_CONTRACT.get("hexPattern") or r"^#[0-9a-fA-F]{6}$"))
_CONTRACT_GRADIENT_RE = re.compile(
    str(_GENERATED_THEME_CONTRACT.get("sidebarBgGradientPattern") or r"$^")
)
_CONTRACT_HEX_KEYS: tuple = tuple(_GENERATED_THEME_CONTRACT.get("hexKeys") or ())
_CONTRACT_CHARTS_LEN = int(_GENERATED_THEME_CONTRACT.get("chartsLength") or 3)


def is_valid_generated_theme(v: Any) -> bool:
    """生成主题合格判定（与前端 isValidGeneratedTheme 同一契约、同一份 JSON）。

    合格才拿来配卡片色；不合格这里不用、前端也必然回落预设——两端判定
    物理同源，不存在"后端用了前端弃用"的错配窗口。
    """
    if not isinstance(v, dict):
        return False
    # fullmatch 不是 match：Python 的 $ 会豁免尾随换行（"#123456\n" 能过），
    # JS 的 $ 不豁免——用 match 就给"两端同源"留了一道换行错配窗口
    # （Python 判合格拿去配卡片色、前端整套弃用回落预设）。
    for key in _CONTRACT_HEX_KEYS:
        val = v.get(key)
        if not isinstance(val, str) or not _CONTRACT_HEX_RE.fullmatch(val):
            return False
    sidebar_bg = v.get("sidebarBg")
    if not isinstance(sidebar_bg, str) or not (
        _CONTRACT_HEX_RE.fullmatch(sidebar_bg) or _CONTRACT_GRADIENT_RE.fullmatch(sidebar_bg)
    ):
        return False
    charts = v.get("charts")
    if (
        not isinstance(charts, list)
        or len(charts) != _CONTRACT_CHARTS_LEN
        or not all(isinstance(c, str) and _CONTRACT_HEX_RE.fullmatch(c) for c in charts)
    ):
        return False
    return True

_DEVICE_CONTAINER_HINTS: dict[str, str] = {
    "phone": (
        "这张卡片会被塞进手机端内容区：上方约 48px 标题栏、下方有底部 Tab "
        "导航，两者都已经画好，不用你画；内容区窄（几百像素宽），必须单列纵向"
        "排布，字号/图标/间距都要比桌面版收紧一档，避免横向并排的多列布局。"
    ),
    "desktop": (
        "这张卡片会被塞进桌面端内容区：左侧约 208px 深色侧边栏、上方约 56px "
        "顶栏，两者都已经画好，不用你画；内容区较宽，可以用横向排布/多列。"
    ),
    "tablet": (
        "这张卡片会被塞进平板端内容区（比桌面窄一些的侧边栏+顶栏已经画好，"
        "不用你画）；内容区中等宽度，横向排布元素不宜过多。"
    ),
}
_DEFAULT_DEVICE = "desktop"

# 生图尺寸按设备走真实宽高比，不是每次都拿方形凑合——之前 desktop/phone
# 都硬编码 "1024x1024"，跟真实容器形状不搭（桌面该是宽屏，手机该是竖屏），
# 实测这两个尺寸这个服务商都支持（活体探针 2026-07-24）。
_DEVICE_IMAGE_SIZE: dict[str, str] = {
    "phone": "1024x1792",
    "desktop": "1792x1024",
    "tablet": "1792x1024",
}


def _image_size_for_device(device: str) -> str:
    return _DEVICE_IMAGE_SIZE.get(device) or _DEVICE_IMAGE_SIZE[_DEFAULT_DEVICE]


def _theme_palette(theme_id: str, generated_theme: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """身份主题现在可能不是 8 预设之一，而是 identity_theme_gen.py 生成的
    自定义主题——优先用这个（同一个 app 的侧边栏/顶栏就是照它来的，颜色要
    统一），传了但不合契约就落回 8 预设，不让一个坏字典拖垮整个生成。
    判定用 is_valid_generated_theme——与前端同一契约，前端会弃用的主题这里
    绝不拿来配色（否则卡片一个色系、侧栏另一个色系）。

    label 不在契约必填集里（前端渲染也不校验它），但本文件的两个 prompt
    消费方都要读 hint['label']——这里出口兜底，缺了给个中性名，不让一个
    可选字段把整层增强炸成 KeyError（终检实测过的事故路径）。"""
    if is_valid_generated_theme(generated_theme):
        theme = dict(generated_theme)  # type: ignore[arg-type]
        theme.setdefault("label", "自定义主题")
        return theme
    return _THEME_COLOR_HINTS.get(theme_id) or _THEME_COLOR_HINTS[_DEFAULT_THEME_ID]


def _theme_prompt_fragment(theme_id: str, generated_theme: Optional[dict[str, Any]] = None) -> str:
    hint = _theme_palette(theme_id, generated_theme)
    charts = ", ".join(hint["charts"])
    return (
        f"这个应用当前用的身份主题是「{hint['label']}」，下面这套色板已经用在真实"
        f"渲染出来的侧边栏/顶栏/按钮上了，你的配色**只能从这套色板里取**（含深浅/"
        f"透明度变体），不能自己另外发明色相：\n"
        f"- 主色：{hint['primary']}（悬停态 {hint['primaryHover']}，浅端 {hint['gradTo']}）\n"
        f"- 内容区底色：{hint['contentBg']}\n"
        f"- 强调浅底/强调字：{hint['accentBg']} / {hint['accentFg']}\n"
        f"- 多类别/多序列区分色（画多阶段流程、多类别图例这种需要好几个不同色块"
        f"时优先从这 3 个里选，而不是自己配一套糖果色）：{charts}\n"
        "同一个组件里如果需要不止一种颜色，从以上色值出发做深浅/透明度调整，"
        "不要引入跟这套色板色相不搭的新颜色（比如主题是暖橙系就不要通篇上蓝紫）。"
    )


def _device_prompt_fragment(device: str) -> str:
    return _DEVICE_CONTAINER_HINTS.get(device) or _DEVICE_CONTAINER_HINTS[_DEFAULT_DEVICE]


def _datamodel_summary_lines(datamodel: dict[str, Any]) -> str:
    """把数据模型压成生图 prompt 用得上的自然语言摘要——不是甩一整段原始
    JSON 进去（生图模型不是在做结构化解析，喂太长的原始 JSON 对画面构图没
    帮助），只挑「画面里该出现几类/叫什么名字」这种直接影响构图的信息：
    实体名 + 字段名/类型，enum 字段展开真实选项（比如状态有几种、分别叫
    什么），这样生成的图不会凭空编一个"看起来对"但跟真实字段对不上的阶段数。

    不设实体数/选项数上限——密度应该由真实数据模型本身有多厚来决定，不是
    开发者手工定一个"最多给你看 6 个实体"的天花板；有多少真实字段/关系，
    就让生图/结构生成看见多少，让画面的丰富程度自己长出来，而不是靠 prompt
    里写死"多来点分组/多来点标签"这种指令去撑密度。
    """
    lines: list[str] = []
    for e in datamodel.get("entities") or []:
        ename = e.get("name") or e.get("id") or ""
        bits: list[str] = []
        for f in e.get("fields") or []:
            fname = f.get("name") or f.get("id") or ""
            ftype = f.get("type") or ""
            opts = f.get("options")
            if ftype == "enum" and isinstance(opts, list) and opts:
                labels = "/".join(str(o.get("label") or o.get("id") or "") for o in opts)
                bits.append(f"{fname}（{len(opts)}类：{labels}）")
            else:
                bits.append(f"{fname}[{ftype}]")
        if bits:
            lines.append(f"{ename}：{'、'.join(bits)}")
    return "\n".join(lines)


def _enumerate_chart_candidates(datamodel: dict[str, Any]) -> list[dict[str, Any]]:
    """按 Metabase X-Ray 的思路，机械枚举数据模型里所有"数学上合法"的图表
    组合——每个 enum 字段的分布计数、每个 number 字段按 enum 字段分组求和——
    而不是完全指望 LLM 自己去猜哪些字段组合能撑起一张图。这些候选本身已经
    保证 entityRef/dimensionFieldId/metricFieldId 都是真实存在的字段，LLM
    从这批候选里选/组合，可用真实候选一目了然，用不用、用几个，仍然是 LLM
    自己的设计判断，这里只负责穷举"有哪些合法选项"。

    不设候选数量上限——候选多少取决于数据模型本身有多少 enum/number 字段，
    跟 _datamodel_summary_lines 的"不设实体数上限"是同一个原则：密度由真实
    数据模型的厚度决定，不是开发者手工定一个候选数天花板。
    """
    candidates: list[dict[str, Any]] = []
    for e in datamodel.get("entities") or []:
        eid = e.get("id")
        if not eid:
            continue
        ename = e.get("name") or eid
        fields = e.get("fields") or []
        enum_fields = [f for f in fields if f.get("type") == "enum" and f.get("id")]
        number_fields = [f for f in fields if f.get("type") == "number" and f.get("id")]
        for ef in enum_fields:
            efname = ef.get("name") or ef.get("id")
            candidates.append(
                {
                    "entityRef": eid,
                    "dimensionFieldId": ef["id"],
                    "metric": "count",
                    "metricFieldId": None,
                    "metricLabel": f"{ename}数量",
                    "note": f"{ename}按「{efname}」分布计数",
                }
            )
            for nf in number_fields:
                nfname = nf.get("name") or nf.get("id")
                candidates.append(
                    {
                        "entityRef": eid,
                        "dimensionFieldId": ef["id"],
                        "metric": "sum",
                        "metricFieldId": nf["id"],
                        "metricLabel": f"{nfname}总和",
                        "note": f"{ename}按「{efname}」分组的「{nfname}」总和",
                    }
                )
    return candidates


def _chart_candidates_prompt_fragment(datamodel: dict[str, Any]) -> str:
    candidates = _enumerate_chart_candidates(datamodel)
    if not candidates:
        return ""
    lines = []
    for c in candidates:
        metric_bit = (
            'metric="count"'
            if c["metric"] == "count"
            else f'metric="sum", metricFieldId="{c["metricFieldId"]}"'
        )
        lines.append(
            f'- {c["note"]}：entityRef="{c["entityRef"]}", '
            f'dimensionFieldId="{c["dimensionFieldId"]}", {metric_bit}, '
            f'metricLabel 建议"{c["metricLabel"]}"'
        )
    return (
        "\n下面是这个数据模型里机械枚举出来的所有合法图表候选（每一条的字段组合"
        "都已验证过真实存在，可以直接拿来填 chart 字段，type 自己按设计需要挑 "
        "bar/line/pie/donut）——不要求全部用上，但可以更多地利用这些真实候选去"
        "撑画面密度，而不是只挑一两个：\n" + "\n".join(lines) + "\n"
    )


def _entity_index(datamodel: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    entities = {e.get("id"): e for e in datamodel.get("entities", []) if e.get("id")}
    field_types: dict[str, str] = {}
    for e in datamodel.get("entities", []):
        eid = e.get("id")
        if not eid:
            continue
        for f in e.get("fields", []):
            fid = f.get("id")
            if fid:
                field_types[f"{eid}.{fid}"] = f.get("type")
    return entities, field_types


def build_freeform_models(datamodel: dict[str, Any]) -> type[BaseModel]:
    """按当轮真实数据模型闭包构建 Pydantic 模型——DataRef.entityRef/aggregate
    的校验需要知道"真实存在哪些实体/字段"，每轮数据模型不同，模型也要重建。
    """
    entities, field_types = _entity_index(datamodel)

    class DataRef(BaseModel):
        """一个数字的真实来源。

        2026-07-29 加了 trendFieldRef/trendGrain：参考图上的 KPI 卡都是
        「大数字 + 较昨日↑12% + 卡底一条迷你走势线」三层，我们只出得了第一层，
        对比下来就是"少了两层信息"。形状对标 ant-design/pro-components 的
        StatisticCard（Statistic 的 trend: up|down + description 文案，
        StatisticCard 的 chart 槽位 + chartPlacement）——那是这类卡片的成熟
        长相，不自己发明一套。

        **一个字段同时驱动两层**：给了 trendFieldRef 就既算环比、也出走势线。
        分成两个声明的话模型要多记一套规则，而这两层本来就靠同一份时间分桶，
        没有"只要其一"的实际场景。
        """

        entityRef: str
        aggregate: Optional[str] = None
        #: 时间字段（同实体下的 date 字段）。给了就出环比 + 迷你走势线。
        trendFieldRef: Optional[str] = None
        #: 分桶粒度，默认按天。
        trendGrain: Optional[str] = None

        @field_validator("trendGrain")
        @classmethod
        def check_grain(cls, v: Optional[str]) -> Optional[str]:
            if v is not None and v not in ("day", "week", "month"):
                raise ValueError("trendGrain must be one of: day, week, month")
            return v

        @field_validator("entityRef")
        @classmethod
        def check_entity(cls, v: str) -> str:
            if v not in entities:
                raise ValueError(
                    f"entityRef '{v}' does not exist. Real entities are: {list(entities.keys())}"
                )
            return v

        @model_validator(mode="after")
        def check_aggregate(self) -> "DataRef":
            if self.aggregate and self.aggregate != "count":
                prefix, sep, field_id = self.aggregate.partition(":")
                if not sep or prefix not in ("sum", "avg"):
                    raise ValueError(
                        "aggregate must be 'count', 'sum:<fieldId>', or 'avg:<fieldId>'"
                    )
                qualified = f"{self.entityRef}.{field_id}"
                if qualified not in field_types:
                    raise ValueError(
                        f"field '{field_id}' does not exist on entity '{self.entityRef}'"
                    )
                if field_types[qualified] != "number":
                    raise ValueError(
                        f"field '{field_id}' on '{self.entityRef}' is type "
                        f"'{field_types[qualified]}', aggregate requires a number field"
                    )
            if self.trendFieldRef:
                qualified_trend = f"{self.entityRef}.{self.trendFieldRef}"
                if qualified_trend not in field_types:
                    raise ValueError(
                        f"dataRef.trendFieldRef '{self.trendFieldRef}' does not exist on "
                        f"entity '{self.entityRef}'"
                    )
                if field_types[qualified_trend] != "date":
                    raise ValueError(
                        f"dataRef.trendFieldRef '{self.trendFieldRef}' on '{self.entityRef}' "
                        f"is type '{field_types[qualified_trend]}', 环比与走势线需要 date 字段"
                    )
            elif self.trendGrain:
                raise ValueError("dataRef.trendGrain 需要同时给 trendFieldRef")
            return self

    class ChartSpec(BaseModel):
        """真图表声明——不是画出来的近似值，是运行时拿真实行数据现算的
        ECharts option（复用 client 侧 build-echarts-option.ts 那套已经在用
        的确定性配色/分组逻辑）。数据会随真实数据变化自动更新，不是生成时
        定死的静态快照。"""

        type: str
        entityRef: str
        dimensionFieldId: str
        metric: str
        metricFieldId: Optional[str] = None
        metricLabel: str

        @field_validator("type")
        @classmethod
        def check_type(cls, v: str) -> str:
            if v not in ("bar", "line", "pie", "donut"):
                raise ValueError("chart.type must be one of: bar, line, pie, donut")
            return v

        @field_validator("metric")
        @classmethod
        def check_metric(cls, v: str) -> str:
            if v not in ("count", "sum"):
                raise ValueError("chart.metric must be 'count' or 'sum'")
            return v

        @field_validator("entityRef")
        @classmethod
        def check_entity(cls, v: str) -> str:
            if v not in entities:
                raise ValueError(
                    f"chart.entityRef '{v}' does not exist. Real entities are: {list(entities.keys())}"
                )
            return v

        @model_validator(mode="after")
        def check_fields(self) -> "ChartSpec":
            qualified_dim = f"{self.entityRef}.{self.dimensionFieldId}"
            if qualified_dim not in field_types:
                raise ValueError(
                    f"chart.dimensionFieldId '{self.dimensionFieldId}' does not exist on entity '{self.entityRef}'"
                )
            if self.metric == "sum":
                if not self.metricFieldId:
                    raise ValueError("chart.metric='sum' requires metricFieldId")
                qualified_metric = f"{self.entityRef}.{self.metricFieldId}"
                if qualified_metric not in field_types:
                    raise ValueError(
                        f"chart.metricFieldId '{self.metricFieldId}' does not exist on entity '{self.entityRef}'"
                    )
                if field_types[qualified_metric] != "number":
                    raise ValueError(
                        f"chart.metricFieldId '{self.metricFieldId}' on '{self.entityRef}' is type "
                        f"'{field_types[qualified_metric]}', sum requires a number field"
                    )
            return self

    class BlockRef(BaseModel):
        """把一个**现成的体验积木**摆进设计树里（2026-07-29）。

        动机：freeform 的 dataRef 只能表达聚合值（count/sum/avg），没有"枚举
        真实第 N 行"的能力——排行榜/动态流这类逐行内容它画不出来，真机试过
        一次只能画出表头 + 空表身。与其让它硬画，不如让它**挑一个现成积木摆进
        自己的版式里**，渲染仍走那个积木经过测试的真渲染器（主题联动、诚实
        空态、真实行数据都是白送的）。

        这是 chart 节点的泛化：那边是"节点上挂 chart，渲染委托给 ECharts"，
        这边是"节点上挂 blockRef，渲染委托给 ExperienceBlockBoundary"。同一个
        口子，从只能嵌图表放宽到能嵌名单内的任何积木。

        名单语义抄 Puck 的 DropZone allow（packages/core/lib/data/
        is-component-allowed.ts）：**allow 设了就只放行名单内的**，名单外一律
        拒。名单从 experience_block_catalog.json 的 freeformEmbeddable 派生。

        binding 的深校验直接吃目录里那份 bindingSchema——跟 Gate 校验
        page.blocks 用的是同一本账（EXPERIENCE_BLOCK_BINDING_SCHEMAS），
        不另写一套判定，免得两处对同一个绑定给出不同结论。
        """

        type: str
        binding: dict[str, Any] = Field(default_factory=dict)
        props: dict[str, Any] = Field(default_factory=dict)

        @field_validator("type")
        @classmethod
        def check_type(cls, v: str) -> str:
            if v not in FREEFORM_EMBEDDABLE_BLOCK_TYPES:
                raise ValueError(
                    f"blockRef.type '{v}' can not be embedded in a freeform design. "
                    f"Embeddable types are: {list(FREEFORM_EMBEDDABLE_BLOCK_TYPES)}"
                )
            return v

        @model_validator(mode="after")
        def check_binding(self) -> "BlockRef":
            schema = EXPERIENCE_BLOCK_BINDING_SCHEMAS.get(self.type) or {}
            required = [str(k) for k in (schema.get("required") or [])]
            optional = [str(k) for k in (schema.get("optional") or [])]
            if not required and not optional:
                # 这类积木不吃 binding（QuickActionPanel / WorkflowTimeline）。
                if self.binding:
                    raise ValueError(
                        f"blockRef.type '{self.type}' does not take a binding "
                        f"(got keys: {sorted(self.binding)})"
                    )
                return self

            allowed = set(required) | set(optional)
            unknown = sorted(set(self.binding) - allowed)
            if unknown:
                raise ValueError(
                    f"blockRef.binding for '{self.type}' has unknown keys {unknown}. "
                    f"Allowed: {sorted(allowed)}"
                )
            missing = [k for k in required if not str(self.binding.get(k) or "").strip()]
            if missing:
                raise ValueError(
                    f"blockRef.binding for '{self.type}' is missing required keys {missing}"
                )

            entity_ref = str(self.binding.get("entityRef") or "").strip()
            if entity_ref and entity_ref not in entities:
                raise ValueError(
                    f"blockRef.binding.entityRef '{entity_ref}' does not exist. "
                    f"Real entities are: {list(entities.keys())}"
                )
            # 字段引用必须落在同一个实体上、类型对得上（date 的位置不能塞
            # number）——判定标准与 Gate 的 _validate_block_binding 同源。
            for ref_key, want_type in (schema.get("entityFieldRefs") or {}).items():
                field_id = str(self.binding.get(ref_key) or "").strip()
                if not field_id:
                    continue
                qualified = f"{entity_ref}.{field_id}"
                if qualified not in field_types:
                    raise ValueError(
                        f"blockRef.binding.{ref_key} '{field_id}' does not exist on entity "
                        f"'{entity_ref}'"
                    )
                if field_types[qualified] != want_type:
                    raise ValueError(
                        f"blockRef.binding.{ref_key} '{field_id}' on '{entity_ref}' is type "
                        f"'{field_types[qualified]}', {self.type} requires a {want_type} field"
                    )
            # 数组型字段引用（ActivityFeed 宽行档的 detailFieldRefs）——校验口径
            # 与 Gate 的 _validate_block_binding 同源。
            for key, spec in (schema.get("entityFieldRefLists") or {}).items():
                val = self.binding.get(key)
                if val is None:
                    continue
                if not isinstance(val, list):
                    raise ValueError(
                        f"blockRef.binding.{key} must be an array of field ids, got {val!r}"
                    )
                cap = spec.get("maxItems")
                if cap and len(val) > cap:
                    raise ValueError(
                        f"blockRef.binding.{key} accepts at most {cap} field(s), got {len(val)}"
                    )
                want = spec.get("fieldType")
                for field_id in val:
                    qualified = f"{entity_ref}.{field_id}"
                    if qualified not in field_types:
                        raise ValueError(
                            f"blockRef.binding.{key} '{field_id}' does not exist on entity "
                            f"'{entity_ref}'"
                        )
                    if want and field_types[qualified] != want:
                        raise ValueError(
                            f"blockRef.binding.{key} '{field_id}' on '{entity_ref}' is type "
                            f"'{field_types[qualified]}', {self.type} requires a {want} field"
                        )
            for key, choices in (schema.get("enums") or {}).items():
                val = self.binding.get(key)
                if val is not None and val not in choices:
                    raise ValueError(
                        f"blockRef.binding.{key} '{val}' is not one of {list(choices)}"
                    )
            for key, bounds in (schema.get("ranges") or {}).items():
                val = self.binding.get(key)
                if val is None:
                    continue
                lo, hi = bounds[0], bounds[1]
                if not isinstance(val, int) or isinstance(val, bool) or not (lo <= val <= hi):
                    raise ValueError(
                        f"blockRef.binding.{key} must be an integer in [{lo}, {hi}], got {val!r}"
                    )
            return self

    class FreeformNode(BaseModel):
        tag: str
        style: dict[str, str] = Field(default_factory=dict)
        text: Optional[str] = None
        iconRef: Optional[str] = None
        dataRef: Optional[DataRef] = None
        chart: Optional[ChartSpec] = None
        blockRef: Optional[BlockRef] = None
        children: list["FreeformNode"] = Field(default_factory=list)

        @field_validator("tag")
        @classmethod
        def check_tag(cls, v: str) -> str:
            if v not in FREEFORM_ALLOWED_TAGS:
                raise ValueError(
                    f"tag '{v}' is not allowed. Allowed tags: {list(FREEFORM_ALLOWED_TAGS)}"
                )
            return v

        @field_validator("style", mode="before")
        @classmethod
        def coerce_style_numbers(cls, v: Any) -> Any:
            """数字样式值补单位——照 React 的做法，不比 React 还严。

            2026-07-28 真跑逮到：模型写 `{"gap": 24, "padding": 16}`（数字），
            而 style 的类型标注是 dict[str, str]，Pydantic 在下面那个白名单
            校验之前就整批拒了——一次 89 条错误、三次重试全耗在同一类问题上，
            最后整个 freeformOverview 生成失败、首页回落固定骨架。

            React 本身是接受数字的：`style={{gap: 24}}` 渲染成 `gap: 24px`，
            只有一批"无单位属性"（flex/fontWeight/opacity/lineHeight/zIndex…）
            原样输出（见 React 源码 shared/CSSProperty.js 的 isUnitlessNumber）。
            这里照抄那份名单——渲染层最终就是交给 React，判定标准跟它一致才
            不会出现"Pydantic 拒了但 React 其实画得出来"的错杀。

            只做数字 → 字符串这一步；属性白名单和危险值拦截仍由下面那个
            校验器负责，安全边界没有放松。
            """
            if not isinstance(v, dict):
                return v
            out: dict[str, Any] = {}
            for k, val in v.items():
                if isinstance(val, bool) or not isinstance(val, (int, float)):
                    out[k] = val
                    continue
                num = int(val) if float(val).is_integer() else val
                out[k] = f"{num}" if k in _UNITLESS_STYLE_PROPS else f"{num}px"
            return out

        @field_validator("style")
        @classmethod
        def check_style(cls, v: dict[str, str]) -> dict[str, str]:
            for k, val in v.items():
                if k not in FREEFORM_ALLOWED_STYLE_PROPS:
                    raise ValueError(f"style property '{k}' is not in the allowed list")
                if _DANGEROUS_VALUE_RE.search(str(val)):
                    raise ValueError(f"style value for '{k}' contains a disallowed pattern: {val}")
            return v

        @field_validator("iconRef")
        @classmethod
        def check_icon(cls, v: Optional[str]) -> Optional[str]:
            # 2026-07-24：不再限定在一个手维护的十几个图标里——Ant Design 图标
            # 有上百个，硬卡一个小集合会逼着 LLM 拿语义不搭的图标凑合（真机
            # 撞到：订单销售额配了 trending-up、补货任务配了 alert-triangle）。
            # 改成"形状校验"：只要是合法的 Ant Design 图标组件名（PascalCase +
            # Outlined/Filled/TwoTone 结尾）就放行，前端按名字动态解析成真实
            # 组件。安全性不靠这个白名单兜底——图标名永远只当组件名查表，从不
            # 被当代码执行，且前端解析不到（拼错/编造的名字）就渲染成空、优雅
            # 降级，不会崩。老的 kebab 别名（check-circle 等）仍兼容。
            if v is None:
                return v
            if v in _LEGACY_ICON_ALIASES or _ANTD_ICON_NAME_RE.match(v):
                return v
            raise ValueError(
                f"iconRef '{v}' 不是合法的 Ant Design 图标名"
                "（应为 PascalCase 且以 Outlined/Filled/TwoTone 结尾，如 WalletOutlined）"
            )

        @model_validator(mode="after")
        def check_numbers_grounded(self) -> "FreeformNode":
            # "数字不能编"的生成侧强制（此前只靠 prompt 约束，模块 docstring
            # 自称有这条校验但代码里没有——guardrails 声明式 validator 思路）。
            # 只拦"数据声明"形状的数字（裸数值/货币/百分比/千分位/量词计数），
            # 不拦结构性数字（"近 7 天趋势"/"Top 5 客户"/"2026 年度"这类标题
            # ——终检实测过的一批误伤，prompt 也明说装饰性文案不需要 dataRef）。
            # 拦下即校验错误回喂 reask；建议把数值拆成独立节点挂 dataRef，
            # 因为渲染端 dataRefText 会整段替换 text（标签与数值要分节点写）。
            if self.text and _NUMERIC_CLAIM_RES_MATCH(self.text):
                if not (self.dataRef and self.dataRef.aggregate):
                    raise ValueError(
                        f"text 是数据声明（'{self.text[:40]}'）但没有挂 dataRef 聚合——"
                        "具体数值必须来自真实数据现算，不能手写。把数值拆成独立节点并挂 "
                        "dataRef（aggregate=count / sum:<fieldId> / avg:<fieldId>，"
                        "标签文字放在相邻节点），或改写文案去掉具体数值"
                    )
            return self

    FreeformNode.model_rebuild()

    class FreeformDesign(BaseModel):
        root: FreeformNode

        @model_validator(mode="after")
        def check_tree_bounds(self) -> "FreeformDesign":
            depth, nodes = _freeform_tree_bounds(self.root)
            if depth > FREEFORM_MAX_DEPTH:
                raise ValueError(
                    f"内容树嵌套过深（{depth} 层，上限 {FREEFORM_MAX_DEPTH}）——"
                    "请压平结构，减少不必要的嵌套容器"
                )
            if nodes > FREEFORM_MAX_NODES:
                raise ValueError(
                    f"内容树节点过多（≥{nodes} 个，上限 {FREEFORM_MAX_NODES}）——"
                    "请精简内容，只保留关键信息"
                )
            return self

    return FreeformDesign


def _blockref_prompt_fragment() -> str:
    """可嵌积木清单——从目录的 freeformEmbeddable 派生（2026-07-29）。

    名单语义抄 Puck 的 DropZone allow：allow 设了就只放行名单内的。改目录
    一处，Pydantic 校验/这段 prompt/前端渲染三处同步。绑定字段说明直接吃
    bindingSchema，与 Gate 校验 page.blocks 同一本账。
    """
    if not FREEFORM_EMBEDDABLE_BLOCK_TYPES:
        return ""
    by_type = {str(b["type"]): b for b in EXPERIENCE_BLOCKS}
    lines = [
        "",
        "有些内容你**画不出来**：需要逐行列出真实记录的那类（排行榜、动态流、",
        "流程时间线、入口按钮组）。dataRef 只能取聚合值（count/sum/avg），没有",
        "\"引用第 N 行\"的表达方式，硬画只会得到一个表头加一片空白。",
        "",
        "遇到这种内容，不要硬画，也不要跳过——**在你的版式里摆一个现成积木**：",
        "节点上加一个 blockRef 字段，运行时会把那个积木真实渲染进这块区域",
        "（真实行数据、主题配色、空态文案都由积木自己负责，你只决定它摆在哪、",
        "占多大）。这跟 chart 字段是同一个机制，只是换成了积木。",
        "",
        "可以嵌的积木只有这几个，名单之外的一律不接受：",
    ]
    for block_type in FREEFORM_EMBEDDABLE_BLOCK_TYPES:
        block = by_type.get(block_type) or {}
        schema = block.get("bindingSchema") or {}
        required = list(schema.get("required") or [])
        optional = list(schema.get("optional") or [])
        desc = str(block.get("description") or "").strip()
        if not required and not optional:
            bind_desc = "不需要 binding（省略这个字段）"
        else:
            parts = []
            field_refs = schema.get("entityFieldRefs") or {}
            for key in required:
                want = field_refs.get(key)
                parts.append(f"{key}（必填{'，同实体下的 ' + want + ' 字段' if want else ''}）")
            ref_lists = schema.get("entityFieldRefLists") or {}
            for key in optional:
                want = field_refs.get(key)
                extra = ""
                if want:
                    extra = f"，同实体下的 {want} 字段"
                elif key in ref_lists:
                    spec = ref_lists[key]
                    cap = spec.get("maxItems")
                    want_type = spec.get("fieldType")
                    extra = "，同实体下的{}字段 id **数组**{}".format(
                        f" {want_type} " if want_type else "",
                        f"，最多 {cap} 个" if cap else "",
                    )
                elif key in (schema.get("enums") or {}):
                    extra = "，取值：" + "/".join(map(str, schema["enums"][key]))
                elif key in (schema.get("ranges") or {}):
                    lo, hi = schema["ranges"][key]
                    extra = f"，{lo}-{hi} 的整数"
                parts.append(f"{key}（可选{extra}）")
            bind_desc = "binding: " + "、".join(parts)
        lines.append(f"- {block_type}：{desc[:60]}　{bind_desc}")
        # 表现档位（props.variant）——同一个积木的两种长相，由设计者按版面挑。
        # 从 propsSchema 派生而不是在这写死，加档位改目录一处即可。
        variants = (
            ((block.get("propsSchema") or {}).get("properties") or {})
            .get("variant", {})
            .get("enum")
        )
        if variants:
            lines.append(
                f"  ↳ 这个积木有 props.variant 可选：{'/'.join(map(str, variants))}"
                "（不写按第一个算）"
            )
    lines += [
        "",
        "写法（binding 里的 limit/sortOrder 这类可选项也写在 binding 里，不要写进 props；",
        "props 只放上面标了 ↳ 的表现档位）：",
        '{"tag": "div", "style": {"flex": "1"}, "blockRef": {',
        '  "type": "<上面名单里的一个>",',
        '  "binding": {"entityRef": "<真实实体 id>", "...": "<按上面说明填>"},',
        '  "props": {"variant": "<有 ↳ 才写，没有就整个省掉 props>"}',
        "}}",
        "",
        "**积木摆在哪，就挑对应的长相**：占满整行的位置用宽行档（ActivityFeed 的",
        "variant=row），这时一定要用 detailFieldRefs 补 1-3 个明细字段，否则一整行",
        "只有标题和日期，右边三分之二全是空的；挤在窄侧栏里才用默认的时间轴档。",
        "",
        "跟 chart 一样：有 blockRef 的节点不要再写 children/text（积木会接管这块",
        "区域的内容），节点自己的 style 仍然控制它在版式里占多大、周围留多少白。",
        "积木自带卡片外观（标题栏 + 白底 + 内边距），所以**不要再给这个节点套一层",
        "自己画的卡片**（不要设 backgroundColor / border / boxShadow / padding），",
        "否则又是卡片套卡片。",
        "",
        "这些积木是**可选的**：这一页确实需要展示逐行记录才摆，用不上就完全不用，",
        "不要为了凑数硬塞一个跟这页业务无关的排行榜。",
    ]
    return "\n".join(lines)


def build_freeform_prompt(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> str:
    return f"""你是一名前端视觉设计师。设计一个可视化组件：{design_brief}
要有视觉创意和现代感，大胆用间距、层次、颜色对比、图标去表达内容。

{_theme_prompt_fragment(theme_id, generated_theme)}
{_device_prompt_fragment(device)}

只能用安全原子积木拼：{", ".join(FREEFORM_ALLOWED_TAGS)} 标签。

图标（iconRef）：直接用 Ant Design 图标组件名，PascalCase、以 Outlined 结尾
（也可以是 Filled/TwoTone），比如 WalletOutlined、ShoppingCartOutlined、
PieChartOutlined。Ant Design 有上百个图标，**按语义挑最贴切的那个**，不要
将就：金额/营收用 DollarOutlined/WalletOutlined/AccountBookOutlined，订单/
购物用 ShoppingCartOutlined/ShoppingOutlined，库存/补货用 InboxOutlined/
DropboxOutlined/ContainerOutlined，任务/清单用 ProfileOutlined/
CarryOutOutlined，图表/分析用 PieChartOutlined/BarChartOutlined/
LineChartOutlined，用户/会员用 UserOutlined/TeamOutlined/CrownOutlined，
时间/排期用 ClockCircleOutlined/CalendarOutlined，告警/风险用
WarningOutlined/AlertOutlined/FireOutlined。下面是一批常用示例，但不限于
这些，任何合法的 Ant Design 图标名都可以用：
{json.dumps(list(FREEFORM_ALLOWED_ICON_REFS), ensure_ascii=False)}
每张统计卡/列表项/小节标题旁边，尽量都配一个贴切的 iconRef，图标是这类信息
卡片天然该有的视觉锚点，不要整份设计一个图标都不用。
图标要做得醒目、有存在感：统计卡（KPI 卡）的图标别做成一个跟正文一样大的
小字符，做成一个 40~48px 的圆角色块当图标底座（给这个图标节点设
backgroundColor 一块主题色/浅色底 + borderRadius + 居中），图标本身用
fontSize 22~28px（图标大小 = 所在节点的 fontSize，想让图标大就把这个节点的
fontSize 调大，不是设 width/height），色块配色跟这张卡的主色系呼应——参考
现代仪表盘里"每张 KPI 卡左上角一个醒目图标方块"的做法，不要缩成一个灰扑扑
的小图标。

style 对象的 key 只能用这些 CSS 属性名，写了列表之外的属性（比如 fontFamily、
listStyle）会被直接判失败：{", ".join(FREEFORM_ALLOWED_STYLE_PROPS)}。
颜色用具体十六进制值，背景可用 linear-gradient(...)，不能出现 url(...)。

间距（padding/margin/gap）、圆角（borderRadius）只能从这套固定刻度里取值，
不要自己另外发明数字——这套刻度是应用真实壳体（侧边栏/顶栏/卡片）本身在用
的同一套 Design Token，从这里取才能跟外层容器的间距感觉一致，不是"设计得
更精致"，是"对得上"：
- 间距刻度（px）：4、8、12、16、24、32——越小用在图标与文字的贴身间距，
  越大用在卡片之间的分隔；同一张卡片内部的 padding 通常统一用同一个值
  （比如卡片一律 16，不要一张卡 14 另一张 18）。
- 圆角刻度（px）：4（小元素，比如徽标/标签）、6（默认，大多数卡片/按钮）、
  8（强调型大卡片）。
- 阴影：浅色卡片用 "0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px 0 rgba(0,0,0,0.02)"
  这类很轻的多层阴影（近似取代边框、不抢视觉），需要更明显层次时用
  "0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)"，
  不要自己调一个更重/更黑的阴影。

根节点（也就是最外层那个 "root"）会被直接放进页面已有的内容区容器里，那层
容器本身已经带了背景色和内边距——根节点的 style 不要再设置 backgroundColor
或 padding，会跟外层容器套出"卡片里嵌卡片"的多余边框感；根节点只负责整体
排布（display/flexDirection/gap/width 这类）就够了。想要的卡片感、分组感，
放到内部子块（比如每张统计卡/图表卡自己）上去做。

需要柱状图/折线图/饼图/环形图这类真正的图表时，不要用 CSS 画近似的形状——
节点上加一个 chart 字段，交给真实图表引擎按运行时的真实数据现算，会随数据
变化自动更新，不是生成时定死的静态画面：
{{"tag": "div", "style": {{...控制这块区域的宽高/间距...}}, "chart": {{
  "type": "bar" | "line" | "pie" | "donut",
  "entityRef": "<数据模型里真实的实体 id>",
  "dimensionFieldId": "<同实体下真实的字段 id，通常是 enum 字段，图表按这个
    字段的取值分组>",
  "metric": "count" | "sum",
  "metricFieldId": "<metric 是 sum 时必填，同实体下真实的 number 字段 id>",
  "metricLabel": "<这个指标的展示名，比如 数量/总额>"
}}}}
有 chart 字段的节点不需要也不应该再写 children/text 去画图表本身的内容
（图表引擎会接管这块区域），但节点本身的 style 仍然控制这块区域的宽高/
外边距/背景。柱状图/饼图/环形图的分组字段（dimensionFieldId）优先选 enum
类型的字段——这样图表的类别数量和名字直接来自真实数据，不需要你去猜。

注意：chart 节点渲染出来的图表画布本身是固定高度（约 200px），你在这个
节点 style 上设的 height 不会让图表本身跟着变高变矮，只影响这块区域在
整体版式里占多大留白——不要指望"设一个更大的 height 图表就会画得更大"，
想要图表视觉上更突出，用外层包一层更宽的容器（比如让它独占一整行）或
调整周围留白，而不是在 chart 节点自己身上加一个不会生效的 height 期望。
{_chart_candidates_prompt_fragment(datamodel)}
{_blockref_prompt_fragment()}
下面是这个应用真实的数据模型，唯一可以引用的数据来源：
{json.dumps(datamodel, ensure_ascii=False, indent=2)}

如果设计里画的是某个 enum 字段的分类/阶段/流程步骤（比如状态流转图、分类
占比图），具体有几类、每一类叫什么名字，必须跟这个字段 options 里的真实值
完全一致（数量、顺序、名字都不能改），不能自己另外发明一套"看起来差不多但
对不上"的名字——那样图面好看，但跟真实数据字段脱节，dataRef 引用它也没
意义了。

凡是设计里出现的具体数字/统计类文字，必须挂 dataRef 指向真实存在的
entity+field，JSON 形状严格是这样，key 名必须一字不差（不能写成 entity/
field 这种猜测的名字，必须是 entityRef/aggregate）：
{{"dataRef": {{"entityRef": "<上面数据模型里真实的实体 id>", "aggregate": "count"}}}}
aggregate 只能是 "count"、"sum:<字段id>"、"avg:<字段id>" 三种之一，或者不填
这个键（没有聚合、只是引用实体本身时可以省略 aggregate）。
数据模型里没有合适字段支撑的数字就不要画，不能编。纯装饰性文案不需要 dataRef。

KPI 数字想带「环比 + 迷你走势线」时，在同一个 dataRef 里再加两个键：
{{"dataRef": {{"entityRef": "<实体 id>", "aggregate": "count",
  "trendFieldRef": "<同一个实体下 type 为 date 的字段 id>", "trendGrain": "day"}}}}
trendFieldRef 必须是**同一个实体**下的 date 字段（不是 number、不是 string），
trendGrain 只能是 "day"、"week"、"month"，不填按 day 算。给了这两个键之后，
渲染端会按这个时间字段自动分桶，在大数字下面渲染出「较前一日 ↑12%」和一条
迷你走势线——**这两层是渲染端算的，你不要自己再写一个写死的百分比文字节点，
也不要为它画额外的图**。走势的取值口径跟 aggregate 一致（aggregate 是
sum:金额，走势线画的就是每期金额之和）。
这是 KPI 卡片最该用的地方：数据模型里有日期字段的核心指标，都值得带上。

注意：children 数组里每一项都必须是完整的节点对象（有 tag 字段），
不能直接放字符串当子节点——文字内容一律放在节点的 text 字段里。

输出严格 JSON：{{"root": {{"tag": "div", "style": {{}}, "children": [...]}}}}
只输出这一个 JSON 对象，不要解释文字，不要 markdown 代码围栏。"""


def _build_reference_image_prompt(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> str:
    hint = _theme_palette(theme_id, generated_theme)
    charts = "、".join(hint["charts"])
    device_note = {
        "phone": "这是手机端内容区里的一张卡片（上方标题栏、下方 Tab 导航另有画面，不用你画），窄幅单列布局，比例偏竖长。",
        "tablet": "这是平板端内容区里的一张卡片（侧边栏+顶栏另有画面，不用你画），中等宽度。",
    }.get(device, "这是桌面端内容区里的一张卡片（左侧侧边栏、上方顶栏另有画面，不用你画），可以偏宽幅横向布局。")
    datamodel_summary = _datamodel_summary_lines(datamodel)
    datamodel_note = (
        f"\n这个区块背后真实的数据字段长这样（画面里出现的分类/阶段/条目数量"
        f"和名字要照着这些字段（尤其是括号里展开的 enum 选项）来，不要凭空编一个"
        f"'看起来差不多但对不上'的数量或名字，只示意版式不用写具体数值）：\n{datamodel_summary}\n"
        if datamodel_summary else ""
    )
    return (
        f"为一个应用界面区块生成一张 UI 参考效果图（干净原型图）。设计需求：{design_brief}。"
        "要求：只示意版式与配色，不要写任何具体数字/真实数据，占位文案用「示例XX」这类通用字样；"
        f"配色基调用「{hint['label']}」这套主题——主色 {hint['primary']}，背景用浅色（贴近 "
        f"{hint['contentBg']} 或纯白），强调浅底可参考 {hint['accentBg']}，克制使用，不要满屏铺色；"
        f"如果画面需要多个不同色块区分类别，优先从这几个颜色里选：{charts}，不要另配一套糖果色；"
        "卡片白底细边框，图标简洁线性，留白节奏舒展；不要出现任何多余的装饰性水印或品牌字样；"
        "画面内容要撑满整个画布，边缘到边缘，不要在四周留一圈空白画布底色、"
        "不要画装饰性的外框/圆角卡片壳/网页浏览器窗口 mockup 把整个画面包起来——"
        "这张图本身就是内容区局部，不是「一张图里嵌一张界面截图」的效果。"
        f"{device_note}{datamodel_note}"
    )


def _build_overview_sheet_prompt(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> str:
    """总览页的**一张三区参照板**：样式风格 + 桌面版式 + 手机版式。

    为什么是一张而不是三张：桌面与手机两档版式要出自同一套视觉语言。分开生
    三张图，三张各自随机，两档设计参照的是三种不同风格，拼起来就不像一个产品。
    一张板上并排画，模型自己会保证三区同色同调——这也正是设计行业「Style
    Tile」这个交付物的用法（Samantha Warren 2011）：色板、字体层级、按钮/
    标签/图标样例摆在同一块板上，先定调性再谈具体页面。

    三区的内容分工照 Style Tile 的老规矩来：
      左窄栏 = 调性（色板色块 / 图标集 / 按钮标签徽标样例 / 字号层级）
      中间   = 桌面首页版式（宽幅，可多列横排）
      右窄栏 = 手机首页版式（窄幅单列，手机比例）

    注意跟单区块参照图（_build_reference_image_prompt）的一个关键差别：那张
    明令"不要画外框/浏览器窗口 mockup，这张图本身就是内容区局部"；这张恰恰
    相反——三个区要能看出边界，手机那区还需要一个手机轮廓才说得清是哪一档。
    """
    hint = _theme_palette(theme_id, generated_theme)
    charts = "、".join(hint["charts"])
    datamodel_summary = _datamodel_summary_lines(datamodel)
    datamodel_note = (
        f"\n背后真实的数据字段长这样（画面里出现的分类/阶段/条目的数量和名字要"
        f"照着这些字段来，尤其是括号里展开的 enum 选项，不要凭空编一个"
        f"'看起来差不多但对不上'的数量；只示意版式，不用写具体数值）：\n{datamodel_summary}\n"
        if datamodel_summary else ""
    )
    return (
        "生成一张横向的 UI 设计参照板（design style sheet），16:9，"
        "用细分隔线把画布**从左到右分成三个区**，三区共用同一套视觉语言：\n"
        "① 左侧窄栏「样式风格」：主色/辅色的色板色块、一组简洁线性图标（6-10 个）、"
        "按钮与标签与徽标的样例、两三级字号层级示意。\n"
        "② 中间宽区「桌面首页」：桌面端内容区的总览版式——顶部一行指标卡、"
        "下方图表区，可以多列横向排布。不要画左侧侧边栏和顶栏（那部分另有画面）。\n"
        "③ 右侧窄栏「手机首页」：同一个总览，改成手机端的窄幅**单列纵向**排布，"
        "指标卡一行一张、图表压扁；画一个简洁的手机轮廓把这一区框起来，"
        "好看出它是手机档。\n"
        f"设计需求：{design_brief}。"
        f"配色基调用「{hint['label']}」这套主题——主色 {hint['primary']}，"
        f"背景浅色（贴近 {hint['contentBg']} 或纯白），强调浅底可参考 {hint['accentBg']}，"
        "克制使用不要满屏铺色；"
        f"需要多色区分类别时优先从这几个里选：{charts}，不要另配一套糖果色。"
        "只示意版式与配色，不要写任何具体数字或真实数据，占位文案用「示例XX」这类通用字样；"
        "卡片白底细边框、图标简洁线性、留白舒展；不要出现水印或品牌字样；"
        "画面撑满画布，四周不留空白底色。"
        f"{datamodel_note}"
    )


def _generate_reference_image_b64(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """生图当参照——加分项，不是必需项。未配置 IMAGE_API_KEY 或生图失败都
    静默降级为 None，绝不能让这一步拖垮 FreeformInsight 主生成路径。图片
    只在本次调用内临时使用（喂给下面的视觉 LLM 看一眼），不落盘、不进产物、
    不展示给终端用户——它上面的"数字"都是占位假象，不能当真实数据源。
    """
    try:
        from sliderule_llm.image_client import ImageGenError, generate_image_png
    except Exception:
        return None
    try:
        prompt = _build_reference_image_prompt(
            design_brief, datamodel, theme_id=theme_id, device=device, generated_theme=generated_theme
        )
        png_bytes = generate_image_png(prompt, size=_image_size_for_device(device))
    except ImageGenError as exc:
        print(f"[freeform_block] reference image skipped: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 生图失败绝不能拖垮主链路
        print(f"[freeform_block] reference image skipped (unexpected): {str(exc)[:160]}")
        return None
    return base64.b64encode(png_bytes).decode("ascii")


def _supports_image_content_parts() -> bool:
    """通道支不支持多模态 content parts。

    单独抽出来是因为 get_llm_config 在 generate_freeform_block 里是**函数内
    导入**的（那是为了不让 LLM 配置在模块导入期就被拉起），
    enrich_monitor_page_overviews 用不到那个局部名字。配置读不出来时按
    "不支持"处理——宁可退回纯文字生成，也不要在生图上白等一轮。
    """
    try:
        from sliderule_llm.config import get_llm_config

        return bool(get_llm_config().supports_image_content_parts)
    except Exception:  # noqa: BLE001 — 配置异常不该拖垮主链路
        return False


def _generate_overview_sheet_b64(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """生成三区参照板。跟 _generate_reference_image_b64 一样是**加分项**：
    任何失败都静默返回 None，调用方退回纯文字生成，绝不拖垮主链路。

    尺寸用 16:9 的 1792x1024——不是 1920x1080：这一档的图像接口只认固定几个
    尺寸档（1024x1024 / 1792x1024 / 1024x1792），1920x1080 不在其中，传进去
    会被拒。1792x1024 是同一个 16:9 家族里它认的那一档。
    """
    try:
        from sliderule_llm.image_client import ImageGenError, generate_image_png
    except Exception:
        return None
    try:
        prompt = _build_overview_sheet_prompt(
            design_brief, datamodel, theme_id=theme_id, generated_theme=generated_theme
        )
        png_bytes = generate_image_png(prompt, size=_DEVICE_IMAGE_SIZE["desktop"])
    except ImageGenError as exc:
        print(f"[freeform_block] overview sheet skipped: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 生图失败绝不能拖垮主链路
        print(f"[freeform_block] overview sheet skipped (unexpected): {str(exc)[:160]}")
        return None
    return base64.b64encode(png_bytes).decode("ascii")


def _render_preview_screenshot_b64(
    design_dump: dict[str, Any],
    *,
    theme_id: str,
    device: str,
    generated_theme: Optional[dict[str, Any]],
) -> Optional[str]:
    """把校验通过的候选内容真实渲染一次、截图，供下面的自我校验步骤跟参考图
    比对（借鉴 abi/screenshot-to-code 的 screenshot_preview 思路：生成→截图→
    自己看→改，不是纯一次性生成完就当定稿）。

    这一步这时候还没有真实运行时行数据（generate_freeform_block 只有
    datamodel schema，没有实例数据）——chart 节点会渲染成"暂无数据"占位，
    截图主要用来检验版式/密度/图标使用/留白这些跟真实数据无关的部分，不能
    验证图表配色/形状本身。跟生参考图一样，任何一步不可用/失败都返回 None，
    调用方必须当作"这一步跳过"处理，不能让这个增强项拖垮主生成路径。
    """
    try:
        from services.app_screenshot import (
            capture_freeform_preview_screenshot,
            e2b_screenshot_available,
        )
        from services.freeform_preview_store import put_preview
    except Exception:
        return None
    if not e2b_screenshot_available():
        return None
    try:
        pid = put_preview(
            {
                "freeformContent": design_dump,
                "themeId": theme_id,
                "generatedTheme": generated_theme,
                "device": device or _DEFAULT_DEVICE,
            }
        )
        png_bytes = capture_freeform_preview_screenshot(pid)
    except Exception:
        return None
    if not png_bytes:
        return None
    return base64.b64encode(png_bytes).decode("ascii")


def _critique_against_reference(
    design_dump: dict[str, Any],
    *,
    reference_image_b64: str,
    preview_screenshot_b64: str,
    design_brief: str,
    FreeformDesign: type[BaseModel],
) -> Optional[dict[str, Any]]:
    """把参考图和真实渲染截图一起喂给 LLM，让它自己判断这版结构是不是明显
    比参考图单薄/有版式问题；如果是，让它直接产出一版修订过的完整 JSON。

    只做一轮，不递归再校验一次修订结果的截图——那样成本会失控。修订结果
    仍然要过同一套 Pydantic 深校验，校验不过就放弃这轮修订、用原版本，不能
    因为"想变得更好"反而引入一个没校验过的坏结果。任何失败（LLM 报错/
    JSON 解析失败/校验不过）都静默回退到原始 design_dump。
    """
    from sliderule_llm.client import LlmError, call_llm_with_retry

    critique_prompt = (
        f"设计需求是：{design_brief}\n\n"
        "第一张图是这个区块的配色/版式参考图（生成用的草稿参照，不是真实数据）。"
        "第二张图是刚才生成的结构 JSON 真实渲染出来的样子（图表部分因为还没有"
        "真实数据会显示「暂无数据」占位，这是正常的，不算问题，不用因此改动）。\n\n"
        "对比这两张图，只看版式密度、留白节奏、图标使用、色彩克制程度这些跟"
        "具体数据无关的方面：如果第二张明显比第一张单薄（卡片数量少很多/"
        "大片空白/完全没用图标/结构过于简单），请输出一版修订后的完整 JSON，"
        "在现有基础上补充更多卡片/分组/图标，让密度更接近参考图，其它规则"
        "（安全标签白名单、dataRef 必须指向真实字段、chart 字段格式）完全不变。"
        "如果已经足够接近，不需要改，直接回复严格的 JSON 字符串 \"GOOD\"，"
        "不要输出别的文字。"
    )
    convo: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": critique_prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{reference_image_b64}"}},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{preview_screenshot_b64}"}},
            ],
        }
    ]
    try:
        result = call_llm_with_retry(
            convo,
            max_attempts=2,
            backoff_ms=2000,
            temperature=0.5,
            max_tokens=14000,
            on_delta=lambda _chunk: None,
        )
    except LlmError:
        return None

    raw = (result.content or "").strip()
    if raw.strip('"').strip() == "GOOD" or not raw:
        return None
    try:
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
        if not text.startswith("{"):
            return None
        payload = json.loads(text)
        revised = FreeformDesign.model_validate(payload)
    except (ValueError, json.JSONDecodeError, ValidationError):
        return None
    return revised.model_dump()


def generate_freeform_block(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
    max_retries: int = 2,
    temperature: float = 0.7,
    max_tokens: int = 14000,
    use_reference_image: bool = True,
    allow_screenshot_verify: bool = True,
    reference_image_b64: Optional[str] = None,
) -> dict[str, Any]:
    """生成 + 深校验一个 FreeformInsight 区块的内容树。校验失败时把「上次
    输出 + 具体报错」拼回消息重问（跟 structured_llm_json 同一套 reask 语义，
    这里额外插入 Pydantic 深校验，不只是 shape 校验）。重试耗尽抛
    FreeformGenerationError，调用方应把这个区块降级/拿掉，不能让它拖垮
    整个应用发布。

    theme_id/device：这个区块最终会落进真实运行的固定壳里（哪套身份主题的
    侧边栏/顶栏、哪种设备容器），生图和结构生成两处 prompt 都要照这两条线
    走，否则配色会跟真实壳脱节、版式也不知道自己是塞进桌面宽内容区还是手机
    窄内容区。留空按 azure/desktop 兜底，不是必填——老调用方不传也不炸。

    generated_theme：如果这个 app 的身份主题是 identity_theme_gen.py 生图
    生成的（不是 8 预设之一），把那份完整主题对象传进来，优先级高于
    theme_id——否则 FreeformInsight 的配色还是照着 8 预设走，跟侧边栏/顶栏
    真实用的自定义主题对不上。

    use_reference_image=True（默认）时先生一张干净原型图当视觉参照，喂给
    视觉 LLM 一起看（需要网关声明 LLM_SUPPORTS_IMAGE_CONTENT_PARTS=1，未声明
    或生图不可用时自动降级为纯文字生成，行为与加这段之前完全一致）。

    max_tokens 默认 7000 → 10000 → 14000：每次都是被真实截断推上去的。
    10000 那次是加了视觉参照（模型描述更细、节点数变多）；14000 这次是加了
    blockRef（可嵌积木清单进 prompt、逐行内容清单进 brief，输出又长一截，
    实测在 6580 字符处被切断、三次重试全挂在同一个位置）。截断表现为
    "invalid JSON: Expecting ',' delimiter"，不是模型写错了 JSON，是话没说完。
    """
    design_brief = (design_brief or "").strip()
    if not design_brief:
        raise FreeformGenerationError("designBrief is empty")

    from sliderule_llm.client import LlmError, call_llm_with_retry
    from sliderule_llm.config import get_llm_config

    FreeformDesign = build_freeform_models(datamodel)
    prompt_text = build_freeform_prompt(
        design_brief, datamodel, theme_id=theme_id, device=device, generated_theme=generated_theme
    )

    # 调用方可以把现成的参照图传进来（reference_image_b64）——总览页就是这么用的：
    # 一张三区参照板同时喂给桌面档和手机档两次设计，两档才出自同一套视觉语言，
    # 也省掉一次生图。没传才自己生一张。
    if reference_image_b64 is None and use_reference_image and get_llm_config().supports_image_content_parts:
        reference_image_b64 = _generate_reference_image_b64(
            design_brief, datamodel, theme_id=theme_id, device=device, generated_theme=generated_theme
        )

    if reference_image_b64:
        first_content: Any = [
            {
                "type": "text",
                "text": prompt_text
                + "\n\n下面这张图是这个设计需求的参考效果图：版式布局、配色克制程度、"
                "留白节奏照着这张图的风格来。但图上任何看起来像数字/统计的内容都只是"
                "占位假象，绝不能照抄或参考它的具体数值——真实数字仍然只能来自上面给出的"
                "数据模型，并挂 dataRef。",
            },
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{reference_image_b64}"}},
        ]
    else:
        first_content = prompt_text

    convo: list[dict[str, Any]] = [{"role": "user", "content": first_content}]
    last_error = "unknown"
    for _attempt in range(max_retries + 1):
        try:
            result = call_llm_with_retry(
                convo,
                max_attempts=2,
                backoff_ms=2000,
                temperature=temperature,
                max_tokens=max_tokens,
                on_delta=lambda _chunk: None,  # 强制流式，免疫 CF 524（跟 structured_llm_json 同招）
            )
        except LlmError as exc:
            last_error = f"llm error: {str(exc)[:200]}"
            continue

        raw = result.content or ""
        try:
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
            if not text.startswith("{"):
                m = re.search(r"\{.*\}", text, re.DOTALL)
                if not m:
                    raise ValueError("no JSON object found in response")
                text = m.group(0)
            payload = json.loads(text)
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = f"invalid JSON: {str(exc)[:200]}"
            convo = convo + [
                {"role": "assistant", "content": raw[:6000]},
                {"role": "user", "content": f"你上次的输出不是合法 JSON：{last_error}。请重新输出，只要一个 JSON 对象。"},
            ]
            continue

        try:
            design = FreeformDesign.model_validate(payload)
        except ValidationError as exc:
            last_error = str(exc)[:1200]
            convo = convo + [
                {"role": "assistant", "content": raw[:6000]},
                {
                    "role": "user",
                    "content": (
                        f"你上次的输出没有通过校验，具体错误：\n{last_error}\n"
                        "请仔细检查：children 数组每一项必须是完整节点对象（不能是裸字符串）、"
                        "tag/style 属性/iconRef 必须在允许的白名单内、dataRef 引用的实体和字段"
                        "必须真实存在且类型对得上。如果报错是 dataRef 相关的 'Field required' 或"
                        "缺 entityRef，最常见原因是 key 名写错了（比如写成 entity/field），"
                        "dataRef 的 key 只有 entityRef / aggregate / trendFieldRef / "
                        "trendGrain 四个，不是别的名字。"
                        "重新输出完整的 JSON，只要一个 JSON 对象。"
                    ),
                },
            ]
            continue

        design_dump = design.model_dump()

        # 配色合规的机械防线（2026-07-29，见 palette_guard.py）。
        #
        # 色板约束此前**只写在 prompt 里**，而且写得很清楚（连"暖橙系不要通篇
        # 上蓝紫"都写了）。真跑一看模型一字不差地干了那句话警告的事：tangerine
        # 主题的应用主色一次没出现、蓝色占 60%、还自己发明了一套绿。参考图给
        # 对了、文字约束给对了，但没有任何一层去查。这里补上。
        #
        # 违规先 reask（跟 Pydantic 校验失败走同一条路，把具体哪几个色、偏了
        # 多少度告诉它）；重试耗尽时**机械纠偏后放行**，绝不因为配色问题抛错
        # ——抛了调用方就回落固定骨架，那正是这一整条链路一直在治的病。
        palette_hint = _theme_palette(theme_id, generated_theme)
        palette_list = [
            c
            for c in [palette_hint.get("primary"), *(palette_hint.get("charts") or [])]
            if isinstance(c, str) and c.startswith("#")
        ]
        primary_color = str(palette_hint.get("primary") or "")
        if palette_list and primary_color:
            report = palette_report(
                extract_hex_colors(design_dump), palette_list, primary_color
            )
            if not report.ok:
                is_last = _attempt >= max_retries
                if not is_last:
                    last_error = "palette non-compliance"
                    convo = convo + [
                        {"role": "assistant", "content": raw[:6000]},
                        {
                            "role": "user",
                            "content": report.reask_message(palette_list, primary_color)
                            + "\n其余内容（版式、节点结构、dataRef、chart、blockRef）保持不变，"
                            "重新输出完整的 JSON，只要一个 JSON 对象。",
                        },
                    ]
                    continue
                repaired, changed = repair_colors(
                    json.dumps(design_dump, ensure_ascii=False), palette_list, primary_color
                )
                if changed:
                    try:
                        design_dump = json.loads(repaired)
                        print(
                            f"[freeform_block] palette repaired mechanically: {changed} color(s) "
                            "snapped to the nearest palette hue"
                        )
                    except json.JSONDecodeError:
                        pass  # 纠偏后解析不了就用原样，配色问题不值得丢掉整份设计
                if not report.primary_ok:
                    print(
                        "[freeform_block] palette warning: primary hue used "
                        f"{report.primary_uses}x vs dominant family {report.dominant_uses}x "
                        "(kept as-is; proportion is a design call, not mechanically repairable)"
                    )

        # 自我校验闭环（借鉴 abi/screenshot-to-code 的 screenshot_preview 思路：
        # 生成→截图→自己看→改，不是纯一次性生成完就当定稿）。只在真的生了
        # 参考图时才做——没有参照物就没法判断"够不够密"。这整块包在自己的
        # try/except 里，任何异常（哪怕是我没预料到的 bug）都不能让一次已经
        # 校验通过的生成结果因为这个增强步骤而报废。
        if reference_image_b64 and allow_screenshot_verify:
            try:
                preview_b64 = _render_preview_screenshot_b64(
                    design_dump, theme_id=theme_id, device=device, generated_theme=generated_theme
                )
                if preview_b64:
                    revised_dump = _critique_against_reference(
                        design_dump,
                        reference_image_b64=reference_image_b64,
                        preview_screenshot_b64=preview_b64,
                        design_brief=design_brief,
                        FreeformDesign=FreeformDesign,
                    )
                    if revised_dump is not None:
                        design_dump = revised_dump
            except Exception as exc:  # noqa: BLE001 — 增强步骤绝不能拖垮已校验通过的主结果
                print(f"[freeform_block] self-verify skipped (unexpected): {str(exc)[:160]}")
        return design_dump

    raise FreeformGenerationError(f"exhausted {max_retries + 1} attempts, last error: {last_error}")


def enrich_freeform_blocks(model: dict[str, Any]) -> dict[str, Any]:
    """主模型过 Gate 之后，同一次「生成」体验里紧接着跑的第二段——扫描
    page.blocks 里的 FreeformInsight，逐个生成+校验内容树，写回
    block["freeformContent"]。生成失败（重试耗尽）的区块直接从
    page.blocks 和 page.layout 的槽位引用里一并摘掉，如实降级，不让一个
    装饰性区块的生成失败拖垮整个应用发布（fail-closed 的口径延伸到区块
    级）。原地修改并返回同一个 model，方便调用方链式使用。
    """
    datamodel = model.get("datamodel") or {}
    appbundle = model.get("appbundle") or {}
    identity = appbundle.get("appIdentity") or {}
    theme_id = str(identity.get("theme") or "").strip()
    device = str(appbundle.get("preferredDevice") or "").strip()
    # identity_theme_gen.enrich_identity_theme 如果已经跑过（在这之前调用），
    # appIdentity.generatedTheme 会有一份自定义主题——FreeformInsight 的配色
    # 要照它走，不能还停在 8 预设，不然侧边栏和内容卡片颜色对不上。
    generated_theme_raw = identity.get("generatedTheme")
    generated_theme = generated_theme_raw if isinstance(generated_theme_raw, dict) else None
    max_ref_images = _env_budget(_ENRICH_MAX_REF_IMAGES_ENV, _ENRICH_MAX_REF_IMAGES_DEFAULT)
    max_screenshot_verify = _env_budget(
        _ENRICH_MAX_SCREENSHOT_VERIFY_ENV, _ENRICH_MAX_SCREENSHOT_VERIFY_DEFAULT
    )
    ref_used = 0
    shot_used = 0
    capped_blocks = 0
    for page in (model.get("page") or {}).get("pages") or []:
        blocks = page.get("blocks")
        if not isinstance(blocks, list):
            continue
        dropped_ids: set[str] = set()
        for block in blocks:
            if not isinstance(block, dict) or block.get("type") != "FreeformInsight":
                continue
            # 幂等（2026-07-27 D1）：已有内容树的区块不重生成——精修/回退
            # 时未被指令触及的区块必须原样保留（REFINE prompt 已要求逐字节
            # 保留,这里是第二道保险),否则加一个字段整页设计全部重掷。
            existing_content = block.get("freeformContent")
            if isinstance(existing_content, dict) and existing_content.get("root"):
                continue
            brief = str((block.get("props") or {}).get("designBrief") or "").strip()
            bid = str(block.get("id") or "").strip()
            # 成本预算：参考图/截图自检按"尝试"计费（参考图在 generate 开头
            # 就生成了——失败的区块钱照样花了，必须扣预算；只在成功分支计数
            # 会让网关抖动时笼子完全失效，生图次数退化为区块数×1，终检实测）。
            use_ref = ref_used < max_ref_images
            allow_shot = use_ref and shot_used < max_screenshot_verify
            if use_ref:
                ref_used += 1
            else:
                capped_blocks += 1
            if allow_shot:
                shot_used += 1
            try:
                content = generate_freeform_block(
                    brief, datamodel, theme_id=theme_id, device=device,
                    generated_theme=generated_theme,
                    use_reference_image=use_ref,
                    allow_screenshot_verify=allow_shot,
                )
                block["freeformContent"] = content
            except FreeformGenerationError as exc:
                print(f"[freeform_block] {page.get('id')}.{bid} generation failed, dropping block: {str(exc)[:200]}")
                if bid:
                    dropped_ids.add(bid)
        if dropped_ids:
            page["blocks"] = [b for b in blocks if str(b.get("id") or "") not in dropped_ids]
            layout = page.get("layout")
            if isinstance(layout, dict):
                for slot_key, refs in list(layout.items()):
                    if isinstance(refs, list):
                        layout[slot_key] = [r for r in refs if r not in dropped_ids]
    if capped_blocks:
        # no silent caps：预算截断必须可见，静默截断会被当成"全覆盖了"。
        print(
            f"[freeform_block] enrich budget hit: {capped_blocks} block(s) generated "
            f"text-only (ref-image cap {max_ref_images}, screenshot cap {max_screenshot_verify}; "
            f"raise {_ENRICH_MAX_REF_IMAGES_ENV} / {_ENRICH_MAX_SCREENSHOT_VERIFY_ENV} to widen)"
        )
    return model


def _monitor_overview_design_brief(page: dict[str, Any], datamodel: dict[str, Any]) -> str:
    """monitor 页面（首页/运营总览）的总览设计需求文案——不是让 LLM 凭空
    发挥内容范围，而是把这个页面自己已经声明、已经过 Gate 校验的
    stats/charts 当成"必须覆盖的内容清单"喂给它，LLM 只负责这批内容的
    视觉设计（版式/分组/颜色/图标），不负责决定"该不该有"。这样首页既能
    有 FreeformInsight 的设计自由度（不再是每个 app 都长一样的固定网格
    骨架），又不会漂出这个页面本来经过内容质量门校验过的信息架构——真实
    数字仍然要靠 generate_freeform_block 内部的 dataRef 校验兜底，这里只
    提供"画面上该出现哪些卡片"的自然语言线索，不直接摆 entityRef/字段 id
    这种结构化内容，那是 build_freeform_prompt 已经在做的事（完整数据
    模型 + 图表候选枚举），这里重复会互相打架。

    故意不把 rankings/feeds 塞进这份清单：FreeformInsight 的 dataRef 只能
    表达聚合值（count/sum/avg），没有"枚举真实的第 N 行记录"这种能力——
    真机测试过一次，LLM 收到"必须包含排行榜/动态流"的要求后，只能画出
    表头+空表身（没有任何一行数据，因为它没有合法的方式引用具体某一行），
    比留白还难看。排行榜/动态流这类"必须是真实逐行记录"的内容，继续走
    AppRuntimeScreen 里原有的 renderRankingCard/renderFeedCard 动态渲染
    （直接读 state.entities 真实行数据），不归 freeformOverview 管。
    """
    entities = {e.get("id"): e for e in datamodel.get("entities") or [] if e.get("id")}

    def entity_label(entity_id: str) -> str:
        e = entities.get(entity_id) or {}
        return str(e.get("name") or entity_id or "")

    def field_label(qualified: str) -> str:
        entity_id, _, field_id = qualified.partition(".")
        e = entities.get(entity_id) or {}
        for f in e.get("fields") or []:
            if f.get("id") == field_id:
                return str(f.get("name") or field_id)
        return field_id or qualified

    name = page.get("name") or page.get("id") or "总览"
    lines = [f"「{name}」——这个应用打开后看到的首页/运营总览区块。"]
    # 2026-07-28 真跑发现：上面这句话里带了页面名，模型就照着写了个 <h1>「经营监控」，
    # 而外层页卡（AppRuntimeScreen 的 defaultPageContent）本来就以 page.name 当标题，
    # 于是同一个词在一屏里出现三次（面包屑 / 页卡标题 / 你写的 h1）。
    # 这是「容器拥有标题」的惯例问题——ProCard 那类容器组件里，标题归外层，内容
    # 区不再自报家门。模型不知道自己被嵌在一张已有标题的卡片里，得明说。
    lines.append(
        f"注意：你的设计会被嵌进一张**已经有标题「{name}」的卡片**里，"
        "所以不要再写页面级大标题/副标题（不要出现 h1，也不要在最上面重复一遍页面名）——"
        "直接从内容开始画。区块内部每张小卡自己的标题照常写。"
    )

    stats = page.get("stats") or []
    if stats:
        bits = []
        for s in stats:
            metric = str(s.get("metric") or "count")
            if metric == "count":
                metric_desc = f"{entity_label(str(s.get('entity') or ''))}数量"
            else:
                prefix, _, mref = metric.partition(":")
                metric_desc = f"{field_label(mref)}{'总和' if prefix == 'sum' else '平均值'}"
            bits.append(f"{s.get('name') or s.get('id')}（{metric_desc}）")
        lines.append("必须包含的 KPI 统计卡：" + "、".join(bits) + "。")

    charts = page.get("charts") or []
    if charts:
        bits = []
        for c in charts:
            dim = field_label(str(c.get("dimension") or ""))
            metric = str(c.get("metric") or "count")
            metric_desc = "数量分布" if metric == "count" else f"{field_label(metric.partition(':')[2])}总和分布"
            bits.append(f"{c.get('name') or c.get('id')}（按「{dim}」的{metric_desc}，用{c.get('type') or 'bar'}图）")
        lines.append("必须包含的图表：" + "、".join(bits) + "。")

    lines.append(
        "这份清单是这个页面已经审核通过的真实内容范围，不能新增清单之外的统计"
        "指标/图表，也不能遗漏清单里的任何一项；具体每一项用什么颜色、图标、"
        "分组方式、卡片大小关系、整体版式，由你自由设计，做出比标准网格骨架"
        "更有设计感的呈现——这正是这次设计要解决的问题。"
    )
    # 这一页已经声明的**逐行内容**：以 blockRef 的形状给出，binding 直接照抄
    # 即可。2026-07-29 第一版只给了一句"适合的话就摆一个"的泛泛引导，真跑
    # 生成出来 blockRef 一个都没有——模型压根不知道这一页有哪些逐行内容可摆
    #（"必须包含"清单里刻意只放了 stats/charts）。给了具体清单和现成绑定，
    # 它才有得挑。仍然是可选项：清单为空就不出这段。
    # 同一份逐行内容常被声明两遍（page.feeds 一份、page.blocks 一份，绑定
    # 逐字段相同只有名字不同——真跑逮到过）。喂给模型之前先按内容指纹去重，
    # 否则等于让它把同一张卡摆两次。指纹口径与前端 page-panel-dedupe.ts 的
    # blockPanelKey 一致：类型 + 实体 + 关键字段，不含 id / 名字 / 条数。
    row_bits: list[str] = []
    seen_row_keys: set[str] = set()

    def _take(key: str) -> bool:
        if key in seen_row_keys:
            return False
        seen_row_keys.add(key)
        return True

    for r in page.get("rankings") or []:
        entity = str(r.get("entity") or "").strip()
        sort_by = str(r.get("sortBy") or "").rpartition(".")[2]
        if not entity or not sort_by:
            continue
        if not _take(f"RankedList|{entity}|{sort_by}"):
            continue
        limit = r.get("limit")
        extra = f', "limit": {limit}' if isinstance(limit, int) else ""
        row_bits.append(
            f'{r.get("name") or r.get("id")}：{{"type": "RankedList", "binding": '
            f'{{"entityRef": "{entity}", "sortByRef": "{sort_by}"{extra}}}}}'
        )
    for f in page.get("feeds") or []:
        entity = str(f.get("entity") or "").strip()
        time_field = str(f.get("timeField") or "").rpartition(".")[2]
        if not entity or not time_field:
            continue
        level = str(f.get("levelField") or "").rpartition(".")[2]
        if not _take(f"ActivityFeed|{entity}|{time_field}|{level}"):
            continue
        extra = f', "levelFieldRef": "{level}"' if level else ""
        row_bits.append(
            f'{f.get("name") or f.get("id")}：{{"type": "ActivityFeed", "binding": '
            f'{{"entityRef": "{entity}", "timeFieldRef": "{time_field}"{extra}}}}}'
        )
    for b in page.get("blocks") or []:
        block_type = str(b.get("type") or "")
        if block_type not in FREEFORM_EMBEDDABLE_BLOCK_TYPES:
            continue
        binding = b.get("binding") or {}
        ent = str(binding.get("entityRef") or "")
        if block_type == "RankedList":
            key = f"RankedList|{ent}|{binding.get('sortByRef') or ''}"
        elif block_type == "ActivityFeed":
            key = (
                f"ActivityFeed|{ent}|{binding.get('timeFieldRef') or ''}"
                f"|{binding.get('levelFieldRef') or ''}"
            )
        else:
            key = f"{block_type}|{b.get('id')}"
        if not _take(key):
            continue
        row_bits.append(
            f'{b.get("id")}：{{"type": "{block_type}", "binding": '
            f"{json.dumps(binding, ensure_ascii=False)}}}"
        )
    if row_bits:
        lines.append(
            "这一页还声明了下面这些**逐行内容**，请把它们用 blockRef 摆进你的版式里"
            "（binding 照抄，由你决定各自放哪一格、占多宽）：\n- " + "\n- ".join(row_bits)
        )

    # 2026-07-29：这里原来是一句硬禁令——"不要画排行榜/动态流/数据列表"，
    # 理由是 dataRef 取不到逐行记录、硬画只会出空表头。禁令本身没错，但代价是
    # 那些内容被赶到设计之外单独渲染成外挂卡，首页变成"AI 设计区 + 两张外挂
    # 卡"，主次和留白都由不得设计者。
    #
    # 现在有 blockRef 了（见 _blockref_prompt_fragment）：逐行内容仍然不由它
    # 画，但**由它决定摆在哪、占多大**，渲染交给积木自己的真渲染器。所以这里
    # 从"不许"改成"要用就摆一个"。
    lines.append(
        "除了 KPI 统计卡和图表，如果这一页还适合展示逐行记录（比如排行榜、"
        "最近动态/提醒、流程阶段条、常用操作入口），就在你的版式里用 blockRef "
        "摆一个现成积木（用法见下方说明），由你决定它放在哪一格、占多宽——"
        "不要自己用 CSS 去画这类内容（画出来只有表头没有行），也不要因为画不了"
        "就当它不存在。用不上就完全不用，不必凑数。"
    )
    return "\n".join(lines)


def enrich_monitor_page_overviews(model: dict[str, Any]) -> dict[str, Any]:
    """首页/monitor 页面的总览区块也交给 FreeformInsight 设计，不再永远
    套同一套固定骨架（KPI 行 + 图表主列 + 排行/动态流侧列）——那套骨架
    此前是唯一选项，所以所有生成出来的应用首页看起来都一个模子，且列
    高度不一致时还得靠 grid-compact.ts 去补洞。

    跟 enrich_freeform_blocks 同一套 fail-open 纪律：只在这里追加写入
    freeformOverview，从不删除页面已有的 stats/charts/rankings/feeds 声明
    ——AppRuntimeScreen 渲染时优先用 freeformOverview，没有（未声明/生成
    失败）就照旧走固定骨架兜底，两者是"有更好的就用更好的，没有就诚实
    退回骨架"，不是互相替代关系。原地修改并返回同一个 model，方便调用方
    链式使用。
    """
    datamodel = model.get("datamodel") or {}
    appbundle = model.get("appbundle") or {}
    identity = appbundle.get("appIdentity") or {}
    theme_id = str(identity.get("theme") or "").strip()
    device = str(appbundle.get("preferredDevice") or "").strip()
    generated_theme_raw = identity.get("generatedTheme")
    generated_theme = generated_theme_raw if isinstance(generated_theme_raw, dict) else None

    max_ref_images = _env_budget(_ENRICH_MAX_REF_IMAGES_ENV, _ENRICH_MAX_REF_IMAGES_DEFAULT)
    max_screenshot_verify = _env_budget(
        _ENRICH_MAX_SCREENSHOT_VERIFY_ENV, _ENRICH_MAX_SCREENSHOT_VERIFY_DEFAULT
    )
    ref_used = 0
    shot_used = 0
    capped_pages = 0
    for page in (model.get("page") or {}).get("pages") or []:
        # 2026-07-27：dashboard 也纳入——此前只认 monitor,LLM 把总览页写成
        # dashboard(prompt 曾反向引导)或夹具用 dashboard 时,设计版式整条
        # 生成不出来,首页恒回固定骨架。渲染端 AppRuntimeScreen 同步放宽。
        if str(page.get("kind") or "").strip() not in ("monitor", "dashboard"):
            continue
        # 只看 stats/charts——rankings/feeds 不进设计文案（见
        # _monitor_overview_design_brief 的说明），一个页面如果只声明了
        # rankings/feeds、没有 stats/charts，freeformOverview 没有东西可画，
        # 生成了也是空区块，不如不生成，直接走原有固定骨架（那套骨架的
        # renderRankingCard/renderFeedCard 本来就能正确渲染这种页面）。
        has_content = bool(page.get("stats")) or bool(page.get("charts"))
        if not has_content:
            continue
        # 幂等（2026-07-27 D1）：已有总览设计的页不重生成（同上区块级注释）。
        existing_overview = page.get("freeformOverview")
        if isinstance(existing_overview, dict) and existing_overview.get("root"):
            continue
        brief = _monitor_overview_design_brief(page, datamodel)
        # 与 enrich_freeform_blocks 同一预算语义：按尝试计费（见彼处注释）。
        use_ref = ref_used < max_ref_images
        allow_shot = use_ref and shot_used < max_screenshot_verify
        if use_ref:
            ref_used += 1
        else:
            capped_pages += 1
        if allow_shot:
            shot_used += 1
        # 一张三区参照板（样式风格 + 桌面首页 + 手机首页），两档设计共用。
        # 分开生两张图的话两档各随机各的，拼起来不像一个产品；共用一张，
        # 模型看到的是"这两档本来就该长成一家人"。生图失败返回 None，
        # 下面照旧退回纯文字生成。
        sheet_b64 = (
            _generate_overview_sheet_b64(
                brief, datamodel, theme_id=theme_id, generated_theme=generated_theme
            )
            if use_ref and _supports_image_content_parts()
            else None
        )
        try:
            content = generate_freeform_block(
                brief, datamodel, theme_id=theme_id, device=device,
                generated_theme=generated_theme,
                use_reference_image=use_ref,
                allow_screenshot_verify=allow_shot,
                reference_image_b64=sheet_b64,
            )
            # 手机档再设计一版（方案 B）。
            #
            # 形状照两处成熟先例：react-grid-layout 的 layouts={{lg,md,sm}}
            # ——同一份内容、每个断点一份布局，取用时"有本档用本档、没有就往
            # 更大的档回退"；以及本仓库自己 page.layout + layout.mobile 的
            # 覆盖约定。这里定为 freeformOverview = {root, mobile:{root}}：
            # 默认那份是 device 档（通常桌面），mobile 是手机档覆盖。
            #
            # 为什么值得多花一次调用：设计是按 device 生成的，phone 档的提示词
            # 明确要求"内容区窄、必须单列纵向、字号图标间距收紧一档"。此前只
            # 生一份，手机上看到的是桌面版式被 CSS 掰弯的结果——能读，但不是
            # 为手机规划的。
            #
            # 失败不影响主产物：手机那份生不出来就不挂 mobile 键，前端自动
            # 回退到 root（与 RGL 的"往更大的档回退"同一语义）。
            if device != "phone":
                try:
                    mobile_content = generate_freeform_block(
                        brief, datamodel, theme_id=theme_id, device="phone",
                        generated_theme=generated_theme,
                        use_reference_image=use_ref,
                        # 手机那份不再单独截图自检：那一步是"渲染出来再让视觉
                        # 模型跟参照图比一遍"，成本高且收益递减，两档都做等于
                        # 把总览页的生成时间再翻一倍。
                        allow_screenshot_verify=False,
                        reference_image_b64=sheet_b64,
                    )
                    # 复制一份而不是原地改：生成器返回的对象不该被调用方
                    # 就地改写。真被咬过——测试里 fake 两次返回同一个 dict，
                    # `content["mobile"] = mobile_content` 直接造出自引用结构。
                    content = {**content, "mobile": mobile_content}
                except FreeformGenerationError as exc:
                    print(
                        f"[freeform_block] {page.get('id')} mobile overview generation failed, "
                        f"falling back to the desktop design on phone: {str(exc)[:160]}"
                    )
            page["freeformOverview"] = content
        except FreeformGenerationError as exc:
            print(
                f"[freeform_block] {page.get('id')} monitor overview generation failed, "
                f"keeping fixed skeleton: {str(exc)[:200]}"
            )
    if capped_pages:
        print(
            f"[freeform_block] monitor overview budget hit: {capped_pages} page(s) generated "
            f"text-only (ref-image cap {max_ref_images}; raise {_ENRICH_MAX_REF_IMAGES_ENV} to widen)"
        )
    return model
