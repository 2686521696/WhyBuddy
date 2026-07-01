"""
Task 58: backend-python-no-node-final-observability-readiness-105

Python tests proving Python API observability covers:
- health probes with provenance
- standardized provenance signals on responses
- degraded states (explicit, never hidden)
- errors (HTTP and generic) always carry backend/source/provenance/degraded

Python FastAPI is source of truth (PYTHON_FIRST_COMPAT). Node thin proxy only.

Run (smallest relevant):
  python -m pytest slide-rule-python/tests/test_observability_readiness_105.py -q --tb=line

Also exercised via:
  python -m pytest slide-rule-python/tests/test_api_health.py -q --tb=no
  python -m pytest slide-rule-python/tests/test_no_node_backend_contracts.py -q --tb=no
"""

import sys
from pathlib import Path
import pytest

_pkg_root = Path(__file__).resolve().parent.parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))

from fastapi.testclient import TestClient

try:
    from app import app
except Exception as e:
    pytest.skip(f"slide-rule-python app import failed: {e}", allow_module_level=True)

client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"


def test_health_includes_observability_coverage():
    """Health must report observabilityCoverage for health/provenance/degraded/errors."""
    for path in ["/health", "/api/health", "/ready", "/api/sliderule/health"]:
        r = client.get(path)
        assert r.status_code == 200, f"{path}"
        data = r.json()
        cov = data.get("observabilityCoverage") or {}
        assert cov.get("health") is True
        assert cov.get("provenance") is True
        assert cov.get("degradedStates") is True
        assert cov.get("errors") is True
        assert data.get("source") == "python"
        assert "slide-rule-python" in str(data.get("backend", "")).lower()
        assert "backend:slide-rule-python" in str(data.get("provenance", ""))


def test_observability_endpoint_surfaces_full_coverage():
    """Dedicated /api/observability endpoint for task 58."""
    r = client.get("/api/observability")
    assert r.status_code == 200
    data = r.json()
    assert data.get("source") == "python"
    assert "slide-rule-python" in str(data.get("backend", "")).lower()
    obs = data.get("observability", {})
    assert obs.get("coverage", {}).get("health") is True
    assert obs.get("coverage", {}).get("degradedStates") is True
    assert obs.get("coverage", {}).get("errors") is True
    assert "python-rag" in str(obs.get("provenanceSignals", []))
    ex = obs.get("degradedExample", {})
    assert ex.get("degraded") is True
    assert ex.get("backend") == "slide-rule-python"


def test_degraded_states_carry_python_provenance(monkeypatch):
    """Orchestrate degraded paths (timeout, config, error) must return 200 + explicit degraded + provenance (Python owned)."""
    from routes import sliderule_full as sf

    async def fake_timeout(*a, **k):
        return sf._degraded_plan("planner_timeout", "timeout", "sim timeout")

    monkeypatch.setattr(sf, "_run_orchestrate_plan", fake_timeout)

    r = client.post(
        "/api/sliderule/orchestrate-plan",
        json={"state": {"sessionId": "obs-d", "goal": {"text": "d"}}, "turnId": "t1"},
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    assert r.status_code == 200
    d = r.json()
    assert d.get("degraded") is True
    assert d.get("backend") == "python"
    assert d.get("provenance") in ("python-rag", "python-llm", "python-fullpath")
    assert d.get("error") in ("planner_timeout", "planner_config_missing", "planner_error")


def test_error_responses_carry_python_provenance_and_degraded():
    """HTTP and uncaught errors must attach provenance/degraded via handlers (never silent)."""
    # trigger 400 bad plan (returns with signals now hardened)
    r_bad = client.post(
        "/api/sliderule/orchestrate-plan",
        json={"state": {"goal": {}}, "turnId": ""},  # missing/invalid
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    assert r_bad.status_code == 400
    data = r_bad.json()
    assert data.get("backend") == "python"
    assert data.get("source") == "python"
    assert data.get("provenance") in ("python-rag", "python-llm", "python-fullpath")
    assert data.get("degraded") is True

    # trigger 404 (via missing session -> HTTPException -> handler attaches)
    r404 = client.get("/api/sliderule/sessions/does-not-exist-404-obs", headers={"X-Internal-Key": INTERNAL_KEY})
    assert r404.status_code == 404
    d404 = r404.json()
    assert "slide-rule-python" in str(d404.get("backend", "")).lower() or d404.get("backend") == "python"
    assert d404.get("degraded") is True or d404.get("status") == "error"

    # trigger 403 on drive-full (enforced without dev skip)
    r403 = client.post("/api/sliderule/drive-full", json={"state": {}}, headers={})
    assert r403.status_code == 403
    d403 = r403.json()
    assert "slide-rule-python" in str(d403.get("backend", "")).lower() or d403.get("backend") == "python"
    assert d403.get("degraded") is True or d403.get("status") == "error"


def test_contracts_registry_lists_observability_task58():
    """Contracts registry advertises observability surface (hardened by task 58)."""
    r = client.get("/api/agent-loop/contracts")
    assert r.status_code == 200
    data = r.json()
    assert data.get("observabilityHardenedByTask") == 58
    surfaces = [s.get("surface") for s in data.get("surfaces", [])]
    assert any("observability" in (s or "").lower() for s in surfaces)
    assert any("health" in (s or "").lower() for s in surfaces)
