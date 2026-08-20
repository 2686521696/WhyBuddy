"""主题锁：顶栏/侧栏同一套 chrome，卡片不许跟主题对着干。

正向：浅色不搜深砖、深色 Header 与 aside 同色、通用后台换成产品名。
反向：没接进 unify / pipeline 的调用点，函数写对也等于没修。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.design_language import DEFAULT_DESIGN_LANGUAGE  # noqa: E402
from services.theme_tokens import (  # noqa: E402
    THEME_MARK,
    THEME_STYLE_ID,
    apply_theme_to_html,
    apply_theme_to_pages,
    derive_theme_tokens,
    is_dark_tone,
    language_from_style_brief,
    resolve_theme_language,
)

DARK_PAGE = """<!doctype html><html><head></head><body>
<header class="bg-black text-white">顶栏</header>
<aside class="bg-slate-800 text-white">侧栏</aside>
<main>
  <div class="bg-white p-4">突然一块白卡</div>
</main>
</body></html>"""

LIGHT_PAGE = """<!doctype html><html><head></head><body>
<header class="bg-white">顶栏</header>
<aside class="bg-slate-50">侧栏</aside>
<main>
  <div class="bg-slate-900 text-white p-6">系统设置</div>
  <div class="bg-black">数据监控</div>
</main>
</body></html>"""


class Test深浅判断:
    def test_浅色词优先(self):
        assert is_dark_tone("企业后台风格，浅色底") is False
        assert is_dark_tone("深色点缀的浅色底") is False

    def test_深色调(self):
        assert is_dark_tone("科技感深色仪表盘") is True
        assert is_dark_tone("dark neon console") is True


class Test语义色:
    def test_header与sidebar共用chrome(self):
        """shadcn 允许 sidebar 略深一档；真机病是两边各发明一个深色，所以焊死同一值。"""
        dark = derive_theme_tokens({"tone": "科技感深色", "primary": "#0ea5e9"})
        light = derive_theme_tokens({"tone": "浅色底", "primary": "#0ea5e9"})
        assert dark["scheme"] == "dark" and light["scheme"] == "light"
        assert dark["chrome"]
        css = apply_theme_to_html(DARK_PAGE, dark)
        compact = css.replace("\n", "")
        assert "header,aside,nav.fixed{background-color:var(--chrome)" in compact
        assert dark["chrome"] != dark["background"]

    def test_浅色页深砖被改写成卡片色(self):
        tokens = derive_theme_tokens({"tone": "浅色底", "primary": "#2563eb"})
        out = apply_theme_to_html(LIGHT_PAGE, tokens)
        assert 'data-theme="light"' in out
        assert 'html[data-theme="light"] main .bg-slate-900' in out
        assert 'html[data-theme="light"] main .bg-black' in out
        assert THEME_STYLE_ID in out
        assert THEME_MARK in out

    def test_深色页白卡被改写成卡片色(self):
        tokens = derive_theme_tokens({"tone": "深色", "primary": "#0ea5e9"})
        out = apply_theme_to_html(DARK_PAGE, tokens)
        assert 'data-theme="dark"' in out
        assert 'html[data-theme="dark"] main .bg-white' in out

    def test_幂等(self):
        tokens = derive_theme_tokens(DEFAULT_DESIGN_LANGUAGE)
        once = apply_theme_to_html(LIGHT_PAGE, tokens)
        twice = apply_theme_to_html(once, tokens)
        assert twice.count(f'id="{THEME_STYLE_ID}"') == 1
        assert twice.count(THEME_MARK) == 1

    def test_风格段散文也能抽出主色(self):
        lang = language_from_style_brief({
            "app": "科技感深色，主色 #0ea5e9，强调 #22d3ee。",
            "pages": {"p1": "地图"},
        })
        assert lang["primary"] == "#0ea5e9"
        assert is_dark_tone(lang["tone"]) is True

    def test_人写散文走resolve(self):
        lang = resolve_theme_language(None, None, "浅色底，主色 #0f766e")
        assert lang["primary"] == "#0f766e"


class Test接在活路上:
    def test_pipeline在unify之后钉主题(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        src = open(
            os.path.join(root, "services", "spec_first_pipeline.py"),
            encoding="utf-8",
        ).read()
        # 用赋值语句定位，不用 ident 全文搜索——模块头文档会把
        # unify_shell 这个词带跑，三引号剥错还会把这段代码吃掉。
        i = src.index("shell = unify_shell(pages, spec, device=device)")
        j = src.index("pages = apply_theme_to_pages(pages, _theme_lang)")
        k = src.index("_reemit_pages(sink, pages, bound=False)")
        assert i < j < k
        assert "resolve_theme_language(" in src[i:k]
        # 打孔会整页重写。主题必须在 repair_pages_after_bind 之后再钉一次，
        # 否则用户看见的 bound=True 成品页又漂回去。删掉后半段，这条必红。
        bind_at = src.index("repair_pages_after_bind(")
        j2 = src.index(
            "pages = apply_theme_to_pages(pages, _theme_lang)", bind_at
        )
        assert j2 > bind_at
        assert src.index("_reemit_pages(sink, pages, bound=True)") > j2

    def test_多页一起钉(self):
        tokens_lang = {"tone": "浅色底", "primary": "#2563eb"}
        out = apply_theme_to_pages({"p1": LIGHT_PAGE, "p2": LIGHT_PAGE}, tokens_lang)
        assert all(THEME_STYLE_ID in html for html in out.values())
        assert all('data-theme="light"' in html for html in out.values())

    def test_注入形状extractPalette读得动(self):
        """跟 html-app-surface.extractPalette 配对：键是标识符，值是 '#rrggbb'。"""
        tokens = derive_theme_tokens({"tone": "深色", "primary": "#0ea5e9"})
        html = apply_theme_to_html("<html><head></head><body></body></html>", tokens)
        assert "chrome: '" in html
        assert "background: '" in html
        assert re.search(r"colors:\s*\{\n\s*background:", html)

    def test_浅色顶栏白字和高亮被盖住(self):
        """★ 满电青年：面包屑/菜单 text-white 在浅 chrome 上看不见。"""
        tokens = derive_theme_tokens({"tone": "浅色底", "primary": "#2563eb"})
        src = (
            "<html><head></head><body>"
            '<header class="text-white"><nav aria-label="Breadcrumb">'
            '<a aria-current="page" class="text-white">当前页</a></nav>'
            '<button class="bg-slate-900">发布</button></header>'
            '<aside><a aria-current="page" class="text-white">甲</a></aside>'
            "</body></html>"
        )
        out = apply_theme_to_html(src, tokens)
        assert 'html[data-theme="light"] header .text-white' in out
        assert 'html[data-theme="light"] header .bg-slate-900' in out
        assert 'aside [aria-current="page"]' in out
        assert 'nav[aria-label="Breadcrumb"] [aria-current="page"]' in out
        assert "aside nav a{box-sizing:border-box;width:100%;" in out.replace("\n", "")
        assert 'html[data-theme="light"] header .bg-zinc-950' in out
        assert "min-width:16rem" in out
        assert "align-items:center" in out

    def test_对比层与前端同文(self):
        from services.theme_tokens import _chrome_contrast_css

        ts = open(
            os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "..",
                "client",
                "src",
                "pages",
                "sliderule",
                "live-runtime",
                "html-app-surface.tsx",
            ),
            encoding="utf-8",
        ).read()
        css = _chrome_contrast_css()
        for token in (
            'html[data-theme="light"] header .text-white',
            "aside nav a{box-sizing:border-box;width:100%;",
            'aside [aria-current="page"]',
            'nav[aria-label="Breadcrumb"] [aria-current="page"]',
            "min-width:16rem",
            "bg-zinc-950",
            "align-items:center",
        ):
            assert token in css, token
            assert token in ts, token
