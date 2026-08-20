# -*- coding: utf-8 -*-
"""打开态 Slide-over 必须收成 hidden。

2026-08-20 巡检 p3：模型把 Tailwind UI 打开态快照当首屏，``fixed inset-0``
挡住菜单。提示词拦不住（同会话 p1 会写 hidden）。中和，不判死刑。
把 conceal_open_overlays 从 generate_page_html 拿掉，本文件必须红。
"""

from services import spec_page_html as sph
from services.html_bindings import bind_page
from tests.test_spec_page_html import PAGE, SPEC, _OK_HTML


def _page_with(inner: str) -> str:
    return _OK_HTML.replace("</body>", inner + "</body>")


OPEN_DRAWER = (
    '<div class="fixed inset-0 bg-black/60 z-50 flex justify-end">'
    '<div class="w-[480px] h-full bg-white">工单调度详情'
    "<button>关闭</button></div></div>"
)


def _called_names(fn) -> list:
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(fn))
    return [
        n.func.id
        for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
    ]


class Test打开态浮层收成hidden:
    def test_fixed_inset_0_gets_hidden(self):
        out = sph.conceal_open_overlays(_page_with(OPEN_DRAWER))
        assert "工单调度详情" in out
        assert "hidden" in out
        assert "display:none!important" in out.replace(" ", "")

    def test_already_hidden_untouched(self):
        html = _page_with(
            '<div class="fixed inset-0 z-50 flex justify-end hidden">'
            "<span>上报抽屉</span></div>"
        )
        assert sph.conceal_open_overlays(html) == html

    def test_bottom_nav_is_not_overlay(self):
        html = _page_with(
            '<nav class="fixed inset-x-0 bottom-0 z-20">巡检</nav>'
        )
        assert sph.conceal_open_overlays(html) == html

    def test_image_absolute_inset_is_not_overlay(self):
        html = _page_with(
            '<div class="absolute inset-0 bg-black opacity-0">预览</div>'
        )
        assert sph.conceal_open_overlays(html) == html

    def test_hidden_is_in_the_overlay_class(self):
        """变异：conceal 若漏掉 class hidden，本条红。"""
        raw = _page_with(OPEN_DRAWER)
        overlay_cls = next(
            chunk.split('"')[0]
            for chunk in sph.conceal_open_overlays(raw).split('class="')
            if "inset-0" in chunk
        )
        assert "hidden" in overlay_cls.split()

    def test_open_overlay_does_not_fail_the_page(self):
        """Foclip 教训：中和，不 fail-closed 丢掉这一页。"""
        html = _page_with(OPEN_DRAWER)
        assert sph.validate_page_html(html) == []
        assert sph.validate_page_html(sph.conceal_open_overlays(html)) == []

    def test_generate_page_html_calls_conceal(self):
        assert "conceal_open_overlays" in _called_names(sph.generate_page_html)

    def test_edit_page_html_calls_conceal(self):
        """只改 generate 等于精修后又焊死。把 edit 里那行拿掉，本条必须红。"""
        assert "conceal_open_overlays" in _called_names(sph.edit_page_html)

    def test_generate_output_is_concealed(self):
        class _R:
            content = _page_with(OPEN_DRAWER)

        out = sph.generate_page_html(PAGE, SPEC, llm_call=lambda *a, **k: _R())
        assert "工单调度详情" in out["html"]
        assert "hidden" in out["html"]
        assert "fixed inset-0" in out["html"]

    def test_contract_requires_closed_overlays(self):
        prompt = sph.build_page_html_prompt("x")
        assert "fixed inset-0" in prompt
        assert "hidden" in prompt


class Test打孔后也要再收一次:
    def test_bind_page_calls_conceal(self):
        """打孔 LLM 常把 hidden 剥掉。只改 generate 等于 bind 后又焊死。"""
        assert "conceal_open_overlays" in _called_names(bind_page)
