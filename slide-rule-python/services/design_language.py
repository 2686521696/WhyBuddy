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


# ── 风格段改由 LLM 现写（2026-08-16）─────────────────────────────────
#
# ## 为什么换掉确定性渲染
#
# 用户裁决：「a 就算内容再多也是写死的」。上面那套 render_design_language
# 是**代码写句式、模型填字段**——密度条款、组件那句、图表那句，措辞全是常量，
# 换哪个业务都是同一段话。实测两个完全不同业务的最终提示词逐字相同 92.8%。
#
# 对照实验（同一份 spec 两臂，唯一变量是这一段）：
#
#     跨业务相同度   确定性 92.8%   LLM 现写 81.7%   ← 后者是唯一越过 87% 那条
#                                                     历史基准线的
#     面板/页        21.3          15.8
#     交互控件/页    18.0           9.0
#
# 多样性是真的，密度腰斩也是真的。**但密度那一半是实现缺陷，不是路线代价**：
# 那次 B 臂的风格段是**应用级**的，而模型自发写成了逐页版式计划——于是
# p1 的提示词里塞着 p2/p3/p4 该怎么排。所以这里改成**一次调用出两层**：
#
#     app    应用级基调（配色、圆角、气质）——全应用共用，页面才像同一个产品
#     pages  逐页版式计划——每页只拿自己那份
#
# ⚠ 仍然一个字都不写死：密度、组件、图表用不用，全由模型自己定。
#   代码只负责"把它的判断准确地送到该去的地方"。
#
# ⚠ 确定性那套**不删**：它是这一步挂掉时的回落。审美挂了不该打死整轮。

STYLE_BRIEF_VERSION = "style-brief-v1"

#: 结构词。风格段里出现它们就是在碰契约——模型一句"去掉侧边导航"能让
#: page_shell 抠不到壳，而整套外壳判据会静默全绿（2026-08-15 栽过两次）。
#: ⚠ 契约本来就压在风格段后面且写明"冲突时以这一节为准"，所以这里**只清洗
#:   不失败**：为一句措辞把整页打掉，代价比留着大。
_STRUCTURAL_WORDS = (
    "<aside", "aside>", "侧边栏", "侧栏", "面包屑", "breadcrumb", "Breadcrumb",
    "<header", "<main", "<nav", "Tailwind", "tailwind", "<script",
)


def _scrub(text: str, limit: int) -> str:
    """去掉结构词所在的那一句，其余保留。"""
    out = []
    for seg in re.split(r"(?<=[。；;.\n])", " ".join(str(text or "").split())):
        if seg and not any(w in seg for w in _STRUCTURAL_WORDS):
            out.append(seg)
    return "".join(out).strip()[:limit]


def normalize_style_brief(raw: Any, page_ids: List[str]) -> Dict[str, Any]:
    """收进封闭形状。**逐字段兜底，不整份丢。**"""
    src = raw if isinstance(raw, dict) else {}
    pages_src = src.get("pages") if isinstance(src.get("pages"), dict) else {}
    pages = {}
    for pid in page_ids:
        got = _scrub(pages_src.get(pid), 400)
        if got:
            pages[pid] = got
    return {
        "version": STYLE_BRIEF_VERSION,
        "app": _scrub(src.get("app"), 300),
        "pages": pages,
    }


def style_brief_ok(brief: Optional[Dict[str, Any]], page_ids: List[str]) -> bool:
    """够不够用。**应用级基调必须有**，逐页计划缺几页可以容忍（那几页退回只用基调）。"""
    if not isinstance(brief, dict) or not str(brief.get("app") or "").strip():
        return False
    return bool(brief.get("pages"))


def style_for_page(brief: Optional[Dict[str, Any]], page_id: str) -> str:
    """拼出**这一页**的风格段：应用级基调 + 它自己那份版式计划。

    ⚠ 只给自己那份。B 臂那次把四页的计划一起塞进每一页，是密度腰斩的主因。
    """
    if not isinstance(brief, dict):
        return ""
    bits = [str(brief.get("app") or "").strip()]
    own = str((brief.get("pages") or {}).get(page_id) or "").strip()
    if own:
        bits.append(own)
    return "\n".join(b for b in bits if b)


def build_style_brief_prompt(spec: Dict[str, Any]) -> List[Dict[str, str]]:
    """问一次「这个应用长什么样 + 每一页怎么排」。

    ## ⚠ 逐个点名面板，是量出来的（2026-08-16，同一份 spec 四臂）

        臂                      面板   图表   表格列数   标题   文字量
        A 写死密度条款          21.3   0.3    5.5       4.8    599
        C LLM逐页（只问分几区） 14.5   0.3    3.8       2.5    526
        D C + 逐个点名面板      11.3   1.5    5.3       5.5    546

    D 把**表格列数追回了 A 的水平**（3.8→5.3）、图表翻五倍、标题最多。

    ⚠ 「面板」那一列反而更低，而这是**指标在骗人**：它数的是圆角+边框的容器，
      chip / 徽标 / 内层小盒子全算。A 的密度条款催生大量嵌套小盒子把数刷高了。
      看渲染图：D 的看板每张统计卡里带 sparkline、主图带完整坐标轴、
      右侧环形仪表——视觉信息量不低于 A，只是盒子少。

    ⚠ 明写「不要为了凑数硬加」：D 的销课台只点了 4 个面板（大扫码框 + 会员
      核验卡 + 课包卡 + 流水），而 A 被密度条款催出 25 个。**对一个前台
      销课页，少才是对的**——密度不该是无条件的。
    """
    pages = [p for p in (spec.get("pages") or []) if isinstance(p, dict) and p.get("id")]
    listing = "\n".join(
        f'- {p["id"]}｜{p.get("name","")}：{p.get("purpose","") or p.get("audience","")}'
        for p in pages
    )
    ids = "、".join(str(p["id"]) for p in pages)
    return [
        {"role": "system", "content": (
            "你是资深 B 端产品设计师。给这个应用定视觉风格，并为每一页定版式计划。"
            "**只谈风格与版面**：气质基调、配色、圆角、字号、一屏放多少东西、"
            "用哪些组件、要不要图表、各区怎么分。"
            "**不要提任何 HTML 标签，不要提侧边导航/面包屑这类外壳结构，不要提技术栈**"
            "——那些由另一套约束负责，你写了会打架。只返回 JSON。"
        )},
        {"role": "user", "content": (
            f"应用名：{_clean_str(spec.get('appName'), 40) or '（未命名）'}\n"
            f"页面清单：\n{listing}\n\n"
            "返回 JSON：\n"
            '{\n'
            '  "app": "应用级基调，80~150 字：气质、主色 hex、强调色 hex、圆角、字号密度。'
            '这一段全应用共用，页面才像同一个产品。",\n'
            f'  "pages": {{ 每个页面 id 一段版式计划，200~350 字（id 是：{ids}）}}\n'
            '}\n\n'
            # ★ 逐个点名（2026-08-16 对照实验落地）：只问"分几个区"时模型给的是
            #   笼统描述；逼它把面板写成清单之后，表格列数从 3.8 回到 5.3、
            #   图表 0.3→1.5、标题 2.5→5.5。见函数 docstring 里的四臂数据。
            "每页那段必须**把这一页要放的面板逐个点名**，写成清单：每个面板叫什么、"
            "放什么内容、大概占多大。这一页该放几个面板由你按它的活儿定——"
            "台账类通常要得多，扫码核销这类专注操作的页面要得少，不要为了凑数硬加。"
            "点名之后再补：统计卡几张分别是什么指标、主表几列分别是哪些列、"
            "配不配图表配哪种、有没有右侧详情栏。"
        )},
    ]


def generate_style_brief(
    spec: Dict[str, Any],
    *,
    llm_json_fn: Optional[Any] = None,
) -> Optional[Dict[str, Any]]:
    """一次调用出两层风格。**挂了返回 None**，由调用方回落到确定性那套。"""
    page_ids = [str(p.get("id")) for p in (spec.get("pages") or [])
                if isinstance(p, dict) and p.get("id")]
    if not page_ids:
        return None
    from .spec_llm_call import call_spec_json

    try:
        outcome = call_spec_json(
            build_style_brief_prompt(spec),
            llm_json_fn,
            stage="specfirst.design",
        )
    except Exception as exc:  # noqa: BLE001 — 审美挂了不该打死整轮
        print(f"[design_language] 风格段生成抛错：{str(exc)[:200]}")
        return None
    if outcome.payload is None:
        print(f"[design_language] 风格段生成失败：{outcome.failure}")
        return None
    brief = normalize_style_brief(outcome.payload, page_ids)
    if not style_brief_ok(brief, page_ids):
        print("[design_language] 风格段内容不够用（缺应用级基调或全部逐页计划）")
        return None
    return brief
