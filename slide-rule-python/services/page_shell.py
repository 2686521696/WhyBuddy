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
    # 激活链接 = 独有词最多的那个。全都一样时退回第一个（那时也没有激活态可认）
    extras = [len(ts - base) for ts in token_sets]
    active_idx = extras.index(max(extras)) if max(extras) > 0 else 0
    active_tokens = sorted(token_sets[active_idx])
    icons = [(_SVG.search(a).group(0) if _SVG.search(a) else "") for a in links]
    return {
        "link": links[0 if active_idx != 0 else -1],  # 拿一个**非激活**的当基座
        "base_class": " ".join(sorted(base)),
        "active_class": " ".join(active_tokens),
        "icons": icons,
    }


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

    out: Dict[str, str] = {}
    for page_id, markup in pages_html.items():
        aside, header = shell["aside"], shell["header"]
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


def check_shell_consistency(
    pages_html: Dict[str, str], spec: Dict[str, Any]
) -> List[Dict[str, str]]:
    """判据：统一之后还剩几处不一致。**这是本模块存在的理由，别删。**

    四条，每条对应量到过的一个真实症状：
      · 壳（除当前页标记外）必须各页一致（对应「三个产品名、三个登录人」）
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
