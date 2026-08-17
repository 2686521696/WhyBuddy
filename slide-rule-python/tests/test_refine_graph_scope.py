# -*- coding: utf-8 -*-
"""精修作用域的影子对照：图闭包挑页 vs 文本挑页（2026-08-17，纯影子）。

## 这组判据守三件事

1. **影子期不许碰行为**（本文件最要紧的一条）：影子跑不跑、跑成什么样，
   `_scope` / `_reuse_now` 都必须跟纯文本路径一字不差。正向判据（影子日志
   出现了）配反向判据（行为没变）——CLAUDE.md 第三条。
2. **fail 的方向**：影子属增强类（纪律七），任何失败只打日志绝不外抛。
   它跟 refine_page_scope 不同——那边 fail-open 的落点是"全量重画"，
   这边的落点是"什么都不发生"，因为影子本来就不产生行为。
3. **接线**：spec_first_pipeline 真的调了它（剥注释后 grep——注释里就写着
   函数名，不剥必然假绿），且返回值没被接回作用域、且没进左侧进度线。

MODEL 沿用 test_app_graph.py 的形状（rolePermissions 恒空、权限在 menus，
那是真机的形状，别照假形状写——来回见那边的注释）。
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.app_graph import build_app_graph  # noqa: E402
from services.refine_graph_scope import (  # noqa: E402
    build_seed_prompt,
    compare_graph_scope_shadow,
    graph_scope_shadow_enabled,
    parse_seeds,
)

MODEL = {
    "datamodel": {"entities": [
        {"id": "order", "name": "订单", "fields": [
            {"id": "amount", "name": "金额"}, {"id": "status", "name": "状态"},
        ]},
        {"id": "cust", "name": "客户", "fields": [{"id": "phone", "name": "电话"}]},
    ]},
    "rbac": {
        "roles": [{"id": "mgr", "name": "店长"}, {"id": "clerk", "name": "店员"}],
        "permissions": ["order:read", "order:create", "cust:read"],
        "rolePermissions": {},
        "menus": [
            {"id": "m1", "label": "订单", "roleRefs": ["mgr"],
             "permissionRefs": ["order:read", "order:create"]},
            {"id": "m2", "label": "客户", "roleRefs": ["clerk"],
             "permissionRefs": ["cust:read"]},
        ],
    },
    "workflow": {"nodes": [
        {"id": "submit", "name": "提交", "assigneeRole": "clerk"},
        {"id": "approve", "name": "审批", "assigneeRole": "mgr"},
    ]},
    "page": {"pages": [
        {"id": "p1", "name": "订单页",
         "fieldBindings": ["order.amount", "order.status"],
         "actionPermissions": ["order:read", "order:create"]},
        {"id": "p2", "name": "客户页",
         "fieldBindings": ["cust.phone"], "actionPermissions": ["cust:read"]},
    ]},
    "aigc": {"capabilities": [
        {"id": "sum1", "name": "订单摘要", "inputFields": ["order.amount"], "roleRefs": ["mgr"]},
    ]},
    "appbundle": {"landingPageRef": "p1", "preferredDevice": "desktop",
                  "pageBindings": [{"pageRef": "p1", "workflowRef": "submit"}]},
}

PAGES = [
    {"id": "p1", "name": "订单页", "purpose": "看订单"},
    {"id": "p2", "name": "客户页", "purpose": "看客户"},
]


@pytest.fixture(scope="module")
def G():
    return build_app_graph(MODEL)


class Test挑种子提示词:
    def test_只判范围不产内容(self, G):
        """对应 Aider ContextPrompts 的 `NEVER RETURN CODE!`——同 refine_page_scope。"""
        user = build_seed_prompt("把审批人改成店员", G)[-1]["content"]
        assert "不要输出任何 HTML" in user

    def test_宁窄勿宽写进提示词(self, G):
        """种子挑多了，闭包会把半个应用卷进来，对照就没有信息量。"""
        user = build_seed_prompt("改点东西", G)[-1]["content"]
        assert "宁窄勿宽" in user

    def test_节点清单带kind前缀原样列出(self, G):
        """让模型照抄带前缀的 id——裸 id 在图上对不上，会被 parse_seeds 丢掉。"""
        user = build_seed_prompt("改点东西", G)[-1]["content"]
        assert "page:p1" in user
        assert "entity:order" in user
        assert "role:mgr" in user
        assert "wf:approve" in user

    def test_指令进了提示词(self, G):
        user = build_seed_prompt("把审批人从店长改成店员", G)[-1]["content"]
        assert "把审批人从店长改成店员" in user


class Test种子解析:
    def test_只收图里的节点id(self, G):
        assert parse_seeds({"seeds": ["page:p1", "role:mgr"]}, G) == ["page:p1", "role:mgr"]

    def test_图外id直接丢掉_不做模糊匹配(self, G, capsys):
        """反向判据：模糊匹配一旦对错人，闭包就从错误的种子扩散，
        而日志里长得跟正常一模一样。"""
        assert parse_seeds({"seeds": ["page:p1", "page:p9", "订单页", "p1"]}, G) == ["page:p1"]
        assert "已丢弃" in capsys.readouterr().out

    def test_形状不对回None(self, G):
        for bad in (None, [], "page:p1", {"seeds": "page:p1"}, {}, {"pages": ["p1"]}):
            assert parse_seeds(bad, G) is None

    def test_空清单如实返回空(self, G):
        """空清单交给上层判——影子的处理是"本轮不对照"，不是报错。"""
        assert parse_seeds({"seeds": []}, G) == []


class Test闭包翻译:
    """图闭包 → 页面/段。扩散是 impacted_closure 确定性算的，不是 LLM 说的。"""

    def _shadow(self, seeds, text_scope=None, hops=2):
        return compare_graph_scope_shadow(
            "把审批人改成店员", MODEL, text_scope, PAGES,
            llm_json_fn=lambda m: {"seeds": seeds}, hops=hops,
        )

    def test_字段种子两跳能翻到绑它的页面(self):
        got = self._shadow(["field:order.amount"])
        assert "p1" in got["graphPages"]
        assert "p2" not in got["graphPages"], "不相干的页面被卷进来了"

    def test_闭包翻成五系统段(self):
        got = self._shadow(["field:order.amount"])
        assert "datamodel" in got["graphSegments"]
        assert "page" in got["graphSegments"]
        assert "aigc" in got["graphSegments"], "吃这个字段的能力没被算进来"

    def test_两跳半径收得住_不吞全图(self):
        """全图连通（角色是跨簇的桥），半径必须自己划——见 app_graph 模块头。
        p1 到 p2 最短要三跳（p1→wf:submit→role:clerk→p2），两跳够不着。"""
        got = self._shadow(["page:p1"])
        assert got["graphPages"] == ["p1"]

    def test_角色种子翻出它能进的页面(self):
        """这正是文本判定看不到的那只手：改角色牵动哪些页。"""
        got = self._shadow(["role:clerk"], hops=1)
        assert "p2" in got["graphPages"]


class Test影子对照主流程:
    def _shadow(self, *, text_scope, llm=None):
        return compare_graph_scope_shadow(
            "把审批人改成店员", MODEL, text_scope, PAGES,
            llm_json_fn=llm or (lambda m: {"seeds": ["page:p1"]}),
        )

    def test_打出对照日志一行_五个字段齐全(self, capsys):
        self._shadow(text_scope=["p1"])
        out = capsys.readouterr().out
        assert "[refine_graph_scope] 影子对照：" in out
        for field in ("种子=", "图闭包页=", "图段=", "文本挑页=", "交集="):
            assert field in out, f"对照日志缺 {field}"

    def test_交集算对(self):
        got = self._shadow(text_scope=["p1", "p2"])
        assert got["overlapPages"] == ["p1"]
        assert got["textPages"] == ["p1", "p2"]

    def test_文本判不出来时显示全量(self, capsys):
        got = self._shadow(text_scope=None)
        assert got["textPages"] is None
        assert "文本挑页=(全量)" in capsys.readouterr().out

    def test_不改传进来的作用域和模型(self):
        """反向判据：影子连输入都不许碰——碰了就不是影子。"""
        import copy

        scope = ["p1"]
        model = copy.deepcopy(MODEL)
        self._shadow(text_scope=scope)
        assert scope == ["p1"]
        assert model == MODEL


class Test失败必须fail_open:
    """★ 影子属增强类（纪律七）：任何失败只打日志，绝不外抛、绝不改行为。"""

    def test_LLM抛异常不外抛_回None(self, capsys):
        def boom(messages):
            raise RuntimeError("网关炸了")

        got = compare_graph_scope_shadow("改点东西", MODEL, ["p1"], PAGES, llm_json_fn=boom)
        assert got is None
        assert "不对照" in capsys.readouterr().out

    def test_答非所问回None(self, capsys):
        got = compare_graph_scope_shadow(
            "改点东西", MODEL, ["p1"], PAGES, llm_json_fn=lambda m: {"随便": "什么"}
        )
        assert got is None
        assert "不对照" in capsys.readouterr().out

    def test_全是图外id回None(self):
        got = compare_graph_scope_shadow(
            "改点东西", MODEL, ["p1"], PAGES, llm_json_fn=lambda m: {"seeds": ["page:p9"]}
        )
        assert got is None

    def test_没有上一版模型时不调LLM(self):
        called = []

        def spy(messages):
            called.append(1)
            return {"seeds": ["page:p1"]}

        for bad_model in (None, {}, "不是字典"):
            assert compare_graph_scope_shadow("改", bad_model, ["p1"], PAGES, llm_json_fn=spy) is None
        assert not called, "没有模型还去调 LLM，白烧一次调用"

    def test_没有指令时不调LLM(self):
        called = []

        def spy(messages):
            called.append(1)
            return {"seeds": ["page:p1"]}

        assert compare_graph_scope_shadow("", MODEL, ["p1"], PAGES, llm_json_fn=spy) is None
        assert compare_graph_scope_shadow("   ", MODEL, ["p1"], PAGES, llm_json_fn=spy) is None
        assert not called

    def test_建图炸了也不外抛(self, monkeypatch, capsys):
        import services.app_graph as ag

        def boom(model):
            raise RuntimeError("图炸了")

        monkeypatch.setattr(ag, "build_app_graph", boom)
        got = compare_graph_scope_shadow(
            "改点东西", MODEL, ["p1"], PAGES, llm_json_fn=lambda m: {"seeds": ["page:p1"]}
        )
        assert got is None
        assert "fail-open" in capsys.readouterr().out

    def test_建出零节点的图时跳过(self, capsys):
        got = compare_graph_scope_shadow(
            "改点东西", {"datamodel": {"entities": []}}, ["p1"], PAGES,
            llm_json_fn=lambda m: {"seeds": ["page:p1"]},
        )
        assert got is None
        assert "零节点" in capsys.readouterr().out


class Test开关:
    def test_开关0时整个跳过_LLM一次都不调(self, monkeypatch, capsys):
        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_SHADOW", "0")
        called = []

        def spy(messages):
            called.append(1)
            return {"seeds": ["page:p1"]}

        got = compare_graph_scope_shadow("改点东西", MODEL, ["p1"], PAGES, llm_json_fn=spy)
        assert got is None
        assert not called, "开关关了还在调 LLM"
        assert "影子对照" not in capsys.readouterr().out

    @pytest.mark.parametrize("val", ["0", "false", "no", "off", "OFF"])
    def test_这些取值都算关(self, monkeypatch, val):
        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_SHADOW", val)
        assert graph_scope_shadow_enabled() is False

    def test_缺省是开(self, monkeypatch):
        monkeypatch.delenv("SLIDERULE_GRAPH_SCOPE_SHADOW", raising=False)
        assert graph_scope_shadow_enabled() is True

    def test_显式开也是开(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_SHADOW", "1")
        assert graph_scope_shadow_enabled() is True


class Test影子期不许碰行为:
    """★ 本文件最要紧的一组：正向（影子真的在主链路上跑了）配反向（行为没变）。

    驱动真实的 run_spec_first（除影子外与 test_refine_page_scope.Test端到端接线
    同一套桩），拿"交给第 3 步的照搬清单"当行为指纹：影子开/关两轮必须一字不差。
    """

    SPEC = {
        "rootNodeId": "n0", "version": 3, "appName": "维保云",
        "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
        "successCriteria": [{"id": "sc1", "text": "24 小时内派工"}],
        "nodes": [],
        "pages": [{"id": "p1", "name": "订单页"}, {"id": "p2", "name": "客户页"}],
    }

    def _drive(self, monkeypatch, *, scope, llm_json_fn=None):
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.refine_page_scope as rps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree
        from services import spec_first_pipeline as sfp

        seen = {}

        monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda g, **kw: dict(self.SPEC))
        monkeypatch.setattr(rps, "decide_pages_to_regenerate", lambda i, p, **kw: scope)

        def fake_pages(spec, **kw):
            seen["reuse_pages"] = kw.get("reuse_pages")
            return {"pages": {"p1": "<html>x</html>", "p2": "<html>y</html>"}, "failed": {}}

        monkeypatch.setattr(sph, "generate_pages_parallel", fake_pages)
        monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda p, s: [])
        monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b: (dict(p), [], []))
        monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: {"entities": [], "pages": []})
        monkeypatch.setattr(ss, "derive_semantics", lambda st, sp, **kw: {"roles": []})
        monkeypatch.setattr(
            ma, "assemble", lambda *a, **k: {"model": {"datamodel": {}}, "gate": {"passed": True}}
        )
        monkeypatch.setattr(hb, "bind_pages", lambda p, m: {"pages": dict(p), "failed": {}})

        sfp.run_spec_first(
            "做个工单系统",
            refine={"instruction": "把客户页改一下", "modelDigest": "d"},
            reuse_model=MODEL,
            reuse_pages={"p1": "<html>旧1</html>", "p2": "<html>旧2</html>"},
            llm_json_fn=llm_json_fn,
        )
        return seen

    def test_影子期不许碰行为(self, monkeypatch, capsys):
        """开影子（且影子给出跟文本**不同**的结论）与关影子，行为指纹必须一致。

        影子挑 page:p1、文本挑 p2——两边故意不同，才验得出"影子的结论
        没有漏进主路径"。结论相同的话这条判据是空的。
        """
        monkeypatch.delenv("SLIDERULE_GRAPH_SCOPE_SHADOW", raising=False)
        seen_on = self._drive(
            monkeypatch, scope=["p2"], llm_json_fn=lambda m: {"seeds": ["page:p1"]}
        )
        out_on = capsys.readouterr().out
        assert "[refine_graph_scope] 影子对照：" in out_on, (
            "影子没在主链路上跑——装在不通电的插座上（CLAUDE.md 纪律一）"
        )

        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_SHADOW", "0")
        seen_off = self._drive(monkeypatch, scope=["p2"])
        out_off = capsys.readouterr().out
        assert "[refine_graph_scope] 影子对照：" not in out_off, "开关关了影子还在跑"

        assert seen_on["reuse_pages"] == seen_off["reuse_pages"] == {"p1": "<html>旧1</html>"}, (
            "影子改了行为——照搬清单跟纯文本路径不一致"
        )

    def test_影子炸了主链路照常跑完(self, monkeypatch):
        """fail-open 落到主链路层面再验一次：影子的 LLM 炸了，精修照常。"""
        monkeypatch.delenv("SLIDERULE_GRAPH_SCOPE_SHADOW", raising=False)

        def boom(messages):
            raise RuntimeError("影子的 LLM 炸了")

        seen = self._drive(monkeypatch, scope=["p2"], llm_json_fn=boom)
        assert seen["reuse_pages"] == {"p1": "<html>旧1</html>"}


def _pipeline_code() -> str:
    """spec_first_pipeline 源码去注释去 docstring——注释里就写着这些函数名，
    不剥必然假绿（CLAUDE.md 纪律二，同 test_refine_merge_reaches_the_live_path）。"""
    import inspect

    from services import spec_first_pipeline as sfp

    src = inspect.getsource(sfp)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


class Test接线判据:
    def test_主链路真的调了影子对照(self):
        code = _pipeline_code()
        assert "from .refine_graph_scope import" in code, "pipeline 没接影子模块"
        assert "compare_graph_scope_shadow(" in code, "pipeline 没调影子对照"

    def test_影子调用点带上了模型与文本作用域(self):
        """窗口判据（同 test_refine_page_scope 的 _setter_windows 写法）：
        非贪婪正则取实参会被嵌套括号截断，按窗口取更稳。"""
        code = _pipeline_code()
        m = re.search(r"compare_graph_scope_shadow\(", code)
        assert m, "调用点不见了"
        win = code[m.end():m.end() + 260]
        assert "reuse_model" in win, "影子没拿到上一版模型——建不出图"
        assert "_scope" in win, "影子没拿到文本挑页结果——对照少了一半"

    def test_影子返回值不许接回作用域(self):
        """★ 反向判据：返回值一旦被赋值接走，影子就有了变成行为的通道。"""
        code = _pipeline_code()
        assert not re.search(r"=\s*compare_graph_scope_shadow\(", code), (
            "影子的返回值被赋值接走了——纯影子不许有回流通道"
        )

    def test_影子不进左侧进度线(self):
        """故意不包 _stage()：进 _ENRICH_STAGE_LABELS 表意味着'决定让用户看见'，
        影子对用户没有可感知的产出。哪天转正再按 test_enrich_stage_visibility
        的正反两半一起加。"""
        from services.v5_full_driver import _ENRICH_STAGE_LABELS, _enrich_stage_event

        assert "specfirst.graphscope" not in _ENRICH_STAGE_LABELS
        assert _enrich_stage_event("start", "specfirst.graphscope", {}) is None
        assert '_stage("specfirst.graphscope"' not in _pipeline_code(), (
            "影子被包进了 _stage()——test_enrich_stage_visibility 的全等判据会咬红"
        )

    def test_两个set_refine_context调用点仍带pages(self):
        """别回归：set_refine_context 有两个设置型调用点，漏一个 pages 就会
        被后跑的那次抹掉（2026-08-17 真机踩过，见 test_refine_page_scope）。"""
        import inspect

        from services import v5_full_driver as drv

        src = re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(drv)))
        wins = []
        for m in re.finditer(r"set_refine_context\(", src):
            win = src[m.end():m.end() + 160]
            if win.lstrip().startswith("None"):
                continue
            wins.append(win)
        assert len(wins) >= 2, f"设置型调用点少于 2 个，链路变了先确认现状：{len(wins)}"
        for w in wins:
            assert "pages=" in w, f"这个 set_refine_context 没带 pages：{w[:100]}"
