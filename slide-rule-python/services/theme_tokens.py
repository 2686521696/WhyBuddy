"""画页主题锁：语义色变量钉死顶栏/侧栏/卡片，不靠模型自觉。

⚠ 2026-08-20 真机（满电青年）：同一应用里 Header 有时黑、有时白，
  侧栏海军蓝、顶栏纯黑；浅色页底部又突然出现 bg-slate-900 的「系统设置」
  砖。设计语言只把 hex 写进散文（「主色 #2563eb」），每页 LLM 各画各的
  Tailwind 灰阶——提示词拦不住，也没有任何一层去改。

做法照 shadcn/ui 的语义 token（:root 上 --background/--card/--primary，
组件不写死颜色；sidebar 与 background 同族）和 daisyUI 的「一份 theme
对象染全身」。我们比 shadcn 更严一档：`--chrome` 同时铺 header 和
aside——真机的病就是这两块各自发明了一个深色。

W3C Design Tokens 的 hex→分量仍由 design_language.to_dtcg 算；这里只
派生「给 CSS / Tailwind Play 用的那一张表」。OKLCh 走 coloraide，跟
palette_guard 同一把尺。

增强类 fail-open：钉主题挂了不许拖画页。
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Optional

from coloraide import Color

from .design_language import DEFAULT_DESIGN_LANGUAGE, normalize_design_language
from .palette_guard import repair_colors

THEME_STYLE_ID = "sliderule-theme"
THEME_MARK = "sliderule-theme-tokens"

_HEX = re.compile(r"#[0-9a-fA-F]{6}")
_DARK_MARKS = ("深色", "暗色", "暗黑", "黑底", "夜间", "dark")
_LIGHT_MARKS = ("浅色", "亮色", "白底", "浅底", "light")

#: 浅色页里模型爱用的「强调深砖」；深色页里的「突然一块白卡」。
#: 选择器盯 Tailwind 真类名（Play CDN 会生成 .bg-slate-900），不靠 class*= 误伤。
_LIGHT_DARK_BRICKS = (
    "bg-black",
    "bg-slate-800", "bg-slate-900", "bg-slate-950",
    "bg-gray-800", "bg-gray-900", "bg-gray-950",
    "bg-zinc-800", "bg-zinc-900", "bg-zinc-950",
    "bg-neutral-800", "bg-neutral-900", "bg-neutral-950",
    "bg-stone-800", "bg-stone-900", "bg-stone-950",
)
_DARK_LIGHT_BRICKS = (
    "bg-white",
    "bg-gray-50", "bg-slate-50", "bg-zinc-50", "bg-neutral-50", "bg-stone-50",
)


def is_dark_tone(tone: str) -> bool:
    """浅色词优先：同时写「深色点缀的浅色底」仍算浅色。"""
    text = str(tone or "")
    low = text.lower()
    if any(m in text or m in low for m in _LIGHT_MARKS):
        return False
    return any(m in text or m in low for m in _DARK_MARKS)


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _to_hex(lightness: float, chroma: float, hue: float) -> str:
    color = Color("oklch", [_clamp01(lightness), max(0.0, chroma), hue % 360.0])
    return color.convert("srgb").fit("srgb").to_string(hex=True).lower()


def _lch(hex_color: str) -> Optional[tuple[float, float, float]]:
    try:
        c = Color(hex_color).convert("oklch")
    except Exception:  # noqa: BLE001
        return None
    hue = c["hue"]
    if hue != hue:
        hue = 0.0
    return float(c["lightness"]), float(c["chroma"]), float(hue)


def _fg_for(lightness: float) -> str:
    return "#f8fafc" if lightness < 0.6 else "#0f172a"


def derive_theme_tokens(dl: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """design_language → 语义色表。header 与 sidebar 共用 chrome，不许分叉。"""
    d = normalize_design_language(dl or DEFAULT_DESIGN_LANGUAGE)
    primary = str(d["primary"])
    accent = str(d["accent"])
    got = _lch(primary) or (0.5, 0.1, 250.0)
    _l, chroma, hue = got
    surf_c = min(0.03, max(0.008, chroma * 0.25))
    dark = is_dark_tone(str(d.get("tone") or ""))
    if dark:
        background = _to_hex(0.16, surf_c, hue)
        chrome = _to_hex(0.22, surf_c, hue)
        card = _to_hex(0.26, surf_c, hue)
        muted = _to_hex(0.28, surf_c, hue)
        border = _to_hex(0.34, surf_c, hue)
        foreground = _fg_for(0.16)
    else:
        background = _to_hex(0.97, surf_c, hue)
        chrome = _to_hex(0.99, min(0.02, surf_c), hue)
        card = _to_hex(1.0, min(0.01, surf_c), hue)
        muted = _to_hex(0.95, surf_c, hue)
        border = _to_hex(0.90, surf_c, hue)
        foreground = _fg_for(0.97)
    chrome_l = (_lch(chrome) or (0.22, 0, 0))[0]
    card_l = (_lch(card) or (1.0, 0, 0))[0]
    primary_l = (_lch(primary) or (0.5, 0, 0))[0]
    return {
        "scheme": "dark" if dark else "light",
        "primary": primary,
        "accent": accent,
        "background": background,
        "foreground": foreground,
        "chrome": chrome,
        "chromeFg": _fg_for(chrome_l),
        "card": card,
        "cardFg": _fg_for(card_l),
        "muted": muted,
        "border": border,
        "primaryFg": _fg_for(primary_l),
        "radius": str(d.get("radius") or "8px"),
    }


def language_from_style_brief(brief: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """风格段赢了的那条路没有 designLanguage 字典，从散文里捞 hex / 深浅。"""
    out = dict(DEFAULT_DESIGN_LANGUAGE)
    if not isinstance(brief, dict):
        return out
    text = str(brief.get("app") or "")
    hexes = _HEX.findall(text)
    if hexes:
        out["primary"] = hexes[0].lower()
        if len(hexes) > 1:
            out["accent"] = hexes[1].lower()
    if text.strip():
        out["tone"] = " ".join(text.split())[:60]
    return normalize_design_language(out)


def resolve_theme_language(
    design_language: Optional[Dict[str, Any]] = None,
    style_brief: Optional[Dict[str, Any]] = None,
    design_system: Optional[Any] = None,
) -> Dict[str, Any]:
    if isinstance(design_language, dict) and design_language.get("primary"):
        return normalize_design_language(design_language)
    if isinstance(style_brief, dict):
        return language_from_style_brief(style_brief)
    if isinstance(design_system, str) and design_system.strip():
        return language_from_style_brief({"app": design_system})
    if isinstance(design_system, dict):
        joined = " ".join(str(v) for v in design_system.values() if v)
        return language_from_style_brief({"app": joined})
    return dict(DEFAULT_DESIGN_LANGUAGE)


def _chrome_contrast_css() -> str:
    """浅色 chrome 上，盖掉模型按深色壳写的白字 / 白高亮 / 深按钮。

    ⚠ 2026-08-20 满电青年审查：``header,aside{color:var(--chrome-fg)!important}``
    **不会**压过子元素的 ``.text-white``（继承带不走 !important）。于是：
    面包屑当前节白字看不见、菜单高亮一块白、Logo 白字、顶栏右侧一排黑按钮。
    ``[aria-current="page"]`` 还同时打在侧栏和面包屑上——面包屑被涂成白底。

    选择器与前端 html-app-surface.CHROME_CONTRAST_CSS 同文，渲染时再钉一次，
    已经生成的页刷新就能看见。

    ⚠ 同日第二趟：Logo 和标题不对齐（aside 品牌行没有 items-center，对照
    shadcn SidebarMenuButton）；有文字的侧栏停在 w-16（对照 Sidebar
    ``--sidebar-width: 16rem``）；顶栏右侧分段控件写成 bg-zinc-950，
    浅色 Header 上是一块黑。砖表补 950，宽度和品牌行也盖在这一层——
    已经生成的页刷新即生效，不必重跑推演。
    """
    light_white = ",".join(
        f'html[data-theme="light"] {surf} .{cls}'
        for surf in ("header", "aside")
        for cls in ("text-white", "text-slate-100", "text-slate-200", "text-gray-100")
    )
    light_dark_bg = ",".join(
        f'html[data-theme="light"] header .{cls}' for cls in _LIGHT_DARK_BRICKS
    )
    return (
        f"{light_white}{{color:var(--chrome-fg,#0f172a)!important}}"
        f"{light_dark_bg}{{background-color:var(--muted)!important;"
        f"color:var(--chrome-fg,#0f172a)!important}}"
        "aside nav a{box-sizing:border-box;width:100%;"
        "display:flex!important;flex-direction:row!important;"
        "align-items:center!important;gap:.5rem}"
        "aside>:first-child:not(nav):not(:has(nav)){"
        "display:flex!important;flex-direction:row!important;"
        "align-items:center!important;gap:.5rem}"
        "aside :is(img,svg){flex-shrink:0}"
        "aside:has(nav a){min-width:16rem!important;box-sizing:border-box}"
        'aside[class*="fixed"]:has(nav a),aside[class*="absolute"]:has(nav a)'
        "{width:16rem!important}"
        'aside[class*="fixed"]:has(nav a)~*,aside[class*="absolute"]:has(nav a)~*'
        "{margin-left:16rem!important}"
        'aside [aria-current="page"]{'
        "background-color:color-mix(in srgb,var(--primary,currentColor) 16%,var(--chrome,transparent))!important;"
        "color:var(--chrome-fg,inherit)!important;font-weight:600}"
        'header nav[aria-label="Breadcrumb"] [aria-current="page"],'
        'header nav[aria-label="breadcrumb"] [aria-current="page"]{'
        "background-color:transparent!important;"
        "color:var(--chrome-fg,inherit)!important;font-weight:600}"
    )


def _theme_css(tokens: Dict[str, str]) -> str:
    scheme = tokens["scheme"]
    bricks = _LIGHT_DARK_BRICKS if scheme == "light" else _DARK_LIGHT_BRICKS
    brick_sel = ",".join(
        f'html[data-theme="{scheme}"] main .{cls}' for cls in bricks
    )
    return (
        f':root{{'
        f'--background:{tokens["background"]};'
        f'--foreground:{tokens["foreground"]};'
        f'--chrome:{tokens["chrome"]};'
        f'--chrome-fg:{tokens["chromeFg"]};'
        f'--card:{tokens["card"]};'
        f'--card-fg:{tokens["cardFg"]};'
        f'--primary:{tokens["primary"]};'
        f'--primary-fg:{tokens["primaryFg"]};'
        f'--muted:{tokens["muted"]};'
        f'--border:{tokens["border"]};'
        f'--radius:{tokens["radius"]};'
        f"}}"
        f"html,body{{background-color:var(--background)!important;"
        f"color:var(--foreground)!important}}"
        # 顶栏和侧栏（含手机底栏）锁同一块 chrome。不许一边黑一边海军蓝。
        f"header,aside,nav.fixed{{background-color:var(--chrome)!important;"
        f"color:var(--chrome-fg)!important}}"
        f"{brick_sel}{{background-color:var(--card)!important;"
        f"color:var(--card-fg)!important;border-color:var(--border)!important}}"
        f"{_chrome_contrast_css()}"
    )


def _theme_config(tokens: Dict[str, str]) -> str:
    # extractPalette 只认 名字: '#rrggbb'，键必须是标识符（别加引号、别用连字符）。
    return (
        "<script>\n"
        f"/* {THEME_MARK} */\n"
        "tailwind.config = { theme: { extend: { colors: {\n"
        f"  background: '{tokens['background']}',\n"
        f"  foreground: '{tokens['foreground']}',\n"
        f"  chrome: '{tokens['chrome']}',\n"
        f"  card: '{tokens['card']}',\n"
        f"  primary: '{tokens['primary']}',\n"
        f"  muted: '{tokens['muted']}',\n"
        f"  border: '{tokens['border']}'\n"
        "} } } };\n"
        "</script>"
    )


def _set_html_theme(html: str, scheme: str) -> str:
    if re.search(r"<html\b[^>]*data-theme=", html or "", re.I):
        return re.sub(
            r'data-theme="[^"]*"',
            f'data-theme="{scheme}"',
            html,
            count=1,
            flags=re.I,
        )
    if re.search(r"<html\b", html or "", re.I):
        return re.sub(r"<html\b", f'<html data-theme="{scheme}"', html, count=1, flags=re.I)
    return f'<html data-theme="{scheme}">{html}</html>'


_STYLE_BLOCK = re.compile(
    rf'<style id="{THEME_STYLE_ID}">[\s\S]*?</style>', re.I
)
_CONFIG_BLOCK = re.compile(
    rf"<script>\s*/\* {re.escape(THEME_MARK)} \*/[\s\S]*?</script>", re.I
)


def apply_theme_to_html(html: str, tokens: Dict[str, str]) -> str:
    """给一页钉主题。幂等：已有同 id 的块就换内容。"""
    if not html:
        return html
    scheme = tokens.get("scheme") or "light"
    out = _set_html_theme(html, scheme)
    style = f'<style id="{THEME_STYLE_ID}">{_theme_css(tokens)}</style>'
    config = _theme_config(tokens)
    if _STYLE_BLOCK.search(out):
        out = _STYLE_BLOCK.sub(style, out, count=1)
    elif "</head>" in out:
        out = out.replace("</head>", style + "</head>", 1)
    else:
        out = style + out
    if _CONFIG_BLOCK.search(out):
        out = _CONFIG_BLOCK.sub(config, out, count=1)
    elif "</head>" in out:
        out = out.replace("</head>", config + "</head>", 1)
    else:
        out = config + out
    # 把跑出色板的 hex（紫图标、蓝按钮）旋回主色相。Tailwind 类名走上面 CSS。
    repaired, _n = repair_colors(
        out, [tokens["primary"], tokens["accent"]], tokens["primary"]
    )
    return repaired


def apply_theme_to_pages(
    pages: Dict[str, str],
    language: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    tokens = derive_theme_tokens(language)
    return {pid: apply_theme_to_html(html, tokens) for pid, html in (pages or {}).items()}


def theme_token_values(language: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    """测试/埋点用。"""
    return derive_theme_tokens(language)
