"""风格段改由 LLM 现写（2026-08-16）。

## 用户裁决

「我选 llm 现写的，a 就算内容再多也是写死的」。

确定性那套（render_design_language）是**代码写句式、模型填字段**——密度条款、
组件那句、图表那句措辞全是常量，换哪个业务都是同一段话。

## 对照实验（同一份 spec 两臂，唯一变量是这一段）

    跨业务相同度   确定性 92.8%   LLM 现写 81.7%   ← 后者是唯一越过 87%
                                                    那条历史基准线的
    面板/页        21.3          15.8
    交互控件/页    18.0           9.0

多样性是真的，密度腰斩也是真的。**但密度那一半是实现缺陷，不是路线代价**：
那次的风格段是**应用级**的，而模型自发写成了逐页版式计划——于是 p1 的
提示词里塞着 p2/p3/p4 该怎么排。所以这里做成两层，一次调用出：

    app    应用级基调——全应用共用，页面才像同一个产品
    pages  逐页版式计划——每页只拿自己那份

⚠ 仍然一个字都不写死。代码只负责把模型的判断准确送到该去的地方。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.design_language import (  # noqa: E402
    build_style_brief_prompt,
    generate_style_brief,
    normalize_style_brief,
    style_brief_ok,
    style_for_page,
)
from services.spec_page_html import _style_for, build_page_html_prompt  # noqa: E402

SPEC = {"appName": "链动健身云", "pages": [
    {"id": "p1", "name": "经营看板", "purpose": "看全连锁营收"},
    {"id": "p2", "name": "排期编辑", "purpose": "编排教练与场地"},
]}
GOOD = {"app": "冷冽的运动科技感，主色 #0d9488，强调色 #f59e0b，圆角 8px。",
        "pages": {"p1": "分四区：顶部 4 张统计卡…", "p2": "左侧教练列，右侧 24 小时网格…"}}


class Test两层结构:
    def test_逐页只拿自己那份(self):
        """★ 上一次密度腰斩的主因：四页的计划一起塞进每一页。"""
        b = normalize_style_brief(GOOD, ["p1", "p2"])
        s1 = style_for_page(b, "p1")
        assert "顶部 4 张统计卡" in s1
        assert "24 小时网格" not in s1, "p1 拿到了 p2 的版式计划"

    def test_应用级基调每页都有(self):
        b = normalize_style_brief(GOOD, ["p1", "p2"])
        for pid in ("p1", "p2"):
            assert "#0d9488" in style_for_page(b, pid), "基调没进去，页面不像同一个产品"

    def test_缺自己那份时退回只用基调(self):
        b = normalize_style_brief({"app": GOOD["app"], "pages": {"p1": "x"}}, ["p1", "p2"])
        out = style_for_page(b, "p2")
        assert "#0d9488" in out and out.strip()


class Test结构词要清洗掉:
    """⚠ 风格段是模型自由写的，它随口一句"侧边栏用深色"就碰到了契约。

    契约本来就压在后面且写明"冲突时以这一节为准"，所以这里**只清洗不失败**——
    为一句措辞把整页打掉，代价比留着大。
    """

    @pytest.mark.parametrize("bad", [
        "冷淡风。侧边栏用深色。主色 #111111。",
        "主色 #111111。用 <aside> 放导航。",
        "面包屑要显眼。主色 #111111。",
        "直接用 Tailwind 的默认色板。主色 #111111。",
    ])
    def test_带结构词的句子被摘掉(self, bad):
        b = normalize_style_brief({"app": bad, "pages": {"p1": "x"}}, ["p1"])
        for w in ("aside", "侧边栏", "面包屑", "Tailwind"):
            assert w not in b["app"]
        assert "#111111" in b["app"], "把不相干的句子也一起摘了"

    def test_清洗之后契约仍在(self):
        b = normalize_style_brief({"app": "去掉侧边栏。主色 #111111。",
                                   "pages": {"p1": "单栏，不要面包屑。分三区。"}}, ["p1"])
        p = build_page_html_prompt("某页", design_system=style_for_page(b, "p1"))
        assert "<aside>" in p and 'aria-current="page"' in p


class Test收进封闭形状:
    @pytest.mark.parametrize("junk", [None, "字符串", [], 42, {}])
    def test_垃圾输入不炸(self, junk):
        b = normalize_style_brief(junk, ["p1"])
        assert b["app"] == "" and b["pages"] == {}

    def test_不认识的页面id丢掉(self):
        b = normalize_style_brief({"app": "x", "pages": {"p1": "a", "p9": "b"}}, ["p1"])
        assert set(b["pages"]) == {"p1"}

    def test_够不够用的判定(self):
        assert style_brief_ok(normalize_style_brief(GOOD, ["p1", "p2"]), ["p1", "p2"])
        assert not style_brief_ok(normalize_style_brief({"pages": {"p1": "a"}}, ["p1"]), ["p1"])
        assert not style_brief_ok(normalize_style_brief({"app": "x"}, ["p1"]), ["p1"])
        assert not style_brief_ok(None, ["p1"])


class Test提示词不诱导谈结构:
    def test_明写不许提标签与外壳(self):
        joined = " ".join(m["content"] for m in build_style_brief_prompt(SPEC))
        assert "不要提任何 HTML 标签" in joined
        assert "只返回 JSON" in joined

    def test_把页面id给它(self):
        joined = " ".join(m["content"] for m in build_style_brief_prompt(SPEC))
        assert "p1" in joined and "p2" in joined, "不给 id 它没法按页返回"


class Test挂了要回落:
    """⚠ 审美挂了不该打死整轮。确定性那套**不删**，就是留着当回落的。"""

    def test_模型没产出时返回None(self):
        assert generate_style_brief(SPEC, llm_json_fn=lambda _m: None) is None

    def test_内容不够用时返回None(self):
        """只有 app 没有任何逐页计划——退回确定性那套，比用半份好。"""
        assert generate_style_brief(SPEC, llm_json_fn=lambda _m: {"app": "冷淡风"}) is None

    def test_底层抛错时返回None(self, monkeypatch):
        import services.spec_llm_call as sl

        def boom(*_a, **_kw):
            raise RuntimeError("客户端崩了")

        monkeypatch.setattr(sl, "call_spec_json", boom)
        assert generate_style_brief(SPEC) is None

    def test_链路里挂了会走确定性那支(self):
        import pathlib

        src = (pathlib.Path(__file__).resolve().parents[1]
               / "services/spec_first_pipeline.py").read_text(encoding="utf-8")
        i = src.index("style_brief = generate_style_brief(spec)")
        tail = src[i:i + 700]
        assert "if style_brief is None:" in tail
        assert "render_design_language" in tail, "没有回落，风格段挂了整轮就没风格"


class Test逐页风格接到生成侧:
    def test_按页取(self):
        assert _style_for({"p1": "甲", "p2": "乙"}, "p2") == "乙"

    def test_一段字符串照旧(self):
        assert _style_for("一段", "p1") == "一段"

    def test_链路把逐页表传下去(self):
        import pathlib

        src = (pathlib.Path(__file__).resolve().parents[1]
               / "services/spec_first_pipeline.py").read_text(encoding="utf-8")
        assert "style_for_page(style_brief" in src, "没有按页拆，又会是每页拿到全部计划"

    def test_落库与精修复用(self):
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[1]
        sfp = (root / "services/spec_first_pipeline.py").read_text(encoding="utf-8")
        ce = (root / "services/v5_capability_executor.py").read_text(encoding="utf-8")
        assert 'model["styleBrief"] = style_brief' in sfp, "没挂进 model 等于没落库"
        assert "reuse_style_brief=" in ce, "精修没沿用，同一应用每轮换个样子"
