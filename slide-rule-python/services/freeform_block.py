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

import json_repair
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from pathlib import Path

from .app_preview import OverviewPreviewSink
from .enrich_timing import stage as _enrich_stage
from .identity_palette_hint import BRAND_LABEL, BRAND_SEED, derive_prompt_palette
from .palette_guard import extract_hex_colors, palette_report, repair_colors
from .schema_legal import (
    EXPERIENCE_BLOCKS,
    EXPERIENCE_BLOCK_BINDING_SCHEMAS,
    FREEFORM_ALLOWED_ICON_REFS,
    FREEFORM_ALLOWED_STYLE_PROPS,
    FREEFORM_ALLOWED_TAGS,
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

# lineHeight 不带单位时是"字号的倍数"（CSS 规范特例，React 的
# isUnitlessNumber 原样保留这条），不是像素值——真机逮到过 LLM 把它当成
# "字号 28px 配一个稍大的行高 32" 来写，写成 lineHeight: 32（或强转后的
# "32"），结果渲染成 32 倍字号 = 896px 的行高，一整行 KPI 卡被撑到
# 1000+px，图表/列表全被挤到一屏之外——版式看着"稀疏"，其实是这一个属性
# 把后面的内容全推没了。正常行高倍数很少超过 3（宽松排版顶格用到 2），
# 超过这个阈值基本可以断定是"把像素值当倍数写"的手误，拦下来逼它改用带
# 单位的写法（比如 "32px"），不做静默纠偏——纠偏会把"该用多大行高"这个
#设计判断替它做了，交回 reask 让它自己选一个合理值更稳妥。
_LINE_HEIGHT_RATIO_MAX = 4.0


def _check_plausible_line_height(value: str) -> None:
    try:
        ratio = float(value)
    except (TypeError, ValueError):
        return  # 带单位（"32px"/"150%"）或其它形式，不是这条要拦的情况
    if ratio > _LINE_HEIGHT_RATIO_MAX:
        raise ValueError(
            f"lineHeight '{value}' 不带单位时表示字号的倍数（1.5 = 1.5 倍字号），"
            f"不是像素值——{value} 倍字号会把行高撑到离谱的高度，把同一行/同一页"
            "后面的内容挤出可视区域。如果想要更宽松的行距，用 1.2~2 之间的倍数；"
            "如果确实需要一个固定像素值，必须带单位写成比如 '32px'。"
        )

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

# rowsRef 单次取行数（2026-08-03）。逐行内容展开发生在渲染期，一个 rowsRef
# 就能把 limit 份模板子树摆进页面——limit 不设上限的话，一句 "limit": 500 能
# 直接把渲染预算（FREEFORM_MAX_NODES）吃穿、页面高度也失控。默认值按参照图上
# 排行榜/动态流的常见长度取（5~8 条），上限给到 20 留余量。
# 两侧同值：前端 block-registry.tsx 展开时再夹一次（纵深防御，快照恢复也走那条路）。
ROWS_REF_DEFAULT_LIMIT = 5
ROWS_REF_MAX_LIMIT = 20


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


# 生成主题（appIdentity.generatedTheme）的合格契约——与前端
# isValidGeneratedTheme 同读 presets JSON 里的 generatedThemeContract。
# 2026-07-30 起契约只剩一个必填字段 seed（路线丙：LLM 只选种子色，其余
# 字段由 identity_palette_hint.derive_prompt_palette / 前端 deriveIdentityPalette
# 派生），不再是 11 项严校验。
_THEME_PRESETS_PATH = Path(__file__).resolve().parent / "data" / "identity_theme_presets.json"
_THEME_PRESETS: dict[str, Any] = json.loads(_THEME_PRESETS_PATH.read_text(encoding="utf-8"))
_GENERATED_THEME_CONTRACT: dict[str, Any] = _THEME_PRESETS.get("generatedThemeContract") or {}
_CONTRACT_HEX_RE = re.compile(str(_GENERATED_THEME_CONTRACT.get("hexPattern") or r"^#[0-9a-fA-F]{6}$"))


def is_valid_generated_theme(v: Any) -> bool:
    """生成主题合格判定（与前端 isValidGeneratedTheme 同一契约、同一份 JSON）。

    合格才拿来配卡片色；不合格这里不用、前端也必然回落 FALLBACK_SEED 派生
    的中性色板——两端判定物理同源，不存在"后端用了前端弃用"的错配窗口。

    fullmatch 不是 match：Python 的 $ 会豁免尾随换行（"#123456\\n" 能过），
    JS 的 $ 不豁免——用 match 就给"两端同源"留了一道换行错配窗口
    （Python 判合格拿去配卡片色、前端整套弃用回落预设）。
    """
    if not isinstance(v, dict):
        return False
    seed = v.get("seed")
    return isinstance(seed, str) and bool(_CONTRACT_HEX_RE.fullmatch(seed))

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

# 占位文案的写法（2026-07-30，抄自一份第三方技能包的产出）。
#
# 我们原本统一写「示例XX」——不写真实数据这条是对的，但**把所有字段类型
# 压成了同一个词**，出图里每一格都是"示例XX"，看着就不像真界面。对照那份
# 技能包生成的 CRM 草样：日期写 20XX-XX-XX、电话写 138-••••-••••、邮箱写
# name@xxxx.com、公司写「示例科技有限公司」——同样没有一个真数据，但**保留
# 了每类字段的形状**，所以一眼就能看出哪格是日期、哪格是金额。
#
# 这对参照图是实打实的：设计 LLM 看图学的是"这一格该放什么形状的内容"，
# 形状被抹平，它就学不到列宽/对齐/字号该怎么排。
_PLACEHOLDER_STYLE_NOTE = (
    "占位文案要**保留每类字段本来的形状**，不要所有格子都写同一个词："
    "日期写成 20XX-XX-XX、时间写成 20XX-XX-XX 10:30、手机号写成 138-••••-••••、"
    "邮箱写成 name@xxxx.com、金额写成 ¥ ××,×××、百分比写成 ××.×%、"
    # 人名给的是**构词法**不是具体名字：写死「张销售」会把一个销售岗的称呼
    # 带进健身房/餐饮这些完全不相干的应用里（真机撞到过：健身房会员列表里
    # 出现「会员：张销售」）。让它按当前业务语境自己选。
    "人名写成「张先生」「李女士」这类示例名——**按这个应用自己的业务语境选**，"
    "不要带上跟本业务无关的职业称呼；机构写成「示例科技有限公司」这类；"
    "状态/分类这种有固定选项的，直接用下面数据字段里给出的真实枚举标签。"
    # 2026-07-30 补：原来这份清单**漏了纯数值那一类**（计数/量/图表数据点），
    # 模型学会了日期和电话怎么占位，对数字却没范例可循，就回退到编——真机
    # 撞到过：KPI 卡写 2,385 人 / ¥128,650，折线图 312/356/410，环形图各段
    # 加起来还正好等于 KPI 的总数，编了一整套自洽的假数据。
    #
    # 这个漏洞在完整版 prompt 里被末尾那段信息层级清单兜住了（那里又复述了
    # 一遍"照上面那套占位法写"），所以一直没暴露。补在这里才是治本——省得
    # 这份清单的正确性依赖另一段话去复述。
    "数值也一样要按形状占位、不许编：计数写成 ×,××× 或 ××（带单位就写成"
    "「×,××× 人」「×× 节」），带小数的量写成 ×××.×，金额和百分比照上面的写法。"
    "**图表里的数据点、坐标轴刻度、环形图各段占比同样适用**——不要编一组"
    "「看起来很合理、加起来还能对上」的真数字，那比明显的假数据更容易被当真。"
    "**一个真实数据都不许出现**，但要让人一眼看出这一格装的是什么类型的内容；"
)

# KPI 卡的视觉处理（2026-07-30，人工核对第三方技能包产出后放开）。
#
# 这条推翻了 ba67e59 定的"图表之外保持单一色系"。当初锁单色是为了修"颜色发花"
# ——但那次发花的真正原因是**四张卡是高饱和实心圆、没有设计语言托着**，多色
# 只是表象。对照那份技能包的产出：它每张卡也是一个色相，却配了柔和渐变装饰 +
# 圆角方形图标底座，多色被设计语言兜住了，不显乱。
#
# 所以放开的是"**多色 + 装饰**"这一对，不是单独把多色放开——只放多色不加装饰，
# 会原样退回发花那一版。改这里的人请把两半当一个整体看。
_CARD_VISUAL_NOTE = (
    "KPI 指标卡要有设计感，不要画成白底纯文字的方块："
    "每张卡左上角一个**圆角方形图标底座**（约 44~52px，用浅色到主色的柔和渐变作底，"
    "图标本身用白色或更深一档的同色系），**四张卡各用一个不同色相**——从上面那组"
    "图表分类色里挑，同一张卡的图标底座、装饰和强调数字共用它自己那个色相；"
    "卡片下半部或右下角再加一块**柔和的渐变波浪/弧形装饰**（低饱和、半透明，"
    "压在卡片底色上当氛围，绝不能盖住文字）；卡片整体仍是白底、细边框、小圆角。"
    # 2026-07-30 二次放开：原本这里还锁着"这几个色相只用在 KPI 卡这一层，
    # 正文/表格/列表照旧墨色、不要整屏铺彩色"。人工核对后连这条也撤了——
    # 前几轮的教训是"发花"来自没有设计语言托着的高饱和实心块，不是来自色彩
    # 用得多。现在装饰语言已经立住了，就没必要再把彩色圈在一层里。
    #
    # 只留两条**功能性**底线（不是审美偏好，别当成克制指令删掉）：
    #   ① 色相仍从上面那套主题色板取——B 版实测丢掉这条之后，生成的主题种子
    #      完全白给，整屏配色跟应用身份对不上。
    #   ② 正文/数值这类要读的文字保证对比度——彩色底就上白字，浅底就上深字。
    "彩色可以放开用，不用刻意克制：列表项图标、动态流头像/圆点、表格状态列、"
    "分区标题的小色条、卡片浅色底纹这些地方都可以上色，让整屏有色彩节奏；"
    "但**色相一律从上面那套主题色板里取**（主色 + 图表分类色），不要另配一套"
    "糖果色，否则整屏配色会跟这个应用的身份对不上。"
    "唯一的硬底线是可读性：正文、数值、表格文字必须跟它的底色拉开对比"
    "（彩色底配白字，浅底配深字），不要出现看不清的低对比文字。"
)

# 生图尺寸：**当前这家端点（api.xiaoleai.team）逐像素认 size 参数**——传
# 什么回什么，不降档、不改比例。所以下面这些值就是真实画布，写 prompt 时可以
# 直接照着算密度。
#
# 实测（2026-07-31，探针带形状线索，逐个真发一轮）：
#   1280x720  → 实收 1280x720  (0.92MP, 16:9)  69s
#   720x1280  → 实收 720x1280  (0.92MP, 9:16)  48s
#   1920x1080 → HTTP 400（不在这家的白名单里，秒回）
# 中文标签在 0.92MP 上依旧锐利，没有糊字——密度预算够用。
#
# ⚠️ **这是端点相关的行为，换端点必须整份重测。** 同一份代码在上一家
# （hello.vangularcode.asia）上表现完全相反：那家 size 参数**完全不起作用**，
# 十个尺寸/形态组合（1024x1024 一路到 3840x2160，以及 image_size 1K/2K/4K +
# aspect_ratio）**全部**回 1672x941，总像素锁死 1.57MP，长宽比只由提示词内容
# 决定（横版线索→1672x941，中性→1254x1254，9:16 线索→864x1821）。
#
# 被这件事绊过三次，记在这里免得下一个人再踩：
#   ① 拿上一个端点测出的"可用尺寸白名单"当常量用，换 URL 后整份作废；
#   ② 拿**没有形状线索**的中性提示词做探针（"纯浅灰背景，正中一个大号数字
#      1"），拿到一堆方图就误判成"这家给不了竖图"——错的是探针不是端点；
#   ③ 把 ② 得出的"形状只能靠提示词"当成普适结论，而它只对那一家成立。
#
# 提示词里的比例措辞仍然保留、并且**要跟这里的尺寸对齐**：认尺寸的端点上它
# 是冗余的双保险，不认尺寸的端点上它是唯一的形状来源，两边都不吃亏
# （见 _build_reference_image_prompt 的 device_note 与
# identity_theme_gen._SHELL_SHAPE_NOTE）。
_DEVICE_IMAGE_SIZE: dict[str, str] = {
    "phone": "720x1280",
    "desktop": "1280x720",
    "tablet": "1280x720",
}
# 手机档参照图的**实际**画布（explicit 好过 implicit：调用方要写 prompt
# 就得知道真实形状，不能从上面那个字面值猜）。这家端点不降档，所以两者相同；
# 留着这个名字是因为换回降档端点时它还会重新分叉。
_PHONE_IMAGE_ACTUAL_SIZE = "720x1280"


# 参照板的尺寸：跟 _DEVICE_IMAGE_SIZE 同一套，按档位取。
#
# 曾经这里是一个跟设备无关的常量（"1792x1024"），因为上一家端点无论传什么都
# 回同一个横版尺寸，手机档只能靠 prompt 里那句"9:16 竖屏"把形状掰回来。换到
# 认尺寸的端点之后没有理由再这么绕——手机档直接传 720x1280，形状由参数保证，
# prompt 里那句竖屏措辞降级成双保险。
#
# 密度预算跟画布尺寸是一组：元素个数不同步收敛的话每个元素分到的像素会少到
# 中文标签糊成一片。所以下面 prompt 里图表最多 2 张、动态列表最多 5 行那些
# 上限不能单独放开——真正让参照失效的不是总像素不够，是每个元素分到的像素
# 不够。0.92MP 这一档实测中文仍然锐利，当前上限有余量。
_SHEET_IMAGE_SIZE = _DEVICE_IMAGE_SIZE["desktop"]


def _image_size_for_device(device: str) -> str:
    return _DEVICE_IMAGE_SIZE.get(device) or _DEVICE_IMAGE_SIZE[_DEFAULT_DEVICE]


def _sheet_image_size_for_device(device: str) -> str:
    """参照板按档位取画布。

    device 没明说时走桌面档——跟 _build_overview_sheet_prompt 的 else 分支
    一致：那一支要在一张横版画布上并排画桌面和手机两块，本身就是横版。
    """
    return _DEVICE_IMAGE_SIZE.get(device) or _SHEET_IMAGE_SIZE


def _theme_palette(theme_id: str, generated_theme: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """**全站一个颜色**（2026-08-03，用户裁决）：永远是 BRAND_SEED 派生的色板。

    这个色板只有一个用途：告诉设计 LLM「运行时的侧边栏/顶栏/按钮已经按这套
    渲染了」，好让它生成的版式配色跟真实外壳对得上。所以它必须与前端实际
    渲染的那套同源——两者同读 identity_theme_presets.json 的 brandSeed。

    两个参数都不再参与颜色决定，签名保持不变：调用点有十几处，且**存量应用
    的库里仍然存着 generatedTheme 字段**。保留参数 = 老数据不需要迁移脚本，
    读进来直接被忽略。

    · theme_id：appIdentity.theme 那 8 选 1 的分类字段，2026-07-30 起就不是
      颜色来源了（仍然是 gate 校验的合法分类值）。
    · generated_theme：2026-08-03 起不再生成。为它生的那张参照图从不展示给
      任何人，用一次生图换一个色值，已整段移除。

    derive_prompt_palette 返回的色板是 OKLCh 近似（不是前端渲染用的权威
    HCT 派生），只用于这里的 prompt 拼接和下面 palette_guard 的色相参照——
    见 identity_palette_hint.py 顶部说明，为什么这里不需要跟前端数值一致。"""
    del theme_id, generated_theme
    return derive_prompt_palette(BRAND_SEED, id_="brand", label=BRAND_LABEL)


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

    def _entity_field_ids(entity_id: str) -> list[str]:
        """某实体的真实字段 id 列表——只用来把校验错误说清楚。

        报错里带上"这个实体到底有哪些字段"，reask 一次就能改对；只说"字段
        不存在"的话模型只能瞎猜，白烧一轮重试。"""
        prefix = f"{entity_id}."
        return [k[len(prefix):] for k in field_types if k.startswith(prefix)]

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

    class RowsRef(BaseModel):
        """逐行真实数据的来源——「取这张表、按某字段排序、前 N 行」。

        为什么要有它（2026-08-03）：dataRef 只能表达聚合值（count/sum/avg），
        没有"枚举第 N 行"的能力。于是设计模型只要想画排行榜/动态流/最近记录
        这类**一行一行**的内容，就只能画出表头加一片空白——这正是当初引入
        blockRef（从固定积木清单里挑一个摆进来）的唯一原因。

        但固定积木是死的：长什么样由组件写死，设计模型改不动，参照图上画的
        版式落不了地。用户裁决「首页只由 LLM 动态设计，图上有什么就设计什么」
        之后，正确的解法不是二选一，而是**把逐行能力补给设计模型自己**：
        版式它自由画，数据我们负责喂真的。补上之后 blockRef 整条通道就没有
        存在理由了，已一并删除。

        ## 用法：这个节点是列表容器，它的 children 是**一行**的模板

            {"tag": "div", "rowsRef": {...}, "children": [ ...一行的样子... ]}

        渲染端把 children 这棵子树按取到的行数重复渲染，每行把子树里带
        fieldRef 的节点替换成那一行的真实字段值。模板只写一次，展开发生在
        渲染期——所以设计树本身不会因为行数多而变大，节点上限不受影响。

        ## 安全边界（逐行数据比聚合数字敏感得多，这里是主要防线）

        · fieldRefs 是**显式白名单**：模板里的 fieldRef 只能取这里声明过的
          字段。不声明就读不到——避免设计模型顺手把整张表的字段拉出来。
        · limit 夹在 1..ROWS_REF_MAX_LIMIT 之间，防止一个 rowsRef 把整表拉平
          撑爆版面（也撑爆渲染预算）。
        · entityRef / fieldRefs / sortByRef 全部要求在真实数据模型里存在，
          与 dataRef 同一套判定，不另起一套。
        """

        entityRef: str
        #: 模板里允许读取的字段白名单。至少一个，且必须真实存在。
        fieldRefs: list[str] = Field(default_factory=list)
        #: 排序字段（可选，不给就按数据源自然顺序）。
        sortByRef: Optional[str] = None
        #: asc | desc，默认 desc（榜单/动态流绝大多数是"最大/最新在前"）。
        order: Optional[str] = None
        #: 取前几行。
        limit: int = ROWS_REF_DEFAULT_LIMIT

        @field_validator("entityRef")
        @classmethod
        def check_entity(cls, v: str) -> str:
            if v not in entities:
                raise ValueError(
                    f"rowsRef.entityRef '{v}' does not exist. "
                    f"Real entities are: {list(entities.keys())}"
                )
            return v

        @field_validator("limit")
        @classmethod
        def check_limit(cls, v: int) -> int:
            if v < 1 or v > ROWS_REF_MAX_LIMIT:
                raise ValueError(
                    f"rowsRef.limit 必须在 1..{ROWS_REF_MAX_LIMIT} 之间（给的是 {v}）"
                )
            return v

        @field_validator("order")
        @classmethod
        def check_order(cls, v: Optional[str]) -> Optional[str]:
            if v is not None and v not in ("asc", "desc"):
                raise ValueError("rowsRef.order must be 'asc' or 'desc'")
            return v

        @model_validator(mode="after")
        def check_fields(self) -> "RowsRef":
            if not self.fieldRefs:
                raise ValueError(
                    "rowsRef.fieldRefs 不能为空——必须先声明这一行要显示哪些字段，"
                    "模板里的 fieldRef 只能取声明过的字段"
                )
            for fid in self.fieldRefs:
                if f"{self.entityRef}.{fid}" not in field_types:
                    raise ValueError(
                        f"rowsRef.fieldRefs 里的 '{fid}' 在实体 '{self.entityRef}' 上"
                        f"不存在。该实体的真实字段：{_entity_field_ids(self.entityRef)}"
                    )
            if self.sortByRef and f"{self.entityRef}.{self.sortByRef}" not in field_types:
                raise ValueError(
                    f"rowsRef.sortByRef '{self.sortByRef}' 在实体 "
                    f"'{self.entityRef}' 上不存在。"
                    f"该实体的真实字段：{_entity_field_ids(self.entityRef)}"
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
        #: 逐行列表容器：children 是一行的模板，按取到的行数重复渲染。
        rowsRef: Optional[RowsRef] = None
        #: 取当前行的某个字段值（只在 rowsRef 子树内有意义，且必须在该
        #: rowsRef 的 fieldRefs 白名单里——两条都由 FreeformDesign 树级校验保证）。
        fieldRef: Optional[str] = None
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
                if k == "lineHeight":
                    _check_plausible_line_height(val)
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
        def check_field_refs_scoped(self) -> "FreeformDesign":
            """fieldRef 必须落在某个 rowsRef 的子树里，且取的字段被那个
            rowsRef 显式声明过。

            这条只能在树级做——单个节点看不到自己在谁的作用域内。两件事一起
            管住：
              · 作用域外的 fieldRef（没有"当前行"可言）→ 渲染期无解，直接拦下
              · 白名单外的字段 → 逐行数据的主要防线，见 RowsRef 的说明
            嵌套 rowsRef 时以**最近的**那个为准（同 CSS 作用域直觉），所以递归
            时把 allowed 换成内层的白名单。
            """

            def walk(node: "FreeformNode", allowed: Optional[set[str]]) -> None:
                scope = (
                    set(node.rowsRef.fieldRefs) if node.rowsRef is not None else allowed
                )
                if node.fieldRef is not None:
                    if scope is None:
                        raise ValueError(
                            f"fieldRef '{node.fieldRef}' 不在任何 rowsRef 里——"
                            "取某一行的字段必须放在声明了 rowsRef 的列表容器内部。"
                            "如果你要的是总数/求和这类聚合值，用 dataRef。"
                        )
                    if node.fieldRef not in scope:
                        raise ValueError(
                            f"fieldRef '{node.fieldRef}' 没有在所属 rowsRef 的 "
                            f"fieldRefs 里声明（已声明的是 {sorted(scope)}）——"
                            "要显示的字段必须先在 rowsRef.fieldRefs 里列出来。"
                        )
                for child in node.children:
                    walk(child, scope)

            walk(self.root, None)
            return self

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


def _rows_prompt_fragment() -> str:
    """逐行内容怎么画——rowsRef 的用法（2026-08-03）。

    取代了此前的 `_blockref_prompt_fragment`（口径是"你画不出来，从名单里挑
    个现成积木摆进去"）。用户裁决「首页只由 LLM 动态设计，参照图上有什么就
    设计什么，不要固定组件」之后，固定积木那条路整体删除，逐行能力直接补给
    设计模型自己——版式它自由画，真实行数据由 rowsRef 喂进去。

    这段话必须把三件事说清楚，少一件都会退回老毛病：
      ① 逐行内容**可以画**（不说的话模型沿用旧直觉，改用聚合数字替代）；
      ② 模板只写一行（不说的话模型会手写 5 份几乎相同的子树，节点数爆掉）；
      ③ 要显示的字段必须先在 fieldRefs 里声明（白名单是逐行数据的主要防线，
         漏声明会被 Pydantic 拒收、白烧一轮 reask）。
    """
    return "\n".join([
        "",
        "### 逐行内容（排行榜、最近动态、待办清单、流程记录……）",
        "",
        "这类「一行一行列出真实记录」的内容**你可以自己画**，版式完全由你定：",
        "几列、每列多宽、徽标/进度条怎么摆，跟画别的区域一样自由。",
        "",
        "数据这样绑：在**列表容器**节点上写 rowsRef 声明取哪些行，它的 children",
        "写**一行**的样子（模板），运行时会按取到的真实行数重复渲染这份模板，",
        "把模板里带 fieldRef 的节点替换成那一行的真实值。",
        "",
        '{"tag": "div", "style": {"display": "flex", "flexDirection": "column"},',
        ' "rowsRef": {',
        '   "entityRef": "<真实实体 id>",',
        '   "fieldRefs": ["<这一行要显示的字段 id>", "..."],',
        '   "sortByRef": "<排序字段 id，可选>", "order": "desc", "limit": 5},',
        ' "children": [',
        '   {"tag": "div", "style": {"display": "flex", "gap": "12px"},',
        '    "children": [{"tag": "span", "fieldRef": "<字段 id>"},',
        '                 {"tag": "span", "fieldRef": "<字段 id>"}]}]}',
        "",
        "三条硬规矩：",
        "1. **模板只写一份**——不要手写 5 份几乎相同的行，重复由运行时负责。",
        "2. **fieldRef 只能取 fieldRefs 里声明过的字段**，没声明的读不到（会被拒）。",
        "3. rowsRef 与 fieldRef 都必须指向数据模型里真实存在的实体/字段，不能编。",
        "",
        "limit 建议 5-8 条（上限 20）。这一页用不上逐行内容就完全不用，不要为了",
        "凑版面硬塞一个跟业务无关的排行榜——参照图上有才画，没有就没有。",
    ])


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
{_rows_prompt_fragment()}
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
    """2026-07-30 改版：把"只示意版式与配色"换成"画出真实完整的版式细节"。
    实测对比过（同一份内容清单、同一套配色约束，只改这一句）：旧措辞画出来的
    卡片经常只有图标轮廓+大数字，没有图标徽标底色、趋势对比小字这类真实产品
    里常见的细节；换成"真实完整"之后密度明显提升，且配色约束没受影响（这条
    跟"是否单一克制品牌色"是两回事，可以分开控制）。不要求画侧栏/顶栏——那
    部分继续由 device_note 说明"另有画面，不用你画"，这里只提升内容区本身
    的细节完整度。
    """
    hint = _theme_palette(theme_id, generated_theme)
    charts = "、".join(hint["charts"])
    device_note = {
        # 手机档必须在**提示词里明说竖屏**，这是拿到竖版画布的唯一办法：
        # 这个端点的输出形状由**提示词内容**决定，尺寸参数只定像素预算档位
        # （详见 _DEVICE_IMAGE_SIZE 上方的探针记录）。此前这里只写"比例偏竖长"
        # 这种含糊说法，配上后面那句"充分利用整个画布"，模型就把内容横着摊开
        # 画成方图——画出来的比例手机上根本不存在。现在直接点名 9:16 手机屏。
        "phone": (
            "这是手机端内容区里的一张卡片（上方标题栏、下方 Tab 导航另有画面，"
            "不用你画）。**整张图要画成手机竖屏比例（9:16 的竖长画面）**，"
            "内容必须单列纵向排布，字号/图标/间距都比桌面收紧一档。"
        ),
        "tablet": "这是平板端内容区里的一张卡片（侧边栏+顶栏另有画面，不用你画），中等宽度。",
    }.get(device, "这是桌面端内容区里的一张卡片（左侧侧边栏、上方顶栏另有画面，不用你画），可以偏宽幅横向布局。")
    fill_note = "画面内容要充分利用整个画布，边缘到边缘，不要在四周留一圈空白画布底色、"
    datamodel_summary = _datamodel_summary_lines(datamodel)
    datamodel_note = (
        f"\n这个区块背后真实的数据字段长这样（画面里出现的分类/阶段/条目数量"
        f"和名字要照着这些字段（尤其是括号里展开的 enum 选项）来，不要凭空编一个"
        f"'看起来差不多但对不上'的数量或名字，只示意版式不用写具体数值）：\n{datamodel_summary}\n"
        if datamodel_summary else ""
    )
    return (
        f"为一个应用界面区块生成一张 UI 参考效果图（干净原型图）。设计需求：{design_brief}。"
        "要求：画出这个内容区真实完整的版式细节——每张卡片要有具体的图标（配色底"
        "徽标而不是裸线条）、标题、数据占位，以及趋势对比/状态标签这类辅助信息，"
        "不要只画示意性的空壳卡片；"
        f"{_PLACEHOLDER_STYLE_NOTE}"
        # 2026-07-30：这条明令原本只写在 _build_overview_sheet_prompt 里，
        # 这边漏了——而两边**会吃到同一份 brief**：总览页正常走参照板，但
        # _generate_overview_sheet_b64 任何一步失败都静默返回 None，
        # generate_freeform_block 就会退回来自己生一张，把带 blockRef JSON 的
        # 总览 brief 原样喂到这里。真机复现过两次：画面里直接印出
        # 「rowsRef / entityRef」这类徽标，严重时整块 JSON 当代码块画进图里。
        "注意：上面的设计需求里可能夹带 JSON 片段、字段 id、rowsRef 之类的"
        "技术标识，那些只是在告诉你**这一格该放什么内容**，不是要画的文案——"
        "画面里一个技术标识都不许出现，该画成对应的真实界面（比如一行行的动态"
        "列表、带图标和状态标签的条目），标题用人看得懂的中文短语；"
        f"配色基调用「{hint['label']}」这套主题——主色 {hint['primary']}，大面积底色仍走浅色（贴近 "
        f"{hint['contentBg']} 或纯白，保证内容读得清），强调浅底可参考 {hint['accentBg']}；"
        # 多色分类板**只给图表用**。此前这句写的是"如果画面需要多个不同色块
        # 区分类别"——范围太含糊，模型会把这 5 个色相铺到 KPI 卡的图标徽标上，
        # 一张卡一个色（蓝/紫/青/橙），整屏看着花。真机对比过：同一份内容、
        # 只把配色说明换成单一主色，出图明显更协调（2026-07-30 手机档对比）。
        # 图表本来就需要多色区分类别，所以不是不给，是**限定在图表里面**。
        f"图表（折线/环形/柱状）里区分类别时用这几个颜色：{charts}，不要另配一套糖果色；"
        f"{_CARD_VISUAL_NOTE}"
        "不要出现任何多余的装饰性水印或品牌字样；"
        f"{fill_note}"
        "不要画装饰性的外框/圆角卡片壳/网页浏览器窗口 mockup 把整个画面包起来——"
        "这张图本身就是内容区局部，不是「一张图里嵌一张界面截图」的效果。"
        f"{device_note}"
        # 2026-07-30 人工核对：加完配色限定与技术标识两段之后，出图明显变稀
        # ——坐标轴刻度和图例数值退化成灰色横线、KPI 卡掉了副标题和环比行、
        # 列表项掉了次要信息。这条 prompt 到这里已经堆了十几句"不要/不许"，
        # 而"画出真实完整的版式细节"那句在最前面，早被冲掉了：模型把一长串
        # 禁令读成"少画点最安全"。这跟 c425911 记的是同一个坑（"只示意版式与
        # 配色"被读成"画个意思就行"）。
        #
        # 所以在**最后**补一份正面的、可逐项核对的清单——顺序上压在所有禁令
        # 之后，并明说禁令管的是别画错、不是让你少画。正面枚举比否定句管用，
        # 这也正是那份第三方技能包提示词的写法（把真实结构件逐个点名）。
        "最后一条，优先级最高：这张图是拿来当版式参照的，**信息层级必须画满**"
        "——每张 KPI 卡要有图标、标题、数值占位、以及环比/趋势那一行；每个图表"
        "要有标题、图例、坐标轴刻度标签和单位；每条列表项要有图标、主标题、"
        "一行次要信息、状态标签和时间占位。**这些标签一律写成看得见的占位文字**"
        "（照上面那套按字段形状写的占位法），不许用灰色横线、色块或者留空代替文字。"
        "上面那些「不要」管的是别画错东西，不是让你少画东西。"
        f"{datamodel_note}"
    )


def _build_overview_sheet_facts(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> str:
    """总览参照板的**事实清单**——只给模型它自己产生不了的信息，不给任何做法。

    2026-07-31 重构。此前这里是一份 ~1500 字的写死模板（版式处方 / 技术标识
    禁令 / 占位写法 / 水印与铺满 / 信息层级清单），实测两个完全不同业务的出图
    提示词**逐字相同 87%**——能变的那 13% 里没有一个字是关于"怎么排"的，所以
    无论换什么题材，画出来都是「KPI 行 → 图表 → 列表」。

    现在改成两段式：这里只吐事实，怎么画交给 _refine_sheet_prompt_via_llm 按
    这一个系统现写（见那个函数的说明）。事实包含四类，每一类都是"模型没法
    自己推出来"的：

      · 画布尺寸与设备档 —— 端点逐像素认 size，两边说的必须是同一个画布
      · design_brief    —— 这一页经过门禁的内容范围
      · datamodel 摘要  —— 真实实体/字段/enum 选项，防止编出对不上的分类数

    ⚠️ **不给色板**（2026-08-03，用户裁决：首页生图自由发挥）。
    此前这里会附一句"运行时外壳已经按这套渲染了，别偏色"。现在全站外壳是
    统一的白菜单 + 白 Header + 一个品牌主色，参照图本来就不需要去迁就它——
    它的职责只剩**版式**。把配色的手铐摘掉，出图的表现力明显更高，而外壳
    的一致性由前端那套固定色板保证，不依赖这张图画成什么样。

    ⚠️ 保留一条底线：**这段文本会被原样塞进 refine 的输入里**，而 brief 里
    夹带 blockRef JSON 是常态。refine 那一步的指令里必须自己处理这件事——
    这里不再重复禁令（那正是本次要拿掉的东西之一）。
    """
    del theme_id, generated_theme  # 见上：参照图不再受色板约束
    datamodel_summary = _datamodel_summary_lines(datamodel)
    canvas = _sheet_image_size_for_device(device)
    tier = {
        "desktop": "桌面端（宽屏，横版画布）",
        "phone": "手机端（窄屏，竖版画布）",
    }.get(device, "未指定（按桌面宽屏处理）")

    parts = [
        f"画布：{canvas} 像素，出图端点逐像素照此返回。",
        f"设备档：{tier}。",
        f"这一页要覆盖的内容范围：\n{design_brief}",
    ]
    if datamodel_summary:
        parts.append(
            "背后真实的数据字段（画面里出现的分类/阶段/条目的数量和名字要照着"
            f"这些来，尤其是括号里展开的 enum 选项）：\n{datamodel_summary}"
        )
    return "\n\n".join(parts)


# refine 那一步的**元提示词**：告诉改写 LLM 它在写什么、写给谁看。
#
# 这一段本身仍然是常量——但它约束的是"怎么写提示词"，不是"怎么画界面"。
# 界面上的每一条要求（画多大、画几张、怎么占位、不许画什么）现在都由改写
# LLM 按这一个系统自己定，所以不同业务出来的提示词文字必然不同。
_SHEET_PROMPT_REFINE_SYSTEM = (
    "你是给文生图模型写提示词的人。下面会给你一个企业应用某一页的**事实清单**"
    "（画布尺寸、设备档、这一页要覆盖的内容范围、身份色板、真实数据字段）。\n\n"
    "请据此写出一段**中文文生图提示词**，用来生成这一页的 UI 版式参照图。"
    "这张图的读者不是终端用户，而是另一个负责出页面结构的设计模型——它会照着"
    "这张图学「这一页该长什么样」。\n\n"
    "要求：\n"
    "1. 只输出提示词正文，不要解释、不要标题、不要 markdown 代码块。\n"
    "2. 版式由你按这一页的**业务性质**决定：哪块内容该在最显眼的位置、"
    "分几列、谁跟谁并排、什么该占整行——按这个业务的人打开这一页最先要做什么"
    "来排，不要套「顶部一排指标卡 + 下面两张图 + 底部一张表」那种通用后台网格。\n"
    "3. 事实清单里可能夹带 JSON 片段、字段 id、rowsRef 这类**技术标识**，"
    "那些只是在说明某一格该放什么内容，不是要画在图上的文案——你写的提示词里"
    "必须把它们翻译成人看得懂的中文界面说法。\n"
    "4. 这张图**不能出现任何真实数据**（它会被误当成真实业务数字）。你要在"
    "提示词里写清楚该怎么占位，并且**按字段类型选合适的占位形状**，让人一眼"
    "看出这一格装的是什么类型的内容。\n"
    "5. 画布尺寸和色板照抄事实清单里的值，不要自己改。\n"
    "6. 长度控制在 400-800 字，写成一段连贯的中文，不要分点罗列。"
)


def _refine_sheet_prompt_via_llm(facts: str, *, device: str = "") -> Optional[str]:
    """让 LLM 按这一个系统现写出图提示词。**加分项，失败静默回退。**

    跟 _critique_and_revise_design 同一套纪律：任何失败（LLM 报错 / 空回复 /
    短得不像提示词）都返回 None，调用方退回事实清单直接出图。绝不能因为
    "想写得更好"反而把整条参照图链路弄挂。

    为什么值得多花一轮 LLM：写死模板下两个不同业务的提示词逐字相同 87%，
    版式必然雷同（见 _build_overview_sheet_facts 的说明）。让模型按业务现写，
    才有"律所工作台"和"大棚监控台"排布不同的可能。
    """
    from sliderule_llm.client import LlmError, call_llm_with_retry

    convo = [
        {"role": "system", "content": _SHEET_PROMPT_REFINE_SYSTEM},
        {"role": "user", "content": facts},
    ]
    try:
        # **不传 on_delta**——传了 call_llm 就走流式（见其 docstring）。当前
        # provider（api.rcouyi.com / gpt-5.6-luna）的流式回包解析出来是空内容，
        # 同一个请求非流式一次就回。这里没有逐块回显的需求，直接走非流式。
        # 别照抄 _critique_and_revise_design 那处的写法：那里传 on_delta 是为了
        # 兼容它自己的调用约定，不是因为需要流。
        result = call_llm_with_retry(
            convo,
            max_attempts=2,
            backoff_ms=1500,
            temperature=0.7,
            max_tokens=2000,
        )
    except LlmError as exc:
        print(f"[freeform_block] sheet prompt refine skipped: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 改写失败绝不能拖垮主链路
        print(f"[freeform_block] sheet prompt refine skipped (unexpected): {str(exc)[:160]}")
        return None
    # 字段是 content 不是 text——LlmResult 上没有 text，用 getattr 兜底会**永远
    # 拿到空串**，然后被下面的长度检查判成"回复太短"静默退回。这个 bug 不会报错、
    # 不会留痕，表现就是"改写好像一直没生效"。
    text = (result.content or "").strip()
    # 去掉模型偶尔套上的代码块围栏
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if len(text) < 120:
        print(f"[freeform_block] sheet prompt refine skipped: 回复太短（{len(text)} 字）")
        return None
    del device  # 档位信息已经在 facts 里，这里只留作调用方可读性
    return text


def refine_sheet_prompts_parallel(
    items: list[tuple[str, str]], *, max_workers: int = 4
) -> list[Optional[str]]:
    """批量改写，**并发发出**。返回与入参等长的列表，失败位置是 None。

    每次改写是一发独立的网络请求，串行做 N 页就是 N 倍延迟。这里用线程池并发
    ——call_llm_with_retry 是阻塞 IO，线程池对它有效。

    失败不抛：单个位置失败就是 None，调用方按"这一项退回事实清单"处理，与
    单发版本的 fail-open 语义一致。
    """
    if not items:
        return []
    if len(items) == 1:
        facts, device = items[0]
        return [_refine_sheet_prompt_via_llm(facts, device=device)]

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(max_workers, len(items))) as pool:
        futures = [
            pool.submit(_refine_sheet_prompt_via_llm, facts, device=device)
            for facts, device in items
        ]
        out: list[Optional[str]] = []
        for f in futures:
            try:
                out.append(f.result())
            except Exception as exc:  # noqa: BLE001 — 单个失败不拖垮整批
                print(f"[freeform_block] sheet prompt refine worker failed: {str(exc)[:160]}")
                out.append(None)
    return out


def _build_overview_sheet_prompt(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> str:
    """总览参照板的最终出图提示词 = 事实清单 → LLM 现写。

    ── 2026-07-31 之前是什么样 ────────────────────────────────────

    此前这里是一份写死的 f-string 模板，装着五段常量：版式处方（按 device
    三选一，每支自己是死字符串）、技术标识禁令、占位写法（435 字模块常量）、
    "不要水印 / 画面撑满画布"、末尾信息层级清单。

    那套模板是一路减法实验调出来的，每一条都有出图证据（砍技术标识禁令 →
    blockRef 的 JSON 被当代码块画进图；砍占位写法 → 编出加起来能对上的自洽
    假数据）。问题不在单条对不对，而在**它对每个应用说同一句话**：实测两个
    完全不同业务（律所案件台 / 农业大棚监控）的出图提示词逐字相同 87%，能变
    的 13% 全是色值、字段名和内容清单，没有一个字关于"怎么排"。所以连着三轮
    实验——删掉版式处方、加一句"每个页面布局要各不相同"、换掉 brief 口吻——
    出图骨架都纹丝不动。

    ── 现在的形态 ────────────────────────────────────────────────

    两段式：
      ① _build_overview_sheet_facts 吐**事实**（画布/设备档/内容范围/色板/
         真实字段），一条做法都不给；
      ② _refine_sheet_prompt_via_llm 让 LLM 按这一个系统现写出图提示词，
         版式、占位写法、该强调什么，全部由它按业务性质定。

    ⚠️ **这是拿确定性换多样性。** 那五段常量原本是在替模型兜住已知的坑；
    现在改成每次让改写 LLM 自己重新想一遍，元提示词里只留了"翻译技术标识"
    和"按字段类型选占位形状"两条方向性要求，没有逐类字段的形状清单。改写
    LLM 漏掉哪一条，那一张图就会复发对应的老 bug。判断这笔交易划不划算，
    唯一的办法是出图看——别拿"以前修过"当作现在也不会复发的理由。

    改写失败（LLM 报错/回复过短/未配置）时**静默退回事实清单直接出图**，
    与 _generate_overview_sheet_b64 的 fail-open 纪律一致：宁可出一张少了
    做法指导的图，也不能让参照图这一步拖垮整条生成链。
    """
    facts = _build_overview_sheet_facts(
        design_brief, datamodel,
        theme_id=theme_id, device=device, generated_theme=generated_theme,
    )
    return _refine_sheet_prompt_via_llm(facts, device=device) or facts


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


def _image_generation_configured() -> bool:
    """配没配生图。**这就是首页参照板的开关**——没有单独的环境变量。

    首页参照板可以单独指到另一家服务商（SHEET_ 前缀），缺项时回落到默认那份，
    所以两份任意一份齐全就算配了；判据与 _generate_overview_sheet_b64 真正
    取配置的顺序一致，不能只看默认那份（否则只配了 SHEET_ 的部署会被误判成
    "没配"，一张图都不生，而实际上它是能生的）。

    读不出配置按"没配"处理：宁可退回纯文字设计，也不要在一个注定失败的
    生图请求上串行地白等一分钟。
    """
    try:
        from sliderule_llm.image_client import get_image_gen_config

        return (
            get_image_gen_config("SHEET_") is not None
            or get_image_gen_config() is not None
        )
    except Exception:  # noqa: BLE001 — 配置异常不该拖垮主链路
        return False


def _generate_overview_sheet_b64(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """生成参照板（默认三区，device 明说 desktop/phone 时两区——见
    _build_overview_sheet_prompt）。跟 _generate_reference_image_b64 一样是
    **加分项**：任何失败都静默返回 None，调用方退回纯文字生成，绝不拖垮主链路。

    尺寸走 _SHEET_IMAGE_SIZE（传 1792x1024，实收 1672x941）——这张
    图上要同时容纳版式和一堆样例，小了字就糊。可用尺寸是白名单，见
    _SHEET_IMAGE_SIZE 上方那份活体探针记录，别凭直觉改。

    **首页参照板可以单独指到另一家服务商**（2026-07-30）：配齐
    SHEET_IMAGE_API_URL / SHEET_IMAGE_MODEL / SHEET_IMAGE_API_KEY 三项就走那家，
    缺任意一项自动回落到默认端点、行为与从前逐字节一致。

    为什么只给这一处开这个口子：审查一份第三方技能包的产出时量到，它的图是
    7.3MP 而我们 1.6MP，观感差距主要来自**端点给的像素档位**，不是提示词
    （同一 prompt 在我们端点传 3840x2160 也只回 1672x941，实测 85s vs 90s）。
    而这张首页参照板是当前**唯一驱动版式的图**——FreeformInsight 没放开
    （见 experience_block_catalog 那条 generationEnabled:false 与它的哨兵测试），
    单区块参照图只在这张失败时兜底触发。所以把口子开在这一处，等于用最小
    改动面换到那份观感，其余路径完全不动。

    SHEET_IMAGE_SIZE / SHEET_IMAGE_BODY_STYLE / SHEET_IMAGE_ASPECT_RATIO 一并
    可配：有的服务商用 {"size":"1792x1024"}，有的用 {"image_size":"2K",
    "aspect_ratio":"16:9"}，形态由 body_style 决定（见 image_client）。
    """
    try:
        from sliderule_llm.image_client import (
            ImageGenError,
            generate_image_png,
            get_image_gen_config,
        )
    except Exception:
        return None
    try:
        prompt = _build_overview_sheet_prompt(
            design_brief, datamodel, theme_id=theme_id, device=device, generated_theme=generated_theme
        )
        sheet_cfg = get_image_gen_config("SHEET_")
        size = (os.environ.get("SHEET_IMAGE_SIZE") or "").strip() if sheet_cfg else ""
        png_bytes = generate_image_png(
            prompt, cfg=sheet_cfg, size=size or _sheet_image_size_for_device(device)
        )
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


def _prune_non_dict_list_items(node: Any) -> Any:
    """递归丢弃 list 里非 dict 的元素——json_repair 修复过程中,原始文本里
    多出来的孤立字符/字符串（真机复现过：一份坏 JSON 结尾多了一个孤立的
    句号 "."）有时会被它当成"数组里的一项"塞进去,而不是当噪声丢掉。这些
    杂质在我们的 schema 里必然是非法值（FreeformNode 只能是 dict），
    下面这道清理只删"不是字典的数组项"这一种确定性的垃圾，不改任何
    看起来像合法节点的内容，不做结构性猜测。"""
    if isinstance(node, dict):
        return {k: _prune_non_dict_list_items(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_prune_non_dict_list_items(x) for x in node if isinstance(x, dict)]
    return node


def _repair_freeform_json_or_none(text: str) -> Optional[dict[str, Any]]:
    """LLM 一次性吐深层嵌套 JSON 时偶发数错括号层数（真机复现：{}/[] 各差
    1、结尾多一个孤立句号，且不是 token 截断——那份输出结尾收得完整）。
    这类"语法错但结构基本对"的输出，用成熟的 json-repair 库机械修一次，
    比重新问一轮 LLM 更快更稳；手搓的"数括号数、线性补全"式修补容易把
    内容拼出语法合法但结构错位的树，不如让一个专门为这个问题写的解析器
    来做。修复失败或者输出形状不对（不是 dict）都返回 None，调用方照旧
    落回原有的 reask 流程——这一步只在能省一轮重问时才生效，不改变任何
    失败路径的行为。"""
    try:
        repaired = json_repair.repair_json(text)
        payload = json.loads(repaired)
    except Exception:  # noqa: BLE001 — 修复库本身的异常不该拖垮已有的 reask 兜底
        return None
    if not isinstance(payload, dict):
        return None
    return _prune_non_dict_list_items(payload)


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
        with _enrich_stage("block.refimage", device=device or "unspecified") as _st:
            reference_image_b64 = _generate_reference_image_b64(
                design_brief, datamodel, theme_id=theme_id, device=device, generated_theme=generated_theme
            )
            _st["got"] = 1 if reference_image_b64 else 0

    if reference_image_b64:
        first_content: Any = [
            {
                "type": "text",
                "text": prompt_text
                + "\n\n下面这张图是这个设计需求的参考效果图：版式布局、配色克制程度、"
                "留白节奏照着这张图的风格来。但图上任何看起来像数字/统计的内容都只是"
                "占位假象，绝不能照抄或参考它的具体数值——真实数字仍然只能来自上面给出的"
                "数据模型，并挂 dataRef。"
                # 2026-07-30：参照图**不画外壳**（试过画、又撤回，见
                # _build_overview_sheet_prompt 那条注释）。所以这里不需要"外壳是
                # 背景"那句解释；但"别自己搭外壳"这条禁令保留——它防的是设计 LLM
                # 自作主张在内容区里加一套导航，跟参照图画不画壳无关。
                + "\n注意：侧边栏、顶栏、搜索框、用户头像这些外壳组件由运行时另外"
                "渲染，不归你设计——不要在你的内容树里搭这些，从内容区第一张卡片"
                "开始画。",
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
            # 先试机械修复，成功就直接往下走验证——省一轮重问；修不好或者
            # 修完还是校验不过，就照旧落回 reask（见 _repair_freeform_json_or_none
            # 的说明）。
            repaired_payload = _repair_freeform_json_or_none(text)
            if repaired_payload is None:
                convo = convo + [
                    {"role": "assistant", "content": raw[:6000]},
                    {"role": "user", "content": f"你上次的输出不是合法 JSON：{last_error}。请重新输出，只要一个 JSON 对象。"},
                ]
                continue
            print("[freeform_block] JSON repaired mechanically (json-repair), reask 轮次被省下")
            payload = repaired_payload

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
                            + "\n其余内容（版式、节点结构、dataRef、chart、rowsRef）保持不变，"
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
                # 埋点：E2B 截图自检。这一段此前**完全测不到**——本地没配
                # SLIDERULE_PUBLIC_APP_URL 时整段不触发，只能拿"沙盒固定开销
                # 实测 29.1s + 代码里的超时上限"夹逼出 29~69s 的区间
                # （审查文档「九、3」）。这条线一上，那个区间就能换成实测值。
                with _enrich_stage("block.screenshot", device=device or "unspecified") as _st:
                    preview_b64 = _render_preview_screenshot_b64(
                        design_dump, theme_id=theme_id, device=device, generated_theme=generated_theme
                    )
                    _st["got"] = 1 if preview_b64 else 0
                if preview_b64:
                    with _enrich_stage("block.critique", device=device or "unspecified") as _st:
                        revised_dump = _critique_against_reference(
                            design_dump,
                            reference_image_b64=reference_image_b64,
                            preview_screenshot_b64=preview_b64,
                            design_brief=design_brief,
                            FreeformDesign=FreeformDesign,
                        )
                        _st["revised"] = 1 if revised_dump is not None else 0
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

    ⚠️ **当前灰度下这个函数在生产路径上不处理任何区块**（2026-08-01 实测）。

    它只认 `type == "FreeformInsight"` 的块，而该类型在
    `experience_block_catalog.json` 里是 `generationEnabled: false`，生成契约
    还把它列进 schema-only 名单明令 "never emit them"
    （`schema_legal.py` 的 `schema_only` 那段）。四条独立证据：
      · 目录里 generationEnabled=false
      · 生成契约明令不许产出
      · 演示域冻结夹具 builtin_domain_models.json 里出现 0 次
      · 离线夹具再生成脚本 enrich_builtin_domain_models.py 压根不调用本函数
    五轮真跑（诊所×3 / 公园×2）里 `[enrich-timing] stage=freeform.total` 恒为
    `ms=0`，一次都没触发。

    **但它不是可以删的死代码**：结构门并不拒绝 `FreeformInsight`
    （`v5_model_gate.py:660-672` 有它的专门校验分支，检查 props.designBrief
    非空），所以这是"提示词层面的禁止"而非"结构上的不可能"——模型万一漏网
    吐出一个，门会放行，这段就会真的执行。

    灰度一旦放开（把目录里那个布尔改成 true），这里立刻恢复工作；届时**必须
    先处理下面那两个预算计数器的并发问题**再谈并行化，见
    docs/enrich-pipeline-parallelization-audit-2026-07-31.md「四、2」。
    """
    # 墙钟埋点在函数内部（理由见 identity_theme_gen.enrich_identity_theme 同处
    # 注释：这条链路有多个入口，埋在调用点则换一个入口就没数）。
    with _enrich_stage("freeform.total"):
        return _enrich_freeform_blocks_inner(model)


def _enrich_freeform_blocks_inner(model: dict[str, Any]) -> dict[str, Any]:
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
                # 埋点②：区块级生成。当前灰度下 FreeformInsight 的
                # generationEnabled=false，主模型不会产出这类区块，这个循环体
                # 在生产路径上跑不到（审查文档「八、1」）——埋点仍然照放，
                # 灰度一旦放开就直接有数，不用再回来补一次。
                with _enrich_stage("freeform.block", page=str(page.get("id") or ""), block=bid):
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


def _monitor_overview_design_brief(
    page: dict[str, Any], datamodel: dict[str, Any], *, audience: str = "design"
) -> str:
    # audience（2026-08-01）：这份 brief 有**两个消费方**，需要的说法不一样。
    #   "design" —— 首页设计 LLM。要 blockRef 的技术形态（type/binding/props
    #                照抄），因为它的产出要能被渲染器认出来。
    #   "image"  —— 参照板生图模型。_build_overview_sheet_facts 把 brief 整段
    #                照抄进出图提示词，而技术形态对它是天书：读到
    #                {"type": "ActivityFeed", "binding": {...}} 它不知道该画一
    #                条时间线；架构图那条"画面里不许出现 JSON/字段id/blockRef
    #                等技术标识"针对的也是这里。给它视觉描述。
    # 此前两边共用一份（技术形态那份），是参照板上一直没有这些积木的原因——
    # 不是生图模型判断"这页不需要"，是它没看懂那段 JSON 在说什么。
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
    plain_bits: list[str] = []  # 不吃 binding 的成品积木（动作面／流程面）
    # 同一批积木给**画图模型**看的说法（2026-08-01）。
    #
    # 这份 brief 会被 _build_overview_sheet_facts 整段照抄进出图提示词，而上面
    # 那两份 bits 是给设计 LLM 的：里头是 {"type": "ActivityFeed", "binding":
    # {...}} 这种 JSON 加一句"照抄即可"。生图模型读到它**无从知道该画一排按钮
    # 还是一条时间线**——参照板上一直没有这些积木，原因就在这里，不是它判断
    # "这一页不需要"。架构图那条"画面里不许出现 JSON/字段id/blockRef 等技术
    # 标识（brief 是照抄进 prompt 的）"说的也是同一件事。
    #
    # 所以按受众分两套说法：技术形态留给设计 LLM，画图模型拿视觉描述。
    visual_bits: list[str] = []
    _VISUAL_SHAPE = {
        "RankedList": "一张 Top-N 排行榜（名次 + 名称 + 数值，纵向若干行）",
        "ActivityFeed": "一列最近动态（按时间倒序的事件条目，每条带时间与状态标记）",
        "QuickActionPanel": "一排常用操作按钮（横向并列的几个按钮）",
        "WorkflowTimeline": "一条横向流程阶段条（若干阶段依次相连，当前阶段高亮）",
    }

    def _visual(block_type: str, title: str = "") -> None:
        shape = _VISUAL_SHAPE.get(block_type)
        if not shape:
            return
        visual_bits.append(f"{shape}{f'——{title}' if title else ''}")
    seen_row_keys: set[str] = set()

    def _take(key: str) -> bool:
        if key in seen_row_keys:
            return False
        seen_row_keys.add(key)
        return True

    # 这一页声明的**逐行内容**（2026-08-03 改）。
    #
    # 以前这里拼的是 blockRef 的 JSON（"照抄这段，把这个积木摆进版式"）。固定
    # 积木那条通道已整体删除——现在设计模型用 rowsRef 自己画逐行内容，所以这里
    # 改成用**业务语言**描述"这一页有哪些一行一行的东西、数据从哪来"，具体长
    # 什么样由模型按参照图决定，我们不再规定形状。
    #
    # 两个受众都要说（对比上一版把两边一起停掉的做法）：
    #   · 设计 LLM 要知道有哪些逐行内容可画、绑哪个实体哪些字段；
    #   · 生图模型要把它们画进参照板——现在渲染端真做得出来了，参照板承诺得起。
    for r in page.get("rankings") or []:
        entity = str(r.get("entity") or "").strip()
        sort_by = str(r.get("sortBy") or "").rpartition(".")[2]
        if not entity or not sort_by:
            continue
        if not _take(f"RankedList|{entity}|{sort_by}"):
            continue
        limit = r.get("limit")
        limit_bit = f"，取前 {limit} 条" if isinstance(limit, int) else ""
        row_bits.append(
            f'{r.get("name") or r.get("id")}（排行榜）：实体 "{entity}"，'
            f'按字段 "{sort_by}" 从高到低排序{limit_bit}'
        )
        _visual("RankedList", str(r.get("name") or ""))
    for f in page.get("feeds") or []:
        entity = str(f.get("entity") or "").strip()
        time_field = str(f.get("timeField") or "").rpartition(".")[2]
        if not entity or not time_field:
            continue
        level = str(f.get("levelField") or "").rpartition(".")[2]
        if not _take(f"ActivityFeed|{entity}|{time_field}|{level}"):
            continue
        level_bit = f'，另有等级字段 "{level}" 可用来上色/加徽标' if level else ""
        row_bits.append(
            f'{f.get("name") or f.get("id")}（最近动态）：实体 "{entity}"，'
            f'按时间字段 "{time_field}" 倒序{level_bit}'
        )
        _visual("ActivityFeed", str(f.get("name") or ""))

    # ── 出图受众：到此为止 ──────────────────────────────────────
    # 下面是给设计 LLM 的安置指导，只对它有意义。给生图模型的是同一批内容的
    # 视觉描述——它才画得出来。
    #
    # 2026-08-03：这批逐行内容以前渲染端做不出来（dataRef 只有聚合值），所以
    # 上一版把给生图模型的这段一并停掉了，理由是"参照板不该承诺渲染兑现不了
    # 的东西"。现在 rowsRef 补上了逐行能力，承诺兑现得了，这段恢复。
    if audience == "image":
        if visual_bits:
            lines.append(
                "画面上除了这些数字与图表，还要画出下面这几块内容（它们是这一页"
                "真实存在的部分，不是装饰）：\n- " + "\n- ".join(visual_bits)
            )
        return "\n".join(lines)

    if row_bits:
        lines.append(
            "这一页还有下面这些**逐行内容**。版式由你按参照图定（几列、多宽、"
            "怎么排都由你），数据用 rowsRef 绑（用法见下方说明）：\n- "
            + "\n- ".join(row_bits)
        )

    # 措辞用祈使式并把代价说明白（2026-08-01 的教训，保留）：仓库里两次栽在
    # 许可式措辞上——schema_legal 记着 "You MAY emit…" 让七个通电区块一个没被
    # 用、连跑三次全是 0。所以这里说"要画就这样画"，不说"你可以考虑画"。
    #
    # 2026-08-03 措辞随机制改：以前这些是"已声明、你不安置就会掉到设计区外面
    # 变成外挂卡"的既成事实，所以要说"不摆的代价"。现在没有外挂卡这条退路了
    # ——整页就是你的设计，参照图上没有的就是没有。于是取舍标准回到唯一该有
    # 的那个：**看参照图**。
    if row_bits:
        names = [b.split("（", 1)[0] for b in row_bits]
        lines.append(
            "关于**逐行内容**（也只关于它）的取舍——上面「必须包含」的 KPI 统计卡"
            "与图表**不在取舍范围内，一项都不能少**：\n"
            f"· 可选的只有这几块：{'、'.join(names)}\n"
            "· 参照图上画了 → 用 rowsRef 画出来，放哪一格、占多宽、长什么样由你定；\n"
            "· 参照图上没有 → **不要画**。不画就是这一页没有这块内容，不会跑到"
            "你的设计外面另起一张卡。\n"
            "按这一页的实际需要选，不必凑齐——但这句话只对逐行内容有效，"
            "KPI 与图表照单全画。"
        )
    return "\n".join(lines)

def enrich_monitor_page_overviews(
    model: dict[str, Any], *, preview_sink: Optional[OverviewPreviewSink] = None
) -> dict[str, Any]:
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

    preview_sink：可选的参照板收集槽（见 app_preview）。传了就把这次画的参照板
    交进去，供落库时当应用中心的卡片缩略图；**不传就完全不收集**——两个脚本
    调用方（fresh_topic_shot / enrich_builtin_domain_models）因此不用改，也不会
    有几 MB 的 base64 混进它们产出的 model.json 和仓库里冻结的域夹具。
    """
    # 墙钟埋点在函数内部（理由见 identity_theme_gen.enrich_identity_theme 同处
    # 注释：这条链路有多个入口，埋在调用点则换一个入口就没数）。
    with _enrich_stage("monitor.total"):
        return _enrich_monitor_page_overviews_inner(model, preview_sink=preview_sink)


def _enrich_monitor_page_overviews_inner(
    model: dict[str, Any], *, preview_sink: Optional[OverviewPreviewSink] = None
) -> dict[str, Any]:
    datamodel = model.get("datamodel") or {}
    appbundle = model.get("appbundle") or {}
    identity = appbundle.get("appIdentity") or {}
    theme_id = str(identity.get("theme") or "").strip()
    device = str(appbundle.get("preferredDevice") or "").strip()
    # 哪一页代表这个应用：落地页那张参照板就是用户点开应用第一眼看到的画面，
    # 也就是卡片该显示的东西（见 OverviewPreviewSink.offer 的取舍规则）。
    landing_ref = str(appbundle.get("landingPageRef") or "").strip()
    generated_theme_raw = identity.get("generatedTheme")
    generated_theme = generated_theme_raw if isinstance(generated_theme_raw, dict) else None

    # 生图只给**首页**一张（2026-08-03，用户裁决）。
    #
    # 之前是"每个 monitor/dashboard 页各一张，上限 4 张"，再加主题那张。实测
    # 单张 60~85s 且串行，而真正被用到的只有落地页那张——它同时是应用中心
    # 卡片显示的画面（见 OverviewPreviewSink.offer）。其余页拿到参照板的收益
    # 远不抵那一分多钟。
    #
    # 开关就是**有没有配生图 key**，不再引入新的环境变量：配了就首页这一张，
    # 没配就一张都不生（整页退回纯文字设计，与从前"未配生图"时逐字节一致）。
    # 少一个旋钮少一处"文档说关了其实没关干净"的机会——这条链路已经踩过
    # 一次那个坑（主题图曾经不读成本笼子，设 0 之后照生，白等 685s）。
    sheet_enabled = _image_generation_configured() and _supports_image_content_parts()
    max_screenshot_verify = _env_budget(
        _ENRICH_MAX_SCREENSHOT_VERIFY_ENV, _ENRICH_MAX_SCREENSHOT_VERIFY_DEFAULT
    )
    shot_used = 0
    sheet_used = 0
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
        # 参照板走**出图受众**那一份：同一批内容，但积木用视觉描述而不是
        # blockRef 的 JSON 形态（见 _monitor_overview_design_brief 的 audience）。
        sheet_brief = _monitor_overview_design_brief(page, datamodel, audience="image")
        # 只有首页那一张（见上面的说明）。
        #
        # 落地页没声明时退回"第一个符合条件的页"——不能因为模型漏填一个字段
        # 就整个应用一张图都没有。按尝试计费：生图失败也算用掉了，否则端点
        # 抖动时这个"一张"会退化成"每页都试一次"。
        page_id_now = str(page.get("id") or "")
        is_landing = bool(landing_ref) and page_id_now == landing_ref
        use_ref = sheet_enabled and sheet_used == 0 and (is_landing or not landing_ref)
        allow_shot = use_ref and shot_used < max_screenshot_verify
        if use_ref:
            sheet_used += 1
        if allow_shot:
            shot_used += 1
        # 参照板（只画会真正生成的那几档真实版式），共用一张。分开生的话
        # 各随机各的，拼起来不像一个产品；共用一张，模型看到的是"这些档本来
        # 就该长成一家人"。device 明说 desktop/phone 时参照板也只画那一档
        # （见 _build_overview_sheet_prompt）——不然会让生图模型白画一块
        # 后面根本不会用来生成设计的版式区，还挤占了真正会用的那档的画布
        # 份额。生图失败返回 None，下面照旧退回纯文字生成。
        page_id = str(page.get("id") or "")
        # 埋点①：参照板生图。单张实测 60~85s，是这一段最贵的一步，也是并行化
        # 收益最大的那一处（见审查文档「八、7」第 2 项）——改造前后就靠这条线对比。
        with _enrich_stage("monitor.sheet", page=page_id, device=device or "unspecified") as _st:
            sheet_b64 = (
                _generate_overview_sheet_b64(
                    sheet_brief, datamodel, theme_id=theme_id, device=device,
                    generated_theme=generated_theme,
                )
                if use_ref
                else None
            )
            # 跳过（非首页/未配生图/通道不支持图片）和真生了图，耗时天差地别，
            # 光看 ms 会以为"生图很快"，得把这一位记下来才看得懂数据。
            _st["got"] = 1 if sheet_b64 else 0
        # 这张图排完版式就该丢了——但它同时也正是应用中心那张卡该显示的画面。
        # 调用方给了收集槽就交一份（见 app_preview：**没给槽就什么都不做**，
        # 所以两个脚本调用方不用改也不会被污染）。生图失败传 None 无害，
        # offer 自己会忽略。
        if preview_sink is not None:
            preview_sink.offer(page_id, sheet_b64, is_landing=bool(landing_ref and page_id == landing_ref))
        try:
            with _enrich_stage("monitor.design", page=page_id, device=device or "unspecified"):
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
            # 2026-07-30：手机那份只在**没明说是桌面档**时才生成。
            #
            # 此前是无条件生成，理由是"两档都得有设计"。但扫了一遍真实数据：
            # 9 个应用的 preferredDevice 全是 desktop——不是因为它们真都是桌面
            # 应用，而是因为生成契约里这个字段**只声明了合法域、没给任何判据**
            # （见 schema_legal 的 Step 8），模型无从选择就一路倒向 desktop。
            # 于是"两档都生成"实际是在为一个没人做过的判断买单。
            #
            # 现在契约里补了姿态判据（_DEVICE_RUBRIC，与入站判定共用同一份），
            # 这个字段有意义了，就该用它来省掉这次调用：明说 desktop 就不生成
            # 手机档（约 67s / 总览页）。unspecified 或没写仍然两档都生成——
            # **只在明确的时候才砍**，判不出来时宁可多花一分钟，也不要让用户
            # 切到手机档看见一个被 CSS 掰弯的桌面版式。
            #
            # 这也正是 M3 WindowWidthSizeClass.fromWidth(w, density,
            # supportedSizeClasses) 的语义：布局声明自己有哪几档，解析器在
            # **现有的**档里挑最合适的，不要求全都存在。少生成一档不是降级，
            # 是如实声明"这个应用只有这一档"。
            declared_desktop_only = device == "desktop"
            if device != "phone" and not declared_desktop_only:
                try:
                    # 埋点③：手机档。注释里写的是约 67s/页，这条线用来核实这个
                    # 数字是否还成立——它同时是"跳过手机档省了多少"的依据。
                    with _enrich_stage("monitor.design", page=page_id, device="phone"):
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
    # no silent caps：一张都没生的时候说清楚是"没配 key"还是"通道不吃图"，
    # 否则现象只是"首页长得比较素"，没人会想到去查配置。
    if not sheet_enabled:
        why = (
            "生图未配置（IMAGE_API_URL / IMAGE_MODEL / IMAGE_API_KEY 需三项齐全）"
            if not _image_generation_configured()
            else "LLM 通道不支持图片输入（LLM_SUPPORTS_IMAGE_CONTENT_PARTS=0）"
        )
        print(f"[freeform_block] 首页参照板已跳过，本次全部走纯文字设计：{why}")
    return model
