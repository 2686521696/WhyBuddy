"""
T3 tests — LLM generate() + structural closure gate.

Proves the gate logic is decoupled from LLM reliability (north-star): a fake
llm_json_fn drives generation with NO key + NO network.

  1. valid five-system model  -> gate passes -> closure 6/6
  2. dangling cross-ref model -> gate blocks -> fail-closed + precise finding
  3. missing section          -> gate blocks
  4. _build_per_skill_evidence wiring: fake llm closes a novel intent
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.v5_model_gate import validate_five_system_model, DANGLING, MISSING_SECTION
from services.v5_llm_generate import generate_five_system_model
from services.v5_capability_executor import _build_per_skill_evidence, REQUIRED_EVIDENCE_KEYS
from models.v5_state import V5SessionState


def _valid_library_model():
    """A novel domain (library lending) with fully-resolved cross-refs."""
    return {
        "datamodel": {
            "entities": [
                {"id": "loan", "name": "借阅记录", "fields": [
                    {"id": "id", "name": "编号", "type": "string"},
                    {"id": "book_id", "name": "图书", "type": "ref"},
                    {"id": "due_date", "name": "应还日期", "type": "date"},
                    {"id": "status", "name": "状态", "type": "enum"},
                ]},
                {"id": "book", "name": "图书", "fields": [
                    {"id": "id", "name": "编号", "type": "string"},
                    {"id": "title", "name": "书名", "type": "string"},
                ]},
            ]
        },
        "rbac": {
            "roles": ["member", "librarian", "admin"],
            "permissions": ["loan:create", "loan:approve", "loan:view"],
            "menus": [
                {"id": "m_my_loans", "label": "我的借阅", "roleRefs": ["member"], "permissionRefs": ["loan:view"]},
                {"id": "m_approve", "label": "审批", "roleRefs": ["librarian"], "permissionRefs": ["loan:approve"]},
            ],
        },
        "workflow": {
            "id": "wf_loan",
            "nodes": [
                {"id": "submit", "name": "提交借阅", "assigneeRole": "member"},
                {"id": "review", "name": "馆员审核", "assigneeRole": "librarian"},
            ],
            "transitions": [{"from": "submit", "to": "review"}],
        },
        "page": {
            "pages": [
                {"id": "p_apply", "name": "借阅申请", "fieldBindings": ["loan.book_id", "loan.due_date"],
                 "actionPermissions": ["loan:create"]},
                {"id": "p_review", "name": "审核详情", "fieldBindings": ["loan.status"],
                 "actionPermissions": ["loan:approve"]},
            ]
        },
        "aigc": {
            "capabilities": [
                {"id": "c_reco", "name": "图书推荐", "inputFields": ["book.title"],
                 "outputField": "loan.book_id", "roleRefs": ["member"]},
            ]
        },
        "appbundle": {
            "pageBindings": [{"pageRef": "p_apply", "workflowRef": "wf_loan"},
                             {"pageRef": "p_review", "workflowRef": "review"}],
            "roleRefs": ["member", "librarian", "admin"],
            "dataModelRefs": ["loan", "book"],
        },
    }


def _broken_model():
    """Same, but workflow assignee + page binding + appbundle ref all dangle."""
    m = _valid_library_model()
    m["workflow"]["nodes"][1]["assigneeRole"] = "ghost_role"       # not in rbac.roles
    m["page"]["pages"][0]["fieldBindings"] = ["loan.nonexistent"]  # not in datamodel
    m["appbundle"]["pageBindings"][0]["pageRef"] = "p_missing"     # not in pages
    return m


def test_valid_model_passes_gate():
    result = validate_five_system_model(_valid_library_model())
    assert result["passed"] is True, result["findings"]
    assert result["findings"] == []


def test_broken_model_blocked_with_precise_findings():
    result = validate_five_system_model(_broken_model())
    assert result["passed"] is False
    codes = {f["code"] for f in result["findings"]}
    assert DANGLING in codes
    refs = {f["ref"] for f in result["findings"]}
    assert "ghost_role" in refs
    assert "loan.nonexistent" in refs
    assert "p_missing" in refs


def test_missing_section_blocked():
    m = _valid_library_model()
    del m["aigc"]
    result = validate_five_system_model(m)
    assert result["passed"] is False
    assert any(f["code"] == MISSING_SECTION and f["affectedSkill"] == "aigc" for f in result["findings"])


def test_generate_with_fake_llm_returns_model():
    fake = lambda goal: _valid_library_model()
    model = generate_five_system_model("我要一个图书馆借阅系统", llm_json_fn=fake)
    assert model is not None
    assert set(["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]).issubset(model.keys())


def test_generate_none_when_llm_returns_junk():
    assert generate_five_system_model("x", llm_json_fn=lambda g: {"datamodel": {}}) is None  # missing sections
    assert generate_five_system_model("x", llm_json_fn=lambda g: None) is None
    assert generate_five_system_model("", llm_json_fn=lambda g: _valid_library_model()) is None  # empty goal


def _empty_state(goal: str) -> V5SessionState:
    return V5SessionState(sessionId="t-llm", goal={"text": goal, "status": "needs_refinement"})


def test_wiring_novel_intent_closes_with_valid_fake_llm():
    state = _empty_state("图书馆借阅系统")
    per_skill = _build_per_skill_evidence(
        state, blocked_signal=False, goal="图书馆借阅系统",
        llm_json_fn=lambda g: _valid_library_model(),
    )
    assert all(per_skill[k]["evidencePresent"] for k in REQUIRED_EVIDENCE_KEYS), per_skill


def test_wiring_novel_intent_fail_closed_with_broken_fake_llm():
    state = _empty_state("图书馆借阅系统")
    per_skill = _build_per_skill_evidence(
        state, blocked_signal=False, goal="图书馆借阅系统",
        llm_json_fn=lambda g: _broken_model(),
    )
    # Gate blocked -> no evidence injected -> all absent
    assert all(not per_skill[k]["evidencePresent"] for k in REQUIRED_EVIDENCE_KEYS), per_skill


def test_wiring_deterministic_domain_unaffected_by_llm():
    # Purchase still closes via fixture WITHOUT calling the LLM at all.
    state = _empty_state("采购审批平台")
    called = {"n": 0}
    def _should_not_be_called(g):
        called["n"] += 1
        return None
    per_skill = _build_per_skill_evidence(
        state, blocked_signal=False, goal="采购审批平台",
        llm_json_fn=_should_not_be_called,
    )
    assert all(per_skill[k]["evidencePresent"] for k in REQUIRED_EVIDENCE_KEYS)
    assert called["n"] == 0  # deterministic domain never touches the LLM


if __name__ == "__main__":
    # Allow running directly without pytest.
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{passed}/{len(fns)} passed")
    sys.exit(0 if passed == len(fns) else 1)
