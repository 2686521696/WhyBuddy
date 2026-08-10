# -*- coding: utf-8 -*-
"""应用级模板骨架（2026-08-11）。

## 这批用例守的是什么

模板要取代内置演示域，而演示域的病就是**写死**。所以这里最要紧的两条不是
"能不能加载"，是：

  ① 骨架里绝不能出现绑定/实体/字段 —— 一旦出现，它就退化成了旧模板库那个
     形态（那些绑定指向组件库的订单夹具，丢进真实话题必被结构闸拦下）。
  ② 匹配的默认值必须是"不套模板" —— `goal_coverage` 判不了时返回
     `passed=True`（放行），那是给"别误杀已生成的模型"用的。套模板是反方向的
     动作，判不了却套上等于把别人的应用扣在用户头上。

另外钉一道真实事故：2026-08-04 的「中小学课后托管家长请假」——旧的关键词机制
认成 `leave_approval`（要靠一道额外的相关性补丁才挡住），新机制应当直接不命中。
"""

import json
from pathlib import Path

import pytest

from services.app_template import (
    SEED_APP_TEMPLATES,
    all_app_templates,
    match_app_template,
    template_terms,
    validate_app_template,
)
from services.schema_legal import EXPERIENCE_BLOCKS, PAGE_KINDS, block_placement_problem


def _skeleton(**overrides):
    base = {
        "id": "t1",
        "name": "测试骨架",
        "industry": "测试",
        "when": "用来测的",
        "pages": [{"id": "p1", "kind": "workbench", "purpose": "干活的页"}],
    }
    base.update(overrides)
    return base


@pytest.fixture
def placeable():
    """目录里任意一个「放开生成 + 能进 workbench 的 main」的区块 —— 判据取自
    真相源，不写死某个区块名（区块目录天天在动）。"""
    for block in EXPERIENCE_BLOCKS:
        if block_placement_problem(str(block["type"]), "workbench", "main") is None:
            return str(block["type"])
    pytest.skip("目录里没有能进 workbench.main 的区块")


class Test种子:
    def test_四条种子全部合法且能加载(self):
        assert len(SEED_APP_TEMPLATES) == 4
        assert {t["id"] for t in SEED_APP_TEMPLATES} == {
            "purchase_approval",
            "leave_approval",
            "service_ticket",
            "employee_onboarding",
        }
        for template in SEED_APP_TEMPLATES:
            assert validate_app_template(template) == [], template["id"]

    def test_种子里没有任何实体或字段(self):
        """抠骨架抠干净了没有 —— 演示域那四份是带实体和字段的完整模型。"""
        raw = json.loads(
            (Path(__file__).resolve().parent.parent / "services" / "data" / "app_template_seeds.json").read_text(
                encoding="utf-8"
            )
        )
        text = json.dumps(raw["templates"], ensure_ascii=False)
        for leaked in ("entityRef", "FieldRef", "datamodel", "fieldBindings", "leave_request", "purchase_order"):
            assert leaked not in text, f"种子里漏了 {leaked}"

    def test_全集函数至少给出种子(self):
        ids = {t["id"] for t in all_app_templates()}
        assert {t["id"] for t in SEED_APP_TEMPLATES} <= ids


class Test骨架不许带绑定:
    @pytest.mark.parametrize(
        "bad",
        [
            {"binding": {"entityRef": "order"}},
            {"pages": [{"id": "p", "kind": "workbench", "purpose": "x", "binding": {}}]},
            {"pages": [{"id": "p", "kind": "workbench", "purpose": "x", "entityRef": "order"}]},
            {"pages": [{"id": "p", "kind": "workbench", "purpose": "x", "titleFieldRef": "name"}]},
            {"datamodel": {"entities": []}},
            {"entities": [{"id": "order"}]},
            {"pages": [{"id": "p", "kind": "workbench", "purpose": "x", "fieldBindings": ["a.b"]}]},
        ],
    )
    def test_各种绑定痕迹都被拒(self, bad):
        problems = validate_app_template(_skeleton(**bad))
        assert any("不许带绑定" in p for p in problems), problems

    def test_藏在深处也揪得出来(self):
        deep = _skeleton(
            pages=[
                {
                    "id": "p",
                    "kind": "workbench",
                    "purpose": "x",
                    "notes": [{"deeper": {"more": {"descFieldRef": "x"}}}],
                }
            ]
        )
        assert any("不许带绑定" in p for p in validate_app_template(deep))

    def test_干净的骨架不误伤(self, placeable):
        clean = _skeleton(
            roleShape=["申请人", "审批人"],
            workflowShape={"steps": 3, "hasApproval": True, "phases": ["申请", "审批"]},
            pages=[
                {
                    "id": "p1",
                    "kind": "workbench",
                    "purpose": "干活的页",
                    "blocks": [{"type": placeable, "region": "main"}],
                }
            ],
        )
        assert validate_app_template(clean) == []


class Test区块摆放走目录:
    def test_合法摆放通过(self, placeable):
        skeleton = _skeleton(
            pages=[{"id": "p1", "kind": "workbench", "purpose": "x", "blocks": [{"type": placeable, "region": "main"}]}]
        )
        assert validate_app_template(skeleton) == []

    def test_未知区块被拒(self):
        skeleton = _skeleton(
            pages=[{"id": "p1", "kind": "workbench", "purpose": "x", "blocks": [{"type": "并不存在的区块", "region": "main"}]}]
        )
        assert any("未知区块" in p for p in validate_app_template(skeleton))

    def test_区域不允许被拒(self):
        """判据从目录现查：找一个明确不允许 footerBar 的区块。"""
        victim = next(
            (
                str(b["type"])
                for b in EXPERIENCE_BLOCKS
                if b.get("generationEnabled")
                and "workbench" in b.get("pageKinds", [])
                and "footerBar" not in b.get("allowedRegions", [])
            ),
            None,
        )
        assert victim, "目录里找不到一个不允许 footerBar 的 workbench 区块"
        skeleton = _skeleton(
            pages=[{"id": "p1", "kind": "workbench", "purpose": "x", "blocks": [{"type": victim, "region": "footerBar"}]}]
        )
        assert any("不允许放在 footerBar" in p for p in validate_app_template(skeleton))

    def test_未放开生成的区块被拒(self):
        frozen = next(
            (str(b["type"]) for b in EXPERIENCE_BLOCKS if not b.get("generationEnabled")), None
        )
        if not frozen:
            pytest.skip("目录里已经没有未放开生成的区块了")
        skeleton = _skeleton(
            pages=[{"id": "p1", "kind": "workbench", "purpose": "x", "blocks": [{"type": frozen, "region": "main"}]}]
        )
        assert any("未放开生成" in p for p in validate_app_template(skeleton))


class Test基本形状:
    @pytest.mark.parametrize("missing", ["id", "name", "industry", "when"])
    def test_必填缺一不可(self, missing):
        skeleton = _skeleton()
        del skeleton[missing]
        assert any(f"缺 {missing}" in p for p in validate_app_template(skeleton))

    def test_页面形态必须在目录内(self):
        skeleton = _skeleton(pages=[{"id": "p", "kind": "并不存在的页型", "purpose": "x"}])
        assert any("不在页面形态目录内" in p for p in validate_app_template(skeleton))

    def test_每页必须说清干什么(self):
        """purpose 是骨架里唯一能被相关性尺子量到的业务语义，缺了这一页白搭。"""
        skeleton = _skeleton(pages=[{"id": "p", "kind": "workbench"}])
        assert any("缺 purpose" in p for p in validate_app_template(skeleton))

    def test_页面id不许重复(self):
        skeleton = _skeleton(
            pages=[
                {"id": "same", "kind": "workbench", "purpose": "甲"},
                {"id": "same", "kind": "kanban", "purpose": "乙"},
            ]
        )
        assert any("重复的页面 id" in p for p in validate_app_template(skeleton))

    def test_不是对象不炸(self):
        for bad in (None, "字符串", 42, []):
            assert validate_app_template(bad)


class Test匹配:
    def test_真请假题命中请假骨架(self):
        hit = match_app_template(
            "做一个员工请假审批系统，员工提交请假单，主管审批，HR备案，还要看假期余额",
            all_app_templates(),
        )
        assert hit is not None
        assert hit["template"]["id"] == "leave_approval"

    def test_采购题命中采购骨架(self):
        hit = match_app_template(
            "采购申请审批，员工提需求，经理审批，财务确认付款，供应商归档", all_app_templates()
        )
        assert hit is not None and hit["template"]["id"] == "purchase_approval"

    def test_托管请假不命中_钉住20260804那道题(self):
        """旧的关键词机制把这道题认成 leave_approval，靠一道额外补丁才挡住。

        新机制应当**根本不命中**——不需要补丁。真出事时的后果是：套上企业请假
        样板，学生/班次/签到/账单一个没做。
        """
        goal = "给中小学课后托管做家长请假申请，要管学生、班次、签到签退和托管账单"
        assert match_app_template(goal, all_app_templates()) is None

        from services.v5_capability_executor import _recognize_domain

        assert _recognize_domain(goal) == "leave_approval", "前提不成立：旧机制本来就没误判"

    def test_不相干的题不命中(self):
        assert (
            match_app_template(
                "黑灰产情报自动化分析系统，线索采集、研判、归档和风险预警", all_app_templates()
            )
            is None
        )

    def test_判不了就不套模板(self):
        """默认必须是反的 —— goal_coverage 样本不足时返回 passed=True（放行），
        照抄那个默认就会变成"看不清也敢套"。这条用例在 applicable 检查被删掉时变红。"""
        for goal in ("请假", "", "做个系统"):
            assert match_app_template(goal, all_app_templates()) is None, goal

    def test_空模板集给None(self):
        assert match_app_template("员工请假审批，主管审批，HR备案", []) is None

    def test_命中要带得出理由(self):
        hit = match_app_template(
            "做一个员工请假审批系统，员工提交请假单，主管审批，HR备案，还要看假期余额",
            all_app_templates(),
        )
        verdict = hit["verdict"]
        for key in ("score", "threshold", "passed", "matched", "reason"):
            assert key in verdict, key


class Test比对词:
    def test_只收业务词_不收技术词(self):
        terms = template_terms(SEED_APP_TEMPLATES[1])
        joined = " ".join(terms)
        for technical in ("workbench", "kanban", "dashboard", "DataTable"):
            assert technical not in joined, f"技术词 {technical} 混进了比对词——会把所有模板的相关度拉平"
        assert "请假申请与审批" in terms and "我的请假单" in terms

    def test_不重复(self):
        for template in SEED_APP_TEMPLATES:
            terms = template_terms(template)
            assert len(terms) == len(set(terms))


class Test抽公共判据没抽坏:
    def test_页面预设仍然被同一套判据校验(self):
        """`block_placement_problem` 是从 `_load_page_kind_presets` 里抽出来的，
        两边共用。抽坏了预设那边会静默失去校验，这条盯着它。"""
        from services.schema_legal import PAGE_KIND_PRESETS

        assert PAGE_KIND_PRESETS, "页面预设没了"
        for kind, presets in PAGE_KIND_PRESETS.items():
            for preset in presets:
                for item in preset["blocks"]:
                    assert (
                        block_placement_problem(item["type"], kind, item["region"]) is None
                    ), f"{kind}.{preset['id']} 的 {item['type']}@{item['region']} 现在过不了"

    def test_页型词汇两边同源(self):
        assert set(p["kind"] for t in SEED_APP_TEMPLATES for p in t["pages"]) <= set(PAGE_KINDS)
