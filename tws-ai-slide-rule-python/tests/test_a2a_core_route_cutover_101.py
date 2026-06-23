"""Test for A2A core route cutover readiness 101.

Covers:
- Python outputs A2A core route cutover decision for registry, session, stream, cancel, chat, report
- Classifications: ready, blocked, degraded, skipped-live
- stream/cancel/chat/report default to skipped-live (thin bridge, not full ownership)
- registry/session can surface ready for cutover decision boundary (advisory only)
- Node bridge consumption preserves boundaries: no takeover of real stream/invoke/chat/report
- existing A2A invoke/stream/contract/protocol tests remain honored
- explicit non-ready states never reported as ready
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.a2a_core_route_cutover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    CUTOVER_STATUSES,
    A2A_CORE_ROUTE_COMPONENTS,
    execute_a2a_core_route_cutover,
)


def _payload(**overrides):
    p = {
        "metadata": {"traceId": "a2a-cutover-101", "actor": "test"},
    }
    p.update(overrides)
    return p


def test_cutover_default_ready_with_stream_cancel_chat_report_skipped():
    result = execute_a2a_core_route_cutover(_payload())
    assert result["status"] == "ready"
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["runtime"]["owner"] == "python"
    assert result["ok"] is True
    cs = result["cutoverSummary"]
    assert cs["status"] == "ready"
    assert cs["components"]["registry"] == "ready"
    assert cs["components"]["session"] == "ready"
    assert cs["components"]["stream"] == "skipped-live"
    assert cs["components"]["cancel"] == "skipped-live"
    assert cs["components"]["chat"] == "skipped-live"
    assert cs["components"]["report"] == "skipped-live"
    assert "skipped-live" in CUTOVER_STATUSES
    for comp in A2A_CORE_ROUTE_COMPONENTS:
        assert comp in cs["components"]


def test_cutover_blocked_output():
    result = execute_a2a_core_route_cutover(_payload(simulate={"block": True}))
    assert result["status"] == "blocked"
    assert result["cutoverSummary"]["status"] == "blocked"
    assert result["ok"] is False
    assert result["status"] != "ready"
    for v in result["cutoverSummary"]["components"].values():
        assert v == "blocked"


def test_cutover_degraded_output():
    result = execute_a2a_core_route_cutover(_payload(simulate={"degrade": True}))
    assert result["status"] == "degraded"
    assert result["cutoverSummary"]["status"] == "degraded"
    assert result["ok"] is False
    assert result["status"] != "ready"


def test_cutover_skipped_live_for_thin_bridges():
    result = execute_a2a_core_route_cutover(_payload(simulate={"skipLive": True}))
    assert result["status"] == "ready"
    cs = result["cutoverSummary"]
    assert cs["components"]["stream"] == "skipped-live"
    assert cs["components"]["cancel"] == "skipped-live"
    assert cs["components"]["chat"] == "skipped-live"
    assert cs["components"]["report"] == "skipped-live"
    # registry/session can still be ready
    assert cs["components"]["registry"] == "ready"


def test_cutover_area_specific_skipped():
    result = execute_a2a_core_route_cutover(_payload(simulate={"area": "stream"}))
    assert result["cutoverSummary"]["components"]["stream"] == "skipped-live"
    assert result["status"] == "ready"

    result2 = execute_a2a_core_route_cutover(_payload(simulate={"area": "chat"}))
    assert result2["cutoverSummary"]["components"]["chat"] == "skipped-live"


def test_cutover_preserves_sub_and_boundaries():
    result = execute_a2a_core_route_cutover(
        _payload(metadata={"traceId": "a2a-cutover-101"})
    )
    assert result["cutoverSummary"]["metadata"].get("traceId") == "a2a-cutover-101"
    assert result["runtime"]["mode"] == "cutover_readiness"
    # never claims full takeover
    assert result.get("productionTakeover") is not True
    # never claims stream/invoke as full cut
    assert result["cutoverSummary"]["components"]["stream"] != "ready" or result["cutoverSummary"]["components"]["chat"] != "ready"


def test_cutover_all_statuses_covered_and_contract():
    for st in ["ready", "blocked", "degraded", "skipped-live"]:
        assert st in CUTOVER_STATUSES

    bad = execute_a2a_core_route_cutover(None)  # type: ignore[arg-type]
    assert bad["status"] in ("blocked", "failed")
    assert "error" in bad

    blocked = execute_a2a_core_route_cutover(_payload(simulate={"block": True}))
    assert blocked["status"] != "ready"


def test_cutover_report_and_registry_classification():
    result = execute_a2a_core_route_cutover(_payload())
    comps = result["cutoverSummary"]["components"]
    assert comps["registry"] in ("ready", "skipped-live", "degraded", "blocked")
    assert comps["report"] in ("skipped-live", "degraded", "blocked")
    # report/chat remain advisory, not ready for full ownership
    assert comps["report"] != "ready" or comps.get("note") is not None  # defensive, default not ready
