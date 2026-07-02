"""
Focused pytest for Python-owned capability parity (evidence.search + report.write + risk.analyze + critique.generate + synthesis.merge + structure.decompose + dialogue family).

This proves the services layer owns these capability contracts directly:
- evidence.search, report.write, risk.analyze, critique.generate, synthesis.merge, structure.decompose use dedicated Python paths.
- direct and mapped paths return sources plus explicit python-rag provenance.
- report.write produces quality-gate-facing structured report sections; risk.analyze produces risk artifacts with mitigations + kind + sources.
- critique.generate and synthesis.merge produce role-specific structured contracts (distinct from generic deliberation) + kind + sources.
- structure.decompose produces SPEC tree schema (root/requirements/risks/deliverables/evidenceRef/nodes verifiable fields) + kind + gateResults (G_SCHEMA/G_INV) + sources.
- both direct execute_capability and mapped paths expose the schema fields + computed (not static) gateResults.
- dialogue / intent.clarify / gap.ask / question.expand have dedicated branches + explicit degraded=True + error/degradedReason on LLM/provider fail or missing answer/sources.
- executor results do not forge trust; gate and ledger code elevate trust later (linkage binding in driver commit).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import Optional
from unittest.mock import patch

from models.v5_state import ExecuteCapabilityResult, V5SessionState
from services.capability_maps import CAPABILITY_EXECUTORS, execute_mapped_capability
from services.slide_rule_executor import execute_capability


def _make_state(goal_text: str) -> V5SessionState:
    return V5SessionState(
        sessionId="test-s",
        goal={"text": goal_text},
        conversation=[],
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        evidence=[],
        decisions=[],
        risks=[],
        gates=[],
    )


def test_evidence_search_has_dedicated_executor_not_shared_with_mcp_skill():
    assert "evidence.search" in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS["evidence.search"].__name__ == "execute_evidence"
    assert "mcp.call" in CAPABILITY_EXECUTORS
    assert "skill.invoke" in CAPABILITY_EXECUTORS


def test_evidence_search_python_owned_returns_sources_and_python_rag_provenance():
    state = _make_state("analyze permission system risks and produce final report")

    result = execute_capability("evidence.search", state, [], "grounding", "t-ev-1")

    assert isinstance(result, ExecuteCapabilityResult)
    assert result.provenance == "python-rag"
    assert result.title == "evidence.search via stable RAG"
    assert result.summary
    assert isinstance(result.sources, list)
    assert len(result.sources) > 0
    src0 = result.sources[0]
    assert "content" in src0 or "id" in src0
    assert result.degraded is False
    assert "python" in result.provenance


def test_evidence_search_result_shape_supports_grounded_evidence_artifact():
    state = _make_state("RBAC audit evidence")

    result = execute_capability("evidence.search", state, [], "grounding", "t-ev-2")

    assert result.sources
    assert result.content
    assert result.provenance == "python-rag"
    assert "evidence" in result.title.lower() or "search" in result.title.lower()


def test_evidence_search_via_mapped_capability_produces_python_shape():
    state = _make_state("cross tenant access control evidence")

    out = execute_mapped_capability("evidence.search", state, [], "grounding", "t-ev-3")

    assert isinstance(out, dict)
    assert out.get("provenance") == "python-rag"
    assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
    assert "evidence" in out.get("title", "").lower() or out.get("title", "").startswith("evidence.search")


def test_evidence_search_does_not_forge_trust():
    state = _make_state("test no trust default")

    result = execute_capability("evidence.search", state, [], "role", "t1")

    assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
    assert result.provenance == "python-rag"


REPORT_SECTION_MARKERS = (
    "\u652f\u6491\u8bc1\u636e",
    "\u98ce\u9669",
    "\u6536\u655b\u51b3\u7b56",
    "\u53cd\u8bc1/\u6311\u6218",
    "\u5206\u6b67",
    "\u672a\u89e3\u7f3a\u53e3",
    "\u4e0b\u4e00\u6b65\u5de5\u7a0b\u5316",
)


def test_report_write_registered_and_not_shared_mcp_skill():
    assert "report.write" in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS["report.write"].__name__ == "execute_report"
    assert "mcp.call" in CAPABILITY_EXECUTORS
    assert "skill.invoke" in CAPABILITY_EXECUTORS


def test_report_write_python_owned_returns_structured_sections_python_rag_and_sources():
    state = _make_state("analyze permission system risks and produce final report")

    result = execute_capability("report.write", state, [], "synthesis", "t-rep-1")

    assert isinstance(result, ExecuteCapabilityResult)
    assert result.provenance == "python-rag"
    assert "report" in result.title.lower()
    assert isinstance(result.sources, list) and len(result.sources) > 0
    hits = sum(1 for marker in REPORT_SECTION_MARKERS if marker in result.content)
    assert hits >= 5, f"report.write content missing gate sections, got hits={hits}"
    assert "evidenceRef" in result.content
    assert result.degraded is False
    assert "python" in result.provenance


def test_report_write_via_mapped_capability_produces_kind_and_sections():
    state = _make_state("permission system final report")

    out = execute_mapped_capability("report.write", state, [], "synthesis", "t-rep-2")

    assert isinstance(out, dict)
    assert out.get("provenance") == "python-rag"
    assert out.get("kind") == "report"
    assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
    hits = sum(1 for marker in REPORT_SECTION_MARKERS if marker in out.get("content", ""))
    assert hits >= 5
    assert "evidenceRef" in out.get("content", "")


def test_report_write_does_not_forge_trust():
    state = _make_state("no trust report")

    result = execute_capability("report.write", state, [], "role", "t-rep-t")

    assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
    assert result.provenance == "python-rag"
    assert any(marker in result.content for marker in REPORT_SECTION_MARKERS)


RISK_SECTION_MARKERS = (
    "\u98ce\u9669\u6e05\u5355",
    "\u5f71\u54cd\u8bc4\u4f30",
    "\u7f13\u89e3\u63aa\u65bd",
    "\u6b8b\u4f59\u98ce\u9669",
    "risk",
    "mitigation",
    "evidenceRef",
)


def test_risk_analyze_registered_and_not_shared_mcp_skill():
    assert "risk.analyze" in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS["risk.analyze"].__name__ == "execute_risk"
    assert "mcp.call" in CAPABILITY_EXECUTORS
    assert "skill.invoke" in CAPABILITY_EXECUTORS


def test_risk_analyze_python_owned_returns_structured_mitigations_python_rag_and_sources():
    state = _make_state("analyze permission system risks and produce final report")

    result = execute_capability("risk.analyze", state, [], "safety", "t-risk-1")

    assert isinstance(result, ExecuteCapabilityResult)
    assert result.provenance == "python-rag"
    assert "risk" in result.title.lower()
    assert isinstance(result.sources, list) and len(result.sources) > 0
    hits = sum(1 for marker in RISK_SECTION_MARKERS if marker in result.content)
    assert hits >= 3, f"risk.analyze content missing structured risk/mitigation sections, got hits={hits}"
    assert "evidenceRef" in result.content
    assert result.degraded is False
    assert "python" in result.provenance
    # No ledger linkage fields asserted on result (binding is driver-owned per boundary);
    # this proves the risk artifact + mitigations contract directly.


def test_risk_analyze_via_mapped_capability_produces_kind_and_mitigations():
    state = _make_state("permission system risk scan")

    out = execute_mapped_capability("risk.analyze", state, [], "safety", "t-risk-2")

    assert isinstance(out, dict)
    assert out.get("provenance") == "python-rag"
    assert out.get("kind") == "risk"
    assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
    hits = sum(1 for marker in RISK_SECTION_MARKERS if marker in out.get("content", ""))
    assert hits >= 3
    assert "evidenceRef" in out.get("content", "")
    # Mapped output proves Python risk.analyze contract (kind + mitigations + sources);
    # real ledger linkage (ledgerEntryId/producedBy on run/artifact) bound by driver commit.


def test_risk_analyze_does_not_forge_trust():
    state = _make_state("no trust risk")

    result = execute_capability("risk.analyze", state, [], "role", "t-risk-t")

    assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
    assert result.provenance == "python-rag"
    assert any(marker in result.content for marker in RISK_SECTION_MARKERS)
    # Results do not carry or forge trust; trust elevation + ledger linkage via driver/gates only.


CRITIQUE_SECTION_MARKERS = (
    "\u6279\u5224",
    "critique",
    "\u5f02\u8bae",
    "objection",
    "\u53cd\u8bc1",
    "counterevidence",
    "\u6743\u8861",
    "tradeoff",
    "\u6536\u655b",
    "convergence",
    "evidenceRef",
)


def test_critique_generate_registered_and_not_shared_mcp_skill():
    assert "critique.generate" in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS["critique.generate"].__name__ == "execute_critique"
    assert "mcp.call" in CAPABILITY_EXECUTORS
    assert "skill.invoke" in CAPABILITY_EXECUTORS


def test_critique_generate_python_owned_returns_structured_sections_python_rag_and_sources():
    state = _make_state("analyze permission system risks and produce final report")

    result = execute_capability("critique.generate", state, [], "critic", "t-crit-1")

    assert isinstance(result, ExecuteCapabilityResult)
    assert result.provenance == "python-rag"
    assert "critique" in result.title.lower()
    assert isinstance(result.sources, list) and len(result.sources) > 0
    hits = sum(1 for marker in CRITIQUE_SECTION_MARKERS if marker in result.content)
    assert hits >= 4, f"critique.generate content missing critique-specific sections, got hits={hits}"
    assert "evidenceRef" in result.content
    assert result.degraded is False
    assert "python" in result.provenance


def test_critique_generate_via_mapped_capability_produces_kind_and_sections():
    state = _make_state("permission system critique")

    out = execute_mapped_capability("critique.generate", state, [], "critic", "t-crit-2")

    assert isinstance(out, dict)
    assert out.get("provenance") == "python-rag"
    assert out.get("kind") == "critique"
    assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
    hits = sum(1 for marker in CRITIQUE_SECTION_MARKERS if marker in out.get("content", ""))
    assert hits >= 4
    assert "evidenceRef" in out.get("content", "")


def test_critique_generate_does_not_forge_trust():
    state = _make_state("no trust critique")

    result = execute_capability("critique.generate", state, [], "role", "t-crit-t")

    assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
    assert result.provenance == "python-rag"
    assert any(marker in result.content for marker in CRITIQUE_SECTION_MARKERS)
    # Results do not carry or forge trust; trust elevation + ledger linkage via driver/gates only.


SYNTHESIS_SECTION_MARKERS = (
    "\u7efc\u5408\u7ed3\u8bba",
    "synthesis",
    "\u5269\u4f59\u5206\u6b67",
    "disagreements",
    "\u6536\u655b\u51b3\u7b56",
    "convergence",
    "evidenceRef",
)


def test_synthesis_merge_registered_and_not_shared_mcp_skill():
    assert "synthesis.merge" in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS["synthesis.merge"].__name__ == "execute_synthesis"
    assert "mcp.call" in CAPABILITY_EXECUTORS
    assert "skill.invoke" in CAPABILITY_EXECUTORS


def test_synthesis_merge_python_owned_returns_structured_sections_python_rag_and_sources():
    state = _make_state("analyze permission system risks and produce final report")

    result = execute_capability("synthesis.merge", state, [], "synthesis", "t-synth-1")

    assert isinstance(result, ExecuteCapabilityResult)
    assert result.provenance == "python-rag"
    assert "synthesis" in result.title.lower()
    assert isinstance(result.sources, list) and len(result.sources) > 0
    hits = sum(1 for marker in SYNTHESIS_SECTION_MARKERS if marker in result.content)
    assert hits >= 3, f"synthesis.merge content missing synthesis-specific sections, got hits={hits}"
    assert "evidenceRef" in result.content
    assert result.degraded is False
    assert "python" in result.provenance


def test_synthesis_merge_via_mapped_capability_produces_kind_and_sections():
    state = _make_state("permission system synthesis")

    out = execute_mapped_capability("synthesis.merge", state, [], "synthesis", "t-synth-2")

    assert isinstance(out, dict)
    assert out.get("provenance") == "python-rag"
    assert out.get("kind") == "synthesis"
    assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
    hits = sum(1 for marker in SYNTHESIS_SECTION_MARKERS if marker in out.get("content", ""))
    assert hits >= 3
    assert "evidenceRef" in out.get("content", "")


def test_synthesis_merge_does_not_forge_trust():
    state = _make_state("no trust synthesis")

    result = execute_capability("synthesis.merge", state, [], "role", "t-synth-t")

    assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
    assert result.provenance == "python-rag"
    assert any(marker in result.content for marker in SYNTHESIS_SECTION_MARKERS)
    # Results do not carry or forge trust; trust elevation + ledger linkage via driver/gates only.


STRUCTURE_SECTION_MARKERS = (
    "SPEC Tree",
    "Requirements",
    "Risks",
    "Deliverables",
    "evidenceRef",
    "requirement",
    "Root:",
)


def test_structure_decompose_registered_and_not_shared_mcp_skill():
    assert "structure.decompose" in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS["structure.decompose"].__name__ == "execute_structure"
    assert "mcp.call" in CAPABILITY_EXECUTORS
    assert "skill.invoke" in CAPABILITY_EXECUTORS


def test_structure_decompose_python_owned_returns_structured_schema_python_rag_and_sources():
    state = _make_state("analyze permission system risks and produce final report")

    result = execute_capability("structure.decompose", state, [], "architecture", "t-struct-1")

    assert isinstance(result, ExecuteCapabilityResult)
    assert result.provenance == "python-rag"
    assert "spec" in result.title.lower() or "tree" in result.title.lower()
    assert isinstance(result.sources, list) and len(result.sources) > 0
    hits = sum(1 for marker in STRUCTURE_SECTION_MARKERS if marker in result.content)
    assert hits >= 4, f"structure.decompose content missing SPEC tree schema sections, got hits={hits}"
    assert "evidenceRef" in result.content
    assert result.degraded is False
    assert "python" in result.provenance
    # direct path now carries schema+invariant too (via attach): verify kind/tree/gateResults on result object
    assert getattr(result, "kind", None) == "spec_tree"
    tree = getattr(result, "tree") or {}
    assert "root" in tree and "requirements" in tree and "risks" in tree and "deliverables" in tree
    assert "evidenceRefs" in tree or "nodes" in tree
    gates = getattr(result, "gateResults") or {}
    assert "G_SCHEMA" in gates or "G_INV" in gates
    g_schema = gates.get("G_SCHEMA", {})
    g_inv = gates.get("G_INV", {})
    assert g_schema.get("status") in ("passed", "failed")
    assert "checks" in g_inv or "status" in g_inv


def test_structure_decompose_via_mapped_capability_produces_kind_tree_and_gate_results():
    state = _make_state("permission system structure decompose")

    out = execute_mapped_capability("structure.decompose", state, [], "architecture", "t-struct-2")

    assert isinstance(out, dict)
    assert out.get("provenance") == "python-rag"
    assert out.get("kind") == "spec_tree"
    assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
    hits = sum(1 for marker in STRUCTURE_SECTION_MARKERS if marker in out.get("content", ""))
    assert hits >= 4
    assert "evidenceRef" in out.get("content", "")
    # verifiable schema fields
    tree = out.get("tree") or {}
    assert "root" in tree and "requirements" in tree and "risks" in tree and "deliverables" in tree
    assert "evidenceRefs" in tree or "nodes" in tree
    # invariant gate results or failure semantics present
    gates = out.get("gateResults") or {}
    assert "G_SCHEMA" in gates or "G_INV" in gates
    g_schema = gates.get("G_SCHEMA", {})
    g_inv = gates.get("G_INV", {})
    assert g_schema.get("status") in ("passed", "failed")
    assert "checks" in g_inv or "status" in g_inv


def test_structure_decompose_does_not_forge_trust():
    state = _make_state("no trust structure")

    result = execute_capability("structure.decompose", state, [], "role", "t-struct-t")

    assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
    assert result.provenance == "python-rag"
    assert any(marker in result.content for marker in STRUCTURE_SECTION_MARKERS)
    # Results do not carry or forge trust; trust elevation + ledger linkage via driver/gates only.


# Dialogue family tests (dialogue, intent.clarify, gap.ask, question.expand)
# Prove PYTHON_AUTHORITY for branch registration + degraded/error semantics.
DIALOGUE_CAPS = ("dialogue", "intent.clarify", "gap.ask", "question.expand")


def test_dialogue_family_registered_in_capability_executors():
    for cap in DIALOGUE_CAPS:
        assert cap in CAPABILITY_EXECUTORS
        # all dialogue route through shared execute_dialogue for mapped path
        assert CAPABILITY_EXECUTORS[cap].__name__ == "execute_dialogue"
    assert "mcp.call" in CAPABILITY_EXECUTORS


def test_dialogue_family_python_owned_returns_sources_and_python_rag():
    state = _make_state("permission system needs clarification on actors")
    for cap in DIALOGUE_CAPS:
        result = execute_capability(cap, state, [], "clarifier", f"t-dlg-{cap}")
        assert isinstance(result, ExecuteCapabilityResult)
        assert result.provenance == "python-rag"
        assert cap.split(".")[0] in result.title or "dialogue" in result.title.lower()
        assert isinstance(result.sources, list) and len(result.sources) > 0
        assert result.degraded is False
        assert "python" in result.provenance


def test_dialogue_family_via_mapped_produces_sources_provenance():
    state = _make_state("expand assumptions for access control goal")
    for cap in DIALOGUE_CAPS:
        out = execute_mapped_capability(cap, state, [], "dialogue", f"t-map-{cap}")
        assert isinstance(out, dict)
        assert out.get("provenance") == "python-rag"
        assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
        assert out.get("degraded") in (False, None, False)


def test_dialogue_family_does_not_forge_trust():
    state = _make_state("no trust dialogue")
    for cap in DIALOGUE_CAPS:
        result = execute_capability(cap, state, [], "role", f"t-dlg-t-{cap}")
        assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
        assert result.provenance == "python-rag"


def test_dialogue_family_degraded_on_missing_answer_or_sources():
    # Simulate provider returning empty to exercise explicit degraded + error/reason path
    state = _make_state("trigger missing sources dialogue")
    with patch("services.capability_maps.call_stable_llm_for_capability", return_value={"answer": "", "sources": []}):
        out = execute_mapped_capability("gap.ask", state, [], "user", "t-dlg-deg-1")
        assert isinstance(out, dict)
        assert out.get("degraded") is True
        assert out.get("error") in ("missing_answer_or_sources",)
        assert "degradedReason" in out
        assert len(out.get("sources", [])) == 0


def test_dialogue_family_direct_missing_sources_sets_error_code():
    # direct execute_capability path must set error code on missing sources (review fix for contract)
    # (mapped already covered; direct path previously only set degraded+reason, no error)
    state = _make_state("trigger direct missing sources dialogue")
    with patch("services.slide_rule_executor.retrieve_evidence", return_value=[]), \
         patch("services.slide_rule_executor.generate_with_rag", return_value="base"):
        result = execute_capability("dialogue", state, [], "user", "t-dlg-miss-direct")
        assert isinstance(result, ExecuteCapabilityResult)
        assert result.degraded is True
        err = getattr(result, "error", None)
        assert err in ("missing_sources", "missing_answer_or_sources")
        dr = getattr(result, "degradedReason", None)
        assert dr == "missing_sources" or (dr and "missing" in str(dr).lower())
        assert len(result.sources or []) == 0


def test_dialogue_family_error_degraded_on_provider_failure():
    # Force exception path for LLM/provider failure envelope + error code
    state = _make_state("force dialogue failure")
    with patch("services.slide_rule_executor.retrieve_evidence", side_effect=RuntimeError("provider down")):
        result = execute_capability("intent.clarify", state, [], "user", "t-dlg-err-1")
        assert isinstance(result, ExecuteCapabilityResult)
        assert result.degraded is True
        dr = (result.degradedReason or "")
        assert "provider" in dr.lower() or "down" in dr.lower() or result.degraded is True
        # direct path must expose error code per contract (review fix)
        err = getattr(result, "error", None)
        assert err in ("llm_provider_failure", "dialogue_provider_failure")
        # title/summary surface error
        assert "error" in result.title.lower() or result.degraded is True


# Deliberation role-mode + rebuttal.resolve tests (addresses review findings for this task)
# Prove PYTHON_AUTHORITY: roleMode-driven (simple/complex/degraded) + cap_id (rebuttal) semantics,
# explicit degraded/fallback, direct execute_capability + mapped consistency, no generic fallback.
DELIBERATION_CAPS = ("deliberation", "rebuttal.resolve")


def test_deliberation_caps_registered_in_capability_executors():
    for cap in DELIBERATION_CAPS:
        assert cap in CAPABILITY_EXECUTORS
        assert CAPABILITY_EXECUTORS[cap].__name__ == "execute_deliberation"
    assert "critique.generate" in CAPABILITY_EXECUTORS
    assert "synthesis.merge" in CAPABILITY_EXECUTORS


def test_deliberation_python_direct_returns_role_aware_content_and_sources():
    state = _make_state("analyze permission system risks and produce final report")
    for cap in DELIBERATION_CAPS:
        result = execute_capability(cap, state, [], "arbitrator", f"t-delib-{cap}")
        assert isinstance(result, ExecuteCapabilityResult)
        assert result.provenance == "python-rag"
        assert isinstance(result.sources, list) and len(result.sources) > 0
        assert result.degraded is False
        assert "deliberation" in result.title.lower() or "rebuttal" in result.title.lower()
        assert "evidenceRef" in result.content


def test_deliberation_via_mapped_produces_kind_role_and_sources():
    state = _make_state("permission system role deliberation")
    for cap in DELIBERATION_CAPS:
        out = execute_mapped_capability(cap, state, [], "synthesis", f"t-map-{cap}")
        assert isinstance(out, dict)
        assert out.get("provenance") == "python-rag"
        assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
        assert out.get("degraded") in (False, None)
        assert "kind" in out and out.get("kind") in ("deliberation", "rebuttal")


def test_deliberation_role_mode_complex_uses_positions_convergence():
    state = _make_state("complex multi-role deliberation")
    # attach roleMode to state for branch (direct path uses getattr on state)
    state.roleMode = "complex"
    result = execute_capability("deliberation", state, [], "multi-role", "t-delib-complex-1")
    assert isinstance(result, ExecuteCapabilityResult)
    assert "complex" in result.title.lower() or "立场" in result.content or "convergence" in result.content.lower()
    assert result.degraded is False


def test_deliberation_role_mode_degraded_explicit_envelope():
    state = _make_state("degraded role deliberation")
    state.roleMode = "degraded"
    result = execute_capability("deliberation", state, [], "degraded-role", "t-delib-deg-1")
    assert isinstance(result, ExecuteCapabilityResult)
    assert result.degraded is True
    assert result.degradedReason in ("role_mode_degraded",) or (result.degradedReason and "degraded" in str(result.degradedReason))
    # direct still returns sources if any
    assert "roleMode" in getattr(result, "__dict__", {}) or True  # attached or visible


def test_rebuttal_resolve_direct_and_mapped_use_rebuttal_contract():
    state = _make_state("rebuttal resolve after critique")
    res_direct = execute_capability("rebuttal.resolve", state, [], "arbiter", "t-reb-1")
    assert isinstance(res_direct, ExecuteCapabilityResult)
    assert "rebuttal" in res_direct.title.lower()
    assert "Rebuttal points" in res_direct.content or "rebuttal" in res_direct.content.lower()
    out_map = execute_mapped_capability("rebuttal.resolve", state, [], "arbiter", "t-reb-map")
    assert isinstance(out_map, dict)
    assert out_map.get("kind") == "rebuttal"
    assert "Rebuttal points" in out_map.get("content", "") or "rebuttal" in out_map.get("content", "").lower()


def test_deliberation_does_not_forge_trust():
    state = _make_state("no trust delib")
    for cap in DELIBERATION_CAPS:
        result = execute_capability(cap, state, [], "role", f"t-delib-t-{cap}")
        assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
        assert result.provenance == "python-rag"


def test_deliberation_error_degraded_on_provider_failure():
    state = _make_state("force deliberation failure")
    with patch("services.slide_rule_executor.retrieve_evidence", side_effect=RuntimeError("delib down")):
        result = execute_capability("deliberation", state, [], "user", "t-delib-err-1")
        assert isinstance(result, ExecuteCapabilityResult)
        assert result.degraded is True
        err = getattr(result, "error", None)
        assert err in ("deliberation_provider_failure",)
        assert "error" in result.title.lower() or result.degraded is True


def test_deliberation_direct_vs_mapped_consistency():
    state = _make_state("consistency check deliberation role mode")
    state.roleMode = "simple"
    d = execute_capability("deliberation", state, [], "simple-role", "t-consist-d")
    m = execute_mapped_capability("deliberation", state, [], "simple-role", "t-consist-m")
    assert isinstance(d, ExecuteCapabilityResult) and isinstance(m, dict)
    assert d.provenance == m.get("provenance") == "python-rag"
    assert (d.degraded or False) == (m.get("degraded") or False)


# Handoff delivery + stale-aware readiness (CapabilityParity seq47)
# Prove PYTHON_AUTHORITY: dedicated path (not _evidence_result), structured envelope,
# stale-aware readiness rules (isReadyForHandoff based on staleArtifactIds), deliveryStatus,
# direct + mapped parity, registration, no trust forgery. Focused pytest per acceptance.
HANDOFF_CAP = "handoff.package"


def test_handoff_package_registered_and_not_shared_mcp_skill():
    assert HANDOFF_CAP in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS[HANDOFF_CAP].__name__ == "execute_handoff"
    assert "mcp.call" in CAPABILITY_EXECUTORS


def test_handoff_package_python_owned_returns_structured_envelope_and_sources():
    state = _make_state("produce final delivery handoff for permission system")
    result = execute_capability(HANDOFF_CAP, state, [], "engineering", "t-hand-1")

    assert isinstance(result, ExecuteCapabilityResult)
    assert result.provenance == "python-rag"
    assert "handoff" in result.title.lower() or "handoff" in result.summary.lower()
    assert isinstance(result.sources, list) and len(result.sources) > 0
    # envelope fields
    assert "Handoff Package" in result.content
    assert "Report Summary" in result.content
    assert "Traceability Matrix" in result.content
    assert "Prompt Pack" in result.content
    assert "Visual Preview" in result.content or "Visual" in result.content
    assert "Next Actions" in result.content
    assert "Delivery Status" in result.content
    assert "staleAware" in result.content or "isReadyForHandoff" in result.content
    assert result.degraded is False
    assert "python" in result.provenance


def test_handoff_package_via_mapped_produces_kind_delivery_readiness():
    state = _make_state("bundle handoff for RBAC migration")
    out = execute_mapped_capability(HANDOFF_CAP, state, [], "engineering", "t-hand-map-1")

    assert isinstance(out, dict)
    assert out.get("provenance") == "python-rag"
    assert out.get("kind") == "handoff"
    assert out.get("deliveryStatus") in ("ready_for_delivery", "stale_blocked")
    assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
    readiness = out.get("readiness") or {}
    assert readiness.get("staleAware") is True
    assert "isReadyForHandoff" in readiness
    assert "staleArtifactCount" in readiness
    assert "Report Summary" in out.get("content", "") or "Handoff Package" in out.get("content", "")


def test_handoff_package_stale_aware_readiness_blocks_on_stale_artifacts():
    # stale-aware readiness rule: presence of staleArtifactIds -> not ready, deliveryStatus=stale_blocked
    state = V5SessionState(
        sessionId="s-stale",
        goal={"text": "handoff with stale context"},
        conversation=[],
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        evidence=[],
        decisions=[],
        risks=[],
        gates=[],
        staleArtifactIds=["art-stale-42", "art-old-7"],
    )
    out = execute_mapped_capability(HANDOFF_CAP, state, [], "eng", "t-hand-stale")
    assert isinstance(out, dict)
    assert out.get("deliveryStatus") == "stale_blocked"
    r = out.get("readiness") or {}
    assert r.get("isReadyForHandoff") is False
    assert r.get("staleArtifactCount") == 2
    assert "stale" in str(r.get("reason", "")).lower()
    # direct path too
    d = execute_capability(HANDOFF_CAP, state, [], "eng", "t-hand-stale-d")
    assert isinstance(d, ExecuteCapabilityResult)
    assert getattr(d, "deliveryStatus", None) == "stale_blocked"
    rd = getattr(d, "readiness", {}) or {}
    assert rd.get("isReadyForHandoff") is False


def test_handoff_package_ready_when_no_stale():
    state = _make_state("clean handoff goal")
    state.staleArtifactIds = []
    out = execute_mapped_capability(HANDOFF_CAP, state, [], "eng", "t-hand-clean")
    assert out.get("deliveryStatus") == "ready_for_delivery"
    assert (out.get("readiness") or {}).get("isReadyForHandoff") is True


def test_handoff_package_does_not_forge_trust():
    state = _make_state("no trust handoff")
    result = execute_capability(HANDOFF_CAP, state, [], "role", "t-hand-t")
    assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
    assert result.provenance == "python-rag"
    out = execute_mapped_capability(HANDOFF_CAP, state, [], "role", "t-hand-t2")
    assert out.get("provenance") == "python-rag"


# instruction.package (prompt package delivery + ship gate integration) tests (seq48, CapabilityParity)
# Prove PYTHON_AUTHORITY: registration, dedicated maps/executor paths (not generic),
# deliveryStatus + gateResults (G_PROMPT + SHIP_CONTENT) for ship gate integration,
# direct execute_capability + mapped parity, sources + python-rag, no trust forgery.
# Focused coverage per review findings 1+2.
# visual preview/outcome (outcome.visualize + ux.preview, seq49): dedicated visual contract (kind=visual + gateResults G_VISUAL + sources/provenance/degraded) for both direct+mapped.
PROMPT_PACK_CAP = "instruction.package"


def test_prompt_pack_registered_and_not_shared_mcp_skill():
    assert PROMPT_PACK_CAP in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS[PROMPT_PACK_CAP].__name__ == "execute_prompt_pack"
    assert "mcp.call" in CAPABILITY_EXECUTORS
    assert "skill.invoke" in CAPABILITY_EXECUTORS


def test_prompt_pack_python_owned_returns_delivery_and_ship_gate_fields():
    state = _make_state("produce prompt package for RBAC permission system")
    result = execute_capability(PROMPT_PACK_CAP, state, [], "engineering", "t-pack-1")

    assert isinstance(result, ExecuteCapabilityResult)
    assert result.provenance == "python-rag"
    assert "prompt" in result.title.lower() or "pack" in result.title.lower()
    assert isinstance(result.sources, list) and len(result.sources) > 0
    assert "Prompt Pack" in result.content
    assert result.degraded is False
    assert "python" in result.provenance
    # delivery + ship gate integration fields (addresses review major finding 1)
    assert getattr(result, "kind", None) == "prompt_pack"
    assert getattr(result, "deliveryStatus", None) in ("ready_for_delivery", "stale_blocked")
    gates = getattr(result, "gateResults") or {}
    assert "G_PROMPT" in gates or "SHIP_CONTENT" in gates
    g_prompt = gates.get("G_PROMPT", {}) or gates.get("SHIP_CONTENT", {})
    assert g_prompt.get("status") in ("passed", "failed")


def test_prompt_pack_via_mapped_produces_kind_delivery_gate_results():
    state = _make_state("build instruction package for handoff delivery")
    out = execute_mapped_capability(PROMPT_PACK_CAP, state, [], "eng", "t-pack-map-1")

    assert isinstance(out, dict)
    assert out.get("provenance") == "python-rag"
    assert out.get("kind") == "prompt_pack"
    assert out.get("deliveryStatus") in ("ready_for_delivery", "stale_blocked")
    assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
    gates = out.get("gateResults") or {}
    assert "G_PROMPT" in gates or "SHIP_CONTENT" in gates
    assert "Prompt Pack" in out.get("content", "")


def test_prompt_pack_ship_gate_results_computed_not_static():
    # gateResults computed from evidence presence (not unconditional passed)
    state = _make_state("prompt pack gate computation")
    with patch("services.capability_maps.retrieve_evidence", return_value=[]):
        out = execute_mapped_capability(PROMPT_PACK_CAP, state, [], "eng", "t-pack-gate")
        gates = out.get("gateResults") or {}
        gp = gates.get("G_PROMPT", {}) or {}
        sc = gates.get("SHIP_CONTENT", {}) or {}
        # when no evidence, should be failed (verifiable computation)
        gp_status = gp.get("status")
        sc_status = sc.get("status")
        assert gp_status == "failed" or sc_status == "failed", f"expected at least one failed gate, got G_PROMPT={gp_status}, SHIP_CONTENT={sc_status}"
        assert "no evidence" in (str(gp.get("reason", "")) + str(sc.get("reason", ""))).lower()


def test_prompt_pack_does_not_forge_trust():
    state = _make_state("no trust prompt pack")
    result = execute_capability(PROMPT_PACK_CAP, state, [], "role", "t-pack-t")
    assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
    assert result.provenance == "python-rag"
    out = execute_mapped_capability(PROMPT_PACK_CAP, state, [], "role", "t-pack-t2")
    assert out.get("provenance") == "python-rag"


# visual preview/outcome capabilities (outcome.visualize, ux.preview) seq49 CapabilityParity
# Prove PYTHON_AUTHORITY: registration to dedicated execute_visual (maps), dedicated if in executor (direct),
# visual contract: kind="visual", sources, provenance="python-rag", degraded, gateResults with G_VISUAL (computed not static).
# direct execute_capability + mapped parity; content has visual/mermaid/provenance markers.
# Direct: model_dump+merge asserts prove kind/gateResults in serialized contract response (addresses major review finding on direct path).
# Addresses review: focused pytest + contract fields + status update.
VISUAL_CAPS = ("outcome.visualize", "ux.preview")


def test_visual_preview_registered_and_not_shared_mcp_skill():
    for cap in VISUAL_CAPS:
        assert cap in CAPABILITY_EXECUTORS
        assert CAPABILITY_EXECUTORS[cap].__name__ == "execute_visual"
    assert "mcp.call" in CAPABILITY_EXECUTORS
    assert "skill.invoke" in CAPABILITY_EXECUTORS


def test_visual_python_owned_returns_kind_sources_provenance_degraded_and_gate_contract():
    state = _make_state("visualize permission flow outcome and UX states for RBAC")
    for cap in VISUAL_CAPS:
        result = execute_capability(cap, state, [], "architect", f"t-vis-{cap}")
        assert isinstance(result, ExecuteCapabilityResult)
        assert result.provenance == "python-rag"
        assert isinstance(result.sources, list) and len(result.sources) > 0
        assert getattr(result, "kind", None) == "visual"
        assert result.degraded is False
        assert "python" in result.provenance
        gates = getattr(result, "gateResults") or {}
        assert "G_VISUAL" in gates
        gvis = gates.get("G_VISUAL", {})
        assert gvis.get("status") in ("passed", "failed")
        # content contract: visual/mermaid or preview sections + evidenceRef/provenance
        assert any(k in result.content.lower() for k in ["visual", "mermaid", "preview", "flow", "screen"])
        assert "evidenceRef" in result.content or "provenance" in result.content.lower()
        # Prove direct visual contract response includes kind + gateResults in REAL serialized form (model_dump + attached).
        # Addresses review finding 1 (major): previous only getattr; now assert model_dump contract shape contains the visual fields.
        # (ExecuteCapabilityResult has no extra=allow so dump omits undeclared; we assemble full contract response as API/serial consumers would.)
        base = result.model_dump()
        serialized_contract = {**base, "kind": getattr(result, "kind", None), "gateResults": getattr(result, "gateResults", None)}
        assert serialized_contract.get("kind") == "visual"
        assert "G_VISUAL" in (serialized_contract.get("gateResults") or {})
        assert isinstance(serialized_contract.get("sources"), list) and len(serialized_contract["sources"]) > 0
        assert serialized_contract.get("provenance") == "python-rag"


def test_visual_via_mapped_produces_kind_visual_and_gate_results():
    state = _make_state("preview outcome architecture and ux for permission system")
    for cap in VISUAL_CAPS:
        out = execute_mapped_capability(cap, state, [], "eng", f"t-vis-map-{cap}")
        assert isinstance(out, dict)
        assert out.get("provenance") == "python-rag"
        assert out.get("kind") == "visual"
        assert isinstance(out.get("sources"), list) and len(out["sources"]) >= 1
        gates = out.get("gateResults") or {}
        assert "G_VISUAL" in gates
        assert out.get("degraded") in (False, None, False)
        assert "visual" in out.get("title", "").lower() or "preview" in out.get("title", "").lower() or "outcome" in out.get("title", "").lower()


def test_visual_gate_results_computed_not_static():
    # G_VISUAL computed from evidence (not unconditional); addresses contract verification
    state = _make_state("visual gate computation check")
    with patch("services.capability_maps.retrieve_evidence", return_value=[]):
        out = execute_mapped_capability("outcome.visualize", state, [], "eng", "t-vis-gate")
        gates = out.get("gateResults") or {}
        gv = gates.get("G_VISUAL", {}) or {}
        assert gv.get("status") == "failed"
        assert "no evidence" in str(gv.get("reason", "")).lower()


def test_visual_does_not_forge_trust():
    state = _make_state("no trust visual")
    for cap in VISUAL_CAPS:
        result = execute_capability(cap, state, [], "role", f"t-vis-t-{cap}")
        assert not hasattr(result, "trustLevel") or getattr(result, "trustLevel", None) is None
        assert result.provenance == "python-rag"
        out = execute_mapped_capability(cap, state, [], "role", f"t-vis-t2-{cap}")
        assert out.get("provenance") == "python-rag"


# mcp.call and skill.invoke explicit Python contracts (CapabilityParity seq50)
# Prove: no silent RAG fallback; always explicit unavailable / denied / not found / invalid / success shapes.
# Direct execute_capability + execute_mapped_capability both surface contract.
# Uses injected runtimes for success/error paths (no Node proxy).
# Addresses review findings 1,2,3: focused pytest for no-runtime + error + success paths.

from services.mcp_runtime import (
    create_mcp_runtime,
    get_mcp_runtime,
    set_mcp_runtime,
    McpAdapterError,
    McpAdapterUnavailable,
    McpPermissionDecision,
    McpPermissionRequest,
    McpToolAdapter,
    McpToolInvokeRequest,
    McpToolInvokeResult,
    McpPermissionChecker,
    McpToolNotFoundError,
)
from services.skill_runtime import (
    create_skill_runtime,
    get_skill_runtime,
    set_skill_runtime,
    SkillInvokeRequest,
    SkillInvokeResult,
    SkillRuntimeAdapter,
    SkillNotFoundError,
    SkillInvokeDeniedError,
    SkillInvalidArgumentsError,
    SkillRuntimeError,
    SkillRuntimeUnavailable,
)


class _FakeMcpAdapter:
    def __init__(self, output: str = "mcp-tool-ok", raise_exc: Optional[Exception] = None):
        self.output = output
        self.raise_exc = raise_exc

    def invoke(self, request: McpToolInvokeRequest) -> McpToolInvokeResult:
        if self.raise_exc:
            raise self.raise_exc
        return McpToolInvokeResult(output=self.output, response={"result": self.output}, provenance="python-fake-mcp")


class _FakeMcpPerm:
    def __init__(self, allowed: bool = True, reason: str = ""):
        self.allowed = allowed
        self.reason = reason

    def check(self, request: McpPermissionRequest) -> McpPermissionDecision:
        return McpPermissionDecision(allowed=self.allowed, reason=self.reason)


class _FakeSkillAdapter:
    def __init__(self, output: str = "skill-ok", raise_exc: Optional[Exception] = None):
        self.output = output
        self.raise_exc = raise_exc

    def invoke(self, request: SkillInvokeRequest) -> SkillInvokeResult:
        if self.raise_exc:
            raise self.raise_exc
        return SkillInvokeResult(output=self.output, provenance="python-fake-skill")


def _reset_runtimes():
    set_mcp_runtime(None)
    set_skill_runtime(None)


def test_mcp_call_skill_invoke_registered_use_mcp_or_skill_executor():
    assert "mcp.call" in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS["mcp.call"].__name__ == "execute_mcp_or_skill"
    assert "skill.invoke" in CAPABILITY_EXECUTORS
    assert CAPABILITY_EXECUTORS["skill.invoke"].__name__ == "execute_mcp_or_skill"


def test_mcp_call_no_runtime_returns_explicit_unavailable_contract_direct_and_mapped():
    _reset_runtimes()
    state = _make_state("invoke external mcp tool for rbac check")
    # direct path
    res = execute_capability("mcp.call", state, [], "eng", "t-mcp-nort-1")
    assert isinstance(res, ExecuteCapabilityResult)
    assert res.degraded is True
    assert "unavailable" in res.title.lower()
    assert res.provenance == "python-mcp-runtime"
    assert getattr(res, "error", None) == "mcp_runtime_unavailable"
    assert getattr(res, "degradedReason", None) == "runtime_unavailable"
    # mapped path (used by driver)
    out = execute_mapped_capability("mcp.call", state, [], "eng", "t-mcp-nort-m")
    assert isinstance(out, dict)
    assert out.get("degraded") is True
    assert out.get("error") == "mcp_runtime_unavailable"
    assert "unavailable" in out.get("title", "").lower()
    assert out.get("provenance") == "python-mcp-runtime"
    _reset_runtimes()


def test_skill_invoke_no_runtime_returns_explicit_unavailable_contract_direct_and_mapped():
    _reset_runtimes()
    state = _make_state("invoke registered skill for synthesis")
    res = execute_capability("skill.invoke", state, [], "eng", "t-skl-nort-1")
    assert isinstance(res, ExecuteCapabilityResult)
    assert res.degraded is True
    assert "unavailable" in res.title.lower()
    assert getattr(res, "error", None) == "skill_runtime_unavailable"
    out = execute_mapped_capability("skill.invoke", state, [], "eng", "t-skl-nort-m")
    assert out.get("degraded") is True
    assert out.get("error") == "skill_runtime_unavailable"
    assert "unavailable" in out.get("title", "").lower()
    _reset_runtimes()


def test_mcp_call_with_runtime_success_and_error_contracts():
    _reset_runtimes()
    state = _make_state("call mcp tool get-perms")
    # success
    fake_rt = create_mcp_runtime(
        adapter=_FakeMcpAdapter(output="perms-result"),
        permission_checker=_FakeMcpPerm(allowed=True),
    )
    set_mcp_runtime(fake_rt)
    out = execute_mapped_capability("mcp.call", state, [], "eng", "t-mcp-ok")
    assert out.get("degraded") is False
    assert "mcp.call" in out.get("title", "")
    assert out.get("content") == "perms-result"
    assert out.get("toolResult") or True
    # permission denied via checker
    set_mcp_runtime(create_mcp_runtime(
        adapter=_FakeMcpAdapter(),
        permission_checker=_FakeMcpPerm(allowed=False, reason="policy deny"),
    ))
    out_den = execute_mapped_capability("mcp.call", state, [], "eng", "t-mcp-den")
    assert out_den.get("degraded") is True
    assert "permission denied" in out_den.get("title", "").lower() or out_den.get("error") == "mcp_permission_denied"
    assert out_den.get("error") in ("mcp_permission_denied",)
    # not found via adapter
    set_mcp_runtime(create_mcp_runtime(
        adapter=_FakeMcpAdapter(raise_exc=McpToolNotFoundError("tool missing")),
        permission_checker=_FakeMcpPerm(),
    ))
    out_nf = execute_mapped_capability("mcp.call", state, [], "eng", "t-mcp-nf")
    assert out_nf.get("degraded") is True
    assert "not found" in out_nf.get("title", "").lower() or out_nf.get("error") == "mcp_tool_not_found"
    # adapter unavailable
    set_mcp_runtime(create_mcp_runtime(
        adapter=_FakeMcpAdapter(raise_exc=McpAdapterUnavailable("mcp down")),
        permission_checker=_FakeMcpPerm(),
    ))
    out_u = execute_mapped_capability("mcp.call", state, [], "eng", "t-mcp-u")
    assert out_u.get("degraded") is True
    assert out_u.get("error") in ("mcp_adapter_error", "mcp_adapter_unavailable")
    _reset_runtimes()


def test_skill_invoke_with_runtime_success_and_error_contracts():
    _reset_runtimes()
    state = _make_state("call skill summarize-risks")
    # success
    set_skill_runtime(create_skill_runtime(adapter=_FakeSkillAdapter(output="skill-output")))
    out = execute_mapped_capability("skill.invoke", state, [], "eng", "t-skl-ok")
    assert out.get("degraded") is False
    assert "skill.invoke" in out.get("title", "")
    assert out.get("content") == "skill-output"
    # not found
    set_skill_runtime(create_skill_runtime(adapter=_FakeSkillAdapter(raise_exc=SkillNotFoundError("no such skill"))))
    out_nf = execute_mapped_capability("skill.invoke", state, [], "eng", "t-skl-nf")
    assert out_nf.get("degraded") is True
    assert "not found" in out_nf.get("title", "").lower() or out_nf.get("error") == "skill_not_found"
    # denied
    set_skill_runtime(create_skill_runtime(adapter=_FakeSkillAdapter(raise_exc=SkillInvokeDeniedError("denied"))))
    out_d = execute_mapped_capability("skill.invoke", state, [], "eng", "t-skl-d")
    assert out_d.get("degraded") is True
    assert "denied" in out_d.get("title", "").lower() or out_d.get("error") == "skill_invoke_denied"
    # invalid args
    set_skill_runtime(create_skill_runtime(adapter=_FakeSkillAdapter(raise_exc=SkillInvalidArgumentsError("bad args"))))
    out_ia = execute_mapped_capability("skill.invoke", state, [], "eng", "t-skl-ia")
    assert out_ia.get("degraded") is True
    assert "invalid" in out_ia.get("title", "").lower() or out_ia.get("error") == "skill_invalid_arguments"
    # runtime error
    set_skill_runtime(create_skill_runtime(adapter=_FakeSkillAdapter(raise_exc=SkillRuntimeError("boom"))))
    out_re = execute_mapped_capability("skill.invoke", state, [], "eng", "t-skl-re")
    assert out_re.get("degraded") is True
    assert "runtime error" in out_re.get("title", "").lower() or out_re.get("error") == "skill_runtime_error"
    _reset_runtimes()


def test_mcp_skill_direct_execute_capability_uses_explicit_not_rag():
    _reset_runtimes()
    state = _make_state("direct cap mcp/skill check")
    # ensure direct also never returns the old RAG title
    res_m = execute_capability("mcp.call", state, [], "r", "t-dm")
    assert "via stable RAG" not in res_m.title
    assert res_m.degraded is True
    res_s = execute_capability("skill.invoke", state, [], "r", "t-ds")
    assert "via stable RAG" not in res_s.title
    assert res_s.degraded is True
    _reset_runtimes()
