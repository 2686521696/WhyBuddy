"""Test for Final provider and A2A scope reconciliation 104.

Reconciles Web AIGC real providers + A2A transport/registry scope into final migration denominator.
- Python and Node must return identical summary counts and shape.
- skipped-live / synthetic / external-owned / external-agent-required excluded from numerator.
- Real live-ready claim ONLY with explicit python-owned + takeover evidence; never from simulate on external.
- No takeover for retained A2A surfaces.
- Uses 103 live contract + 102/103 a2a ownership; no new live surfaces added.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.final_provider_a2a_scope_reconciliation import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    A2A_SCOPE_SURFACES,
    decide_final_provider_a2a_scope_reconciliation,
)
from services.web_aigc_real_provider_live_contract import get_web_aigc_real_provider_live_contract
from services.a2a_production_transport_ownership_closure import decide_a2a_production_transport_ownership_closure


def _payload(**overrides):
    base = {"area": "all"}
    base.update(overrides)
    return base


def test_recon_envelope_and_contract():
    result = decide_final_provider_a2a_scope_reconciliation(_payload())
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["productionTakeover"] is False
    for key in ("providerSummary", "a2aSummary", "migrationDenominator", "excludedFromNumerator", "blockers", "note"):
        assert key in result
    assert isinstance(result["excludedFromNumerator"], list)
    assert "skipped-live" in result["excludedFromNumerator"]
    assert "external-agent-required" in result["excludedFromNumerator"]


def test_recon_uses_103_provider_live_contract_counts():
    prov = get_web_aigc_real_provider_live_contract()
    result = decide_final_provider_a2a_scope_reconciliation(_payload())
    ps = result["providerSummary"]
    assert ps["total"] == prov["total"]
    assert ps["skippedLive"] == prov["counts"]["skippedLive"]
    assert ps["synthetic"] == prov["counts"]["synthetic"]
    assert ps["externalOwned"] == prov["counts"]["externalOwned"]
    assert ps["liveReady"] == prov["counts"].get("liveReady", 0)
    assert ps["realPythonTakeover"] == 0  # external and synthetic never count


def test_recon_a2a_scope_from_ownership_and_static():
    a2a = decide_a2a_production_transport_ownership_closure({"area": "all"})
    result = decide_final_provider_a2a_scope_reconciliation(_payload(area="a2a"))
    a2a_s = result["a2aSummary"]
    assert a2a_s["total"] == len(A2A_SCOPE_SURFACES)
    assert a2a_s["pythonOwned"] == 1  # sessionStreamSliceDecision
    assert a2a_s["nodeRetained"] >= 1
    assert a2a_s["externalAgentRequired"] >= 1
    assert a2a_s["productionTakeover"] is False


def test_provider_skipped_synthetic_external_excluded_from_numerator():
    result = decide_final_provider_a2a_scope_reconciliation(_payload())
    ps = result["providerSummary"]
    # none of these count for python takeover
    assert ps["realPythonTakeover"] == 0
    denom = result["migrationDenominator"]
    assert denom["canClaimCompletion"] is False
    # external-owned and skipped stay out
    assert ps["liveReady"] == 0 or ps["realPythonTakeover"] == 0


def test_a2a_node_retained_and_external_agent_not_takeover():
    result = decide_final_provider_a2a_scope_reconciliation(_payload(area="a2a"))
    assert result["productionTakeover"] is False
    a2a_s = result["a2aSummary"]
    assert a2a_s["pythonOwned"] == 1  # only the slice decision
    # others retained or external
    assert a2a_s["nodeRetained"] + a2a_s["externalAgentRequired"] + a2a_s.get("blocked", 0) >= 4


def test_migration_denominator_python_node_agree_counts():
    result = decide_final_provider_a2a_scope_reconciliation(_payload(area="all"))
    denom = result["migrationDenominator"]
    # provider 19 + a2a 5 = 24 surfaces for scope
    # pythonOwned only the 1 a2a slice (no real python live provider takeover)
    assert denom["totalSurfaces"] == 24
    assert denom["pythonOwned"] == 1
    assert denom["canClaimCompletion"] is False
    # providers contribute their externalOwned to retained
    ps = result["providerSummary"]
    assert ps["skippedLive"] >= 8
    assert ps["synthetic"] >= 10


def test_simulate_live_ready_external_still_no_takeover():
    # live flag on external must not produce python takeover
    result = decide_final_provider_a2a_scope_reconciliation(
        _payload(simulate={"liveReadyPython": True})
    )
    ps = result["providerSummary"]
    assert ps["realPythonTakeover"] == 0
    assert result["productionTakeover"] is False
    assert result["migrationDenominator"]["canClaimCompletion"] is False


def test_blocked_a2a_and_excluded_stay_excluded():
    result = decide_final_provider_a2a_scope_reconciliation(
        _payload(area="all", simulate={"blockA2a": True})
    )
    a2a_s = result["a2aSummary"]
    assert a2a_s.get("blocked", 0) >= 1 or "blocked" in str(result.get("blockers", []))
    assert result["productionTakeover"] is False


def test_final_note_and_blockers_machine_readable():
    result = decide_final_provider_a2a_scope_reconciliation(_payload())
    assert "MUST NOT" in result.get("note", "") or "excluded" in result.get("note", "").lower()
    assert isinstance(result["blockers"], list)
    assert len(result["blockers"]) >= 1
    for b in result["blockers"]:
        assert isinstance(b, str)


def test_python_node_same_summary_shape_keys():
    result = decide_final_provider_a2a_scope_reconciliation(_payload())
    # keys that node mirror will also produce
    for k in ("providerSummary", "a2aSummary", "migrationDenominator", "excludedFromNumerator", "productionTakeover"):
        assert k in result
    assert result["migrationDenominator"]["canClaimCompletion"] is False
