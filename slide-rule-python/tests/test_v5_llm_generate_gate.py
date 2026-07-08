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


def _with_chain_and_invariants(model):
    """扩展有效模型：附加一条 money 链路 + 两条落地的不变式（改进①②）。"""
    model["workflow"]["chains"] = [
        {
            "id": "wf_fine",
            "name": "逾期罚款链路",
            "kind": "money",
            "nodes": [
                {"id": "fine_assess", "name": "核定罚款", "assigneeRole": "librarian"},
                {"id": "fine_pay", "name": "缴纳罚款", "assigneeRole": "member"},
            ],
            "transitions": [{"from": "fine_assess", "to": "fine_pay"}],
        }
    ]
    model["appbundle"]["invariants"] = [
        {
            "id": "inv_loan_status_ledger",
            "statement": "借阅状态变更必须落借阅记录，不允许只改内存",
            "systems": ["datamodel", "workflow"],
            "refs": ["loan.status", "review"],
        },
        {
            "id": "inv_fine_before_next_loan",
            "statement": "有未缴罚款的会员不能发起新借阅",
            "systems": ["workflow", "rbac"],
            "refs": ["fine_pay", "member"],
        },
    ]
    return model


def test_chains_and_invariants_valid_model_passes():
    m = _with_chain_and_invariants(_valid_library_model())
    # appbundle 可以引用附加链路的 id / 节点 id
    m["appbundle"]["pageBindings"].append({"pageRef": "p_review", "workflowRef": "wf_fine"})
    m["appbundle"]["pageBindings"].append({"pageRef": "p_review", "workflowRef": "fine_pay"})
    result = validate_five_system_model(m)
    assert result["passed"] is True, result["findings"]


def test_chain_dangling_assignee_blocked():
    m = _with_chain_and_invariants(_valid_library_model())
    m["workflow"]["chains"][0]["nodes"][0]["assigneeRole"] = "ghost_role"
    result = validate_five_system_model(m)
    assert result["passed"] is False
    hits = [f for f in result["findings"] if f["ref"] == "ghost_role"]
    assert hits and "workflow.chains[wf_fine]" in hits[0]["path"]


def test_invariant_dangling_ref_and_bad_system_blocked():
    m = _with_chain_and_invariants(_valid_library_model())
    m["appbundle"]["invariants"][0]["refs"] = ["loan.nonexistent_field"]
    m["appbundle"]["invariants"][1]["systems"] = ["blockchain"]
    m["appbundle"]["invariants"].append(
        {"id": "inv_vague", "statement": "系统应当安全", "systems": [], "refs": []}
    )
    result = validate_five_system_model(m)
    assert result["passed"] is False
    refs = {f["ref"] for f in result["findings"]}
    assert "loan.nonexistent_field" in refs
    assert "blockchain" in refs
    assert any("inv_vague" in f["path"] and "no refs" in f["message"] for f in result["findings"])


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


# ---------------------------------------------------------------------------
# T3.5 — thread the gate-PASSED model through evidence + SSE (payload only)
# ---------------------------------------------------------------------------


def test_llm_path_per_skill_evidence_carries_model_sections():
    """Gate-passed LLM model sections ride on perSkillEvidence as modelSection payload."""
    model = _valid_library_model()
    state = _empty_state("图书馆借阅系统")
    per_skill = _build_per_skill_evidence(
        state, blocked_signal=False, goal="图书馆借阅系统",
        llm_json_fn=lambda g: model,
    )
    for skill in REQUIRED_EVIDENCE_KEYS:
        assert per_skill[skill]["evidencePresent"] is True
        assert per_skill[skill]["modelSection"] == model[skill], skill


def test_deterministic_domain_has_no_model_section():
    """Fixture domains have no LLM model — the key must be absent (never fabricated)."""
    state = _empty_state("采购审批平台")
    per_skill = _build_per_skill_evidence(state, blocked_signal=False, goal="采购审批平台")
    for skill in REQUIRED_EVIDENCE_KEYS:
        assert per_skill[skill]["evidencePresent"] is True
        assert "modelSection" not in per_skill[skill], skill


def test_model_section_never_participates_in_closure_hash():
    """modelSection is payload only: closure hash identical with or without it."""
    from services.v5_capability_executor import _stable_closure_hash

    state = _empty_state("图书馆借阅系统")
    with_model = _build_per_skill_evidence(
        state, blocked_signal=False, goal="图书馆借阅系统",
        llm_json_fn=lambda g: _valid_library_model(),
    )
    stripped = {
        skill: {k: v for k, v in entry.items() if k != "modelSection"}
        for skill, entry in with_model.items()
    }
    assert _stable_closure_hash(with_model, False, "图书馆借阅系统") == \
        _stable_closure_hash(stripped, False, "图书馆借阅系统")


def test_linkage_artifact_content_embeds_fenced_section_json():
    """Artifact content carries the section as a fenced ```json block (client-parseable),
    while matching/trust still reads only id/title/kind/summary."""
    import json
    from services.v5_llm_generate import model_to_linkage_artifacts

    model = _valid_library_model()
    artifacts = model_to_linkage_artifacts(model, "图书馆借阅系统")
    assert len(artifacts) == 6
    for artifact in artifacts:
        skill = artifact["id"].replace("llm-linkage-", "")
        assert artifact["_model_section"] == model[skill]
        content = artifact["content"]
        assert "```json" in content
        fenced = content.split("```json", 1)[1].split("```", 1)[0].strip()
        assert json.loads(fenced) == {skill: model[skill]}
        # trust haystack fields stay clean of model payload
        assert "```" not in artifact["summary"]
        assert "```" not in artifact["title"]


def test_stream_skill_result_emits_model_section_for_llm_path(monkeypatch):
    """drive_full_v5_session_stream: skill_result events carry modelSection when the
    (mocked) LLM path closes a novel intent; shape matches the client contract."""
    import asyncio
    import services.v5_llm_generate as v5_llm_generate

    model = _valid_library_model()
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    monkeypatch.setattr(
        v5_llm_generate, "generate_five_system_model",
        lambda goal, llm_json_fn=None: model,
    )

    from services.v5_full_driver import drive_full_v5_session_stream

    state = V5SessionState(
        sessionId="t-llm-stream",
        goal={"text": "图书馆借阅系统", "status": "needs_refinement"},
    )

    async def _collect():
        events = []
        async for event in drive_full_v5_session_stream(
            state, max_loops=1, user_instruction="图书馆借阅系统"
        ):
            events.append(event)
        return events

    events = asyncio.run(_collect())
    skill_results = [e for e in events if e.get("type") == "skill_result"]
    assert len(skill_results) == 6, [e.get("type") for e in events]
    by_label = {e["label"]: e for e in skill_results}
    for skill in REQUIRED_EVIDENCE_KEYS:
        event = by_label[skill]
        assert event["evidencePresent"] is True
        assert event["modelSection"] == model[skill], skill
        assert isinstance(event.get("mermaid"), str)  # edge projection still present


def test_stream_skill_result_model_section_none_for_deterministic_domain():
    """Deterministic fixture domain: skill_result still closes 6/6 but modelSection is None."""
    import asyncio

    from services.v5_full_driver import drive_full_v5_session_stream

    state = V5SessionState(
        sessionId="t-det-stream",
        goal={"text": "采购审批平台", "status": "needs_refinement"},
    )

    async def _collect():
        events = []
        async for event in drive_full_v5_session_stream(
            state, max_loops=1, user_instruction="采购审批平台"
        ):
            events.append(event)
        return events

    events = asyncio.run(_collect())
    skill_results = [e for e in events if e.get("type") == "skill_result"]
    assert len(skill_results) == 6
    for event in skill_results:
        assert "modelSection" in event  # field always present in the SSE contract
        assert event["modelSection"] is None  # no LLM model — never fabricated


def _closure_result_for(goal: str, monkey_env=None):
    """Run appbundle.runtimeClosure via the real executor and return the report dict."""
    from services.v5_capability_executor import execute_v5_capability

    state = _empty_state(goal)
    result = execute_v5_capability("appbundle.runtimeClosure", state, [], "appbundle", "t1")
    return result if isinstance(result, dict) else result.model_dump()


def test_blocked_closure_carries_llm_disabled_diagnostic(monkeypatch):
    """新颖意图 + LLM 未开启 → blocker 明示 LLM_GENERATE_DISABLED（不再无解释 0/6）。"""
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    report = _closure_result_for("星际殖民地物资调度系统")
    assert report["blocked"] is True
    codes = [b["code"] for b in report["blockers"]]
    assert "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED" in codes
    assert "LLM_GENERATE_DISABLED" in codes
    diag = next(b for b in report["blockers"] if b["code"] == "LLM_GENERATE_DISABLED")
    assert "SLIDERULE_LLM_GENERATE_ENABLED" in diag["ref"]
    assert {"code": "LLM_GENERATE_DISABLED"} in report["findingsByTier"]["hard_blocker"]


def test_blocked_closure_carries_llm_failed_diagnostic(monkeypatch):
    """LLM 开启但调用失败 → blocker 明示 LLM_GENERATE_FAILED + 失败原因。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    import services.v5_llm_generate as v5_llm_generate

    def _boom(goal, llm_json_fn=None):
        v5_llm_generate.last_generate_diagnostic = {
            "outcome": "failed",
            "detail": "LlmError: connection refused to llm host",
        }
        return None

    monkeypatch.setattr(v5_llm_generate, "generate_five_system_model", _boom)
    report = _closure_result_for("星际殖民地物资调度系统")
    assert report["blocked"] is True
    diag = next(b for b in report["blockers"] if b["code"] == "LLM_GENERATE_FAILED")
    assert "connection refused" in diag["ref"]


def test_closed_closure_has_no_diagnostic_blocker():
    """确定性域正常闭合 → 无诊断 blocker（诊断只在 blocked 时透出）。"""
    report = _closure_result_for("采购审批平台")
    assert report["blocked"] is False
    assert report["blockers"] == []
    assert report["findingsByTier"]["hard_blocker"] == []


def test_stream_emits_llm_delta_during_generation(monkeypatch):
    """新颖意图生成期间，SSE 流应携带 llm_delta 事件（LLM 实时输出可观测）。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    import asyncio
    import services.v5_llm_generate as v5_llm_generate
    from services.v5_full_driver import drive_full_v5_session_stream

    def fake_generate(goal, llm_json_fn=None):
        # 模拟流式：通过模块 sink 逐块吐增量（真实路径由 _default_llm_json_fn
        # 的 on_delta 驱动），然后返回合法模型。
        v5_llm_generate._emit_delta('{"datamodel"')
        v5_llm_generate._emit_delta(": {...}")
        return _valid_library_model()

    monkeypatch.setattr(v5_llm_generate, "generate_five_system_model", fake_generate)
    state = _empty_state("图书馆借阅系统")

    async def _collect():
        events = []
        async for ev in drive_full_v5_session_stream(state, max_loops=2, user_instruction="图书馆借阅系统"):
            events.append(ev)
        return events

    events = asyncio.run(_collect())
    deltas = [e for e in events if e.get("type") == "llm_delta"]
    assert len(deltas) >= 1, "generation increments must surface as llm_delta events"
    assert '"datamodel"' in "".join(d["text"] for d in deltas)
    # sink 用完即卸载（不泄漏到后续会话）
    assert v5_llm_generate._delta_sink is None


def test_diagnostic_never_affects_closure_hash(monkeypatch):
    """诊断只是留痕：同一 per-skill 证据下，有无诊断 hash 一致（不参与判定）。"""
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    r1 = _closure_result_for("星际殖民地物资调度系统")
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    import services.v5_llm_generate as v5_llm_generate
    monkeypatch.setattr(v5_llm_generate, "generate_five_system_model", lambda goal, llm_json_fn=None: None)
    r2 = _closure_result_for("星际殖民地物资调度系统")
    # 两次都是 0/6 blocked；诊断 code 不同（disabled vs failed）但 closureHash 相同
    assert r1["closureHash"] == r2["closureHash"]


if __name__ == "__main__":
    # Allow running directly without pytest (fixture-taking tests are pytest-only).
    import inspect

    fns = [
        v for k, v in sorted(globals().items())
        if k.startswith("test_") and callable(v)
        and not inspect.signature(v).parameters
    ]
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
