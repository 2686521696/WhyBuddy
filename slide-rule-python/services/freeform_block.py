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

# 合法的 Ant Design 图标组件名形状：PascalCase + Outlined/Filled/TwoTone 结尾
# （@ant-design/icons 全部图标都遵循这个命名，前端按名字动态解析）。校验只看
# 形状不看具体名字——编造/拼错的名字前端解析不到会渲染成空，优雅降级。
_ANTD_ICON_NAME_RE = re.compile(r"^[A-Z][A-Za-z0-9]*(Outlined|Filled|TwoTone)$")
# 老模型里可能还有这批 kebab 语义名（放开之前的 12 个白名单），前端保留了
# 同名别名映射，这里也一并放行，历史产物不炸。
_LEGACY_ICON_ALIASES = frozenset({
    "check-circle", "clock", "alert-triangle", "arrow-right", "user",
    "message-circle", "flag", "zap", "circle", "chevron-right", "star", "trending-up",
})


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
            max_tokens=10000,
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
            continue

        design_dump = design.model_dump()
        # 自我校验闭环（借鉴 abi/screenshot-to-code 的 screenshot_preview 思路：
        # 生成→截图→自己看→改，不是纯一次性生成完就当定稿）。只在真的生了
        # 参考图时才做——没有参照物就没法判断"够不够密"。这整块包在自己的
        # try/except 里，任何异常（哪怕是我没预料到的 bug）都不能让一次已经
        # 校验通过的生成结果因为这个增强步骤而报废。
        if reference_image_b64:
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
    lines.append(
        "只设计这个页面的 KPI 统计卡+图表这部分（一个完整、自洽的视觉区块），"
        "不要画排行榜/动态流/数据列表这类需要逐行展示具体记录的内容——这类内容"
        "在你的设计之外由另一套机制单独渲染真实逐行数据，你这里画了也没有真实"
        "数据可填，只会出现空表格/占位行，不要画。"
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

    for page in (model.get("page") or {}).get("pages") or []:
        if str(page.get("kind") or "").strip() != "monitor":
            continue
        # 只看 stats/charts——rankings/feeds 不进设计文案（见
        # _monitor_overview_design_brief 的说明），一个页面如果只声明了
        # rankings/feeds、没有 stats/charts，freeformOverview 没有东西可画，
        # 生成了也是空区块，不如不生成，直接走原有固定骨架（那套骨架的
        # renderRankingCard/renderFeedCard 本来就能正确渲染这种页面）。
        has_content = bool(page.get("stats")) or bool(page.get("charts"))
        if not has_content:
            continue
        brief = _monitor_overview_design_brief(page, datamodel)
        try:
            content = generate_freeform_block(
                brief, datamodel, theme_id=theme_id, device=device, generated_theme=generated_theme
            )
            page["freeformOverview"] = content
        except FreeformGenerationError as exc:
            print(
                f"[freeform_block] {page.get('id')} monitor overview generation failed, "
                f"keeping fixed skeleton: {str(exc)[:200]}"
            )
    return model
