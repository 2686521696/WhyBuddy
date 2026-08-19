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
from html import escape, unescape
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
_ASIDE_OPEN = re.compile(r"<aside\b[^>]*>", re.I)


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

_STYLE_BLOCK = re.compile(r"<style\b[^>]*>([\s\S]*?)</style>", re.I)
#: 只认「单个类选择器 + 一条规则」这种最朴素的写法——真机上模型给自定义类
#: 写的就是这个形状（`.bg-primary { background-color: #2D5CF7; }`）。
#: 复合选择器 / 伪类 / 媒体查询一律不认：移植它们要连上下文一起搬，
#: 而搬错比不搬更糟。
_SIMPLE_RULE = re.compile(r"(?<![\w.\-])\.([A-Za-z][\w-]*)\s*\{([^{}]*)\}")


def style_class_rules(markup: str) -> Dict[str, str]:
    """页面自己的 <style> 里定义了哪些类 → 规则原文。"""
    rules: Dict[str, str] = {}
    for block in _STYLE_BLOCK.findall(markup or ""):
        for name, body in _SIMPLE_RULE.findall(block):
            rules.setdefault(name, body.strip())
    return rules


def shell_class_tokens(*shell_parts: str) -> set:
    """统一外壳（aside/header）用到的全部 class 名。"""
    tokens: set = set()
    for part in shell_parts:
        for value in _CLASS.findall(part or ""):
            tokens.update(t for t in value.split() if t)
    return tokens


def transplant_shell_css(html: str, needed: Dict[str, str]) -> str:
    """把外壳依赖、而本页 <style> 里没有的类定义补回来。

    ## 这条防的是一个必然会周期性发生的形态

    真机证据（sr-20260816095147「步伴 AI 拐杖」，2026-08-16）：侧栏是四页
    **统一**的外壳，导航项都写着 `rounded-custom`；而每页的 `<style>` 是
    **各写各的**——p1/p3/p4 定义了 `.rounded-custom`，**p2 没有**。于是同一段
    外壳在 p2 上圆角失效，四页菜单长得不一样。

    这不是运气问题：外壳统一之后，它依赖的类名就成了**跨页契约**，而定义那些
    类的 CSS 仍由每页的 LLM 各自即兴发挥。只要页数 × 类数够多，总会漏。

    ## 为什么是"移植"而不是"兜底默认值"

    不发明数值。补给 p2 的那条 `.rounded-custom` 就是 p1 写的那条原文——
    外壳本来就是从某一页抄过来的，它依赖的样式跟着一起抄才叫完整。
    随手写个 `border-radius:8px` 看着也能跑，但那是**另一种设计**，
    会让 p2 的圆角跟其它页不一致——把一个明显的 bug 换成一个不易察觉的。

    没有任何页定义过的类（真机上的 `ring-primary`）**不补**：没有真相来源时
    编一个出来，就是拿"看起来对"冒充"是对的"。它照旧交给 Tailwind 运行时。

    ## 插在最前面

    插在页面自己的 <style> **之前**，所以本页若自己定义了同名类，
    按 CSS 后来者胜，本页那条照常赢。这一段只填空，不覆盖。
    """
    if not needed:
        return html
    css = "".join(f".{name}{{{body}}}" for name, body in sorted(needed.items()))
    tag = f"<style data-shell-css>{css}</style>"
    first = _STYLE_BLOCK.search(html or "")
    if first:
        return html[: first.start()] + tag + html[first.start() :]
    if "</head>" in html:
        return html.replace("</head>", tag + "</head>", 1)
    return re.sub(r"(<body\b[^>]*>)", lambda m: m.group(1) + tag, html, count=1)


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


def _breadcrumb_current_span(header_html: str) -> Optional[Tuple[re.Match, re.Match]]:
    """定位面包屑的**当前节**，返回 (nav 匹配, 该节匹配)。

    ⚠ 抽出来是因为有三个调用方要用**同一套**定位：写（set_）、读（_text）、
      抹平（blank_）。三份各写各的，就是下一处「一个改了另一个没改」。
      本模块刚在归一化上栽过一次：restore_shell_after_bind 知道 data-* 不算
      漂移，check_shell_consistency 不知道——同一个模块两套标准。
    """
    nav = _breadcrumb_nav(header_html)
    if not nav:
        return None
    body = nav.group(0)
    cur = _ARIA_CURRENT_EL.search(body)
    if cur:
        return nav, cur
    segs = [m for m in _CRUMB_SEG.finditer(body) if m.group(0).strip()]
    if not segs:
        return None
    return nav, segs[-1]


def breadcrumb_current_text(header_html: str) -> Optional[str]:
    """面包屑当前节的**文本**。没有面包屑返回 None（合法，不是错）。"""
    found = _breadcrumb_current_span(header_html)
    if not found:
        return None
    inner = _SEG_INNER.search(found[1].group(0))
    raw = inner.group(2) if inner else found[1].group(0)
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", raw)).split())


def blank_breadcrumb_current(header_html: str) -> str:
    """把面包屑当前节的文本抹掉，用于**比各页外壳是不是同一套**。

    ⚠ 这一节 `set_breadcrumb_current` **故意**写成各页不同——它是壳里唯一
      该逐页变的东西。比指纹时不抹掉，各页 header 必然不同，判据就会把
      「修复正常工作」报成「3 种不同的 header」。

      真机实测（社区药店，2026-08-15）：三页 header 指纹两两不同，抹平
      aria-current 和 class 之后**唯一**的差异就是这一节的文字——
      「进货入库管理页」/「库存看板与效期监控」/「处方登记审计日志」。

      一道对正确行为报警的闸比没有闸更糟：它会训练人忽略它。所以照
      shell_fingerprint 对 aria-current 的老办法——**比之前抹平，
      该查的另开一条判据去查**（见 check_shell_consistency 的 .breadcrumb）。
    """
    found = _breadcrumb_current_span(header_html)
    if not found:
        return header_html
    nav, seg = found
    body = nav.group(0)
    replaced = (
        body[: seg.start()]
        + _SEG_INNER.sub(lambda m: m.group(1) + m.group(3), seg.group(0), count=1)
        + body[seg.end():]
    )
    return header_html.replace(body, replaced, 1)


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
    found = _breadcrumb_current_span(header_html)
    if not found:
        return header_html
    nav, seg = found
    body = nav.group(0)
    replaced = (
        body[: seg.start()]
        + _SEG_INNER.sub(
            lambda m: m.group(1) + escape(page_name) + m.group(3), seg.group(0), count=1
        )
        + body[seg.end():]
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


def _cn_len(text: str) -> int:
    return len(re.findall(r"[\u4e00-\u9fff]", text))


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

    2026-08-18 CareBridge：方块里一个「循」是缩写，不是品名。把它当 old
    去做全局 replace，已经写对的「循护桥」会变成「循护桥护桥」。
    单字中文不当品牌/角色——标定集里最短的品名也是「维保云」。
    """
    texts = [s.strip() for s in _CN_TEXT.findall(aside_html or "") if s.strip()]
    texts = [s for s in texts if _cn_len(s) >= 2]
    if not texts:
        return "", ""
    return texts[0], texts[-1]


def _apply_identity(shell_part: str, old: str, new: str) -> str:
    """整段替换产品名 / 角色。空值或没变化时原样返回。

    对照 WHATWG DOM / BeautifulSoup：只改**文本节点**，不动属性、标签名。
    成熟做法是遍历 NavigableString（bs4 文档「NavigableString」；DOM 的
    ``Text``），禁止对整段 markup 做 ``str.replace``——那会把
    ``class="维保云-theme"`` 一并改掉，壳还在、主题类名却丢了。

    旧名是新名的真子串时还要更严：禁止「节点里出现旧名就换」。
    ``「循护桥」.replace("循", "循护桥")`` 就是「循护桥护桥」。
    这种只改**整段文本恰好等于旧名**的节点（方块缩写），已经写对的新名留下。
    """
    if not old or not new or old == new:
        return shell_part
    exact_only = old in new

    def _one(match: re.Match[str]) -> str:
        text = match.group(1)
        if exact_only:
            if text.strip() != old:
                return match.group(0)
        elif old not in text:
            return match.group(0)
        return f">{text.replace(old, new)}<"

    return _CN_TEXT.sub(_one, shell_part)


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

    # 全站自定义类词表：任意一页定义过的类，都算"这套设计里有的东西"。
    # 外壳依赖其中某个类而本页没写，就从这里把定义搬过去（见
    # transplant_shell_css）。取并集而不是只取源页：外壳的图标/徽标可能
    # 用到源页之外定义的类。
    vocabulary: Dict[str, str] = {}
    for _markup in pages_html.values():
        for _name, _body in style_class_rules(_markup).items():
            vocabulary.setdefault(_name, _body)

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
        # ★ 两个方向都要（2026-08-15 晚）：统一后的侧栏若是 fixed，它不占位，
        #   没有偏移的那一页会被压在侧栏底下（真机 p4 就这么坏的）。
        html = reconcile_main_offset(html)
        # ★ 外壳依赖的自定义类，本页没定义就从别页搬一份（2026-08-16）。
        #   放在 reconcile 之后：那时 aside/header 已经是最终形态，
        #   数出来的 class 才是这一页真正会用到的。
        _own = style_class_rules(html)
        _missing = {
            name: body
            for name, body in vocabulary.items()
            if name in shell_class_tokens(aside, header) and name not in _own
        }
        html = transplant_shell_css(html, _missing)
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
    """`<body>` 是不是一个横向 flex 容器（侧栏和内容区并排的那种布局）。"""
    m = _BODY_OPEN.search(markup or "")
    if not m:
        return False
    cls = _CLASS.search(m.group(0))
    toks = set(cls.group(1).split()) if cls else set()
    return "flex" in toks and "flex-col" not in toks


#: 脱离文档流的定位类。`fixed`/`absolute` 的侧栏**不占位**。
_OUT_OF_FLOW = ("fixed", "absolute")
_WIDTH_CLS = re.compile(r"^w-(\d+|\[[^\]]+\])$")


def _aside_tokens(markup: str) -> set:
    m = _ASIDE_OPEN.search(markup or "")
    if not m:
        return set()
    cls = _CLASS.search(m.group(0))
    return set(cls.group(1).split()) if cls else set()


def aside_out_of_flow(markup: str) -> bool:
    """侧栏是不是脱离了文档流（`fixed` / `absolute`）。

    ## ⚠ 这才是「内容区该不该带左偏移」的真正判据（2026-08-15 晚返工）

    此前只问 `<body>` 是不是横向 flex，**漏了一半**：`fixed` 的侧栏根本不参与
    flex 排布，flex 不会给它留出 256px。这时内容区**必须**自己带 `ml-64`，
    否则直接被压在侧栏底下。

    真机（社区药店 p4）当场撞上：

        <body class="flex h-screen overflow-hidden">        ← 横向 flex
        <aside class="w-64 … fixed h-full">                 ← 却是 fixed，不占位
        <main class="flex-1 flex flex-col min-w-0 …">       ← 没有偏移

    截图上侧栏整个压在表格上，「登记时间」「流水单号」两列被盖住。
    而判据全绿——旧规则看到 body 有 flex 就认定「已经排好了」。

    实测：给这一页加回 `ml-64`，main 左边界 256px = 侧栏右边界 256px，严丝合缝。

    ⚠ 这个 `fixed` 还是 **unify_shell 自己贴上去的**：源页的侧栏是 fixed，
      统一时整段复制给了各页，而各页的 main 各自按原来的侧栏形态写偏移。
      壳统一了、承载层没跟着对齐——所以下面 reconcile_main_offset 要成对做。
    """
    return bool(_aside_tokens(markup) & set(_OUT_OF_FLOW))


def aside_offset_token(markup: str) -> Optional[str]:
    """侧栏宽度对应的左偏移类：`w-64` → `ml-64`，`w-[248px]` → `ml-[248px]`。

    ⚠ 宽度认不出来就返回 None，**不猜一个 ml-64 塞进去**：猜错的偏移
      跟没有偏移一样是坏版式，而且更难查。
    """
    for tok in _aside_tokens(markup):
        m = _WIDTH_CLS.match(tok)
        if m:
            return f"ml-{m.group(1)}"
    return None


_TAG = re.compile(r"<(/?)([a-zA-Z][\w-]*)\b([^>]*?)(/?)>")
#: 空元素不进栈——它们没有闭合标签，压进去会把后面所有祖先关系算错。
_VOID = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
})


def _offset_tokens_of(open_tag: str) -> List[str]:
    cls = _CLASS.search(open_tag or "")
    if not cls:
        return []
    return [t for t in cls.group(1).split() if _OFFSET_CLS.match(t)]


def main_offset_chain(markup: str) -> List[Tuple[int, int, str]]:
    """`<main>` **自己和它到 `<body>` 之间的每一层祖先**的开标签，由外向内。

    ## ⚠ 为什么不能只看 `<main>`（2026-08-15 晚，律所那趟当场打脸）

    真机 p1 长这样——偏移写在**包裹层**上，`<main>` 自己干干净净：

        <body class="flex h-screen">
          <aside class="w-64 … fixed">…</aside>
          <div class="flex-1 ml-64 flex flex-col">   ← 让位的是它
            <header>…</header>
            <main class="flex-1 …">…</main>          ← 这一层没有偏移

    只看 `<main>` 的判据于是报「内容区没有左偏移」——**假警报**；
    而按它去"修"（给 main 补 ml-64）真机当场量到 main.left=512px，
    整屏右移了一整个侧栏的宽度。**判据错和修复错是同一个根因。**

    这是同一处第五次返工，也是同一类错误又一次：**拿一个节点推的结论
    套到整棵子树上**。前四次是 class 抄整段 / 只删不补 / 只看 body /
    只看 main，这次是只看一层。
    """
    src = markup or ""
    body = _BODY_OPEN.search(src)
    start = body.end() if body else 0
    stack: List[Tuple[int, int, str]] = []
    for m in _TAG.finditer(src, start):
        closing, name, _attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if name == "main" and not closing:
            return stack + [(m.start(), m.end(), m.group(0))]
        if closing:
            for i in range(len(stack) - 1, -1, -1):
                if stack[i][2][1:].split(None, 1)[0].rstrip(">").lower() == name:
                    del stack[i:]
                    break
        elif not selfclose and name not in _VOID:
            stack.append((m.start(), m.end(), m.group(0)))
    return []


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
    return sorted({t for _s, _e, tag in main_offset_chain(markup)
                   for t in _offset_tokens_of(tag)})


def _rewrite_main_class(markup: str, toks: List[str]) -> str:
    m = _MAIN_OPEN.search(markup or "")
    if not m:
        return markup
    cls = _CLASS.search(m.group(0))
    if not cls:
        return markup
    if toks == cls.group(1).split():
        return markup
    new_tag = m.group(0).replace(cls.group(0), f'class="{" ".join(toks)}"', 1)
    return markup[: m.start()] + new_tag + markup[m.end():]


def offset_needed(markup: str) -> bool:
    """内容区**该不该**带左偏移。侧栏占不占位说了算，不是 body 说了算。

      · 侧栏 fixed/absolute（不占位）→ 该带：不带就被压在侧栏底下
      · 侧栏在流内 + body 横向 flex   → 不该带：flex 已经排好了，再带就偏两次
      · 其余（没侧栏 / 纵向布局）      → 不动它，这是页面自己的版式
    """
    return aside_out_of_flow(markup)


def strip_main_offset(markup: str) -> str:
    """去掉内容区上**多余**的左偏移（侧栏在流内、body 又是横排的那种）。

    真机上那个「整屏右移 256px」的确定性修法：`ml-64` 叠在 flex 排布之上
    等于偏移两次。只删偏移类，其余 class 一个不动。

    ⚠ `fixed` 的侧栏不占位，那时偏移**不是多余的**——见 aside_out_of_flow。
    """
    if aside_out_of_flow(markup) or not _body_is_flex_row(markup):
        return markup
    out = markup
    # 从内往外改，先改后面的：改了前面的会让后面记下来的偏移量失效。
    for start, end, tag in reversed(main_offset_chain(markup)):
        if not _offset_tokens_of(tag):
            continue
        cls = _CLASS.search(tag)
        kept = [t for t in cls.group(1).split() if not _OFFSET_CLS.match(t)]
        out = out[:start] + tag.replace(cls.group(0), f'class="{" ".join(kept)}"', 1) + out[end:]
    return out


def reconcile_main_offset(markup: str) -> str:
    """让内容区的左偏移跟**这一页现在这个侧栏**对齐。两个方向都要做。

    ## 为什么必须成对（2026-08-15 晚，真机 p4 被压穿之后补）

    `unify_shell` 把源页的 `<aside>` 整段复制给各页——**连定位方式一起复制**。
    源页的侧栏是 `fixed`，于是各页的侧栏全变成 `fixed`；而各页的 `<main>`
    还写着它原来那套侧栏形态下的偏移：

        p2/p3  main class="ml-64 …"    ← 本来就配 fixed 侧栏，正好
        p4     main class="flex-1 …"   ← 本来配的是流内侧栏，现在没人占位了

    结果 p4 的内容区整个滑到侧栏底下，两列表头被盖住。**壳统一了，
    承载层没跟着对齐**——这正是「只修一半」的形状。

    所以这里两个方向都补：该带的补上，多余的去掉。
    """
    m = _MAIN_OPEN.search(markup or "")
    if not m:
        return markup
    cls = _CLASS.search(m.group(0))
    if not cls:
        return markup
    toks = cls.group(1).split()
    if not aside_out_of_flow(markup):
        return strip_main_offset(markup)
    # ⚠ 问的是**整条祖先链**有没有让位，不是只问 <main>：真机 p1 的偏移
    #   写在包裹层上，只看 main 会以为没让位，补一个就成了双倍偏移（512px）。
    if main_offset_tokens(markup):
        return markup  # 已经让位了
    want = aside_offset_token(markup)
    if not want:
        return markup  # 宽度认不出来，不猜
    return _rewrite_main_class(markup, [want] + toks)


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


def repair_pages_after_bind(
    bound: Dict[str, str], before: Dict[str, str]
) -> Tuple[Dict[str, str], List[str], List[str]]:
    """bind 之后的确定性收尾：**换回被改坏的壳 + 重新对齐内容区偏移**。零 LLM。

    ## ⚠ 为什么偏移要再做一遍

    第 3.5 步 `unify_shell` 已经调过 `reconcile_main_offset`——但 bind 是
    **让 LLM 重写整页**，它可以把内容区那一层的 `ml-64` 一起改掉。而
    `restore_shell_after_bind` 只管 `<aside>`/`<header>` 两段，**不碰 main**，
    于是没有任何一处把偏移补回来。这是一条**兜底**，代价是零 LLM 的一次扫描。

    ## ⚠ 诚实记账：它是从一次**假警报**里推出来的

    本函数 2026-08-15 晚加的时候，理由写的是"律所那趟 4 页里 2 页被 bind
    吃掉了偏移"。后来查明那批告警是假的——当时 `main_offset_tokens` 只看
    `<main>` 一层，而真机 p1/p4 的偏移写在**包裹层**上（见 main_offset_chain）。
    交付页本来就是好的，是判据错了；而按那个错判据去"修"，真机量到
    main.left=512px，**整屏右移了一整个侧栏宽度**——判据错和修复错同根。

    所以「bind 吃掉偏移」这个形状**至今没有在真机上观测到**，单测里那份是
    构造出来的。留着它是因为便宜，不是因为它救过火。

    ⚠ 顺序要紧：先还原壳再对齐偏移。偏移该不该有取决于**侧栏是不是 fixed**，
      而侧栏可能刚被换回打孔前那份——先算偏移就是拿旧侧栏做的判断。

    返回 (修好的页面, 被还原的壳, 被重新对齐的内容区)。
    """
    fixed, restored = restore_shell_after_bind(bound, before)
    reconciled: List[str] = []
    for pid, html in list(fixed.items()):
        out = reconcile_main_offset(html)
        if out != html:
            fixed[pid] = out
            reconciled.append(f"{pid}.main")
    return fixed, restored, reconciled


def _drift_fingerprint(part: str, part_html: str) -> str:
    """比「各页是不是同一套壳」时用的指纹。**比 shell_fingerprint 多抹两样。**

    ⚠ 两样都是真机上量出来的**假警报**（社区药店，2026-08-15，一趟报了 2 条，
      两条全是把正确行为当故障）：

      1. `data-*`：bind 会往壳里打**合法的**孔（侧栏那块登录人卡片打了
         `data-record="pharmacist"` + `data-field="name"`）。三页打的位置深浅
         不同（p2 打在外层 div、p3 打在内层、p4 没打），指纹就三种。
         **restore_shell_after_bind 早就知道这条**（它比之前先 _DATA_ATTR.sub），
         而这里不知道——同一个模块两套归一化标准，是这次假警报的直接原因。

      2. 面包屑当前节：`set_breadcrumb_current` 故意让它逐页不同。

    抹掉的东西不是不查，是**另开判据查**：孔的合法性归 html_bindings，
    面包屑末节归下面的 `.breadcrumb` 那条。
    """
    stripped = _DATA_ATTR.sub("", part_html or "")
    if part == "header":
        stripped = blank_breadcrumb_current(stripped)
    return shell_fingerprint(stripped)


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
        distinct = {_drift_fingerprint(part, s[part]) for s in shells.values() if s[part]}
        if len(distinct) > 1:
            problems.append({
                "path": part,
                "message": f"{len(distinct)} 种不同的 <{part}>——各页还不是同一套壳",
            })

    # 面包屑末节：上面比指纹时**故意**抹掉了它，这里单独查。
    # ⚠ 归一化抹掉什么，就得另开一条判据查什么——否则「逐页改对」和
    #   「压根没改、全是源页那一节」会一起静静通过（aria-current 那条
    #   就是这么补的）。
    names = {
        str(p.get("id") or ""): str(p.get("name") or "").strip()
        for p in (spec.get("pages") or [])
    }
    for pid, s in shells.items():
        want = names.get(pid)
        if not want or not s["header"]:
            continue
        got = breadcrumb_current_text(s["header"])
        if got is None:
            continue  # 没有面包屑是合法的，硬塞一个是新的破坏
        if got != want:
            problems.append({
                "path": f"{pid}.breadcrumb",
                "message": f"面包屑末节写着「{got}」，而这一页是「{want}」",
            })

    # 内容区的**定位**。⚠ 只查左偏移，不比整段 class：
    #   `flex` vs `flex-col`、overflow、padding 都是**这一页自己的版式**，
    #   本来就该各页不同。第一版比整段，等于把「页面各有各的排布」报成漂移，
    #   而按它去"修"（抄源页 class）真机当场把页面排炸了——见 main_offset_tokens。
    for pid, html in pages_html.items():
        out_of_flow = aside_out_of_flow(html)
        offsets = main_offset_tokens(html)
        if not out_of_flow and _body_is_flex_row(html) and offsets:
            problems.append({
                "path": f"{pid}.main",
                "message": (
                    f"内容区带着 {'、'.join(offsets)}，"
                    f"而它已经被 flex 排在侧栏右边了——偏移了两次"
                ),
            })
        # ⚠ 反方向，真机 p4 撞的就是这条：fixed 侧栏不占位，内容区不让位
        #   就被压在底下。旧判据只查「偏移了两次」，这一半是**空的**——
        #   页面坏成那样，shellProblems 里一个字都没有。
        elif out_of_flow and not offsets and _ASIDE_OPEN.search(html or ""):
            problems.append({
                "path": f"{pid}.main",
                "message": (
                    f"侧栏是 fixed/absolute（不占位），而内容区没有左偏移——"
                    f"内容会被压在侧栏底下"
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
