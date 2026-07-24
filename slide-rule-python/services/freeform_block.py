"""
FreeformInsight 区块的结构化生成与校验（2026-07-23，实验三 Pydantic + reask
机制生产化，记录见 docs/freeform-llm-generation-experiment-2026-07-23.md）。

不引入 instructor 包——本仓网关已经真机验证过会撞 WAF UA 拦截 + Cloudflare
524（docs/OSS_GAP_ANALYSIS.md），instructor SDK 栈默认用 openai SDK 的非流式
HTTP 客户端，两条都会撞。改成在 sliderule_llm.structured 的流式 reask 骨架
（call_llm_with_retry + on_delta 强制流式）上，加一层 Pydantic 深校验——原来
structured_llm_json 只做 shape 级校验（JSON 能解析 + 必需字段非空），这里补
到"标签/样式/图标在白名单内 + 数字类内容必须挂 dataRef 指向真实数据"。

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
import re
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .schema_legal import (
    FREEFORM_ALLOWED_ICON_REFS,
    FREEFORM_ALLOWED_STYLE_PROPS,
    FREEFORM_ALLOWED_TAGS,
)

_DANGEROUS_VALUE_RE = re.compile(r"url\(|javascript:|expression\(|import\b|@import", re.I)


class FreeformGenerationError(RuntimeError):
    """FreeformInsight 内容生成/校验失败（调用方应把这个区块降级/拿掉）。"""


# 8 套身份主题的完整色板——数值抄自
# client/src/pages/sliderule/live-runtime/identity-themes.ts 的 THEMES（前端
# 才是真正的渲染源，这里是复制，两边独立维护，改一边要记得同步改另一边；
# 万一漏改，最坏结果是色板提示不够准，不影响安全边界——颜色值本身仍然过
# Pydantic 白名单+危险模式校验）。
# 之前只搬了 3 个锚点色（主色/内容底/强调底），生图/结构生成各自还有很大
# 空间自己发明颜色，同一个 app 生两次图配色会漂移；这次把 11 个字段全搬
# 过来，尤其是 charts 三色——那本来就是"给多类别/多序列视觉区分用的调色
# 板"，比如 5 段流程图这种需要好几个不同色块的场景，应该从这 3 色（含深浅
# 变体）里选，不是每次自己现编一套糖果色。
_THEME_COLOR_HINTS: dict[str, dict[str, Any]] = {
    "azure": {"label": "湛蓝·通用企业", "primary": "#1677ff", "primaryHover": "#0958d9", "gradTo": "#69b1ff",
              "contentBg": "#f0f2f5", "accentBg": "#e6f4ff", "accentFg": "#0958d9",
              "charts": ["#1677ff", "#69b1ff", "#003eb3"], "sidebarBg": "#0f2138"},
    "forest": {"label": "松绿·生产运营", "primary": "#2e7d32", "primaryHover": "#1b5e20", "gradTo": "#81c784",
               "contentBg": "#f4f7f2", "accentBg": "#e8f5e9", "accentFg": "#1b5e20",
               "charts": ["#2e7d32", "#558b2f", "#8bc34a"], "sidebarBg": "#13241a"},
    "graphite": {"label": "石墨·专业中性", "primary": "#525252", "primaryHover": "#3d3d3d", "gradTo": "#9e9e9e",
                 "contentBg": "#f0f0f0", "accentBg": "#e5e5e5", "accentFg": "#333333",
                 "charts": ["#606060", "#476780", "#909090"], "sidebarBg": "#1f1f1f"},
    "tangerine": {"label": "橘橙·消费活力", "primary": "#e05d38", "primaryHover": "#c2410c", "gradTo": "#fdba74",
                  "contentBg": "#f8fafc", "accentBg": "#fff0eb", "accentFg": "#b23c17",
                  "charts": ["#e05d38", "#f59e0b", "#3b82f6"], "sidebarBg": "#271a15"},
    "violet": {"label": "紫罗兰·创意智能", "primary": "#7033ff", "primaryHover": "#5b21b6", "gradTo": "#c4b5fd",
               "contentBg": "#f7f7f8", "accentBg": "#ede9fe", "accentFg": "#5b21b6",
               "charts": ["#7033ff", "#a78bfa", "#22d3ee"], "sidebarBg": "#1d1633"},
    "amber": {"label": "琥珀·财务审计", "primary": "#d97706", "primaryHover": "#b45309", "gradTo": "#fcd34d",
              "contentBg": "#fffdf7", "accentBg": "#fffbeb", "accentFg": "#92400e",
              "charts": ["#f59e0b", "#d97706", "#78716c"], "sidebarBg": "#261d0e"},
    "clay": {"label": "陶土·温暖人文", "primary": "#c96442", "primaryHover": "#a34a2e", "gradTo": "#e7bba4",
             "contentBg": "#faf9f5", "accentBg": "#f5e8df", "accentFg": "#8d4a2f",
             "charts": ["#c96442", "#b8a07a", "#6b8e6f"], "sidebarBg": "#241812"},
    "indigo": {"label": "靛蓝·数据密集", "primary": "#6366f1", "primaryHover": "#4f46e5", "gradTo": "#a5b4fc",
               "contentBg": "#f8fafc", "accentBg": "#e0e7ff", "accentFg": "#3730a3",
               "charts": ["#6366f1", "#818cf8", "#38bdf8"], "sidebarBg": "#171b38"},
}
_DEFAULT_THEME_ID = "azure"

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


_GENERATED_THEME_REQUIRED_KEYS = (
    "label", "primary", "primaryHover", "gradTo", "contentBg", "accentBg", "accentFg", "charts",
)


def _theme_palette(theme_id: str, generated_theme: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """身份主题现在可能不是 8 预设之一，而是 identity_theme_gen.py 生成的
    自定义主题——优先用这个（同一个 app 的侧边栏/顶栏就是照它来的，颜色要
    统一），传了但形状不对就落回 8 预设，不让一个坏字典拖垮整个生成。"""
    if isinstance(generated_theme, dict) and all(
        k in generated_theme for k in _GENERATED_THEME_REQUIRED_KEYS
    ):
        return generated_theme
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
        entityRef: str
        aggregate: Optional[str] = None

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

    class FreeformNode(BaseModel):
        tag: str
        style: dict[str, str] = Field(default_factory=dict)
        text: Optional[str] = None
        iconRef: Optional[str] = None
        dataRef: Optional[DataRef] = None
        chart: Optional[ChartSpec] = None
        children: list["FreeformNode"] = Field(default_factory=list)

        @field_validator("tag")
        @classmethod
        def check_tag(cls, v: str) -> str:
            if v not in FREEFORM_ALLOWED_TAGS:
                raise ValueError(
                    f"tag '{v}' is not allowed. Allowed tags: {list(FREEFORM_ALLOWED_TAGS)}"
                )
            return v

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
            if v is not None and v not in FREEFORM_ALLOWED_ICON_REFS:
                raise ValueError(f"iconRef '{v}' is not in the allowed list")
            return v

    FreeformNode.model_rebuild()

    class FreeformDesign(BaseModel):
        root: FreeformNode

    return FreeformDesign


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

只能用安全原子积木拼：{", ".join(FREEFORM_ALLOWED_TAGS)} 标签；
图标引用只能用这些：{json.dumps(list(FREEFORM_ALLOWED_ICON_REFS), ensure_ascii=False)}；
style 对象的 key 只能用这些 CSS 属性名，写了列表之外的属性（比如 fontFamily、
listStyle）会被直接判失败：{", ".join(FREEFORM_ALLOWED_STYLE_PROPS)}。
颜色用具体十六进制值，背景可用 linear-gradient(...)，不能出现 url(...)。

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
{_chart_candidates_prompt_fragment(datamodel)}
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


def generate_freeform_block(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
    max_retries: int = 2,
    temperature: float = 0.7,
    max_tokens: int = 10000,
    use_reference_image: bool = True,
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

    max_tokens 默认从 7000 提到 10000：实测视觉参照会让模型描述更细（节点数
    明显变多），7000 真实撞过截断（JSON 半截被切断解析失败）；10000 一次过。
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

    reference_image_b64: Optional[str] = None
    if use_reference_image and get_llm_config().supports_image_content_parts:
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
            return design.model_dump()
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
                        "dataRef 的 key 必须严格是 entityRef 和 aggregate，不是别的名字。"
                        "重新输出完整的 JSON，只要一个 JSON 对象。"
                    ),
                },
            ]

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
    for page in (model.get("page") or {}).get("pages") or []:
        blocks = page.get("blocks")
        if not isinstance(blocks, list):
            continue
        dropped_ids: set[str] = set()
        for block in blocks:
            if not isinstance(block, dict) or block.get("type") != "FreeformInsight":
                continue
            brief = str((block.get("props") or {}).get("designBrief") or "").strip()
            bid = str(block.get("id") or "").strip()
            try:
                content = generate_freeform_block(
                    brief, datamodel, theme_id=theme_id, device=device, generated_theme=generated_theme
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
    return model
