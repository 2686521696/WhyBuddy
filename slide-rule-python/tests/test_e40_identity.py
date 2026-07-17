"""E40.2 应用身份段：门验枚举、修复器清非法值留痕、契约渲染、夹具带身份。

身份段 appbundle.appIdentity 是纯展示增强层（产品名/主题/图标/导航），
与不变式/图表同一纪律：可选（老模型零变化）、出现即校验（枚举=真相源
账本）、非法值由修复器清除留痕而非株连整模型。
"""

import json
from pathlib import Path

from services import schema_legal
from services.v5_capability_executor import DOMAIN_INTENT_MARKERS
from services.v5_model_gate import validate_five_system_model
from services.v5_model_repair import repair_five_system_model

FIXTURE = Path(__file__).resolve().parent.parent / "services" / "data" / "builtin_domain_models.json"


def _minimal_model(identity=None):
    m = {
        "datamodel": {"entities": [{"id": "t", "name": "T", "fields": [
            {"id": "n", "name": "N", "type": "string"}]}]},
        "rbac": {"roles": ["r"], "permissions": ["t:view"],
                 "menus": [{"id": "m", "label": "M", "roleRefs": ["r"], "permissionRefs": ["t:view"]}]},
        "workflow": {"id": "wf", "nodes": [{"id": "n1", "name": "N", "assigneeRole": "r"}],
                     "transitions": []},
        "page": {"pages": [{"id": "p", "name": "P",
                            "fieldBindings": ["t.n"], "actionPermissions": ["t:view"]}]},
        "aigc": {"capabilities": []},
        "appbundle": {"pageBindings": [{"pageRef": "p", "workflowRef": "wf"}],
                      "roleRefs": ["r"], "dataModelRefs": ["t"]},
    }
    if identity is not None:
        m["appbundle"]["appIdentity"] = identity
    return m


def test_gate_accepts_valid_identity_and_blocks_illegal_enums():
    ok = _minimal_model({"productName": "测试台", "theme": "clay", "icon": "book", "nav": "top"})
    assert validate_five_system_model(ok)["passed"] is True

    bad = _minimal_model({"productName": "测试台", "theme": "rainbow", "icon": "dragon", "nav": "diagonal"})
    verdict = validate_five_system_model(bad)
    assert verdict["passed"] is False
    refs = {f.get("ref") for f in verdict["findings"]}
    assert {"rainbow", "dragon", "diagonal"} <= refs


def test_gate_ignores_missing_identity_legacy_models():
    assert validate_five_system_model(_minimal_model())["passed"] is True


def test_repair_clears_illegal_identity_values_with_notes():
    bad = _minimal_model({"productName": "  ", "theme": "rainbow", "icon": "book", "nav": "top"})
    result = repair_five_system_model(bad)
    fixed = result["model"]
    identity = fixed["appbundle"]["appIdentity"]
    assert "theme" not in identity and "productName" not in identity
    assert identity["icon"] == "book" and identity["nav"] == "top"  # 合法值保留
    cleared = {c["key"] for c in result["presentation"]["clearedIdentity"]}
    assert cleared == {"theme", "productName"}
    # 修完过门（身份层小违规不株连）
    assert validate_five_system_model(fixed)["passed"] is True


def test_contract_renders_identity_enums_from_ledger():
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert "APP IDENTITY" in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("identityThemes") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("identityIcons") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("identityNavs") in _SCHEMA_INSTRUCTION


def test_builtin_fixtures_carry_distinct_identities_and_pass_gate():
    models = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert set(models.keys()) == set(DOMAIN_INTENT_MARKERS.keys())
    seen_themes = set()
    for domain, model in models.items():
        identity = model["appbundle"].get("appIdentity") or {}
        assert identity.get("productName"), f"{domain} 缺产品名"
        assert identity.get("theme") in schema_legal.IDENTITY_THEMES
        assert identity.get("icon") in schema_legal.IDENTITY_ICONS
        assert identity.get("nav") in schema_legal.IDENTITY_NAVS
        seen_themes.add(identity["theme"])
        assert validate_five_system_model(model)["passed"] is True, domain
    assert len(seen_themes) == 4, "四个演示域应各有各的主题（千人千面的门面担当）"
