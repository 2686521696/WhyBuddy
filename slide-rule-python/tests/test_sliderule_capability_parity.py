"""
Focused pytest for Python-owned capability parity (evidence.search + report.write).

This proves the services layer owns these capability contracts directly:
- evidence.search and report.write use dedicated Python paths.
- direct and mapped paths return sources plus explicit python-rag provenance.
- report.write produces quality-gate-facing structured report sections.
- executor results do not forge trust; gate and ledger code elevate trust later.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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
