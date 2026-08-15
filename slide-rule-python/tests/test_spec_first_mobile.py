# -*- coding: utf-8 -*-
"""spec-first 的移动端竖屏（1080×1920）端到端接线（2026-08-14 晚）。

## 病灶

审计结论：老区块链路早有设备维度（device_policy + preferredDevice 归一），
而新链路 spec-first 把桌面横屏写死——设计系统只有「左侧固定菜单」一种壳，
画布只有 1920×1080 一种视口。用户说「手机 App」，拿到的还是带侧栏的横屏页。

## 接线的形状：一处定、处处跟

    run_spec_first        resolve_preferred_device(goal) 认一次设备
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
        for word in ["1080×1920", "底部", "<nav>", "不要左侧边栏"]:
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
