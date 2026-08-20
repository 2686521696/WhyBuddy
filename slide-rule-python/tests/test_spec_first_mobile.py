# -*- coding: utf-8 -*-
"""spec-first 的移动端竖屏（390×844 CSS 像素）端到端接线。

## 病灶

审计结论：老区块链路早有设备维度（device_policy + preferredDevice 归一），
而新链路 spec-first 把桌面横屏写死——设计系统只有「左侧固定菜单」一种壳，
画布只有 1920×1080 一种视口。用户说「手机 App」，拿到的还是带侧栏的横屏页。

2026-08-20：画布一度写成 1080×1920（物理像素）。那一档下 Tailwind `lg:`
着火，模型再套 `max-w-md` 机模，内容缩在框中间。改成 Playwright iPhone 14
同款 390×844。

## 接线的形状：一处定、处处跟

    run_spec_first        resolve_preferred_device(goal) 认一次设备
    spec_tree             phone → 切页按手机信息架构（一屏一件主任务，不写宽屏工作台）
    design_language       phone → 风格段/密度条款按竖屏单列，不点名宽表和右侧栏
    spec_page_html        phone → 移动设计系统（顶栏 + 底部标签栏，无侧栏）
    page_shell            phone → 抠 <header> + 页面级 <nav>（不是 <aside>）
    页面事件 / 产物        每一份都带 device，前端据此选竖屏画布

词表沿用 device_policy 的 Device（"desktop"/"phone"），不另发明。
"""

import pytest

from services import spec_first_pipeline as sfp
from services.page_shell import check_shell_consistency, unify_shell
from services.spec_page_html import build_page_html_prompt


class Test页面提示词:
    def test_phone换移动设计系统(self):
        p = build_page_html_prompt("某页", device="phone")
        for word in ["390×844", "底部", "<nav>", "不要左侧边栏", "pb-32", "个人资料", "max-w-md", "44px", "正中"]:
            assert word in p, f"移动设计系统里少了「{word}」"
        assert "<aside> 固定主导航" not in p, "移动端不该有左侧栏"

    def test_desktop缺省即桌面(self):
        assert build_page_html_prompt("某页") == build_page_html_prompt("某页", device="desktop")

    def test_桌面要左侧栏_移动不要(self):
        """⚠ 这条钉的是**两边分岔本身**，不是某一版的措辞。

        2026-08-15 晚提密度时改了桌面设计系统，原来那条「逐字一致」当场红——
        它钉的是措辞，而措辞本来就该能改。留下的是真正不该变的那一条：
        桌面有 <aside> 左侧栏、移动端没有。page_shell 抠壳按这个分岔走，
        写反了移动端整套判据静默失效。

        ⚠ 同一晚设计系统又劈成「契约 + 可注入风格」，措辞第二次变——
          所以这里只钉 `<aside>` 这个**标签本身**，它是 extract_shell
          真正 search 的东西，措辞怎么改都绕不开它。
        """
        desk = build_page_html_prompt("某页", device="desktop")
        phone = build_page_html_prompt("某页", device="phone")
        assert "<aside>" in desk and "不要左侧边栏" not in desk
        assert "不要 <aside>" in phone or "不要左侧边栏" in phone


def _phone_page(brand: str, role: str, nav_labels: list[str], active: int) -> str:
    """一份合成的移动端页面：<header> 顶栏 + 底部 <nav> 标签栏，无 <aside>。"""
    links = []
    for i, label in enumerate(nav_labels):
        cls = "tab active-tab" if i == active else "tab"
        links.append(f'<a href="#" class="{cls}"><svg viewBox="0 0 1 1"></svg><span>{label}</span></a>')
    return (
        "<!DOCTYPE html><html><head></head><body>"
        f"<header><h1>{brand}</h1><span>{role}</span></header>"
        "<main>正文内容</main>"
        f'<nav class="bottom-bar">{"".join(links)}</nav>'
        "</body></html>"
    )


SPEC = {
    "appName": "维保云",
    "personas": [{"id": "u1", "name": "维修主管", "goals": []}],
    "pages": [{"id": "p1", "name": "工单"}, {"id": "p2", "name": "档案"}],
}


class Test移动壳统一:
    def test_顶栏与底部标签栏统一_导航按spec锚定(self):
        pages = {
            # 两页各编了产品名/角色/菜单——正是桌面版治过的那个病，移动同款
            "p1": _phone_page("智维工单", "李师傅", ["工单", "我的"], 0),
            "p2": _phone_page("维保云", "李主管", ["首页", "档案", "统计"], 1),
        }
        out = unify_shell(pages, SPEC, device="phone")
        assert out["navAnchored"] is True
        assert out["appName"] == "维保云"
        for pid, html in out["pages"].items():
            assert "<aside" not in html
            assert "维保云" in html, "产品名没统一进顶栏"
            assert 'data-page-id="p1"' in html and 'data-page-id="p2"' in html
            assert html.count('aria-current="page"') == 1, "每页要恰好标一个当前页"
        assert check_shell_consistency(out["pages"], SPEC) == [], "统一完还有不一致"

    def test_未闭合注释里的底栏要捞出来(self):
        """真机 p3：``<!-- 底部固定的 <nav`` 没有闭合，底栏整段进注释。"""
        from services.page_shell import ensure_nav_not_commented

        raw = (
            "<!DOCTYPE html><html><body><header>维保云</header><main>列表</main>"
            "<!-- 底部固定的 <nav class='bottom-bar'><a class='tab'>工单</a>"
            "<a class='tab'>档案</a></nav></body></html>"
        )
        pages = {"p1": raw, "p2": _phone_page("维保云", "维修主管", ["工单", "档案"], 1)}
        out = unify_shell(pages, SPEC, device="phone")
        html = out["pages"]["p1"]
        nav_at = html.lower().find("<nav")
        comment_at = html.rfind("<!--", 0, nav_at + 1) if nav_at >= 0 else -1
        close_at = html.find("-->", comment_at, nav_at) if comment_at >= 0 else 0
        assert nav_at >= 0
        assert comment_at < 0 or close_at >= 0, "nav 仍困在未闭合注释里"
        assert 'data-page-id="p1"' in html
        # 已闭合的注释不许误伤
        closed = "<!-- 底部固定的导航栏 --><nav><a class='tab'>工单</a><a class='tab'>档案</a></nav>"
        assert "<nav>" in ensure_nav_not_commented(closed)
        assert "<!-- 底部固定的导航栏 -->" in ensure_nav_not_commented(closed)

    def test_精修后导航id不叠两个_底栏不带产品名前缀(self):
        """模板链接已有 data-page-id 时再盖一层，HTML 认第一个，点哪都跳错页。"""
        from services.page_shell import nav_tab_label

        assert nav_tab_label("团长帮 - 核销首页", "团长帮") == "核销首页"
        assert nav_tab_label("订单详情 - 团长帮", "团长帮") == "订单详情"
        assert nav_tab_label("工单", "维保云") == "工单"

        src = _phone_page("维保云", "维修主管", ["工单", "档案"], 0)
        src = src.replace("<a href", '<a data-page-id="p9" href', 1)
        pages = {"p1": src, "p2": _phone_page("维保云", "维修主管", ["工单", "档案"], 1)}
        spec = {
            "appName": "维保云",
            "personas": SPEC["personas"],
            "pages": [
                {"id": "p1", "name": "维保云 - 工单"},
                {"id": "p2", "name": "档案页"},
            ],
        }
        out = unify_shell(pages, spec, device="phone")
        html = out["pages"]["p1"]
        assert 'data-page-id="p9"' not in html
        nav = html[html.lower().find("<nav") : html.lower().find("</nav>")]
        assert nav.count("data-page-id=") == 2
        assert nav.count("<a") == 2
        assert nav.count('data-page-id="p1"') == 1
        assert nav.count('data-page-id="p2"') == 1
        assert "维保云 - 工单" not in nav
        assert ">工单</span>" in nav


    def test_底栏钉住且main让出高度(self):
        """模型漏写 fixed / pb-32 时由壳补——否则列表最后几行被标签栏盖住。"""
        pages = {
            "p1": _phone_page("维保云", "维修主管", ["工单", "档案"], 0),
            "p2": _phone_page("维保云", "维修主管", ["工单", "档案"], 1),
        }
        out = unify_shell(pages, SPEC, device="phone")
        for html in out["pages"].values():
            assert "fixed" in html and "bottom-0" in html
            assert "pb-32" in html
            assert 'id="sliderule-phone-fill"' in html
            assert "justify-around" in html
            assert "flex-direction:row" in html

    def test_已有fixed的底栏也要横排_不能竖着堆(self):
        """幼安行 r2：nav 已有 fixed，旧逻辑不再补 class，五个入口竖着堆半屏。"""
        from services.page_shell import ensure_phone_safe_area, ensure_phone_viewport_fill

        src = (
            "<!DOCTYPE html><html><head></head><body>"
            "<header>维保云</header><main class='pb-32'>列表</main>"
            "<nav class=\"fixed inset-x-0 bottom-0 z-20 flex-col\">"
            "<a class='tab'>工单</a><a class='tab'>档案</a></nav>"
            "</body></html>"
        )
        out = ensure_phone_safe_area(src)
        nav = out[out.lower().find("<nav") : out.lower().find("</nav>")]
        assert "flex-col" not in nav.split(">")[0]
        assert "flex" in nav.split(">")[0]
        assert "justify-around" in nav.split(">")[0]
        stale = (
            '<html><head><style id="sliderule-phone-fill">nav{width:100%}</style></head>'
            "<body>中文</body></html>"
        )
        filled = ensure_phone_viewport_fill(stale)
        assert filled.count('id="sliderule-phone-fill"') == 1
        assert "flex-direction:row" in filled

    def test_机模css撑满视口且幂等(self):
        """max-w-md 居中卡片不删，用 CSS 盖掉——模型爱写，提示词拦不住。"""
        from services.page_shell import ensure_phone_viewport_fill

        src = (
            '<!DOCTYPE html><html><head></head>'
            '<body class="flex items-center justify-center min-h-screen">'
            '<div class="max-w-md mx-auto w-[390px]">内容</div>'
            "</body></html>"
        )
        once = ensure_phone_viewport_fill(src)
        twice = ensure_phone_viewport_fill(once)
        assert once.count('id="sliderule-phone-fill"') == 1
        assert twice.count('id="sliderule-phone-fill"') == 1
        assert "max-width:none!important" in once
        assert "flex-direction:column" in once
        assert "overflow-y:auto!important" in once
        assert 'body>div[class*="justify-center"]' in once
        assert "main{display:flex" not in once
        # items-center 单独当选择器会误伤顶栏
        assert 'body>div[class*="items-center"]{' not in once
        assert "max-w-md" in once  # 原文还在，靠 CSS 覆盖

    def test_铺满css与前端同文关键选择器(self):
        """Python / TS 两份铺满 CSS 必须盯同一类容器，改一处忘一处会再伤顶栏。"""
        from pathlib import Path

        from services.page_shell import _PHONE_FILL_CSS

        ts = (
            Path(__file__).resolve().parents[2]
            / "client/src/pages/sliderule/live-runtime/html-app-surface.tsx"
        ).read_text(encoding="utf-8")
        for token in (
            "overflow-y:auto!important",
            'body>div[class*="min-h-screen"]',
            'body>div[class*="justify-center"]',
            "-webkit-overflow-scrolling:touch",
            "flex-direction:row",
            "justify-content:space-around",
        ):
            assert token in _PHONE_FILL_CSS, token
            assert token in ts, token
        assert 'body>div[class*="items-center"]{' not in _PHONE_FILL_CSS
        assert "main{display:flex" not in _PHONE_FILL_CSS
        assert "main{display:flex" not in ts

    def test_一致性判据认得页面级nav(self):
        """移动页没有 <aside>，判据要回落到整页找 <nav>——不然移动端
        的菜单漂移全部静默。"""
        pages = {
            "p1": _phone_page("维保云", "维修主管", ["工单", "档案"], 0),
            "p2": _phone_page("维保云", "维修主管", ["工单", "别的", "多余"], 1),
        }
        problems = check_shell_consistency(pages, SPEC)
        assert any("nav" in p["path"] for p in problems), "p2 菜单跟 spec 对不上却没人喊"


class Test管道一处定处处跟:
    def _wire(self, monkeypatch, captured):
        monkeypatch.setattr(
            "services.spec_tree.generate_spec_tree",
            lambda *a, **k: dict(SPEC, nodes=[]),
        )

        def _pages(spec, **kw):
            captured["gen_device"] = kw.get("device")
            return {"pages": {"p1": "<html>1</html>", "p2": "<html>2</html>"}, "failed": {}}

        monkeypatch.setattr("services.spec_page_html.generate_pages_parallel", _pages)

        def _shell(pages, spec, **kw):
            captured["shell_device"] = kw.get("device")
            return {"pages": pages, "navItems": []}

        monkeypatch.setattr("services.page_shell.unify_shell", _shell)
        monkeypatch.setattr("services.page_shell.check_shell_consistency", lambda *a, **k: [])
        monkeypatch.setattr(
            "services.html_structure.derive_structure", lambda *a, **k: {"entities": [], "pages": []}
        )
        monkeypatch.setattr("services.spec_semantics.derive_semantics", lambda *a, **k: {"roles": []})
        monkeypatch.setattr("services.model_assembly.assemble", lambda *a, **k: {"model": {"ok": 1}})
        monkeypatch.setattr(
            "services.html_bindings.bind_pages",
            lambda pages, model, **kw: {"pages": pages, "failed": {}},
        )

    def test_手机话题_全链带phone_事件带device(self, monkeypatch):
        captured: dict = {}
        events: list = []

        def sink(pid, html, done, total, bound=False, device=None):
            events.append(device)

        self._wire(monkeypatch, captured)
        out = sfp.run_spec_first("给维修队做一个手机 App", on_page=sink)
        assert captured["gen_device"] == "phone"
        assert captured["shell_device"] == "phone"
        assert out["device"] == "phone"
        assert sfp.take_last_pages()["device"] == "phone"
        assert events and all(d == "phone" for d in events), "页面事件没带 device——竖屏页会进横屏画布"

    def test_普通话题默认desktop(self, monkeypatch):
        captured: dict = {}
        self._wire(monkeypatch, captured)
        out = sfp.run_spec_first("做一个订单管理网站")
        assert captured["gen_device"] == "desktop"
        assert out["device"] == "desktop"
        sfp.take_last_pages()  # 清暂存，别污染别的用例
