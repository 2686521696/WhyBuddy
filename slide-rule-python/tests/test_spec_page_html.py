# -*- coding: utf-8 -*-
"""第 3 步：spec 的每一页 → HTML（直出，不经图）。

这组测试钉三件事：口径真的抄了 screenshot-to-code、失败不许回落占位、
以及「这里不打 data-* 洞」这条分工不许被人顺手改回去。
"""

import pytest

from services import spec_page_html as sph


SPEC = {
    "rootNodeId": "n0",
    "successCriteria": [{"id": "sc1", "text": "报修能闭环"}],
    "nodes": [
        {"id": "n0", "type": "requirement", "title": "提交报修工单",
         "acceptance": "当报修人提交故障信息时，系统应生成唯一工单并展示工单编号。"},
        {"id": "n1", "type": "design", "title": "入口设计",
         "notes": "以设备报修为入口，建立清晰的工单创建流程。"},
        {"id": "n9", "type": "requirement", "title": "别的页才管的事",
         "acceptance": "这条不该出现在本页的 brief 里。"},
    ],
    "pages": [{"id": "p1", "name": "报修登记页", "audience": "报修人",
               "purpose": "提交故障并拿到工单号", "coversNodes": ["n0", "n1"]}],
}
PAGE = SPEC["pages"][0]

_OK_HTML = (
    "<!doctype html><html><head>"
    '<script src="https://cdn.tailwindcss.com"></script>'
    "</head><body><h1>报修登记</h1><table><th>工单编号</th></table></body></html>"
)


class Test页面简报只取本页覆盖到的需求:
    def test_带上页面身份三件套(self):
        brief = sph.build_page_brief(PAGE, SPEC)
        for want in ("报修登记页", "报修人", "提交故障并拿到工单号"):
            assert want in brief

    def test_acceptance_与_notes_原文进简报(self):
        brief = sph.build_page_brief(PAGE, SPEC)
        assert "系统应生成唯一工单并展示工单编号" in brief
        assert "以设备报修为入口" in brief

    def test_不把整棵树倒进去(self):
        """倒整棵树会让每一页长得一样——spec 的页面清单本来就是按职责切好的。"""
        assert "这条不该出现在本页的 brief 里" not in sph.build_page_brief(PAGE, SPEC)

    def test_引用不存在的节点不炸(self):
        page = {**PAGE, "coversNodes": ["n0", "不存在"]}
        assert "系统应生成唯一工单" in sph.build_page_brief(page, SPEC)


class Test口径抄的是_screenshot_to_code:
    """自己另发明一套，是今天让整轮对照失去意义的那个错（runner.py:220）。
    这一步现在在主链路上，更不该用手写版。"""

    def test_四段都在(self):
        p = sph.build_page_html_prompt("页面：报修登记页")
        assert p.startswith("Generate UI for ")           # create/text.py 的开头
        assert "Selected stack: html_tailwind." in p      # build_selected_stack_policy
        assert "## Design system" in p                    # build_design_system_prompt_block
        assert "# Instructions" in p

    def test_三条_instructions_逐字(self):
        p = sph.build_page_html_prompt("x")
        for line in (
            "- Make sure to make it look modern and sleek.",
            "- Use modern, professional fonts and colors.",
            "- Follow UX best practices.",
        ):
            assert line in p

    def test_image_policy_取_disabled_那一支(self):
        """这个 harness 没有 generate_images 工具，抄 enabled 那支等于让模型
        去调不存在的东西。"""
        p = sph.build_page_html_prompt("x")
        assert "Image generation is disabled for this request." in p
        assert "Do not call generate_images." in p

    def test_设计系统带冲突优先级声明(self):
        p = sph.build_page_html_prompt("x")
        assert "prioritize the design system" in p

    def test_占位必须是可读中文这条在里面(self):
        """这条在参照图那边早就有，改两段式时漏掉过一次，实测灰条当场复发。"""
        p = sph.build_page_html_prompt("x")
        assert "不许用灰色横条或色块代替" in p


class Test机械校验只挡明显不完整的:
    def test_合格的过(self):
        assert sph.validate_page_html(_OK_HTML) == []

    def test_截断能被抓住(self):
        """推理模型思考吃光预算、正文写一半就停，而 finish_reason 不会喊。
        收尾标签是最便宜的判据。"""
        assert any("截断" in p for p in sph.validate_page_html(_OK_HTML[:-40]))

    def test_没引_tailwind_算违约(self):
        bad = _OK_HTML.replace('<script src="https://cdn.tailwindcss.com"></script>', "")
        assert any("Tailwind" in p for p in sph.validate_page_html(bad))

    def test_一个中文都没有算违约(self):
        bad = "<!doctype html><html><head>" \
              '<script src="https://cdn.tailwindcss.com"></script>' \
              "</head><body><h1>Repair</h1></body></html>"
        assert any("中文" in p for p in sph.validate_page_html(bad))

    @pytest.mark.parametrize("lead", ["Here is the HTML:", "好的，这是页面："])
    def test_正文前带解释算违约(self, lead):
        assert sph.validate_page_html(lead + _OK_HTML)

    def test_不判丰富度(self):
        """丰富度只能渲染出来用眼睛看。今天在「造个数替代看一眼」上栽了四次：
        数字段 / 数语义标签 / 拿没加载 Tailwind 的截图当证据。
        机械判据只负责挡住「明显不是一份完整页面」的东西。"""
        import inspect

        src = inspect.getsource(sph.validate_page_html)
        for forbidden in ("区域数", "控件种类", "richness", "score"):
            assert forbidden not in src


class Test失败不回落占位:
    def test_校验一直不过就抛(self):
        class _R:
            content = "<html>没收尾也没 tailwind"

        with pytest.raises(sph.SpecPageHtmlError) as exc:
            sph.generate_page_html(PAGE, SPEC, llm_call=lambda *a, **k: _R(), max_attempts=2)
        assert "p1" in str(exc.value)

    def test_重试一次能救回来就算过(self):
        seen = {"n": 0}

        class _R:
            def __init__(self, c):
                self.content = c

        def _call(*_a, **_k):
            seen["n"] += 1
            return _R("<html>坏的" if seen["n"] == 1 else _OK_HTML)

        out = sph.generate_page_html(PAGE, SPEC, llm_call=_call, max_attempts=2)
        assert out["pageId"] == "p1" and seen["n"] == 2

    def test_围栏被剥掉(self):
        class _R:
            content = "```html\n" + _OK_HTML + "\n```"

        out = sph.generate_page_html(PAGE, SPEC, llm_call=lambda *a, **k: _R())
        assert out["html"].startswith("<!doctype html")


class Test这里不打_data_洞:
    """第 3 步在上游，datamodel 还不存在——它要到第 4 步才从这份 HTML 反推。

    在这里写 data-field="resident.name" 是引用一个还没被发明的 id，校验不了；
    而校验不了的绑定就是下一个 DANGLING（旧模板库那些指向组件夹具的绑定，
    丢进真实话题必被结构闸拦下，是同一个形状）。
    """

    @pytest.mark.parametrize("hole", ["data-fact", "data-field", "data-chart", "data-rows"])
    def test_提示词不许要求打洞(self, hole):
        assert hole not in sph.build_page_html_prompt("x")

    def test_校验器不许开始认这些洞(self):
        import inspect

        src = inspect.getsource(sph.validate_page_html)
        assert "data-" not in src, (
            "第 3 步开始认 data-* 了——那是第 6 步的事。"
            "分工写在 spec_page_html 的模块 docstring 里，改之前先读它。"
        )
