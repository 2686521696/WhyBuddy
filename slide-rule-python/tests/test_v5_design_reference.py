"""E40.3 设计菜谱语料：按域命中注入生成 prompt（软参考，无命中零变化）。"""

from services.v5_design_reference import (
    _load_recipes,
    design_reference_block,
    match_recipes,
)
from services.v5_llm_generate import _build_user_content


def test_frozen_corpus_loads_and_has_required_fields():
    recipes = _load_recipes()
    assert len(recipes) >= 10, "冻结语料应有 10+ 条配方"
    for recipe in recipes:
        assert recipe.get("project")
        assert recipe.get("domainKeywords"), recipe["project"]
        assert recipe.get("navStyle"), recipe["project"]
        assert recipe.get("widgets"), recipe["project"]


def test_domain_intent_hits_matching_recipe():
    hits = match_recipes("做一个品牌舆情监测系统，支持多平台声量分析和预警")
    assert hits, "舆情意图应命中舆情配方"
    assert any("舆情" in str(h.get("project")) for h in hits)

    crm_hits = match_recipes("客户跟进管理系统，销售漏斗和客户档案")
    assert any("CRM" in str(h.get("project")) or "客户" in " ".join(map(str, h.get("domainKeywords") or [])) for h in crm_hits)


def test_unrelated_intent_returns_empty_block():
    # 与语料完全无关的域 → 不硬凑（prompt 零变化）
    assert design_reference_block("量子对撞机束流标定台账") == ""


def test_block_is_soft_reference_and_injected_into_user_content():
    block = design_reference_block("舆情监测与声量预警平台")
    assert "STYLE INSPIRATION ONLY" in block
    assert "nav=" in block and "widgets=" in block

    content = _build_user_content("舆情监测与声量预警平台")
    assert "Industry design reference" in content
    # 无命中意图的 prompt 不带参考块
    content_plain = _build_user_content("量子对撞机束流标定台账")
    assert "Industry design reference" not in content_plain
