# -*- coding: utf-8 -*-
"""精修时 id 必须冻结：同一个概念不许每轮换一个 id（2026-08-17）。

## 病灶（真机实测，量法见 experiments/refine-fingerprint/）

精修第二轮，同一个「社区养老站长」拿到过三套 id：

    station_manager  →  role_station_manager  →  manager_role
    elder:read       →  care_order:read       →  elder_archive:read
    wo_created       →  wf_pending            →  node_pending

后果有两层：

1. **逐段指纹 0/6 里有四段是这个造成的**，不是内容真被重写
   （rbac.roles 名字 3/3 相同、id 0/3 相同；page 甚至 id 和名字都 5/5 相同，
   只因引用了被改名的权限才变）。四次修复的方案选型都被这个读数误导过。
2. 逐段沿用**一段都成功不了**：混合两轮的模型必然违反引用完整性闸——
   沿用 rbac 则新 page 的权限悬空，只沿用别的则新 workflow 的角色悬空。

根因：refine 上下文只到达第 2 步，而铸 id 的是第 4 步（实体/字段）和
第 5 步（角色/流程节点）。`grep -c refine` 在那两个文件里都是 0。

## 做法不是新发明

identifier freezing（RecLLM/Reformer 保证重训练前后 item id 不变）、
MCP 的 LFID 提案（语义信号与稳定 canonical_id 分开）都是同一个路子。
本仓自己也早有同款：`html_structure.build_prompt` 第 5 条「sourcePageId
照抄上面给你的页面 id，不要自己改名」——而实测**唯一 id 保住 5/5 的段
恰好就是 page**。这组测试守的是把它推广到实体/角色/节点这件事。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services.spec_first_pipeline import model_id_lexicon  # noqa: E402


BASELINE = {
    "datamodel": {"entities": [
        {"id": "elder", "name": "老人档案", "fields": [
            {"id": "name", "name": "姓名"}, {"id": "age", "name": "年龄"},
        ]},
        {"id": "work_order", "name": "服务工单", "fields": [{"id": "no", "name": "工单编号"}]},
    ]},
    "rbac": {
        "roles": [
            {"id": "station_manager", "name": "社区养老站长"},
            {"id": "nursing_staff", "name": "助老护理员"},
        ],
        "permissions": ["elder:read", "elder:create"],
    },
    "workflow": {"nodes": [
        {"id": "wo_created", "name": "待派单", "assigneeRole": "station_manager"},
        {"id": "wo_closed", "name": "工单关闭", "assigneeRole": "station_manager"},
    ]},
    "page": {"pages": [{"id": "p1", "name": "工单页"}]},
}


class Test词表:
    def test_摘出实体字段角色节点的id与名字(self):
        lex = model_id_lexicon(BASELINE)
        assert [(e["id"], e["name"]) for e in lex["entities"]] == [
            ("elder", "老人档案"), ("work_order", "服务工单"),
        ]
        assert [(r["id"], r["name"]) for r in lex["roles"]] == [
            ("station_manager", "社区养老站长"), ("nursing_staff", "助老护理员"),
        ]
        assert [(n["id"], n["name"]) for n in lex["workflowNodes"]] == [
            ("wo_created", "待派单"), ("wo_closed", "工单关闭"),
        ]
        assert [(f["id"], f["name"]) for f in lex["entities"][0]["fields"]] == [
            ("name", "姓名"), ("age", "年龄"),
        ]

    def test_不是模型就返回空(self):
        assert model_id_lexicon(None) == {}
        assert model_id_lexicon("不是字典") == {}  # type: ignore[arg-type]
        assert model_id_lexicon({}) == {}

    def test_词表不含权限(self):
        """权限的形状是 `<实体id>:create`，**由实体 id 决定**，不是独立事实。

        把它也放进词表，就等于对同一件事有两个真相：实体改名时权限表还留着
        旧的，对不上时不知道该信哪个。反向判据钉在**词表**这一层而不是提示词
        那一层——提示词那条挡不住"有人先往词表里加"（2026-08-17 变异实测：
        只改提示词循环是个空操作，因为词表里根本没这个键，判据咬不住）。
        """
        lex = model_id_lexicon(BASELINE)
        assert "permissions" not in lex, (
            "词表带上了权限——它该跟着实体 id 走，两处各说一套迟早对不齐"
        )
        import json
        assert "elder:read" not in json.dumps(lex, ensure_ascii=False)

    def test_不带绑定与主题这些无关细节(self):
        """跟 model_refine_digest 同一条纪律：是摘要不是全量。"""
        big = dict(BASELINE)
        big["appbundle"] = {"themeToken": "深蓝夜色", "landingPageRef": "p1"}
        lex = model_id_lexicon(big)
        import json
        assert "深蓝夜色" not in json.dumps(lex, ensure_ascii=False)


class Test提示词:
    def test_第4步给出实体id并要求照抄(self):
        from services.html_structure import build_prev_ids_block

        block = build_prev_ids_block(model_id_lexicon(BASELINE))
        assert "elder" in block and "老人档案" in block
        assert "照抄" in block, "没要求照抄，摆一堆 id 出来模型不知道要干嘛"
        assert "name" in block or "名字" in block, "没说清判断依据是名字"

    def test_第5步给出角色与节点id并要求照抄(self):
        from services.spec_semantics import build_prev_ids_block

        block = build_prev_ids_block(model_id_lexicon(BASELINE))
        assert "station_manager" in block and "社区养老站长" in block
        assert "wo_created" in block and "待派单" in block
        assert "照抄" in block

    def test_第5步不列权限(self):
        """反向判据：权限形状是 `<实体id>:create`，**跟着实体 id 走**。

        再单独列一份权限表就是给同一件事两个真相，对不上时不知道信谁。
        """
        from services.spec_semantics import build_prev_ids_block

        block = build_prev_ids_block(model_id_lexicon(BASELINE))
        assert "elder:read" not in block, (
            "第 5 步列了权限——它该由实体 id 决定，两处各说一套迟早对不齐"
        )

    def test_没有上一版时块是空串(self):
        from services.html_structure import build_prev_ids_block as b4
        from services.spec_semantics import build_prev_ids_block as b5

        for b in (b4, b5):
            assert b(None) == ""
            assert b({}) == ""

    def test_非精修轮的提示词逐字不变(self):
        """反向判据。新建应用没有上一版，多这一段等于给它一批无关 id。"""
        from services.html_structure import build_prompt as p4
        from services.spec_semantics import build_prompt as p5

        html = {"p1": "<html><h1>工单</h1></html>"}
        assert p4(html, "做个工单系统") == p4(html, "做个工单系统", prev_ids=None)
        assert p4(html, "做个工单系统") == p4(html, "做个工单系统", prev_ids={})

        structure = {"entities": [], "pages": []}
        spec = {"personas": [], "nodes": []}
        assert p5(structure, spec) == p5(structure, spec, prev_ids=None)
        assert "上一版已经有的" not in p5(structure, spec)[-1]["content"]


class Test接线_两步都要传:
    """★ 纪律四：只改一半必然静默失效。

    第 4 步管实体/字段 id，第 5 步管角色/节点 id。**只接一步的话另一半照旧
    每轮重铸**，而且不会报错——正是本仓反复踩的形状。这组跑真实的
    run_spec_first 控制流，两步各捕一次实参。
    """

    SPEC = {
        "rootNodeId": "n0", "version": 3, "appName": "维保云",
        "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
        "successCriteria": [{"id": "sc1", "text": "24 小时内派工"}],
        "nodes": [], "pages": [{"id": "p1", "name": "工单页"}],
    }

    def _drive(self, monkeypatch, *, refine, reuse_model):
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree
        from services import spec_first_pipeline as sfp

        seen = {}

        monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda g, **kw: dict(self.SPEC))
        monkeypatch.setattr(
            sph, "generate_pages_parallel",
            lambda s, **kw: {"pages": {"p1": "<html>x</html>"}, "failed": {}},
        )
        monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda p, s: [])
        monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b: (dict(p), [], []))

        def fake_structure(pages, **kw):
            seen["structure_prev_ids"] = kw.get("prev_ids")
            return {"entities": [], "pages": []}

        def fake_semantics(st, sp, **kw):
            seen["semantics_prev_ids"] = kw.get("prev_ids")
            return {"roles": [], "workflowNodes": []}

        monkeypatch.setattr(hs, "derive_structure", fake_structure)
        monkeypatch.setattr(ss, "derive_semantics", fake_semantics)
        monkeypatch.setattr(
            ma, "assemble",
            lambda *a, **k: {"model": {"datamodel": {}}, "gate": {"passed": True}},
        )
        monkeypatch.setattr(hb, "bind_pages", lambda p, m: {"pages": dict(p), "failed": {}})

        sfp.run_spec_first(
            "做一个维保工单系统",
            refine=({"instruction": "加点模拟数据", "modelDigest": "d"} if refine else None),
            reuse_model=reuse_model,
        )
        return seen

    def test_第4步收到实体id词表(self, monkeypatch):
        seen = self._drive(monkeypatch, refine=True, reuse_model=BASELINE)
        lex = seen["structure_prev_ids"]
        assert lex, "第 4 步没收到词表——实体 id 照旧每轮重铸"
        assert [e["id"] for e in lex["entities"]] == ["elder", "work_order"]

    def test_第5步收到角色与节点id词表(self, monkeypatch):
        seen = self._drive(monkeypatch, refine=True, reuse_model=BASELINE)
        lex = seen["semantics_prev_ids"]
        assert lex, "第 5 步没收到词表——角色 id 照旧每轮重铸"
        assert [r["id"] for r in lex["roles"]] == ["station_manager", "nursing_staff"]
        assert [n["id"] for n in lex["workflowNodes"]] == ["wo_created", "wo_closed"]

    def test_非精修轮两步都不带词表(self, monkeypatch):
        seen = self._drive(monkeypatch, refine=False, reuse_model=BASELINE)
        assert not seen["structure_prev_ids"]
        assert not seen["semantics_prev_ids"]

    def test_精修但没有上一版时不炸_且说得出话(self, monkeypatch, capsys):
        """反向判据 + 留痕。这是"整个没生效"的那条静默路径。"""
        seen = self._drive(monkeypatch, refine=True, reuse_model=None)
        assert not seen["structure_prev_ids"]
        assert "id 冻结未生效" in capsys.readouterr().out, (
            "精修轮拿不到词表却一声不吭——线上表现是 id 照旧重铸，无从排查"
        )
