"""E40.1：合法域单一真相源——四方派生的 parity 锁。

账本 = services/data/five_system_legal.json。这里锁三方（门/修复器/生成
契约）与账本逐字一致；客户端渲染器的 parity 由 vitest 侧
legal-domains-parity.test.ts 锁（同读同一份 JSON）。任何一方私自扩枚举、
或改了账本但没跟上派生，这里当场红——E37 式漏账的机械防线。
"""

from services import schema_legal
from services.v5_model_gate import (
    CHART_TYPES,
    EXPERIENCE_BLOCK_TYPES,
    FIELD_TONES,
    NUMBER_FORMATS,
    PAGE_KINDS,
    STAT_FORMATS,
    STRING_FORMATS,
)


def test_gate_constants_are_the_ledger():
    """门的常量必须就是账本对象本身（re-export，不是抄写）。"""
    assert FIELD_TONES is schema_legal.FIELD_TONES
    assert NUMBER_FORMATS is schema_legal.NUMBER_FORMATS
    assert STRING_FORMATS is schema_legal.STRING_FORMATS
    assert STAT_FORMATS is schema_legal.STAT_FORMATS
    assert PAGE_KINDS is schema_legal.PAGE_KINDS
    assert CHART_TYPES is schema_legal.CHART_TYPES
    assert EXPERIENCE_BLOCK_TYPES is schema_legal.EXPERIENCE_BLOCK_TYPES


def test_loader_matches_json_ledger():
    snap = schema_legal.legal_snapshot()
    assert tuple(snap["fieldTones"]) == schema_legal.FIELD_TONES
    assert tuple(snap["pageKinds"]) == schema_legal.PAGE_KINDS
    assert tuple(snap["chartTypes"]) == schema_legal.CHART_TYPES
    assert tuple(snap["statFormats"]) == schema_legal.STAT_FORMATS
    assert tuple(snap["metricBare"]) == schema_legal.METRIC_BARE
    assert tuple(snap["chartMetricPrefixes"]) == schema_legal.CHART_METRIC_PREFIXES
    assert tuple(snap["statMetricPrefixes"]) == schema_legal.STAT_METRIC_PREFIXES


def test_experience_block_catalog_is_structurally_closed():
    catalog = schema_legal.experience_block_catalog_snapshot()
    blocks = catalog["blocks"]
    assert tuple(block["type"] for block in blocks) == schema_legal.EXPERIENCE_BLOCK_TYPES
    assert tuple(block["rendererKey"] for block in blocks) == schema_legal.EXPERIENCE_BLOCK_RENDERER_KEYS
    assert len(set(schema_legal.EXPERIENCE_BLOCK_TYPES)) == len(blocks)
    assert len(set(schema_legal.EXPERIENCE_BLOCK_RENDERER_KEYS)) == len(blocks)
    for block in blocks:
        assert set(block["dataKinds"]) <= set(catalog["dataKinds"])
        assert set(block["allowedSlots"]) <= set(catalog["allowedSlots"])
        assert set(block["events"]) <= set(catalog["eventTypes"])


def test_repair_shares_gate_chart_types():
    from services.v5_model_repair import _CHART_TYPES

    assert _CHART_TYPES is schema_legal.CHART_TYPES


def test_schema_instruction_renders_from_ledger():
    """生成契约的枚举段 = 账本渲染；不残留占位符，不残留手抄串。"""
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert "__" not in _SCHEMA_INSTRUCTION, "契约中不允许残留 __TOKEN__ 占位"
    assert schema_legal.enum_str("fieldTones") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("numberFormats", "stringFormats") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("pageKinds") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("statFormats") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("chartTypes") in _SCHEMA_INSTRUCTION
    # metric 形态按 bare+前缀拼装（与门/修复器判定同源）
    assert "count|sum:<entity_id>.<field_id>|avg:<entity_id>.<field_id>" in _SCHEMA_INSTRUCTION
    assert '"metric": "count|sum:<entity_id>.<field_id>"' in _SCHEMA_INSTRUCTION
    # page.blocks 的放开名单由目录 generationEnabled 派生（2026-07-27）。
    # 此前这里断言的是一刀切禁令 "DO NOT emit page.blocks for production
    # pages"——那句话在渲染器陆续落地后过期了五天，把已经能用的区块一直
    # 关在门外，所以断言随语义一起换成"名单来自目录"。
    _enabled = [
        str(b["type"]) for b in schema_legal.EXPERIENCE_BLOCKS if b.get("generationEnabled")
    ]
    if _enabled:
        # 2026-07-28：只锁"名单整串来自目录"，不锁包着它的措辞。措辞从许可式
        # 改成祈使式那次（实测：0 个积木 → 8~9 个），这条曾因为钉死了
        # "ONLY these types are renderable today: " 这句话而误报。
        assert ", ".join(_enabled) in _SCHEMA_INSTRUCTION
    else:
        assert "DO NOT emit page.blocks for production pages" in _SCHEMA_INSTRUCTION
    for block_type in schema_legal.EXPERIENCE_BLOCK_TYPES:
        assert f"- {block_type}:" in _SCHEMA_INSTRUCTION


def test_gate_still_blocks_off_ledger_values():
    """接线后语义不变：账本外的值照拦（拿 E37 的 avg: 图表案例回归）。"""
    from services.v5_model_gate import validate_five_system_model

    model = {
        "datamodel": {"entities": [{"id": "t", "name": "T", "fields": [
            {"id": "s", "name": "S", "type": "enum",
             "options": [{"id": "a", "label": "A", "tone": "sparkly"}]},
        ]}]},
        "rbac": {"roles": ["r"], "permissions": ["t:view"],
                 "menus": [{"id": "m", "label": "M", "roleRefs": ["r"], "permissionRefs": ["t:view"]}]},
        "workflow": {"id": "wf", "nodes": [{"id": "n1", "name": "N", "assigneeRole": "r"}],
                     "transitions": []},
        "page": {"pages": [{"id": "p", "name": "P", "kind": "hologram",
                            "fieldBindings": ["t.s"], "actionPermissions": ["t:view"],
                            "charts": [{"id": "c", "type": "sparkline", "dimension": "t.s", "metric": "count"}]}]},
        "aigc": {"capabilities": []},
        "appbundle": {"pageBindings": [{"pageRef": "p", "workflowRef": "wf"}],
                      "roleRefs": ["r"], "dataModelRefs": ["t"]},
    }
    verdict = validate_five_system_model(model)
    assert verdict["passed"] is False
    refs = {f.get("ref") for f in verdict["findings"]}
    assert "sparkly" in refs      # 非法 tone
    assert "hologram" in refs     # 非法页面范式
    assert "sparkline" in refs    # 非法图表形态


def test_monitor_pages_carry_an_explicit_block_prohibition():
    """2026-08-01：总览页的禁用积木必须是**显式禁令**，不能只是"不在推荐清单里"。

    实测教训：先只把 FilterBar 从 monitor_ok 移除，重跑一轮 dashboard 页照样
    声明了 analytics_filters——目录里它仍是通电区块，没有任何一句说总览页不许
    用，模型按语义直觉("总览页该有个筛选条")就补上了。

    所以这里锁三件事：说了 NEVER、四个类型都点名、且给了理由（本仓库反复
    验证过只丢名单不给理由时模型会照旧按直觉猜）。
    """
    from services import schema_legal

    prompt = schema_legal.experience_block_prompt_block()
    assert "On monitor / dashboard pages, NEVER emit these blocks" in prompt
    for t in ("MetricGrid", "TrendChart", "DataTable", "FilterBar"):
        assert t in prompt
    # 理由必须在场——FilterBar 那条是最容易被当成"随便定的规矩"的
    assert "cannot filter ANYTHING on an overview" in prompt


def test_slot_restrictions_have_no_unexplained_width_gaps():
    """槽位限制的唯一物理依据是宽度——不该出现"窄的能放、宽的能放、中间不能放"。

    渲染实测（AppRuntimeScreen.tsx:1490-1532）：secondary=1/3 窄栏、
    primary=2/3 主栏、activity/content=全宽且 className 逐字节相同。
    所以若一个区块同时允许 secondary 和全宽档，中间的 primary 必然也放得下；
    禁掉它没有物理解释（ActivityFeed 此前正是如此，见
    docs/layout-slot-constraint-audit-2026-08-01.md）。
    """
    from services import schema_legal

    order = {"secondary": 1, "primary": 2, "activity": 3, "content": 3}
    for block in schema_legal.EXPERIENCE_BLOCKS:
        slots = set(block["allowedSlots"])
        ranked = [order[s] for s in slots if s in order]
        if not ranked:
            continue
        lo, hi = min(ranked), max(ranked)
        gaps = [s for s, o in order.items() if lo < o < hi and s not in slots]
        assert not gaps, f"{block['type']} 的宽度区间有洞：允许 {sorted(slots)}，却禁了 {gaps}"


def test_activity_and_content_are_opened_together():
    """activity 与 content 渲染完全相同（同一段 className），开一个禁一个是任意限制。"""
    from services import schema_legal

    for block in schema_legal.EXPERIENCE_BLOCKS:
        slots = set(block["allowedSlots"])
        assert ("activity" in slots) == ("content" in slots), (
            f"{block['type']} 只开了 activity/content 其中一个：{sorted(slots)}"
            "——两者渲染逐字节相同，这个区分没有效果差异"
        )


def test_non_obvious_slot_restriction_ships_its_reason():
    """限制不显然的类型必须在目录里带 slotsRationale，并渲染进 prompt。

    WorkflowTimeline 禁 secondary 是**有依据**的（横向流程条塞不进 1/3 窄栏），
    但三轮真跑里模型仍把它摆进 secondary 共 5 次——因为 prompt 只给了一张
    slots 表、没给理由，模型只能按"流程条是辅助信息"的直觉猜。
    """
    from services import schema_legal

    wft = next(b for b in schema_legal.EXPERIENCE_BLOCKS if b["type"] == "WorkflowTimeline")
    assert "secondary" not in wft["allowedSlots"]
    assert str(wft.get("slotsRationale") or "").strip(), "禁 secondary 却没写理由"
    prompt = schema_legal.experience_block_prompt_block()
    assert "NOT secondary" in prompt
    assert "one-third-width" in prompt
