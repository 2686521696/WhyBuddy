# -*- coding: utf-8 -*-
"""精修时，指令没点名的模型段必须沿用上一版（2026-08-17）。

## 病灶

用户在已生成的应用上说一句「某一页的列表是空的，加点模拟数据」，整个应用被换掉。
2026-08-16 修了四次，实测（四组真机基线，见 docs/交接-精修增量化-2026-08-16.md）：

        菜单保留    页面数    逐段指纹保留
    前   0 / 4      4 → 3     0 / 6
    后   4 / 4      4 → 4     0 / 6      ← 结构保住了，内容一段没保住

`workflow`、`rbac` 这些跟指令毫不相干的段照样全变。根因不是提示词写得不够狠
（"连续性硬要求"那句话已经在 prompt 里了，四组基线证明求它自觉求不动），
而是 spec-first 天生「从 spec 树重新生成」，出口永远是完整模型——**没有任何
地方说得出「这一段用户根本没提，别动它」**。

## 判据为什么是行为的，不是 grep 的

上一版判据（test_refine_merge_reaches_the_live_path）grep 调用点附近有没有
`merge_patch`。那种写法钉的是"某个标识符出现在某个窗口里"，换个实现方式就
失效——而这一轮恰恰换了实现方式（补丁 → 沿用）。这里改成**驱动真实的
run_spec_first 控制流、量出口那份 model 的逐段指纹**：无论内部怎么写，
"没点名的段没变"这件事都必须成立。

⚠ 判据落在**逐段指纹**上，不是"变没变"。2026-08-16 早上用"四页字节变没变"
  验精修，4/4 变了就判通过——全量重写同样让 4/4 都变，那只能证明"有反应"。
"""

import copy
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services import spec_first_pipeline as sfp  # noqa: E402
from services.spec_first_pipeline import (  # noqa: E402
    REFINE_REUSABLE_SEGMENTS,
    apply_refine_segment_reuse,
)


def _fp(seg) -> str:
    """逐段指纹。判据的尺子——不是"变没变"，是"这一段还是不是原来那一段"。"""
    return hashlib.sha256(
        json.dumps(seg, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]


def _baseline() -> dict:
    """上一版：一份能过闸的完整六段模型。"""
    return {
        "datamodel": {"entities": [
            {"id": "wo", "name": "工单", "fields": [{"id": "amt", "name": "金额", "type": "number"}]},
        ]},
        "rbac": {"roles": [{"id": "mgr", "name": "主管"}, {"id": "eng", "name": "维修工"}]},
        "workflow": {"nodes": [
            {"id": "s1", "name": "提交", "assigneeRole": "mgr"},
            {"id": "s2", "name": "派工", "assigneeRole": "eng"},
        ]},
        "page": {"pages": [{"id": "p1", "name": "工单页", "fieldBindings": ["wo.amt"]}]},
        "aigc": {"capabilities": [
            {"id": "c1", "name": "工单摘要", "inputFields": ["wo.amt"], "roleRefs": ["mgr"]},
        ]},
        "appbundle": {
            "landingPageRef": "p1", "preferredDevice": "desktop",
            "pageBindings": [{"pageRef": "p1"}], "roleRefs": ["mgr"], "dataModelRefs": ["wo"],
        },
    }


def _fresh() -> dict:
    """这一轮重新生成的：结构同源（SPEC 连续性约束管住了），但每段内容都被重写。"""
    m = _baseline()
    m["rbac"] = {"roles": [{"id": "mgr", "name": "店长"}]}
    m["workflow"] = {"nodes": [{"id": "z9", "name": "重写过的节点", "assigneeRole": "mgr"}]}
    m["aigc"] = {"capabilities": [
        {"id": "c9", "name": "重写过的能力", "inputFields": ["wo.amt"], "roleRefs": ["mgr"]},
    ]}
    return m


def _gate(model):
    from services.v5_model_gate import validate_five_system_model

    return validate_five_system_model(
        model,
        require_landing_page_ref=True,
        require_preferred_device=True,
        require_page_kind_contract=False,
    )


class Test沿用本身:
    def test_一段都没点名时_三段全沿用(self):
        base, fresh = _baseline(), _fresh()
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(out[seg]) == _fp(base[seg]), f"{seg} 被重写了——用户根本没提这一段"

    def test_点名的段重新生成_其余沿用(self):
        base, fresh = _baseline(), _fresh()
        out = apply_refine_segment_reuse(fresh, base, ["workflow"], gate_fn=_gate)
        assert _fp(out["workflow"]) == _fp(fresh["workflow"]), (
            "点名要改 workflow 却沿用了上一版——用户要求的改动静默失效了"
        )
        for seg in ("rbac", "aigc"):
            assert _fp(out[seg]) == _fp(base[seg]), f"{seg} 没被点名却被重写"

    def test_没声明scope时_一段都不敢沿用(self):
        """None ≠ []。反向判据：拿沉默当授权是错的。

        模型没答 / 老 spec / 非精修轮都是 None。当成"全沿用"的话，用户明确要求
        改权限时权限会一声不吭地不生效——比不沿用糟得多。
        """
        base, fresh = _baseline(), _fresh()
        out = apply_refine_segment_reuse(fresh, base, None, gate_fn=_gate)
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(out[seg]) == _fp(fresh[seg]), f"scope 是 None 却沿用了 {seg}"

    def test_没有上一版时_原样返回(self):
        fresh = _fresh()
        assert apply_refine_segment_reuse(fresh, None, [], gate_fn=_gate) == fresh


class Test不许沿用的段:
    """反向判据。纪律三：每写一条"应该有 X"，配一条"不该有 Y"。"""

    @pytest.mark.parametrize("seg", ["datamodel", "page", "appbundle"])
    def test_耦合本轮产物的段_即使一段没点名也不沿用(self, seg):
        base, fresh = _baseline(), _fresh()
        fresh[seg] = {"改过了": True}
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        assert _fp(out[seg]) == _fp(fresh[seg]), (
            f"{seg} 被沿用了——它指向的是**本轮**刚生成的页面/字段，"
            f"拿上一版的会错位（appbundle.landingPageRef 指向已不存在的页面就是这么来的）"
        )

    def test_可沿用清单不含耦合段(self):
        for seg in ("datamodel", "page", "appbundle"):
            assert seg not in REFINE_REUSABLE_SEGMENTS


class Test过不了闸时逐段退让:
    def test_只丢过不了闸的那段_其余保住(self):
        """一个 aigc 悬空不该把 rbac 和 workflow 的沿用一起赔掉。

        （第一版就是全有全无，被自己的探针咬出来——aigc.inputFields 指 datamodel
        字段，而 datamodel 永远重新生成，字段 id 一飘 aigc 就悬空。）
        """
        base, fresh = _baseline(), _fresh()

        def picky(model):
            reused_aigc = _fp(model["aigc"]) == _fp(base["aigc"])
            if reused_aigc:
                return {"passed": False, "findings": [
                    {"path": "aigc.capabilities[c1].fields", "message": "悬空"},
                ]}
            return {"passed": True, "findings": []}

        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=picky)
        assert _fp(out["aigc"]) == _fp(fresh["aigc"]), "过不了闸的 aigc 还是被沿用了"
        for seg in ("rbac", "workflow"):
            assert _fp(out[seg]) == _fp(base[seg]), (
                f"{seg} 本来能过闸，却被 aigc 连累着一起赔掉了"
            )

    def test_一段都过不了时_整份用重新生成的那份(self):
        base, fresh = _baseline(), _fresh()
        out = apply_refine_segment_reuse(
            fresh, base, [], gate_fn=lambda m: {"passed": False, "findings": []}
        )
        assert out == fresh

    def test_闸自己抛异常时_不拖垮主链路(self):
        """纪律七：沿用属增强类，自己炸了不许拖垮主链路。

        把异常放出去的话，一个「少改点东西」的优化会让整轮推演崩掉——而
        fresh 那份在 assemble 里已经过过闸，是已知可用的，退回去就行。
        """
        base, fresh = _baseline(), _fresh()

        def boom(model):
            raise RuntimeError("闸自己炸了")

        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=boom)
        assert out == fresh


class Test不污染上一版:
    def test_改返回值不影响baseline(self):
        base, fresh = _baseline(), _fresh()
        snapshot = copy.deepcopy(base)
        out = apply_refine_segment_reuse(fresh, base, [], gate_fn=_gate)
        out["rbac"]["roles"].append({"id": "x", "name": "污染"})
        assert base == snapshot, (
            "沿用是浅拷贝——改产出会改到上一版那份，而它是 refine 回流上下文里"
            "还在被引用的对象"
        )


class Test端到端接线:
    """★ 纪律一的具象化：判据必须跑**真正在跑的那条链**。

    2026-08-16 同一件事打偏三次，全是"代码本身对、装在不通电的插座上"。上一版
    判据（merge_patch）11 条全绿，把调用点删掉照样全绿——它们只直接调那个函数，
    从没验证它接在链路上。

    这一组不直接调 apply_refine_segment_reuse，而是把七步各自打成桩、**跑真实的
    run_spec_first 控制流**，量它出口那份 model。接线断了这里必红。
    """

    SPEC = {
        "rootNodeId": "n0", "version": 3, "appName": "维保云",
        "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
        "successCriteria": [{"id": "sc1", "text": "24 小时内派工率 90%"}],
        "nodes": [], "pages": [{"id": "p1", "name": "工单页"}],
    }

    def _drive(self, monkeypatch, *, scope, refine=True, baseline=None):
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree

        spec = dict(self.SPEC)
        if scope is not None:
            spec["refineScope"] = scope

        monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda goal, **kw: spec)
        monkeypatch.setattr(
            sph, "generate_pages_parallel",
            lambda s, **kw: {"pages": {"p1": "<html>x</html>"}, "failed": {}},
        )
        monkeypatch.setattr(ps, "unify_shell", lambda pages, s, **kw: {"pages": dict(pages)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda pages, s: [])
        monkeypatch.setattr(
            ps, "repair_pages_after_bind", lambda pages, before: (dict(pages), [], [])
        )
        monkeypatch.setattr(
            hs, "derive_structure", lambda pages, **kw: {"entities": [], "pages": []}
        )
        monkeypatch.setattr(
            ss, "derive_semantics", lambda st, s, **kw: {"roles": [], "workflowNodes": []}
        )
        monkeypatch.setattr(
            ma, "assemble",
            lambda *a, **k: {"model": _fresh(), "gate": {"passed": True, "findings": []}},
        )
        monkeypatch.setattr(
            hb, "bind_pages", lambda pages, model: {"pages": dict(pages), "failed": {}}
        )

        return sfp.run_spec_first(
            "做一个维保工单系统",
            refine=(
                {"instruction": "给工单页加点模拟数据", "modelDigest": "实体：工单"}
                if refine else None
            ),
            reuse_model=baseline,
        )

    def test_出口那份model_没点名的段指纹与上一版一致(self, monkeypatch):
        base = _baseline()
        out = self._drive(monkeypatch, scope=[], baseline=base)
        model = out["model"]
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(model[seg]) == _fp(base[seg]), (
                f"{seg} 在真实链路的出口上仍被重写——沿用没接上，"
                f"或者接在了不通电的那一步"
            )

    def test_点名的段在真实链路上确实被重新生成(self, monkeypatch):
        """反向判据：别把「沿用」做成「什么都不改」。"""
        base = _baseline()
        out = self._drive(monkeypatch, scope=["rbac"], baseline=base)
        assert _fp(out["model"]["rbac"]) == _fp(_fresh()["rbac"]), (
            "点名要改 rbac，真实链路上却沿用了上一版"
        )

    def test_非精修轮不沿用(self, monkeypatch):
        """反向判据：新建应用没有"上一版"，沿用不许漏进这条路。"""
        base = _baseline()
        out = self._drive(monkeypatch, scope=[], refine=False, baseline=base)
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(out["model"][seg]) == _fp(_fresh()[seg]), (
                f"非精修轮沿用了 {seg}——新建应用被上一轮的残留污染"
            )

    def test_开关关掉时退回旧行为(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_REFINE_REUSE_SEGMENTS", "0")
        base = _baseline()
        out = self._drive(monkeypatch, scope=[], baseline=base)
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert _fp(out["model"][seg]) == _fp(_fresh()[seg])

    def test_执行器把上一版模型交给了spec_first(self, monkeypatch):
        """再往上一格：v5_capability_executor 真的传了 reuse_model 吗。

        少了这条，上面几条全绿而**执行器压根没传 baseline**，线上依然全量重写——
        正是"函数写对了 ≠ 它被调用了"。
        """
        from services import v5_capability_executor as ex
        from services.v5_llm_generate import set_refine_context

        captured: dict = {}

        def fake_run(goal, **kw):
            captured.update(kw)
            raise RuntimeError("捕获即止")

        monkeypatch.setattr("services.spec_first_pipeline.run_spec_first", fake_run)
        monkeypatch.setattr(
            "services.v5_llm_generate.generate_five_system_model", lambda *a, **k: None
        )
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")

        set_refine_context(_baseline(), "给工单页加点模拟数据")
        try:
            ex._try_llm_generate_evidence("原始话题", None)
        finally:
            set_refine_context(None)

        assert captured.get("reuse_model") is not None, (
            "执行器没把上一版模型传给 spec-first——沿用在生产路径上等于没有"
        )
        assert _fp(captured["reuse_model"]["workflow"]) == _fp(_baseline()["workflow"])


class Test提示词与实现不许只改一半:
    """纪律四。一边给选项另一边不认，完全静默。"""

    def _scope_paragraph(self) -> str:
        from services.spec_tree import build_spec_prompt

        msgs = build_spec_prompt(
            "做一个维保工单系统",
            refine={"instruction": "给工单页加点模拟数据", "modelDigest": "实体：工单"},
        )
        chunks = [c for c in msgs[-1]["content"].split("\n\n") if "refineScope" in c]
        assert chunks, "refine 模式下 prompt 里没有 refineScope 段——模型永远不会声明"
        return "\n\n".join(chunks)

    def test_prompt给的选项与可沿用清单逐字一致(self):
        para = self._scope_paragraph()
        for seg in REFINE_REUSABLE_SEGMENTS:
            assert f'"{seg}"' in para, f"实现认 {seg}，prompt 却没给这个选项"

    def test_prompt不给耦合段当选项(self):
        para = self._scope_paragraph()
        for seg in ("datamodel", "page", "appbundle"):
            assert f'"{seg}"' not in para, (
                f"prompt 把 {seg} 列成了可选项——给了模型迟早会选，而实现不认它，"
                f"用户会看到「我明明说了改这个」却没反应"
            )

    def test_非精修轮的prompt逐字不变(self):
        """反向判据：新增的段不许漏进新建应用那条路。"""
        from services.spec_tree import build_spec_prompt

        assert build_spec_prompt("做一个订单系统") == build_spec_prompt(
            "做一个订单系统", refine=None
        )
        assert "refineScope" not in build_spec_prompt("做一个订单系统")[-1]["content"]

    def test_SpecTree认这个字段(self):
        from services.spec_tree import SpecTree

        spec = SpecTree.model_validate({
            "rootNodeId": "n0", "appName": "维保云",
            "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
            "successCriteria": [{"id": "sc1", "text": "24 小时内派工率 90%"}],
            "nodes": [{
                "id": "n0", "type": "requirement", "title": "派工要快",
                "acceptance": "当工单提交时，系统应在 24 小时内派工",
                "coversCriteria": ["sc1"],
            }],
            "pages": [
                {"id": "p1", "name": "工单页", "purpose": "看工单",
                 "audience": "维修主管", "coversNodes": ["n0"]},
            ],
            "refineScope": ["workflow"],
        })
        assert spec.refineScope == ["workflow"]
        # 缺省是 None（不是 []）——"没声明"和"声明了空"必须分得开
        spec2 = SpecTree.model_validate({
            "rootNodeId": "n0", "appName": "维保云",
            "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
            "successCriteria": [{"id": "sc1", "text": "24 小时内派工率 90%"}],
            "nodes": [{
                "id": "n0", "type": "requirement", "title": "派工要快",
                "acceptance": "当工单提交时，系统应在 24 小时内派工",
                "coversCriteria": ["sc1"],
            }],
            "pages": [
                {"id": "p1", "name": "工单页", "purpose": "看工单",
                 "audience": "维修主管", "coversNodes": ["n0"]},
            ],
        })
        assert spec2.refineScope is None
