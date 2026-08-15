"""第 3.5 步：把多页 HTML 的**外壳**统一成一套（零 LLM 调用）。

## 病灶：三个页面是三个产品

第 3 步逐页独立生成 HTML，每页各自发明自己的导航、侧栏、Header。
2026-08-13 量了一轮真实产物（同一份 spec 的三页）：

    页面   产品名          登录用户                    菜单项
    p1    智维工单        李师傅 · 维修一组 · 维修工     6
    p2    维保云          李主管 · 维修主管             6
    p3    智维运维平台     李晓雯 · 行政部 · 普通员工     11

**三个产品名、三个登录人、三套菜单。** 而且 p3 的菜单列了 8 个页面入口，
可 spec 里只有 3 页——它凭空发明了 5 个不存在的页面。

这不是"菜单不稳"，是根本不像同一个应用。V5.9 架构图的已知缺口里记着这一条
（「菜单在多次生成之间不稳……应该由 spec 的页面清单锚定，不该让图去投票。
这一项目前没有判据在守」），现在补上判据。

## 为什么**不**用 Readability.js

Readability 干的正是这件事的反面（剥掉导航侧栏、留下正文），思路对得上。
但它用不上，理由是实测的：**9/9 份第 3 步产物都规规矩矩用了
`<aside>` + `<header>` + `<main>` + `<nav>`**，壳占 20~26%。

Readability 存在的理由是"真实网页乱七八糟、没人用语义标签，只能靠启发式猜
内容边界"。我们这份 HTML 是自己的提示词生成的，边界**已经标好了**——再上一个
启发式库，是拿猜的去替代已知的，只会更差，还多一个依赖。

所以借它的思路（壳与内容是两回事，可以分开处理），不借它的实现。

## 做法：取一页的壳当模板，但导航按 spec 重排

用户裁决的是"取其中一个页面的壳共用"。这里在那之上多做一步——**导航项按
spec 的页面清单重排**，而不是照抄被选中那页的菜单。理由就是上面 p3 那 8 项：
照抄等于把"发明了 5 个不存在的页面"这个错误扩散到所有页上。

    壳（侧栏外框 / Header / 产品名 / 登录人）  → 取一页，整体复用
    导航项                                  → 按 spec.pages 重新生成

导航项的生成沿用 G2 实验验过的那条契约：**留一个当模板，按清单重复它**
（见 experiments/visual-first/g2_render_test.mjs）。激活态怎么认不写死类名——
比较各链接的 class 词集，**所有链接都有的是基座，只有某一个有的就是激活标记**，
这样换一套配色/命名也不用改代码。图标按位置复用源导航的，不够就循环，
免得所有菜单项长成同一个图标。
"""

from __future__ import annotations

import re
from html import escape
from typing import Any, Dict, List, Optional, Tuple

PAGE_SHELL_VERSION = "page-shell-v1"

_ASIDE = re.compile(r"<aside\b[\s\S]*?</aside>", re.I)
_HEADER = re.compile(r"<header\b[\s\S]*?</header>", re.I)
_NAV = re.compile(r"<nav\b[\s\S]*?</nav>", re.I)
_LINK = re.compile(r"<a\b[^>]*>[\s\S]*?</a>", re.I)
_CLASS = re.compile(r'class="([^"]*)"', re.I)
_SVG = re.compile(r"<svg\b[\s\S]*?</svg>", re.I)
#: 内容区容器的开标签。抠的是 class，因为**位移全写在 class 上**
#: （`ml-64` / `ml-[248px]` / `flex-1`）。
_MAIN_OPEN = re.compile(r"<main\b[^>]*>", re.I)


class PageShellError(RuntimeError):
    """统一外壳失败。**不回落**——半套壳比原来那三套还糟。"""


def extract_shell(markup: str) -> Dict[str, str]:
    """抠出一页的壳：`<aside>` 与 `<header>` 两段原文。

    抠不到就返回空串，由调用方判断——这里不抛，因为"这一页没有壳"本身
    是合法的（比如向导页可能故意不放侧栏）。
    """
    aside = _ASIDE.search(markup or "")
    header = _HEADER.search(markup or "")
    return {
        "aside": aside.group(0) if aside else "",
        "header": header.group(0) if header else "",
    }


def _class_tokens(link: str) -> List[str]:
    m = _CLASS.search(link)
    return m.group(1).split() if m else []


def nav_templates(nav_html: str) -> Optional[Dict[str, Any]]:
    """从一段 `<nav>` 里拆出「基座链接 / 激活链接 / 图标列表」。

    激活态**不写死类名**：把各链接的 class 词集取交集当基座，只出现在某一个
    链接上的词就是激活标记。换配色、换命名（active / is-current / 自定义）
    都不用改这里。

    取不到链接返回 None，调用方回落成"这一页不重排导航"。
    """
    links = _LINK.findall(nav_html or "")
    if len(links) < 2:
        return None
    token_sets = [set(_class_tokens(a)) for a in links]
    base = set.intersection(*token_sets) if token_sets else set()
    # ⚠ 认激活链接时**先把状态变体剔掉**（2026-08-15）。
    #
    # 真机形状（汽修那趟）：
    #     base_class   = flex font-medium items-center px-4 py-3 rounded-lg …
    #     active_class = base + **hover:bg-slate-50**
    #
    # `hover:` 是悬停样式，鼠标不放上去**没有任何视觉差别**——于是
    # aria-current 打对了、判据也绿了，界面上却看不出当前页在哪。
    # 又一次「闸绿了但功能没生效」。
    #
    # Tailwind 的变体一律带冒号（hover: / focus: / dark: / md: / group-hover:），
    # 它们都不能表示一个**持续**的激活状态，所以按冒号一刀切掉。
    def _stable(ts: set) -> set:
        return {t for t in ts if ":" not in t}

    stable_sets = [_stable(ts) for ts in token_sets]
    stable_base = _stable(base)
    extras = [len(ts - stable_base) for ts in stable_sets]
    active_idx = extras.index(max(extras)) if max(extras) > 0 else 0
    # 激活 class 也只留稳定词：把 hover: 抄过去等于抄了个空。
    active_tokens = sorted(stable_sets[active_idx]) if max(extras) > 0 else sorted(stable_base)
    icons = [(_SVG.search(a).group(0) if _SVG.search(a) else "") for a in links]
    return {
        "link": links[0 if active_idx != 0 else -1],  # 拿一个**非激活**的当基座
        "base_class": " ".join(sorted(base)),
        "active_class": " ".join(active_tokens),
        "icons": icons,
    }


#: 源导航本来就没有激活样式时的兜底。挂在 `aria-current="page"` 上，
#: 而 aria-current 是 build_nav_items 一定会打的，所以不依赖任何 class 命名。
#:
#: ⚠ 用 `currentColor` 派生而不是写死颜色：侧栏可能是白底也可能是深色底
#:   （真机两种都见过），写死 `bg-slate-100` 在深色侧栏上等于没有。
_ACTIVE_FALLBACK_CSS = (
    "<style>[aria-current=\"page\"]{"
    "background-color:color-mix(in srgb, currentColor 12%, transparent);"
    "font-weight:600}</style>"
)

#: 面包屑那个 nav。**两种都认**：
#:   · APG 标准写法 `<nav aria-label="Breadcrumb">`
#:   · 真机上模型常写的裸 nav（无 aria-label，用 <span> + 图标分隔符）
#: ⚠ 第一版只认前者，真机（烘焙那趟 ouyi）四页的面包屑全是后者——
#:   修复静静地不生效，没有报错、没有告警、判据全绿。
_BREADCRUMB_NAV = re.compile(
    r'<nav\b[^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?</nav>', re.I
)
#: header 里的第一个 nav（回落用）。header 里通常只有面包屑一个 nav；
#: 侧栏导航在 <aside> 里，不会被这条捞到。
_ANY_NAV = re.compile(r"<nav\b[^>]*>[\s\S]*?</nav>", re.I)

#: 带 aria-current="page" 的那个元素（**任意标签**）。
#: W3C ARIA APG 的 Breadcrumb 模式规定当前项打这个属性：
#:
#:     <li><a href="./breadcrumb.html" aria-current="page">Breadcrumb Example</a></li>
#:
#: （拉了官方示例源码对照：aria-practices/content/patterns/breadcrumb/examples/breadcrumb.html）
#: Bootstrap / Ant Design / Tailwind UI 的面包屑组件都照这个出。
#:
#: ⚠ 认 aria-current 而不是认 `<li>`：真机上模型写过 <span>、<a>、<li> 三种，
#:   按结构猜必然漏。而这个属性是**标准**，且我们侧栏已经在用、已经验证能
#:   穿过消毒器——不另造 data-crumb-current，词表分叉是下一个对不齐的地方。
_ARIA_CURRENT_EL = re.compile(
    r'<(\w+)\b[^>]*aria-current="page"[^>]*>([\s\S]*?)</\1>', re.I
)

#: 回落：认不出 aria-current 时取最后一个"文本节"。
#: ⚠ 不能用「负向前瞻找最后一个」那种写法：惰性组会一路吞到最后一个闭合标签，
#:   等于从**第一个**节替换到末尾。真机上当场把「首页 ›」连同分隔符一起吃掉。
_CRUMB_SEG = re.compile(r"<(li|span|a)\b[^>]*>[^<>]*</\1>", re.I)
_SEG_INNER = re.compile(r"(<\w+\b[^>]*>)([\s\S]*)(</\w+>)", re.I)


def _breadcrumb_nav(header_html: str) -> Optional[re.Match]:
    return _BREADCRUMB_NAV.search(header_html or "") or _ANY_NAV.search(header_html or "")


def set_breadcrumb_current(header_html: str, page_name: str) -> str:
    """把面包屑的**当前节**换成当前页名。

    ## 为什么需要

    外壳统一是整段复制 `<header>`，而面包屑就住在 header 里——于是各页的
    面包屑全都写着源页那一节。真机（汽修）：p3 是库存明细页，面包屑却写
    「首页 › 服务接车」。壳里的东西必然各页相同，而面包屑最后一节
    **本来就该各页不同**，得单独留个位置。

    ## 怎么认「当前节」——照 W3C ARIA APG

    优先认 `aria-current="page"`（APG Breadcrumb 模式的标准标记，
    Bootstrap / antd / Tailwind UI 都这么出）。认不到才回落到"最后一个文本节"。

    ⚠ **第一版只认 `<nav aria-label="Breadcrumb">` 里的 `<li>`**，那是从
      汽修那一趟的 markup 抄的结构。烘焙那趟 ouyi 写的是裸 `<nav>` + `<span>`
      + 图标分隔符，四页面包屑一模一样——**修复静静地不生效**，没有报错、
      没有告警、判据全绿，我差点把它记成「没触发」。
      拿一个样本的 markup 当通用结构，这是同一类错误的第五次。

    ⚠ 前面的层级（首页 › 模块）原样留着：那几节是应用结构，本该各页一样。
    ⚠ 找不到面包屑就原样返回——没有面包屑是合法的，硬塞一个是新的破坏。
    """
    if not page_name:
        return header_html
    nav = _breadcrumb_nav(header_html)
    if not nav:
        return header_html
    body = nav.group(0)

    cur = _ARIA_CURRENT_EL.search(body)
    if cur:
        replaced = body[: cur.start()] + _SEG_INNER.sub(
            lambda m: m.group(1) + escape(page_name) + m.group(3), cur.group(0), count=1
        ) + body[cur.end():]
        return header_html.replace(body, replaced, 1)

    segs = [m for m in _CRUMB_SEG.finditer(body) if m.group(0).strip()]
    if not segs:
        return header_html
    last = segs[-1]
    replaced = (
        body[: last.start()]
        + _SEG_INNER.sub(lambda m: m.group(1) + escape(page_name) + m.group(3), last.group(0), count=1)
        + body[last.end():]
    )
    return header_html.replace(body, replaced, 1)


def _set_class(link: str, value: str) -> str:
    if _CLASS.search(link):
        return _CLASS.sub(f'class="{value}"', link, count=1)
    return link.replace("<a", f'<a class="{value}"', 1)


def _set_label(link: str, icon: str, label: str) -> str:
    """把链接内部换成「图标 + 文案」。

    整段替换而不是找文本节点：链接里通常是 `<svg/>` 加一个 `<span>`，也可能是
    裸文本，还可能夹着徽标。整段换掉最稳，代价是丢掉徽标那类装饰——
    那正是应该丢的（每页各编一个数字徽标也是"不像同一个应用"的一部分）。
    """
    inner = f"{icon}<span>{label}</span>" if icon else f"<span>{label}</span>"
    return re.sub(r"(<a\b[^>]*>)[\s\S]*(</a>)", lambda m: m.group(1) + inner + m.group(2), link, count=1)


def build_nav_items(
    templates: Dict[str, Any], spec_pages: List[Dict[str, Any]], current_page_id: str
) -> str:
    """按 spec 的页面清单生成导航项。

    沿用 G2 实验验过的契约：留一个当模板，按清单重复它
    （experiments/visual-first/g2_render_test.mjs）。图标按位置复用源导航的，
    不够就循环——不然所有菜单项会长成同一个图标。
    """
    icons = [i for i in templates["icons"] if i] or [""]
    out: List[str] = []
    for i, page in enumerate(spec_pages):
        name = str(page.get("name") or page.get("id") or "").strip()
        is_current = str(page.get("id") or "") == current_page_id
        link = _set_class(
            templates["link"],
            templates["active_class"] if is_current else templates["base_class"],
        )
        link = _set_label(link, icons[i % len(icons)], name)
        # ⚠ 导航项必须带页面 id（2026-08-14）。宿主要把点击映射回"切到哪一页"，
        #   而**靠标签文字匹配是不行的**：名字可以重复、可以带图标字符、可以被
        #   模型改写成另一种说法。这条跟 data-* 绑定孔是同一条纪律——
        #   界面上的东西要能指回声明，就得有 id，不能靠人眼看得懂的那串字。
        page_id = str(page.get("id") or "").strip()
        if page_id:
            link = link.replace("<a", f'<a data-page-id="{escape(page_id, quote=True)}"', 1)
        if is_current:
            link = link.replace("<a", '<a aria-current="page"', 1)
        out.append(link)
    return "\n".join(out)


_CN_TEXT = re.compile(r">([^<>]+)<")


def detect_brand_and_role(aside_html: str) -> Tuple[str, str]:
    """从一段侧栏里认出「模型编的产品名」和「模型编的角色」。

    启发式：侧栏里**第一段中文**是产品名，**最后一段中文**是角色。
    这不是拍脑袋——拿 9 份真实产物验过，9/9 命中：

        r1/T_p1  首「智维工单」    末「维修主管」
        r2/T_p3  首「智维运维平台」 末「行政部 · 普通员工」
        r3/T_p2  首「维保云」      末「维修主管」

    ⚠ 但它终究是启发式，认错了不会自己喊。所以**替换完必须有一道硬校验**
    （check_shell_consistency 里那条 appName）：spec 的名字必须出现在每一页、
    旧名字必须一处不剩。认错就当场报出来，绝不半改——半改比不改更糟，
    那会出现"侧栏是新名字、顶栏还是旧名字"这种没人看得懂的中间态。
    """
    texts = [s.strip() for s in _CN_TEXT.findall(aside_html or "") if s.strip()]
    texts = [s for s in texts if re.search(r"[\u4e00-\u9fff]", s)]
    if not texts:
        return "", ""
    return texts[0], texts[-1]


def _apply_identity(shell_part: str, old: str, new: str) -> str:
    """整段替换产品名 / 角色。空值或没变化时原样返回。"""
    if not old or not new or old == new:
        return shell_part
    return shell_part.replace(old, new)


def _pick_shell_source(pages_html: Dict[str, str]) -> str:
    """选哪一页的壳当模板：**导航链接最多的那一页**。

    不是因为它"更对"（p3 那页恰恰发明了 5 个不存在的入口），而是因为链接越多、
    可复用的图标模板越多。导航内容反正要按 spec 重排，被选中那页菜单里的
    错误不会被带过去——留下的只有它的视觉外框。
    """
    best, best_n = "", -1
    for page_id, markup in pages_html.items():
        nav = _NAV.search(extract_shell(markup)["aside"] or markup)
        n = len(_LINK.findall(nav.group(0))) if nav else 0
        if n > best_n:
            best, best_n = page_id, n
    return best


def _pick_shell_source_phone(pages_html: Dict[str, str]) -> str:
    """移动端选源页：**页面级 <nav>（底部标签栏）链接最多的那页**。

    与桌面 _pick_shell_source 同一动机（图标模板越多越好），差别只在
    移动端的导航不在 <aside> 里——设计系统明说了不要侧栏。
    """
    best, best_n = "", -1
    for page_id, markup in pages_html.items():
        nav = _NAV.search(markup or "")
        n = len(_LINK.findall(nav.group(0))) if nav else 0
        if n > best_n:
            best, best_n = page_id, n
    return best


def _unify_shell_phone(pages_html: Dict[str, str], spec: Dict[str, Any]) -> Dict[str, Any]:
    """移动端（竖屏）的壳统一：<header> 顶栏 + 页面级 <nav> 底部标签栏。

    与桌面版同一套病灶与药方（各页各编产品名/登录人/菜单 → 取一页的壳
    整体复用，导航按 spec.pages 重排），只是壳的部件不同：
    没有 <aside>，产品名和角色在 <header> 里认。
    """
    spec_pages = list(spec.get("pages") or [])
    source_id = _pick_shell_source_phone(pages_html)
    src = pages_html[source_id]
    header_m = _HEADER.search(src)
    nav_m = _NAV.search(src)
    if not header_m and not nav_m:
        raise PageShellError(f"选中的源页 {source_id} 既没有 <header> 也没有 <nav>，抠不出移动壳")

    header = header_m.group(0) if header_m else ""
    app_name = str(spec.get("appName") or "").strip()
    personas = list(spec.get("personas") or [])
    role = str((personas[0] or {}).get("name") or "").strip() if personas else ""
    old_brand, old_role = detect_brand_and_role(header)
    header = _apply_identity(header, old_brand, app_name)
    header = _apply_identity(header, old_role, role)

    templates = nav_templates(nav_m.group(0)) if nav_m else None

    out: Dict[str, str] = {}
    for page_id, markup in pages_html.items():
        html = markup
        if header:
            html = _HEADER.sub(lambda _m: header, html, count=1) if _HEADER.search(html) else html
        if templates and nav_m:
            items = build_nav_items(templates, spec_pages, page_id)
            new_nav = re.sub(
                r"(<nav\b[^>]*>)[\s\S]*(</nav>)",
                lambda m: m.group(1) + "\n" + items + "\n" + m.group(2),
                nav_m.group(0),
                count=1,
            )
            html = _NAV.sub(lambda _m: new_nav, html, count=1) if _NAV.search(html) else html
        out[page_id] = html

    return {
        "version": PAGE_SHELL_VERSION,
        "sourcePageId": source_id,
        "navAnchored": bool(templates),
        "navItems": [
            {"id": str(p.get("id") or ""), "name": str(p.get("name") or p.get("id") or "")}
            for p in spec_pages
        ],
        "appName": app_name or old_brand,
        "personaRole": role or old_role,
        "pages": out,
    }


def unify_shell(
    pages_html: Dict[str, str], spec: Dict[str, Any], *, device: str = "desktop"
) -> Dict[str, Any]:
    """把多页 HTML 的壳统一成一套，导航按 spec.pages 重排。零 LLM 调用。

    device（2026-08-14 晚加）：`"phone"` 走移动分支（<header> + 页面级
    <nav> 底部标签栏，没有 <aside>）。词表沿用 device_policy 的 Device。

    返回 {"version", "sourcePageId", "pages": {page_id: html}, "navItems": [...]}。
    """
    if not pages_html:
        raise PageShellError("没有任何页面可统一")
    spec_pages = list(spec.get("pages") or [])
    if not spec_pages:
        raise PageShellError("spec 里没有页面清单，导航无从锚定")
    if device == "phone":
        return _unify_shell_phone(pages_html, spec)

    source_id = _pick_shell_source(pages_html)
    shell = extract_shell(pages_html[source_id])
    if not shell["aside"] and not shell["header"]:
        raise PageShellError(f"选中的源页 {source_id} 既没有 <aside> 也没有 <header>，抠不出壳")

    # 产品名与角色：spec 里有就按 spec 灌，没有就保持模型编的那一套。
    # 保持也算合格——统一是本模块的职责，起名不是；spec 没给就不该由这里发明。
    app_name = str(spec.get("appName") or "").strip()
    personas = list(spec.get("personas") or [])
    role = str((personas[0] or {}).get("name") or "").strip() if personas else ""
    old_brand, old_role = detect_brand_and_role(shell["aside"])
    for part in ("aside", "header"):
        shell[part] = _apply_identity(shell[part], old_brand, app_name)
        shell[part] = _apply_identity(shell[part], old_role, role)

    # ⚠ 顺序要紧：nav 必须在**身份替换之后**重新定位。
    #
    # 先定位再替换的话，一旦产品名或角色那几个字正好落在 nav 里（比如某个菜单项
    # 就叫「维修主管」），替换会把 nav 的原文改掉，后面拿旧的 nav_match 去
    # `replace` 就匹配不上——导航重排**静默不发生**，而各页壳仍然一致，
    # check_shell_consistency 的前两条也照样绿。这种"闸全绿但功能没生效"的
    # 形状，本仓踩过不止一次。
    nav_match = _NAV.search(shell["aside"])
    templates = nav_templates(nav_match.group(0)) if nav_match else None


    # ⚠ **无条件注入**这条兜底，不再试图判断"源导航有没有激活样式"。
    #
    # 判断过一版，两次都判错：
    #   ① 第一版拿「独有 class 词最多」认激活链接 → 认到了 `hover:bg-slate-50`，
    #      悬停样式，静态下零差别；
    #   ② 剔掉变体之后认到 `text-slate-600`，而基座是 `text-slate-700`——
    #      两个都是灰，肉眼同样看不出。
    #
    # 「这个 class 在视觉上够不够显眼」机械判不了，而判错的代价是**当前页
    # 没有任何标记**。所以不判了：aria-current 一定会打，就挂在它上面加一层
    # 底色和字重，有没有原生激活样式都不冲突（叠加在已有高亮上仍然读得通）。
    need_fallback = bool(templates)

    # 页面 id → 名字，给面包屑用
    name_of = {
        str(p.get("id") or ""): str(p.get("name") or p.get("id") or "").strip()
        for p in spec_pages
    }

    out: Dict[str, str] = {}
    for page_id, markup in pages_html.items():
        aside, header = shell["aside"], shell["header"]
        # ★ 面包屑按页改（2026-08-15）：壳是整段复制的，面包屑住在里面，
        #   不单独处理的话每页都写着源页那一节。
        header = set_breadcrumb_current(header, name_of.get(page_id, ""))
        if templates and nav_match:
            items = build_nav_items(templates, spec_pages, page_id)
            new_nav = re.sub(
                r"(<nav\b[^>]*>)[\s\S]*(</nav>)",
                lambda m: m.group(1) + "\n" + items + "\n" + m.group(2),
                nav_match.group(0),
                count=1,
            )
            aside = aside.replace(nav_match.group(0), new_nav, 1)
        html = markup
        if aside:
            html = _ASIDE.sub(lambda _m: aside, html, count=1) if _ASIDE.search(html) else html
        if header:
            html = _HEADER.sub(lambda _m: header, html, count=1) if _HEADER.search(html) else html
        # ★ 内容区容器也要统一（2026-08-15 补）。
        #
        # 此前这里只换 aside/header，**承载它们的那一层没人管**：真机上
        # aside 被收成 1 种、main 仍是 5 种，其中一页写着 `ml-64`——它已经
        # 靠 flex 排在 256px 侧栏右边，再叠 256px 左边距，整个内容区右移一屏。
        # 而判据当时也不看 main，于是 shellProblems=0，**假绿**。
        #
        # ⚠ 只换开标签上的 class，不动 main 里面的任何东西：位移全写在 class
        #   上，而内容里可能有 bind 打的绑定孔，碰不得。
        # ★ 只去掉多余的左偏移，**不抄源页的 main class**（2026-08-15 当天返工）。
        #   抄整段那一版真机当场炸了：p1 是左右分栏（flex 横向），抄给纵向排布的
        #   p3，子元素全被横着排、文字竖排、整页不可用。见 main_offset_tokens。
        html = strip_main_offset(html)
        if need_fallback and _ACTIVE_FALLBACK_CSS not in html:
            # 塞进 </head> 之前；没有 head 就退到 <body> 之后（都没有就不塞）。
            if "</head>" in html:
                html = html.replace("</head>", _ACTIVE_FALLBACK_CSS + "</head>", 1)
            else:
                html = re.sub(
                    r"(<body\b[^>]*>)",
                    lambda m: m.group(1) + _ACTIVE_FALLBACK_CSS,
                    html,
                    count=1,
                )
        out[page_id] = html

    return {
        "version": PAGE_SHELL_VERSION,
        "sourcePageId": source_id,
        "navAnchored": bool(templates),
        # ⚠ 带 id，不只是名字。宿主要照它渲染左侧菜单并切页——只有名字的话
        #   又回到"靠文字认页面"。老口径（纯字符串数组）在 08-14 换掉。
        "navItems": [
            {"id": str(p.get("id") or ""), "name": str(p.get("name") or p.get("id") or "")}
            for p in spec_pages
        ],
        "appName": app_name or old_brand,
        "personaRole": role or old_role,
        "pages": out,
    }


_ARIA_CURRENT = re.compile(r'\s*aria-current="[^"]*"', re.I)


def shell_fingerprint(part_html: str) -> str:
    """把一段壳归一化成"除去当前页标记之外的样子"，用来比各页是不是同一套。

    ⚠ **不能拿原文逐字节比。** 第一版就是那么写的，结果对着真实产物报
    「3 种不同的 <aside>」——查下来唯一差别是哪一项带 `aria-current="page"`
    和激活态 class，而那**正是每页应该不同的地方**（每页要标出自己是当前页）。

    一道对正确行为报警的闸比没有闸更糟：它会训练人忽略它。本仓在区块去重那次
    记过同一条教训——「误判会逼人删掉真有用的」。所以比之前先把当前页标记抹平，
    "有没有恰好标一个当前页"另开一条判据去查（见下面 nav.current）。
    """
    text = _ARIA_CURRENT.sub("", part_html or "")
    return _CLASS.sub('class=""', text)


#: 左偏移类：`ml-64` / `ml-[248px]` / `pl-64` 这一类。
_OFFSET_CLS = re.compile(r"^(ml|pl)-(\d+|\[[^\]]+\])$")
_BODY_OPEN = re.compile(r"<body\b[^>]*>", re.I)


def _body_is_flex_row(markup: str) -> bool:
    """`<body>` 是不是一个横向 flex 容器（侧栏和内容区并排的那种布局）。

    是的话，内容区**已经**被 flex 排在侧栏右边了，再加 `ml-64` 就是双倍偏移。
    """
    m = _BODY_OPEN.search(markup or "")
    if not m:
        return False
    cls = _CLASS.search(m.group(0))
    toks = set(cls.group(1).split()) if cls else set()
    return "flex" in toks and "flex-col" not in toks


def main_offset_tokens(markup: str) -> List[str]:
    """内容区容器上的**左偏移**类，只取这一类。

    ## ⚠ 为什么只看偏移，不看整个 class（2026-08-15 当天返工）

    第一版拿整个 `<main>` 的 class 当指纹，还让 unify_shell 把源页的整段
    class 抄给所有页。**真机当场炸了**（烘焙那趟 p3）：

        p1 main: flex-1 flex overflow-hidden …   子元素是左右两栏 section
        p3 main: 同上（从 p1 抄的）              子元素是 header + 纵向内容

    `flex` 默认横向，p3 的纵向内容被横着排，每个子元素挤成窄条、文字竖排，
    整页不可用。加回 `flex-col` 就完全正常。

    根因是 main 的 class 混着两种东西：

        ml-64        相对侧栏的**定位**    ← 该各页一致
        flex/flex-col overflow p-8
                     **本页自己的版式**    ← 必须各页不同

    抄整段 = 把源页的版式强加给别人。所以收窄到只管偏移那一半。

    ⚠ 这次的教训：我拿 39 份历史产出验过「main 收敛到 1 种」，但**没验页面
      还能不能看**。指标绿了不等于东西对——这一天里第三次栽在同一处。
    """
    m = _MAIN_OPEN.search(markup or "")
    if not m:
        return []
    cls = _CLASS.search(m.group(0))
    if not cls:
        return []
    return sorted(t for t in cls.group(1).split() if _OFFSET_CLS.match(t))


def strip_main_offset(markup: str) -> str:
    """`<body>` 已经是横向 flex 时，把内容区上多余的左偏移去掉。

    这是真机上那个「整屏右移 256px」的确定性修法：`ml-64` 叠在 flex 排布之上
    等于偏移两次。只删偏移类，其余 class 一个不动。
    """
    if not _body_is_flex_row(markup):
        return markup
    m = _MAIN_OPEN.search(markup or "")
    if not m:
        return markup
    cls = _CLASS.search(m.group(0))
    if not cls:
        return markup
    kept = [t for t in cls.group(1).split() if not _OFFSET_CLS.match(t)]
    if len(kept) == len(cls.group(1).split()):
        return markup
    new_tag = m.group(0).replace(cls.group(0), f'class="{" ".join(kept)}"', 1)
    return markup[: m.start()] + new_tag + markup[m.end() :]


def main_signature(markup: str) -> str:
    """内容区容器的 class 指纹。**位移全写在这里**，而它一直没人查。

    ⚠ 2026-08-15 补：此前判据只给 `<aside>` / `<header>` 打指纹，
      **不看承载它们的那一层**。真机上因此出过「假绿」：

          header 指纹   p1/p2/p3/p4 完全相同（len=904）
          <main> class  p1/p2: flex-1 flex flex-col min-w-0 overflow-hidden
                        p3:    flex-1 flex flex-col min-w-0 bg-slate-50 relative
                        p4:    **ml-64** flex-1 flex flex-col     ← 左边距 256px

      p4 已经靠 flex 排在 256px 侧栏右边，又叠了 `ml-64` 的 256px，
      整个内容区右移一屏——而 `shellProblems=0`。

    ⚠ 全仓量过一遍，**三个模型全漏**：think 3 种 / ouyi 4 种 / luna 5 种
      （`ml-[236px]` `ml-[248px]` `ml-[244px]` `main-wrap` `main-shell`）。
      luna 只是漏得不显眼——差几个像素肉眼无感，不代表没病。

    抠不到 `<main>` 返回空串：没有 main 是合法的（全屏向导页），
    由调用方按「有的页才比」处理。
    """
    m = _MAIN_OPEN.search(markup or "")
    if not m:
        return ""
    cls = _CLASS.search(m.group(0))
    # class 顺序不该影响判定——排序后比对，避免把「同一套壳换了个书写顺序」
    # 误报成漂移。
    return " ".join(sorted(cls.group(1).split())) if cls else ""


_DATA_ATTR = re.compile(r'\s*data-[a-z-]+="[^"]*"', re.I)


def restore_shell_after_bind(
    bound: Dict[str, str], before: Dict[str, str]
) -> Tuple[Dict[str, str], List[str]]:
    """bind 把壳改坏的页，用打孔前那份壳换回来。**零 LLM。**

    ## 为什么需要

    第 3.5 步 `unify_shell` 已经把各页的壳统一成一套了。然后第 6.5 步 bind
    让 LLM 重写整页——提示词明写「版式一个像素都不要改」，但真机八趟八次
    都测出漂移，最狠的一次是同一个应用里出现两个产品名、两套侧栏菜单。

    既然打孔前那份壳是**已知正确**的，就不用再问模型，直接换回来。

    ## ⚠ 不能无脑全换：bind 也会往壳里打合法的孔

    实测 34 份产出里 **12 份**壳里有 `data-*`，例如：

        <span data-value="booking" data-aggregate="count">今日已有 N 节排课</span>
        <button data-action="createRecord" data-entity="vaccine_plan">

    无脑还原会把这些孔洗掉，页面退回死的静态壳。

    所以判定标准是**结构**，不是原文：把 `data-*` 属性抠掉之后再比指纹。

      · 抠掉 data-* 后一致 → bind 只是加了孔，**保留 bind 的版本**
      · 抠掉 data-* 后仍不同 → bind 动了结构，**换回打孔前那份**

    真机 A/B（同一批 5 页，bind 前后逐页比对）验证过这个划分：
        p2.header  结构被改了      → 该还原
        p5.aside   结构被改了      → 该还原
        p4.aside   只加了 data-*   → 该保留

    返回 (修正后的页面, 被还原的位置清单)。
    """
    fixed = dict(bound)
    restored: List[str] = []
    for pid, after_html in bound.items():
        src = before.get(pid)
        if not src:
            continue
        a, b = extract_shell(src), extract_shell(after_html)
        for part, pattern in (("aside", _ASIDE), ("header", _HEADER)):
            if not a[part] or not b[part]:
                continue
            if shell_fingerprint(a[part]) == shell_fingerprint(b[part]):
                continue  # 原样没动
            if shell_fingerprint(_DATA_ATTR.sub("", a[part])) == shell_fingerprint(
                _DATA_ATTR.sub("", b[part])
            ):
                continue  # 只加了孔，保留
            fixed[pid] = pattern.sub(lambda _m: a[part], fixed[pid], count=1)
            restored.append(f"{pid}.{part}")
    return fixed, restored


def check_shell_consistency(
    pages_html: Dict[str, str], spec: Dict[str, Any]
) -> List[Dict[str, str]]:
    """判据：统一之后还剩几处不一致。**这是本模块存在的理由，别删。**

    五条，每条对应量到过的一个真实症状：
      · 壳（除当前页标记外）必须各页一致（对应「三个产品名、三个登录人」）
      · **内容区容器必须各页一致**（对应 p4 叠了 ml-64、整屏右移；
        这条 2026-08-15 才补——此前只查壳本身不查承载层，出过假绿）
      · 导航项必须**恰好等于** spec 的页面清单（对应 p3 发明 5 个不存在的入口）
      · 每页恰好标一个当前页（第一版漏掉的——归一化抹平激活态之后，
        "全都不激活"和"标了三个"都会静静通过）
      · 每页至少还剩一个壳（对应替换把壳整段吃掉的失败形态）
    """
    problems: List[Dict[str, str]] = []
    shells = {pid: extract_shell(h) for pid, h in pages_html.items()}

    # 移动端没有 <aside>，导航是页面级 <nav>（底部标签栏）。aside 在时照旧
    # 只认 aside 里的 nav（桌面页面可能另有面包屑 nav，不该被误查）；
    # aside 不在才回落到整页找（2026-08-14 竖屏加）。
    def _nav_of(pid: str) -> Optional[re.Match]:
        aside = shells[pid]["aside"]
        if aside:
            return _NAV.search(aside)
        return _NAV.search(pages_html[pid])

    for part in ("aside", "header"):
        distinct = {shell_fingerprint(s[part]) for s in shells.values() if s[part]}
        if len(distinct) > 1:
            problems.append({
                "path": part,
                "message": f"{len(distinct)} 种不同的 <{part}>——各页还不是同一套壳",
            })

    # 内容区的**定位**。⚠ 只查左偏移，不比整段 class：
    #   `flex` vs `flex-col`、overflow、padding 都是**这一页自己的版式**，
    #   本来就该各页不同。第一版比整段，等于把「页面各有各的排布」报成漂移，
    #   而按它去"修"（抄源页 class）真机当场把页面排炸了——见 main_offset_tokens。
    for pid, html in pages_html.items():
        if _body_is_flex_row(html) and main_offset_tokens(html):
            problems.append({
                "path": f"{pid}.main",
                "message": (
                    f"内容区带着 {'、'.join(main_offset_tokens(html))}，"
                    f"而它已经被 flex 排在侧栏右边了——偏移了两次"
                ),
            })

    # 全部页面都没 aside（移动端）时，标签栏本身也要各页一致
    if not any(s["aside"] for s in shells.values()):
        navs = {pid: _nav_of(pid) for pid in shells}
        distinct_nav = {shell_fingerprint(m.group(0)) for m in navs.values() if m}
        if len(distinct_nav) > 1:
            problems.append({
                "path": "nav",
                "message": f"{len(distinct_nav)} 种不同的 <nav>——底部标签栏还不是同一套",
            })

    for pid, s in shells.items():
        nav = _nav_of(pid)
        if not nav:
            continue
        marked = len(re.findall(r'aria-current="page"', nav.group(0), re.I))
        if marked != 1:
            problems.append({
                "path": f"{pid}.nav.current",
                "message": f"标了 {marked} 个当前页，应该恰好 1 个",
            })

    want = [str(p.get("name") or p.get("id") or "").strip() for p in (spec.get("pages") or [])]
    for pid, s in shells.items():
        nav = _nav_of(pid)
        if not nav:
            continue
        got = [
            re.sub(r"<[^>]+>", "", a).strip()
            for a in _LINK.findall(nav.group(0))
        ]
        got = [g for g in got if g]
        if got != want:
            problems.append({
                "path": f"{pid}.nav",
                "message": f"导航项 {got} 跟 spec 的页面清单 {want} 对不上",
            })

    app_name = str(spec.get("appName") or "").strip()
    if app_name:
        for pid, s in shells.items():
            blob = s["aside"] + s["header"]
            if blob and app_name not in blob:
                problems.append({
                    "path": f"{pid}.appName",
                    "message": f"壳上没有 spec 的产品名「{app_name}」——"
                               f"多半是认错了模型编的那个名字，替换没落到实处",
                })

    for pid, s in shells.items():
        if not s["aside"] and not s["header"]:
            problems.append({"path": pid, "message": "这一页壳没了，替换把它整段吃掉了"})
    return problems
