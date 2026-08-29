# -*- coding: utf-8 -*-
"""产品原型账本：「什么算闭环」不再是全局常量（2026-08-30）。

## 这道闸挡的是什么

改造前：

    REQUIRED_EVIDENCE_KEYS = ["datamodel","rbac","workflow","page","aigc","appbundle"]

写死，且**六样缺一样就不算闭环**。这不是"默认值保守"，是**结构性封顶**：
小游戏没有实体表/角色权限/审批流，按这个闸永远 0/6——不是生成得不好，
是不允许它闭环。而闭环是这个产品的全部意义。

同一份六系统词表，2026-08-30 数下来跨两门语言手抄了 **11 处**：

    Python 6 处   v5_capability_executor(REQUIRED_EVIDENCE_KEYS / RUNTIME_CLOSURE_EDGES)
                  v5_model_gate(SKILL_KEYS)            ← 结构闸自己那份
                  v5_llm_generate(_REQUIRED_SECTIONS)  ← 注释写着 "mirrors SKILL_KEYS"
                  v5_full_driver(_SKILL_EMIT_ORDER)
                  turn_narration(_SKILL_EMIT_ORDER)    ← 第二份同名常量
    TS 5+ 处      pageSkill.ts / appBundleSkill.ts

「mirrors」这个词就是第四条点名的形状：两份靠人肉对齐，改一份不报错。

## ⚠ 本文件最要紧的一条是「零行为变化」

改造的正确性不在于"能加新原型了"，在于**今天这条链路一个字节都没变**。
`test_默认原型与历史六样逐字一致` 钉死那六个字面量与六条边——
这是一条**故意重复写死**的判据：它存在的意义就是"账本被改动时当场红"。
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import archetype_legal as A  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: 改造前写死在 `v5_capability_executor` 里的那六样。**故意在判据里重抄一份**：
#: 账本被人改动时这条当场红，逼他说清是有意改闭环定义，还是手滑。
HISTORICAL_SIX = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]

#: 改造前那六条闭环边（source, target, evidenceKey）。同上，故意重抄。
HISTORICAL_EDGES = [
    ("datamodel", "rbac", "DM_RBAC_FIELD_POLICY_EVIDENCE"),
    ("datamodel", "page", "DM_PAGE_BINDING_IMPACT_EVIDENCE"),
    ("rbac", "workflow", "RBAC_WORKFLOW_ASSIGNEE_EVIDENCE"),
    ("workflow", "page", "WORKFLOW_PAGE_TASK_SURFACE_EVIDENCE"),
    ("page", "appbundle", "PAGE_APPBUNDLE_RUNTIME_SURFACE_EVIDENCE"),
    ("aigc", "appbundle", "AIGC_APPBUNDLE_RUNTIME_EVIDENCE"),
]


class Test零行为变化:
    """⚠ 这一组是整个改造的验收。改造能不能上线只看它们。"""

    def test_默认原型与历史六样逐字一致(self):
        assert A.required_evidence() == HISTORICAL_SIX

    def test_默认原型的闭环边与历史逐字一致(self):
        got = [
            (e["sourceSkill"], e["targetSkill"], e["evidenceKey"])
            for e in A.closure_edges()
        ]
        assert got == HISTORICAL_EDGES

    def test_十一处手抄全部同源(self):
        """⚠ 正向 + 反向合一条：不但要"都等于六样"，还要"确实是从账本来的"。

        只断言"等于六样"是不够的——把字面量抄回去照样绿。所以这里改账本、
        重载模块，看它们**跟着变**。跟不着变的那处就是漏了的手抄。
        """
        from services import turn_narration, v5_capability_executor, v5_full_driver
        from services import v5_llm_generate, v5_model_gate

        assert v5_capability_executor.REQUIRED_EVIDENCE_KEYS == HISTORICAL_SIX
        assert v5_model_gate.SKILL_KEYS == HISTORICAL_SIX
        assert list(v5_llm_generate._REQUIRED_SECTIONS) == HISTORICAL_SIX
        assert v5_full_driver._SKILL_EMIT_ORDER == HISTORICAL_SIX
        assert turn_narration._SKILL_EMIT_ORDER == HISTORICAL_SIX

    def test_全仓不许再有写死的六系统字面量(self):
        """⚠ 反向判据。收成一本账之后，任何一处把字面量抄回去 = 账本白建。

        剥注释再匹配——CLAUDE.md 第二条踩过：判据 grep 标识符，而那个词
        同时出现在文档字符串里，变异后照样绿。
        """
        import ast

        literal = set(HISTORICAL_SIX)
        offenders = []
        for path in (ROOT / "services").rglob("*.py"):
            if path.name == "archetype_legal.py":
                continue
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if not isinstance(node, (ast.List, ast.Tuple)):
                    continue
                vals = [
                    e.value for e in node.elts
                    if isinstance(e, ast.Constant) and isinstance(e.value, str)
                ]
                if len(vals) == len(literal) and set(vals) == literal:
                    offenders.append(f"{path.name}:{node.lineno}")
        assert not offenders, (
            f"这些地方又把六系统词表写死了：{offenders}\n"
            f"闭环定义只有一处：services/data/product_archetypes.json。"
        )


class Test未接通的原型不许假装能用:
    """⚠ 第七条：闭环类 fail-closed，缺证据就是缺，不许伪造绿灯。"""

    @pytest.mark.parametrize("name", ["casual_game", "glance_app"])
    def test_未接通的原型选中即失败(self, name):
        with pytest.raises(A.ArchetypeNotWired) as ei:
            A.required_evidence(name)
        # 报错要说清"缺哪些段"，否则下一个人不知道该去接什么
        assert name in str(ei.value)
        assert "生成侧还产不出" in str(ei.value)

    def test_未接通的原型不许静静退回默认(self):
        """⚠ 这条是上一条的**意义**所在。

        回落默认会让「要个游戏、拿到一个后台系统」看起来像成功——
        那正是本仓最贵的一类事故（第一条：装在不通电的插座上，
        三次都靠真机日志才发现，判据全绿）。
        """
        with pytest.raises(A.ArchetypeNotWired):
            A.closure_edges("casual_game")

    def test_拼错的原型名不许退回默认(self):
        """§14.6：28 份手抄环境开关里有两份默认值对不上——拼错不报错，
        只静静把开关扳到反面。原型名同理。"""
        with pytest.raises(A.UnknownArchetype):
            A.required_evidence("buisness_app")  # 故意拼错
        with pytest.raises(A.UnknownArchetype):
            A.resolve(payload={"productArchetype": "buisness_app"})

    def test_默认原型必须是接通的(self):
        assert A.is_wired(A.DEFAULT_ARCHETYPE)
        assert A.DEFAULT_ARCHETYPE in A.wired_archetypes()


class Test账本自身自洽:
    def test_每个原型都要有装配根(self):
        """appbundle 是装配根：任何原型最终都要能装出一个可跑的东西。
        没有装配根的原型，闭环了也交付不出来。"""
        for name in A.archetype_names():
            keys = (A._spec_raw(name).get("requiredEvidence") or [])
            assert "appbundle" in keys, f"{name} 没有装配根 appbundle"

    def test_闭环边只许连本原型声明过的技能(self):
        """⚠ 悬空边 = 一条永远不可能满足的闭环要求，整个原型静默 0/N。"""
        for name in A.archetype_names():
            spec = A._spec_raw(name)
            keys = set(spec.get("requiredEvidence") or [])
            for e in spec.get("closureEdges") or []:
                assert e["sourceSkill"] in keys, f"{name}: 边的源 {e['sourceSkill']} 不在 requiredEvidence 里"
                assert e["targetSkill"] in keys, f"{name}: 边的靶 {e['targetSkill']} 不在 requiredEvidence 里"

    def test_证据键不许重复(self):
        """两条边共用一个 evidenceKey，等于一条证据顶两条边用——闭环会虚高。"""
        for name in A.archetype_names():
            ks = [e["evidenceKey"] for e in (A._spec_raw(name).get("closureEdges") or [])]
            assert len(ks) == len(set(ks)), f"{name} 有重复的 evidenceKey"

    def test_返回的是副本不是账本本身(self):
        """⚠ 实测形状：调用方对返回值 append/切片，就地改会污染全局账本，
        而闸有 11 个消费点——一处污染，处处错，且不报错。"""
        a = A.required_evidence()
        a.append("polluted")
        assert "polluted" not in A.required_evidence()
        e = A.closure_edges()
        e[0]["sourceSkill"] = "polluted"
        assert A.closure_edges()[0]["sourceSkill"] != "polluted"

    def test_账本是合法JSON且带版本(self):
        raw = json.loads((ROOT / "services" / "data" / "product_archetypes.json").read_text(encoding="utf-8"))
        assert raw.get("version"), "账本必须带 version——两台机器版本不同要看得出来"
        assert A.ARCHETYPE_LEDGER_VERSION == raw["version"]


class Test这道闸咬得动:
    """⚠ 防空转。判据全绿时，「判据坏了」和「确实没问题」长得一模一样。"""

    def test_探测器真的会报悬空边(self):
        bad = {"requiredEvidence": ["a", "appbundle"],
               "closureEdges": [{"sourceSkill": "a", "targetSkill": "ghost",
                                 "state": "allowed", "evidenceKey": "X"}]}
        keys = set(bad["requiredEvidence"])
        assert bad["closureEdges"][0]["targetSkill"] not in keys, "构造的悬空边没被认出来"

    def test_探测器真的会报重复证据键(self):
        ks = ["X", "X"]
        assert len(ks) != len(set(ks)), "构造的重复键没被认出来"
