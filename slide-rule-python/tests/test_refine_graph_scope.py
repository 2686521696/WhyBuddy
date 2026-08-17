# -*- coding: utf-8 -*-
"""图判作用域（影子模式）：LLM 只报种子，扩散交给图算（2026-08-17）。

## 为什么有这个

refine_page_scope 让 LLM 直接猜"重画哪几页"——它答不了"改这一块，牵扯的
工作流/权限/数据模型也要更新"，因为那三只手不在页面清单上。这里拆开：
LLM 判**种子**（语义题），`impacted_closure` 算**牵连**（机械题）。
跟 Aider ContextCoder 的分工差异见 services/refine_graph_scope.py 模块头。

## 这组判据守三件事

1. **fail 的方向**：判不出来回 None，由调用方退回现状行为（纪律七，
   同 refine_page_scope 那组的核心）。
2. **翻译不许丢齿**：闭包出来的页面必须是裸 id——带着 `page:` 前缀对不上
   SPEC/reuse_pages 的键，表现是"影子对照两边永远零交集"，尺子先坏。
3. **影子期不许碰行为**：真正决定重画哪几页的仍是文本判作用域。切行为的
   那天，「影子期不许碰行为」那条判据要**改判据**，不许绕。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.app_graph import build_app_graph  # noqa: E402
from services.refine_graph_scope import (  # noqa: E402
    DEFAULT_HOPS,
    MAX_NODES_FOR_PROMPT,
    build_node_scope_prompt,
    decide_seed_nodes,
    graph_scope_verdict,
    parse_node_scope,
    shadow_compare_line,
)

# 与 test_app_graph 同形状：带 menus（真机口径），role→page 边能产出。
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

G = build_app_graph(MODEL)


class Test提示词:
    def test_节点按类分组_带kind前缀和中文名(self):
        user = build_node_scope_prompt("这一页只给店长看", G)[-1]["content"]
        assert "page:p1" in user and "订单页" in user
        assert "role:mgr" in user and "店长" in user
        assert "wf:approve" in user
        assert "角色" in user and "流程节点" in user

    def test_不许它产内容(self):
        """对应 Aider ContextPrompts 的 `NEVER RETURN CODE!`，同 refine_page_scope。"""
        user = build_node_scope_prompt("改点东西", G)[-1]["content"]
        assert "不要输出任何 HTML" in user

    def test_只要直接点名的_牵连声明由系统算(self):
        """★ 跟 Aider 的分工差异落在提示词上：Aider 要模型报**完整**清单
        （它没有图），这里反过来只要种子——模型得知道多列的代价，
        否则它会照习惯把牵连也列进来，闭包再一扩就是双重放大。
        """
        user = build_node_scope_prompt("改点东西", G)[-1]["content"]
        assert "直接点" in user
        assert "牵连" in user and "自动" in user


class Test收答案:
    def test_只收图上真实存在的节点(self):
        assert parse_node_scope({"nodes": ["page:p1", "role:mgr"]}, G) == [
            "page:p1", "role:mgr",
        ]

    def test_图上没有的id直接丢掉(self):
        """反向判据：不做模糊匹配（同 refine_page_scope 的理由）。"""
        assert parse_node_scope(
            {"nodes": ["page:p1", "page:p9", "订单页", "entity:ghost"]}, G
        ) == ["page:p1"]

    def test_形状不对回None(self):
        for bad in (None, [], "page:p1", {"nodes": "page:p1"}, {}):
            assert parse_node_scope(bad, G) is None


class Test判不出来必须fail_open:
    """★ 同 refine_page_scope：fail 的方向错了比不做这个功能还糟。"""

    def test_LLM抛异常回None(self, capsys):
        def boom(messages):
            raise RuntimeError("网关炸了")

        assert decide_seed_nodes("改点东西", G, llm_json_fn=boom) is None

    def test_答非所问回None(self):
        assert decide_seed_nodes("改点东西", G, llm_json_fn=lambda m: {"随便": 1}) is None

    def test_空清单回None(self):
        assert decide_seed_nodes("改点东西", G, llm_json_fn=lambda m: {"nodes": []}) is None

    def test_全是图外id回None(self):
        assert decide_seed_nodes(
            "改点东西", G, llm_json_fn=lambda m: {"nodes": ["page:p9"]}
        ) is None

    def test_没指令或空图回None(self):
        assert decide_seed_nodes("", G, llm_json_fn=lambda m: {"nodes": ["page:p1"]}) is None
        assert decide_seed_nodes(
            "改", {"nodes": {}, "edges": []}, llm_json_fn=lambda m: {"nodes": ["page:p1"]}
        ) is None

    def test_节点太多放弃图判_且不调LLM(self, capsys):
        """清单一长挑选质量不可信；而且这时**连 LLM 都不该调**——
        调了也是浪费一次调用换一个不可信的答案。
        """
        big = {"nodes": {f"page:x{i}": {"kind": "page", "name": f"页{i}"}
                         for i in range(MAX_NODES_FOR_PROMPT + 1)},
               "edges": []}
        called = []

        def spy(messages):
            called.append(1)
            return {"nodes": ["page:x0"]}

        assert decide_seed_nodes("改点东西", big, llm_json_fn=spy) is None
        assert not called, "放弃图判却还是调了 LLM"
        assert "放弃图判" in capsys.readouterr().out

    def test_判出来了如实返回(self):
        assert decide_seed_nodes(
            "这一页只给店长看", G, llm_json_fn=lambda m: {"nodes": ["page:p1", "role:mgr"]}
        ) == ["page:p1", "role:mgr"]


class Test闭包翻译:
    def test_种子扩成页面和段(self):
        """改店长（role:mgr）：能进的页、审批的节点、可用的能力都该被卷进来。"""
        v = graph_scope_verdict(G, ["role:mgr"])
        assert v["pages"] == ["p1"], "店长能进订单页，它该在受影响页里"
        assert "p2" not in v["pages"], "店长跟客户页无关，卷进来就是扩散过宽"
        assert {"rbac", "page", "workflow", "aigc"} <= set(v["segments"])

    def test_页面清单是裸id(self):
        """★ 反向判据（变异咬这里）：带 `page:` 前缀对不上 SPEC/reuse_pages
        的键，影子对照会**永远零交集**——尺子坏了，数据看着还正常。
        """
        v = graph_scope_verdict(G, ["page:p1"])
        assert "p1" in v["pages"]
        assert not any(p.startswith("page:") for p in v["pages"])

    def test_闭包有半径_默认两跳够不到三跳的东西(self):
        """从提交节点出发：两跳到店员和订单页那一圈，三跳外的 AIGC 能力
        和客户页的字段**不许**进来——半径就是拿来挡这个的。
        """
        v = graph_scope_verdict(G, ["wf:submit"], hops=DEFAULT_HOPS)
        assert "wf:submit" in v["impacted"] and "page:p1" in v["impacted"]
        assert "aigc:sum1" not in v["impacted"], "三跳外的能力被卷进来了——半径没起作用"
        assert "field:cust.phone" not in v["impacted"]

    def test_种子本身也算受影响(self):
        v = graph_scope_verdict(G, ["page:p2"])
        assert "page:p2" in v["impacted"] and "p2" in v["pages"]


class Test影子对照日志行:
    def test_两边都有时报交集和差集(self):
        v = graph_scope_verdict(G, ["role:mgr"])
        line = shadow_compare_line(["p1", "p3"], v)
        assert "交集=['p1']" in line
        assert "只有文本有=['p3']" in line

    def test_图判失败时如实说(self):
        line = shadow_compare_line(["p1"], None)
        assert "图判失败/未启用" in line and "p1" in line

    def test_文本全量时写全量(self):
        line = shadow_compare_line(None, graph_scope_verdict(G, ["page:p1"]))
        assert "(全量)" in line


class Test接线:
    """★ 纪律一：影子步必须接在**真正在跑的那条链**（run_spec_first）上。

    驱动 harness 抄自 test_refine_page_scope.Test端到端接线——同一条链，
    多验一节。
    """

    SPEC = {
        "rootNodeId": "n0", "version": 3, "appName": "维保云",
        "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
        "successCriteria": [{"id": "sc1", "text": "24 小时内派工"}],
        "nodes": [],
        "pages": [{"id": "p1", "name": "工单页"}, {"id": "p2", "name": "报表页"}],
    }

    def _drive(self, monkeypatch, *, refine=True, reuse_model=None,
               reuse_pages=None, text_scope=None, seed_fn=None):
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.refine_graph_scope as rgs
        import services.refine_page_scope as rps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree
        from services import spec_first_pipeline as sfp

        seen = {}

        monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda g, **kw: dict(self.SPEC))
        monkeypatch.setattr(rps, "decide_pages_to_regenerate", lambda i, p, **kw: text_scope)
        if seed_fn is not None:
            monkeypatch.setattr(rgs, "decide_seed_nodes", seed_fn)

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

        out = sfp.run_spec_first(
            "做个工单系统",
            refine=({"instruction": "报表页只给主管看", "modelDigest": "d"} if refine else None),
            reuse_pages=reuse_pages,
            reuse_model=reuse_model,
        )
        seen["stages"] = out.get("stages") or {}
        return seen

    PREV = {"p1": "<html>旧1</html>", "p2": "<html>旧2</html>"}

    def test_影子步真的在链路上跑_且图建自上一版模型(self, monkeypatch):
        got = {}

        def spy(instruction, graph, **kw):
            got["instruction"] = instruction
            got["node_ids"] = set((graph.get("nodes") or {}).keys())
            return ["page:p1"]

        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"], seed_fn=spy)
        assert got, "影子步没被执行——接线断了"
        assert got["instruction"] == "报表页只给主管看"
        assert "page:p1" in got["node_ids"] and "role:mgr" in got["node_ids"], (
            "图不是从上一版模型建的"
        )
        assert "graphscope" in seen["stages"], "没有独立埋点，墙钟会混进别的段"

    def test_对照日志行真的打出来了(self, monkeypatch, capsys):
        """★ 反向判据的镜像：影子模式的**全部产出**就是这行日志（拿它攒标定集）。

        把 print 删掉，其余判据照样全绿——"闸全绿但东西没了"的标准形状，
        所以这行必须单独钉。
        """
        self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                    text_scope=["p2"], seed_fn=lambda i, g, **kw: ["page:p1"])
        out = capsys.readouterr().out
        assert "影子对照" in out, "对照日志没打出来——影子模式白跑，标定集攒不起来"
        assert "只有图有" in out

    def test_影子期不许碰行为(self, monkeypatch):
        """★ 本文件最要紧的一条。重画哪几页仍由**文本判作用域**决定。

        文本说改 p2（p1 照搬）；图种子故意指向 p1。若有人把图的结论接进
        行为，照搬集就会变——这条当场红。**切行为的那天改这条判据，别绕。**
        """
        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"], seed_fn=lambda i, g, **kw: ["page:p1"])
        assert seen["reuse_pages"] == {"p1": "<html>旧1</html>"}, (
            "照搬集不再由文本判作用域决定——影子模式被悄悄切成实弹了"
        )

    def test_影子失败不拖垮主链路(self, monkeypatch):
        """纪律七：影子是增强类，它炸了主链路必须照跑。"""
        def boom(instruction, graph, **kw):
            raise RuntimeError("影子炸了")

        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"], seed_fn=boom)
        assert seen["reuse_pages"] == {"p1": "<html>旧1</html>"}, "主链路被影子拖垮了"

    def test_开关能关掉(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_SHADOW", "0")
        called = []
        self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                    text_scope=["p2"],
                    seed_fn=lambda i, g, **kw: called.append(1) or ["page:p1"])
        assert not called, "开关关了影子还在跑"

    def test_非精修轮不跑影子(self, monkeypatch):
        """反向判据：新建应用没有上一版，建图没有对象，跑了就是白烧一次 LLM。"""
        called = []
        self._drive(monkeypatch, refine=False, reuse_model=MODEL,
                    seed_fn=lambda i, g, **kw: called.append(1) or ["page:p1"])
        assert not called

    def test_没有上一版模型时不跑影子(self, monkeypatch):
        called = []
        self._drive(monkeypatch, reuse_model=None, reuse_pages=self.PREV,
                    text_scope=["p2"],
                    seed_fn=lambda i, g, **kw: called.append(1) or ["page:p1"])
        assert not called
