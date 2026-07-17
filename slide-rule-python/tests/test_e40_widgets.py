"""E40.4 渲染器三零件（排行榜/动态流/donut）：门校验、修复器处方、契约渲染。"""

from services import schema_legal
from services.v5_model_gate import validate_five_system_model
from services.v5_model_repair import repair_five_system_model


def _model(pages_extra=None):
    page = {
        "id": "p", "name": "监控", "fieldBindings": ["t.score"],
        "actionPermissions": ["t:view"],
    }
    if pages_extra:
        page.update(pages_extra)
    return {
        "datamodel": {"entities": [{"id": "t", "name": "T", "fields": [
            {"id": "title", "name": "标题", "type": "string"},
            {"id": "score", "name": "评分", "type": "number"},
            {"id": "at", "name": "时间", "type": "date"},
            {"id": "lvl", "name": "级别", "type": "enum",
             "options": [{"id": "hi", "label": "高", "tone": "danger"}]},
        ]}]},
        "rbac": {"roles": ["r"], "permissions": ["t:view"],
                 "menus": [{"id": "m", "label": "M", "roleRefs": ["r"], "permissionRefs": ["t:view"]}]},
        "workflow": {"id": "wf", "nodes": [{"id": "n1", "name": "N", "assigneeRole": "r"}],
                     "transitions": []},
        "page": {"pages": [page]},
        "aigc": {"capabilities": []},
        "appbundle": {"pageBindings": [{"pageRef": "p", "workflowRef": "wf"}],
                      "roleRefs": ["r"], "dataModelRefs": ["t"]},
    }


def test_donut_is_ledger_legal_and_gate_accepts():
    assert "donut" in schema_legal.CHART_TYPES
    m = _model({"charts": [{"id": "c", "type": "donut", "dimension": "t.lvl", "metric": "count"}]})
    assert validate_five_system_model(m)["passed"] is True


def test_gate_blocks_bad_ranking_and_feed_types():
    m = _model({
        "rankings": [{"id": "rk", "entity": "t", "sortBy": "t.at"}],      # date 排不了榜
        "feeds": [{"id": "fd", "entity": "t", "timeField": "t.score",     # number 不是时间
                   "levelField": "t.title"}],                              # string 不是级别
    })
    verdict = validate_five_system_model(m)
    assert verdict["passed"] is False
    refs = [f["ref"] for f in verdict["findings"]]
    assert refs.count("t.at") >= 1 and refs.count("t.score") >= 1 and refs.count("t.title") >= 1


def test_gate_accepts_valid_ranking_and_feed():
    m = _model({
        "rankings": [{"id": "rk", "name": "评分榜", "entity": "t", "sortBy": "t.score", "limit": 5}],
        "feeds": [{"id": "fd", "name": "动态", "entity": "t", "timeField": "t.at", "levelField": "t.lvl"}],
    })
    assert validate_five_system_model(m)["passed"] is True


def test_repair_near_matches_and_drops_widgets():
    m = _model({
        "rankings": [
            {"id": "rk_typo", "entity": "t", "sortBy": "t.scor"},          # 近邻修复 → t.score
            {"id": "rk_dead", "entity": "t", "sortBy": "t.quantum"},       # 无解 → 剔除
        ],
        "feeds": [
            {"id": "fd_typo", "entity": "t", "timeField": "t.att"},        # 近邻修复 → t.at
            {"id": "fd_badlevel", "entity": "t", "timeField": "t.at",
             "levelField": "t.nonsense"},                                   # level 清除，流保留
        ],
    })
    result = repair_five_system_model(m)
    fixed_page = result["model"]["page"]["pages"][0]
    rankings = {r["id"]: r for r in fixed_page["rankings"]}
    assert rankings["rk_typo"]["sortBy"] == "t.score"
    assert "rk_dead" not in rankings
    feeds = {f["id"]: f for f in fixed_page["feeds"]}
    assert feeds["fd_typo"]["timeField"] == "t.at"
    assert "levelField" not in feeds["fd_badlevel"]
    dropped = {d["rankingId"] for d in result["presentation"]["droppedRankings"]}
    assert "rk_dead" in dropped
    # 修完过门
    assert validate_five_system_model(result["model"])["passed"] is True


def test_contract_mentions_new_widgets():
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert "RANKINGS" in _SCHEMA_INSTRUCTION
    assert "FEEDS" in _SCHEMA_INSTRUCTION
    assert "donut" in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("chartTypes") in _SCHEMA_INSTRUCTION
