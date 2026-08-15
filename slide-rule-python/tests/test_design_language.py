"""第 2.5 步：按应用定设计语言（2026-08-15 晚）。

## 为什么链路里要多这一步

原来「起草规格」直接跳到「逐页画界面」，中间没有"这个应用长什么样"的环节——
不管什么业务出来都是同一个模子。参照的那批企业级后台之所以各有各的样子，
是因为每个产品先定了自己的设计语言。

## 分工：LLM 出判断，代码出格式

模型给的是好判断的东西（hex、枚举档位、组件名）；散文由 `render_design_language`
**确定性**渲染，DTCG 的颜色分量由 `to_dtcg` 从 hex 算。

⚠ 为什么不让模型直接写散文：那样覆盖就没法逐字段做，而且同一份输入每次
  渲染都不一样——同一个应用两次生成两种样子。
⚠ 为什么不让模型写 DTCG：`{"colorSpace":"srgb","components":[…],"hex":"…"}`
  里那三个分量必须跟 hex 自洽，模型写偏了**没有任何一处会报警**，
  颜色只是悄悄不对。这类"错了不响"的东西一律归代码。

## ⚠ 契约不经过这一步

本模块只出风格。它要是能写 <aside>、面包屑、Tailwind，LLM 一句
「去掉侧边导航」就能让 page_shell 抠不到壳，而整套外壳判据会静默全绿
（2026-08-15 当天栽过两次同型）。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.design_language import (  # noqa: E402
    DEFAULT_DESIGN_LANGUAGE,
    DENSITIES,
    build_design_language_prompt,
    generate_design_language,
    merge_override,
    normalize_design_language,
    render_design_language,
    to_dtcg,
)
from services.spec_page_html import build_page_html_prompt  # noqa: E402

SPEC = {
    "appName": "邻里药安",
    "pages": [
        {"id": "p1", "name": "经营监控看板", "purpose": "看当日销售与库存预警"},
        {"id": "p2", "name": "库存台账管理页", "purpose": "按批次管理效期"},
    ],
}

GOOD = {
    "tone": "克制的医疗后台，浅色底",
    "primary": "#0E7490",
    "accent": "#0F172A",
    "radius": "6px",
    "density": "紧凑",
    "components": ["状态标签", "进度条", "时间线"],
    "charts": True,
}


class Test收进封闭形状:
    def test_好的原样收下(self):
        d = normalize_design_language(GOOD)
        assert d["primary"] == "#0e7490" and d["density"] == "紧凑"
        assert d["components"] == ["状态标签", "进度条", "时间线"]

    @pytest.mark.parametrize("bad", ["蓝色", "#GGG", "#2563eb00", "", None, 123, "rgb(1,2,3)"])
    def test_颜色写不对就退缺省(self, bad):
        d = normalize_design_language({**GOOD, "primary": bad})
        assert d["primary"] == DEFAULT_DESIGN_LANGUAGE["primary"]

    def test_密度不在词表里就退缺省(self):
        assert normalize_design_language({"density": "超级紧凑"})["density"] == "标准"

    @pytest.mark.parametrize("d", DENSITIES)
    def test_词表内的都认(self, d):
        assert normalize_design_language({"density": d})["density"] == d

    def test_一个字段瞎写不牵连其它字段(self):
        """⚠ 逐字段兜底，不是整份丢：模型常常九个对一个瞎写，
        整份丢等于把对的九个也扔了。"""
        d = normalize_design_language({**GOOD, "radius": "很圆"})
        assert d["radius"] == DEFAULT_DESIGN_LANGUAGE["radius"]
        assert d["primary"] == "#0e7490", "一个字段坏了把别的也带走了"

    @pytest.mark.parametrize("junk", [None, "字符串", [], 42])
    def test_整个不是字典也不炸(self, junk):
        assert normalize_design_language(junk) == DEFAULT_DESIGN_LANGUAGE

    def test_组件去重并截断(self):
        d = normalize_design_language({"components": ["chip", "chip"] + [f"c{i}" for i in range(20)]})
        assert len(d["components"]) <= 8 and d["components"].count("chip") == 1


class Test渲染成散文:
    def test_确定性(self):
        """同一份输入渲染两次必须一模一样——否则同一个应用两次生成两种样子。"""
        assert render_design_language(GOOD) == render_design_language(GOOD)

    def test_关键字段都进散文(self):
        s = render_design_language(GOOD)
        for mark in ["克制的医疗后台", "#0e7490", "6px", "紧凑", "状态标签"]:
            assert mark in s

    def test_不要图表就不提图表(self):
        assert "图表" not in render_design_language({**GOOD, "charts": False})

    def test_没组件就不写那一行(self):
        assert "按内容需要用这些组件" not in render_design_language({**GOOD, "components": []})

    def test_空的也能渲染(self):
        assert render_design_language(None).strip()


class Test风格不许碰契约:
    """⚠ **本文件最要紧的一组**。"""

    @pytest.mark.parametrize("word", ["aside", "面包屑", "Breadcrumb", "Tailwind", "<header>"])
    def test_散文里不出现结构词(self, word):
        assert word not in render_design_language(GOOD)

    def test_提示词里不许诱导模型谈结构(self):
        msgs = build_design_language_prompt(SPEC)
        joined = " ".join(m["content"] for m in msgs)
        for word in ["aside", "面包屑", "Tailwind"]:
            assert word not in joined
        assert "只谈风格" in joined

    def test_注进槽位后契约仍在(self):
        """端到端：生成的风格塞进第 3 步的槽位，结构契约照旧由代码拼在后面。"""
        p = build_page_html_prompt("某页", design_system=render_design_language(GOOD))
        assert "克制的医疗后台" in p
        assert "<aside>" in p and 'aria-current="page"' in p


class Test覆盖:
    def test_逐字段盖(self):
        out = merge_override(normalize_design_language(GOOD), {"density": "宽松"})
        assert out["density"] == "宽松" and out["primary"] == "#0e7490"

    @pytest.mark.parametrize("empty", [None, {}])
    def test_没给覆盖就原样(self, empty):
        base = normalize_design_language(GOOD)
        assert merge_override(base, empty) == base

    def test_覆盖也要过一遍归一化(self):
        """⚠ 人也会写错。覆盖绕过校验的话，一个 '蓝色' 就能把颜色写坏，
        而它比模型写错更难查——因为"人写的"听起来像可信的。"""
        out = merge_override(normalize_design_language(GOOD), {"primary": "蓝色"})
        assert out["primary"] == DEFAULT_DESIGN_LANGUAGE["primary"]


class Test生成时挂了不打死整轮:
    """⚠ fail-open。这一步产出的是**审美**，挂了顶多难看；
    而整轮挂掉是把前面几分钟的 spec 一起烧了。

    这跟 spec_tree 那条"失败不回落占位"不矛盾：那条护的是**内容**
    （假需求树会骗过下游），这里回落的是审美，骗不了谁。
    """

    def test_模型抛错时回落缺省(self):
        def boom(_messages):
            raise RuntimeError("上游 502")

        assert generate_design_language(SPEC, llm_json_fn=boom) == DEFAULT_DESIGN_LANGUAGE

    def test_模型返回垃圾时回落缺省(self):
        assert generate_design_language(SPEC, llm_json_fn=lambda _m: None) == DEFAULT_DESIGN_LANGUAGE

    def test_模型半对时保住对的那半(self):
        out = generate_design_language(
            SPEC, llm_json_fn=lambda _m: {"primary": "#0e7490", "density": "乱写"}
        )
        assert out["primary"] == "#0e7490" and out["density"] == "标准"

    def test_底层调用抛错时也回落(self, monkeypatch):
        """⚠ **变异测试逼出来的一条**。

        上面那条"模型抛错"其实**没走到** generate_design_language 自己的
        try：`call_spec_json` 的文档写着"注入的 llm_json_fn 抛错按没产出处理"，
        它自己就吞了。所以把本模块的 except 换成 raise，四条用例一条都不红——
        看着在测 fail-open，实际测的是另一条路。

        这里直接让 call_spec_json 本身抛（导入失败、客户端崩这类真实形态）。
        """
        import services.spec_llm_call as sl

        def boom(*_a, **_kw):
            raise RuntimeError("客户端崩了")

        monkeypatch.setattr(sl, "call_spec_json", boom)
        assert generate_design_language(SPEC) == DEFAULT_DESIGN_LANGUAGE

    def test_挂了也照样能被覆盖(self):
        out = generate_design_language(
            SPEC, llm_json_fn=lambda _m: None, override={"density": "紧凑"}
        )
        assert out["density"] == "紧凑"


class Test导出DTCG:
    """W3C Design Tokens Format 2025.10（2025-10-28 首个稳定版）。"""

    def test_颜色分量由代码从hex算(self):
        t = to_dtcg({**GOOD, "primary": "#ffffff"})
        v = t["color"]["primary"]["$value"]
        assert v["components"] == [1.0, 1.0, 1.0] and v["hex"] == "#ffffff"
        assert v["colorSpace"] == "srgb" and v["alpha"] == 1

    def test_分量跟hex始终自洽(self):
        v = to_dtcg({**GOOD, "primary": "#0e7490"})["color"]["primary"]["$value"]
        assert v["components"][0] == pytest.approx(0x0E / 255, abs=1e-4)
        assert v["components"][2] == pytest.approx(0x90 / 255, abs=1e-4)

    def test_尺寸是规范的值单位对象(self):
        assert to_dtcg({**GOOD, "radius": "6px"})["radius"]["base"]["$value"] == {
            "value": 6, "unit": "px"
        }

    def test_组上带type_值节点带value(self):
        """规范：有 $value 的是 token，没有的是 group；$type 可以挂在组上继承。"""
        t = to_dtcg(GOOD)
        assert t["color"]["$type"] == "color" and "$value" not in t["color"]
        assert "$value" in t["color"]["primary"]


class Test接进链路:
    """⚠ 单测模块本身全绿、而它压根没被链路调用——这是本仓反复数到的形状
    （「闸全绿但功能没生效」）。所以这里钉**接线**。"""

    def _spec_first_src(self) -> str:
        import pathlib

        return (pathlib.Path(__file__).resolve().parents[1]
                / "services/spec_first_pipeline.py").read_text(encoding="utf-8")

    def test_链路里有第2_5步(self):
        src = self._spec_first_src()
        assert "specfirst.design" in src, "第 2.5 步没埋点，跑起来看不见它"
        assert "generate_design_language" in src and "render_design_language" in src

    def test_人给了散文就不调LLM(self):
        """⚠ 显式指定优先于生成——跟 on_page「显式实参优先于 sink」同一条纪律。
        省一次调用是顺带的，主要是别让生成结果覆盖人明确写下的东西。"""
        src = self._spec_first_src()
        i = src.index("specfirst.design")
        head = src[max(0, i - 600):i]
        assert 'if not (design_system or "").strip():' in head

    def test_设计语言随结果交出去(self):
        """存得下来，重跑/修补才能复用同一份——否则同一个应用每轮换个样子。"""
        assert '"designLanguage": design_language' in self._spec_first_src()

    def test_风格一路透到第3步(self):
        import inspect

        from services.spec_first_pipeline import run_spec_first
        from services.spec_page_html import generate_page_html, generate_pages_parallel

        for fn in (run_spec_first, generate_pages_parallel, generate_page_html):
            assert "design_system" in inspect.signature(fn).parameters, (
                f"{fn.__name__} 没接 design_system，风格传不到第 3 步"
            )
