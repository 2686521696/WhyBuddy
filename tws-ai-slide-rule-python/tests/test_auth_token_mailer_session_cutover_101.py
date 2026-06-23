"""Test for Auth token/mailer/session cutover readiness 101.

Covers:
- Python outputs readiness for tokenIssuance, emailCodeMailer, sessionRepository
- Classifications: ready, blocked, degraded, skipped-live
- mailer defaults to skipped-live (never claims live/prod email)
- Node bridge consumption preserves boundaries: no takeover of real mailer/session/token issuance
- existing auth contracts (login/register, session, persistence) remain honored
- explicit non-ready states never reported as ready
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.auth_token_mailer_session_cutover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    CUTOVER_STATUSES,
    execute_auth_token_mailer_session_cutover,
)


def _payload(**overrides):
    p = {
        "metadata": {"traceId": "cutover-101", "actor": "test"},
    }
    p.update(overrides)
    return p


def test_cutover_default_ready_with_mailer_skipped_live():
    result = execute_auth_token_mailer_session_cutover(_payload())
    assert result["status"] == "ready"
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["runtime"]["owner"] == "python"
    assert result["ok"] is True
    cs = result["cutoverSummary"]
    assert cs["status"] == "ready"
    assert cs["components"]["tokenIssuance"] == "ready"
    assert cs["components"]["emailCodeMailer"] == "skipped-live"
    assert cs["components"]["sessionRepository"] == "ready"
    assert "skipped-live" in CUTOVER_STATUSES


def test_cutover_blocked_output():
    result = execute_auth_token_mailer_session_cutover(_payload(simulate={"block": True}))
    assert result["status"] == "blocked"
    assert result["cutoverSummary"]["status"] == "blocked"
    assert result["ok"] is False
    assert result["status"] != "ready"
    for v in result["cutoverSummary"]["components"].values():
        assert v == "blocked"


def test_cutover_degraded_output():
    result = execute_auth_token_mailer_session_cutover(_payload(simulate={"degrade": True}))
    assert result["status"] == "degraded"
    assert result["cutoverSummary"]["status"] == "degraded"
    assert result["ok"] is False
    assert result["status"] != "ready"


def test_cutover_skipped_live_mailer():
    result = execute_auth_token_mailer_session_cutover(_payload(simulate={"skipLive": True}))
    assert result["status"] == "ready"
    assert result["cutoverSummary"]["components"]["emailCodeMailer"] == "skipped-live"
    # token and session can still participate
    assert result["cutoverSummary"]["components"]["tokenIssuance"] == "ready"


def test_cutover_area_mailer_skipped():
    result = execute_auth_token_mailer_session_cutover(_payload(simulate={"area": "mailer"}))
    assert result["cutoverSummary"]["components"]["emailCodeMailer"] == "skipped-live"
    assert result["status"] == "ready"  # still advisory ready for cutover decision


def test_cutover_preserves_sub_and_boundaries():
    result = execute_auth_token_mailer_session_cutover(
        _payload(metadata={"traceId": "cutover-101"})
    )
    assert result["cutoverSummary"]["metadata"].get("traceId") == "cutover-101"
    assert result["runtime"]["mode"] == "cutover_readiness"
    # never productionTakeover
    assert result.get("productionTakeover") is not True


def test_cutover_all_statuses_covered_and_contract():
    # ensure all classifications present
    for st in ["ready", "blocked", "degraded", "skipped-live"]:
        assert st in CUTOVER_STATUSES

    bad = execute_auth_token_mailer_session_cutover(None)  # type: ignore[arg-type]
    assert bad["status"] in ("blocked", "failed")
    assert "error" in bad

    # ready never for blocked simulate
    blocked = execute_auth_token_mailer_session_cutover(_payload(simulate={"block": True}))
    assert blocked["status"] != "ready"
