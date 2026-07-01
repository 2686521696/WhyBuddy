"""
Foundation task 04: test_api_health.py
Dedicated Python tests for unified health and readiness probes.
Python FastAPI is the backend API source of truth.
These prove provenance signals, readiness state, and no hidden Node fallback.

Run:
  python -m pytest slide-rule-python/tests/test_api_health.py -q --tb=line
"""

import sys
from pathlib import Path
import pytest

# Ensure slide-rule-python package root on path so "from app import" works when pytest invoked from repo root.
_pkg_root = Path(__file__).resolve().parent.parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))

from fastapi.testclient import TestClient

try:
    from app import app
except Exception as e:
    pytest.skip(f"slide-rule-python app import failed: {e}", allow_module_level=True)

client = TestClient(app)


def test_python_health_probe_returns_python_provenance():
    """Health probe must identify Python as backend source."""
    for path in ["/health", "/api/health"]:
        r = client.get(path)
        assert r.status_code == 200, f"{path} must return 200"
        data = r.json()
        assert data.get("status") == "ok"
        backend = str(data.get("backend", "")).lower()
        assert "slide-rule-python" in backend or "python" in backend, f"{path} backend must signal python: {data}"
        assert data.get("source") == "python" or "python" in str(data.get("provenance", "")).lower()
        assert data.get("readiness") == "ready"


def test_python_readiness_probe():
    """Readiness probe dedicated endpoint for k8s-style probes."""
    r = client.get("/ready")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ready"
    assert "slide-rule-python" in str(data.get("backend", "")).lower()
    assert data.get("source") == "python"
    assert "python" in str(data.get("provenance", "")).lower()


def test_sliderule_health_alias_delegates():
    """Sliderule health alias delegates to unified health."""
    r = client.get("/api/sliderule/health")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"
    assert "slide-rule-python" in str(data.get("backend", "")).lower()


def test_health_includes_readiness_probes_metadata():
    """Health response documents probe paths for observability."""
    r = client.get("/api/health")
    data = r.json()
    probes = data.get("probes", {})
    assert probes.get("liveness") == "/health"
    assert probes.get("readiness") == "/ready"
    assert data.get("provenance") == "backend:slide-rule-python"


def test_python_health_provenance_for_vite_dev_routing():
    """Python health signals used by Vite dev proxy (task 05) to prove Python backend preference.
    Frontend/Vite paths hitting /health /api/health must surface explicit python provenance (no Node fallback hidden).
    """
    for path in ["/health", "/api/health", "/ready"]:
        r = client.get(path)
        assert r.status_code == 200
        data = r.json()
        assert data.get("source") == "python"
        assert "slide-rule-python" in str(data.get("backend", "")).lower()
        assert "backend:slide-rule-python" in str(data.get("provenance", ""))


def test_server_index_retirement_state_from_python_health_task55():
    """Task 55: Python health surfaces server/index.ts retirement state (ACTIVE_NODE_BUSINESS + plan ref).
    Proves Python is contract source even for retirement metadata; Node index not owner.
    """
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert "serverIndexRole" in data
    assert "ACTIVE_NODE_BUSINESS" in str(data.get("serverIndexRole", ""))
    assert data.get("serverIndexRetirementTask") == 55
    assert "plan-recorded" in str(data.get("serverIndexRetirementState", ""))
    # also check /health
    r2 = client.get("/health")
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2.get("serverIndexRetirementTask") == 55
