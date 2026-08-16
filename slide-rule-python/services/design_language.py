"""第 1.5 步：spec → 这个应用的**设计语言**（风格那一半，注进第 3 步的槽位）。

## 这一步为什么存在

链路原来是「起草规格」直接跳到「逐页画界面」，中间没有"这个应用长什么样"
的环节——于是不管什么业务，出来的都是同一个模子。参照的那批企业级后台
真实产品之所以各有各的样子，是因为每个产品**先定了自己的设计语言**。

## 契约不在这里，这里只出风格

`spec_page_html` 已经把设计系统劈成两半：结构契约由代码拼死（<aside>/<header>/
面包屑/脚本不执行…下游全靠它），**风格**才是可注入的那一半。本模块产出的
就是风格那一半，最终渲染成一段散文塞进 `design_system` 槽位。

⚠ 所以这里**永远不该**出现 <aside>、面包屑、Tailwind 这类词。LLM 一句
  「去掉侧边导航」就能让 page_shell 抠不到壳，而整套外壳判据会静默全绿
  （2026-08-15 当天栽过两次同型）。契约压根不经过这里，也就没机会被写坏。

## LLM 只做判断，格式由代码保证

模型给的是**好判断的东西**：hex 颜色、枚举档位、组件名。DTCG 那种
`{"colorSpace":"srgb","components":[0.15,0.39,0.92],"alpha":1,"hex":"#2563eb"}`
不让它写——归一化浮点与 hex 必须自洽，模型写错了没人拦得住，而这种错
不会报警，只会让颜色悄悄偏掉。要标准格式就由 `to_dtcg()` 从 hex 算出来。

（DTCG = W3C Design Tokens Format Module 2025.10，2025-10-28 出的第一个稳定版，
Figma / Penpot / Style Dictionary 都已支持。用它是为了这份产物能被别的工具吃，
不是为了自己好看。）

## 三层覆盖，人写的永远赢

    design_system="..."   人直接给散文   → 整块用它，**不调 LLM**
    design_language={...} 人给结构化字段 → 盖在生成结果上（逐字段）
    都不给                                → 生成一份

## ⚠ fail-open

生成挂了回落到缺省风格，**不打死整轮**。风格不对顶多难看，而整轮挂掉
是把前面几分钟的 spec 一起烧了。这跟 spec_tree 那条"失败不回落占位"不矛盾:
那份回落的是**内容**（假需求树会骗过下游），这里回落的是**审美**。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

DESIGN_LANGUAGE_VERSION = "design-language-v1"

#: 版式原型。封闭词表——开放词表等于没有词表，模型每轮发明一个新词，
#: 下游没法据此做任何事。词少而稳，比多而飘有用。
LAYOUT_ARCHETYPES = ("看板", "工作台", "台账", "表单", "详情")

#: 密度档位。三档就够，再细模型自己也分不清。
DENSITIES = ("紧凑", "标准", "宽松")

#: 档位 → **具体条款**。这一层由代码展开，不问模型。
#:
#: ## ⚠ 为什么必须展开（2026-08-15 晚，两次对照量出来的）
#:
#: 只把「信息密度标准」四个字塞进提示词，模型能推出的动作很有限。实测：
#:
#:     A 旧提示词（一句话）                 字符 16892/页  面板 16.7  右侧栏 0/3
#:     B 硬写死密度条款（统计卡/面板/列数）  字符 25838/页  面板 22.3  右侧栏 3/3
#:     C 换成生成的设计语言（只给档位词）    字符 18748/页  面板 17.8  右侧栏 0/4
#:
#: B 涨的那 53% 全来自**具体条款**，不是来自"密度"这个词。C 把条款撤了、
#: 只留档位词，密度就掉回去了。
#:
#: 所以分工是：**档位是模型的判断，档位具体意味着什么是代码的事**——
#: 跟 DTCG 那条同源（模型给 hex，分量由代码算）。这样既不写死风格
#: （模型仍可选紧凑/标准/宽松，甚至由人覆盖），又不让"密度"变成一句空话。
_DENSITY_RULES = {
    "紧凑": (
        "顶部一组统计卡（4~6 个），每个卡有指标名、大号数值、单位，"
        "以及同比/环比或状态说明这类第二行小字。"
        "主区至少 4 个信息面板，每个面板有标题栏，标题栏右侧放该面板自己的操作。"
        "主表格至少 8 列，带行内状态标签、行内操作列、表头，以及分页或「共 N 条」统计。"
        "字号偏小、行高偏紧，一屏要能看到尽量多的行。"
    ),
    "标准": (
        "顶部一组统计卡（3~5 个），每个卡有指标名、大号数值、单位，"
        "以及同比/环比或状态说明这类第二行小字。"
        "主区至少 3 个信息面板，每个面板有标题栏，标题栏右侧放该面板自己的操作。"
        "主表格至少 6 列，带行内状态标签、行内操作列、表头，以及分页或「共 N 条」统计。"
        "该有筛选区就写筛选区（日期范围、下拉、搜索框、重置按钮排成一行）。"
    ),
    "宽松": (
        "顶部一组统计卡（3 个左右）。主区 2~3 个信息面板，每个面板有标题栏。"
        "主表格 5 列上下，留白多一些，字号和行高都偏大。"
    ),
}

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

#: 缺省设计语言。**没人指定时的兜底**，不是"推荐配置"。
DEFAULT_DESIGN_LANGUAGE: Dict[str, Any] = {
    "version": DESIGN_LANGUAGE_VERSION,
    "tone": "企业后台风格，浅色底",
    "primary": "#2563eb",
    "accent": "#0f172a",
    "radius": "8px",
    "density": "标准",
    "components": [],
    "charts": False,
}


def _clean_str(v: Any, limit: int) -> str:
    return " ".join(str(v or "").split())[:limit]


def normalize_design_language(raw: Any) -> Dict[str, Any]:
    """把模型给的东西收进封闭形状。**不合规的字段丢掉换缺省，不抛。**

    ⚠ 逐字段兜底而不是整份丢：模型常常九个字段对、一个字段瞎写，
      整份丢等于把对的那九个也扔了。
    """
    src = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULT_DESIGN_LANGUAGE)

    tone = _clean_str(src.get("tone"), 60)
    if tone:
        out["tone"] = tone

    for key in ("primary", "accent"):
        val = _clean_str(src.get(key), 7)
        if _HEX.match(val):
            out[key] = val.lower()

    radius = _clean_str(src.get("radius"), 12)
    if re.match(r"^\d{1,2}px$", radius):
        out["radius"] = radius

    if src.get("density") in DENSITIES:
        out["density"] = src["density"]

    comps = src.get("components")
    if isinstance(comps, list):
        seen: List[str] = []
        for c in comps:
            name = _clean_str(c, 12)
            if name and name not in seen:
                seen.append(name)
        out["components"] = seen[:8]

    out["charts"] = bool(src.get("charts"))
    return out


def merge_override(base: Dict[str, Any], override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """人写的字段盖在生成结果上。**只盖给出来的那几个**。

    ⚠ 不做深合并：这份结构是平的，深合并只会在"空列表算不算覆盖"这种
      问题上产生分歧。给了就盖，没给就留着。
    """
    if not isinstance(override, dict) or not override:
        return dict(base)
    out = dict(base)
    for k, v in override.items():
        if v is None:
            continue
        out[k] = v
    return normalize_design_language(out)


def render_design_language(dl: Optional[Dict[str, Any]]) -> str:
    """设计语言 → 塞进 `design_system` 槽位的那段散文。**纯函数，零 LLM。**

    ⚠ 由代码渲染而不是让模型直接写散文：这样覆盖才能是**逐字段**的，
      而且同一份输入永远渲染出同一段话（模型写散文每次都不一样，
      等于同一个应用两次生成两种样子）。
    """
    d = normalize_design_language(dl or DEFAULT_DESIGN_LANGUAGE)
    bits = [f"{d['tone']}。"]
    bits.append(f"主色 {d['primary']}，强调色 {d['accent']}，圆角 {d['radius']}。")
    # ⚠ 档位要**展开成具体条款**再进提示词：只写"信息密度标准"四个字，
    #   模型推不出该画几个统计卡、几个面板、表格几列——实测密度会掉回去。
    #   见 _DENSITY_RULES 头上那三行对照数据。
    bits.append(f"这是给天天用它干活的人看的后台，不是落地页。{_DENSITY_RULES[d['density']]}")
    if d["components"]:
        bits.append("按内容需要用这些组件（不要硬凑）：" + "、".join(d["components"]) + "。")
    if d["charts"]:
        bits.append("这类页面适合配图表，用内联 SVG 画出坐标轴与图例。")
    return "\n".join(bits)


def build_design_language_prompt(spec: Dict[str, Any]) -> List[Dict[str, str]]:
    """按 spec 问一次「这个应用该长什么样」。

    只喂**页面清单与用途**，不喂整棵需求树：定风格要的是"这是个什么应用"，
    倒整棵树进去既贵又会把模型注意力拖到细节上。
    """
    pages = [
        f"- {p.get('name', '')}：{p.get('purpose', '') or p.get('audience', '')}"
        for p in (spec.get("pages") or [])
        if isinstance(p, dict)
    ]
    app = _clean_str(spec.get("appName"), 40)
    body = (
        f"应用名：{app or '（未命名）'}\n"
        f"页面清单：\n" + ("\n".join(pages[:12]) or "（空）")
    )
    return [
        {
            "role": "system",
            "content": (
                "你是资深 B 端产品设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
                "只谈风格，不要谈页面结构或具体标签。只返回 JSON。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"{body}\n\n"
                "按这个形状返回 JSON：\n"
                "{\n"
                '  "tone": "一句话风格基调，30 字以内，例如「克制的企业后台，浅色底，弱化装饰」",\n'
                f'  "primary": "主色 hex，形如 #2563eb",\n'
                f'  "accent": "强调色 hex",\n'
                '  "radius": "圆角，形如 8px",\n'
                f'  "density": "信息密度，只能是 {"/".join(DENSITIES)} 之一",\n'
                '  "components": ["这个应用用得上的组件名，3~6 个，例如 状态标签、进度条、时间线"],\n'
                '  "charts": true 或 false（这个应用是否适合配图表）\n'
                "}\n\n"
                "要求：颜色要贴合业务气质（医疗偏冷静、金融偏稳重、工具偏中性），"
                "不要用高饱和撞色。只返回 JSON，不要解释。"
            ),
        },
    ]


def generate_design_language(
    spec: Dict[str, Any],
    *,
    llm_json_fn: Optional[Any] = None,
    override: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """生成这个应用的设计语言。**挂了回落缺省，不抛。**

    ⚠ fail-open 的理由见模块头：这一步产出的是审美，不是内容。
      挂掉就用缺省风格接着画，比把整轮打死好。
    """
    from .spec_llm_call import call_spec_json

    dl = dict(DEFAULT_DESIGN_LANGUAGE)
    try:
        outcome = call_spec_json(
            build_design_language_prompt(spec), llm_json_fn, stage="specfirst.design"
        )
        if outcome.payload is not None:
            dl = normalize_design_language(outcome.payload)
        else:
            print(f"[design_language] 生成失败，用缺省风格：{outcome.failure}")
    except Exception as exc:  # noqa: BLE001 — 审美挂了不该打死整轮
        print(f"[design_language] 生成抛错，用缺省风格：{str(exc)[:200]}")
    return merge_override(dl, override)


def to_dtcg(dl: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """渲染成 W3C Design Tokens Format 2025.10 的形状。

    ⚠ 由**代码**从 hex 算出 components/alpha，不让模型写：那三个数跟 hex
      必须自洽，模型写偏了不会有任何一处报警，颜色只是悄悄不对。

    颜色值形状照规范：{"colorSpace":"srgb","components":[r,g,b],"alpha":1,"hex":"#.."}
    尺寸值形状照规范：{"value":8,"unit":"px"}
    """
    d = normalize_design_language(dl or DEFAULT_DESIGN_LANGUAGE)

    def color(hex_str: str) -> Dict[str, Any]:
        h = hex_str.lstrip("#")
        comps = [round(int(h[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)]
        return {
            "colorSpace": "srgb",
            "components": comps,
            "alpha": 1,
            "hex": f"#{h.lower()}",
        }

    return {
        "color": {
            "$type": "color",
            "primary": {"$value": color(d["primary"])},
            "accent": {"$value": color(d["accent"])},
        },
        "radius": {
            "$type": "dimension",
            "base": {"$value": {"value": int(d["radius"][:-2]), "unit": "px"}},
        },
    }
