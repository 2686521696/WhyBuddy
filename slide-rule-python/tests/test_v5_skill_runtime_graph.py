"""Focused schema + derive tests for Python skillRuntimeGraph (crossRuntimeGraph shape).

Covers:
- positive evidence: constructs valid {edges, bySkill, evidenceBySkill} from run result
- fail-closed negative: None for empty, degraded, error, missing data
- deterministic local only; no side effects
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import CapabilityRun, V5SessionState  # noqa: E402
from services.v5_skill_runtime_graph import derive_skill_runtime_graph_response  # noqa: E402


def _base_state_with_run(result: dict, error: dict | None = None) -> V5SessionState:
    run = CapabilityRun(
        id="run-srg",
        capabilityId="appbundle.skillGraph",
        turnId="t-srg",
        result=result,
    )
    if error:
        run.error = error  # type: ignore[attr-defined]
    return V5SessionState(
        sessionId="srg-test",
        goal={"text": "skill runtime graph"},
        artifacts=[],
        capabilityRuns=[run],
        coverageGaps=[],
        coverageContract=None,
    )


def test_derive_skill_runtime_graph_returns_full_shape_for_positive_edges():
    state = _base_state_with_run({
        "crossSkillRuntimeEdges": [
            "datamodel->rbac:allowed",
            "rbac->page:allowed",
            "appbundle->aigc:allowed",
        ],
        "runtimeEvidence": [
            "DM_CROSS_RUNTIME_EVIDENCE:rbac",
            "RBAC_CROSS_RUNTIME_EVIDENCE:page",
            "APPBUNDLE_CROSS_RUNTIME_EVIDENCE:app_purchase_approval:aigc",
        ],
    })

    g = derive_skill_runtime_graph_response(state)

    assert g is not None
    assert isinstance(g.get("edges"), list)
    assert len(g["edges"]) == 3
    assert g["edges"][0]["sourceSkill"] == "datamodel"
    assert g["edges"][0]["targetSkill"] == "rbac"
    assert g["edges"][0]["state"] == "allowed"
    assert g["edges"][0]["raw"] == "datamodel->rbac:allowed"
    assert "evidenceKey" in g["edges"][0]
    assert "datamodel" in g["bySkill"]
    assert "rbac" in g["bySkill"]
    assert "appbundle" in g["bySkill"]
    assert "evidenceBySkill" in g
    assert len(g["evidenceBySkill"].get("datamodel", [])) >= 1


def test_derive_skill_runtime_graph_returns_none_for_empty():
    state = V5SessionState(
        sessionId="srg-empty",
        goal={"text": "empty"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
    )
    assert derive_skill_runtime_graph_response(state) is None


def test_derive_skill_runtime_graph_fail_closed_on_degraded_result():
    state = _base_state_with_run({
        "crossSkillRuntimeEdges": ["datamodel->rbac:allowed"],
        "degraded": True,
    })
    assert derive_skill_runtime_graph_response(state) is None


def test_derive_skill_runtime_graph_fail_closed_on_error_run():
    state = _base_state_with_run({"crossSkillRuntimeEdges": ["x->y:allowed"]}, error={"code": "cap_fail"})
    assert derive_skill_runtime_graph_response(state) is None


def test_derive_skill_runtime_graph_pass_through_when_embedded():
    embedded = {
        "edges": [
            {"sourceSkill": "page", "targetSkill": "appbundle", "state": "allowed", "raw": "page->appbundle:allowed"}
        ],
        "bySkill": {"page": [], "appbundle": []},
        "evidenceBySkill": {},
    }
    state = _base_state_with_run({"skillRuntimeGraph": embedded})
    g = derive_skill_runtime_graph_response(state)
    assert g is not None
    assert g["edges"][0]["sourceSkill"] == "page"
    assert g["edges"][0]["targetSkill"] == "appbundle"


def test_derive_skill_runtime_graph_none_on_no_usable_edges():
    state = _base_state_with_run({
        "crossSkillRuntimeEdges": [],
    })
    assert derive_skill_runtime_graph_response(state) is None


def test_derive_skill_runtime_graph_fail_closed_on_latest_degraded_even_with_prior_graph():
    """Major fix: latest run degraded must return None, do not fall back to prior run's graph.
    This preserves degraded/error state for current final_state (prevents stale graph in response).
    """
    from models.v5_state import CapabilityRun
    good_prior = CapabilityRun(
        id="run-prior-good",
        capabilityId="appbundle.skillGraph",
        turnId="t-prior",
        result={
            "crossSkillRuntimeEdges": ["datamodel->rbac:allowed"],
            "runtimeEvidence": ["E1"],
        },
    )
    bad_latest = CapabilityRun(
        id="run-latest-deg",
        capabilityId="some.other",
        turnId="t-bad",
        result={"crossSkillRuntimeEdges": ["x->y:allowed"]},
    )
    # simulate degraded latest (result degraded)
    bad_latest.result = {"crossSkillRuntimeEdges": ["x->y:allowed"], "degraded": True}  # type: ignore[attr-defined]
    state = V5SessionState(
        sessionId="srg-latest-deg",
        goal={"text": "multi"},
        artifacts=[],
        capabilityRuns=[good_prior, bad_latest],
        coverageGaps=[],
        coverageContract=None,
    )
    assert derive_skill_runtime_graph_response(state) is None


def test_derive_skill_runtime_graph_fail_closed_on_latest_error_even_with_prior_graph():
    """Latest error run must fail-closed to None, even if prior run carried graph."""
    from models.v5_state import CapabilityRun
    good_prior = CapabilityRun(
        id="run-prior-good2",
        capabilityId="appbundle.skillGraph",
        turnId="t-prior2",
        result={"crossSkillRuntimeEdges": ["a->b:allowed"]},
    )
    err_latest = CapabilityRun(
        id="run-latest-err",
        capabilityId="appbundle.skillGraph",
        turnId="t-err",
        result={"crossSkillRuntimeEdges": ["a->b:allowed"]},
    )
    err_latest.error = {"code": "exec_failed"}  # type: ignore[attr-defined]
    state = V5SessionState(
        sessionId="srg-latest-err",
        goal={"text": "multi-err"},
        artifacts=[],
        capabilityRuns=[good_prior, err_latest],
        coverageGaps=[],
        coverageContract=None,
    )
    assert derive_skill_runtime_graph_response(state) is None


def test_derive_skill_runtime_graph_fail_closed_on_embedded_empty_edges():
    """Minor fix: shaped embedded skillRuntimeGraph with empty edges must fail-closed to None."""
    embedded_empty = {
        "edges": [],
        "bySkill": {},
        "evidenceBySkill": {},
    }
    state = _base_state_with_run({"skillRuntimeGraph": embedded_empty})
    assert derive_skill_runtime_graph_response(state) is None


def test_derive_skill_runtime_graph_uses_prior_when_latest_good_no_graph():
    """When latest run is good but carries no graph, prior good graph may still surface (non-degraded current state)."""
    from models.v5_state import CapabilityRun
    good_prior = CapabilityRun(
        id="run-prior-g",
        capabilityId="appbundle.skillGraph",
        turnId="t1",
        result={"crossSkillRuntimeEdges": ["p->q:allowed"]},
    )
    latest_other = CapabilityRun(
        id="run-latest-other",
        capabilityId="other.cap",
        turnId="t2",
        result={"some": "other"},
    )
    state = V5SessionState(
        sessionId="srg-prior",
        goal={"text": "prior"},
        artifacts=[],
        capabilityRuns=[good_prior, latest_other],
        coverageGaps=[],
        coverageContract=None,
    )
    g = derive_skill_runtime_graph_response(state)
    assert g is not None
    assert len(g["edges"]) == 1
    assert g["edges"][0]["sourceSkill"] == "p"
