"""
SlideRule AgentLoop 108: integration inventory test.
This test documents source boundaries per acceptance criteria.
Marker: agentloop integration inventory 108 documents source boundaries
"""

import os
import sys

import pytest

# Ensure project root on path for consistency with other tests (stdlib test here)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

INVENTORY_MD = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "AGENT_LOOP_INTEGRATION_INVENTORY.md",
)


def test_agentloop_integration_inventory_108_documents_source_boundaries():
    """agentloop integration inventory 108 documents source boundaries

    Verifies the inventory document exists and covers all required areas:
    - Node runner, queue config, run state, artifacts, logs, settings, dashboard, VS Code-only pieces
    - Names target Python modules for control-plane concerns
    - Explicitly keeps runQueue.js and loopEngine.js as worker-owned for this wave
    """
    assert os.path.exists(INVENTORY_MD), f"Inventory doc must exist at {INVENTORY_MD}"

    with open(INVENTORY_MD, "r", encoding="utf-8") as f:
        content = f.read().lower()

    # Required file references (case-insensitive check on lowered)
    assert "agent-loop/src/runqueue.js" in content or "runqueue.js" in content
    assert "agent-loop/src/loopengine.js" in content or "loopengine.js" in content
    assert "worker-owned" in content or "worker owned" in content or "remain worker" in content

    # Covers required areas (loose match)
    assert "node runner" in content
    assert "queue config" in content
    assert "run state" in content
    assert "artifacts" in content
    assert "logs" in content
    assert "settings" in content
    assert "dashboard" in content
    assert "vs code" in content or "vscode" in content or "vs code-only" in content

    # Names target python modules (at least references services or python paths)
    assert "services/" in content or "slide-rule-python/services" in content or "config/settings.py" in content or "models/" in content

    # Explicit keep statement for this wave
    assert "this wave" in content
    assert "runqueue.js" in content and "loopengine.js" in content

    # Sanity: doc has overview of boundaries
    assert "boundary" in content or "inventory" in content
    assert "python control plane" in content

try:
    from fastapi.testclient import TestClient
    from app import app as py_app
    _py_client = TestClient(py_app)
except Exception as _e:
    _py_client = None
    _py_import_err = str(_e)


def test_foundation_route_inventory_python_first_compat_provenance():
    """Executable verification for PYTHON_FIRST_COMPAT surfaces identified in foundation inventory.

    Proves /health, /api/agent-loop/health, /api/sliderule/health and /api/agent-loop/capabilities
    are served by Python FastAPI and expose backend provenance (not silent Node).
    """
    if _py_client is None:
        pytest.skip(f"slide-rule-python app not importable: {_py_import_err}")

    for path in ["/health", "/api/agent-loop/health", "/api/sliderule/health"]:
        resp = _py_client.get(path)
        assert resp.status_code == 200, f"PYTHON_FIRST_COMPAT path {path} must be 200"
        data = resp.json()
        assert data.get("status") == "ok", f"{path} status"
        backend = str(data.get("backend", "")).lower()
        assert ("python" in backend or "sliderule" in backend), f"{path} must signal python backend provenance, got {data}"

    # agent-loop capabilities surface
    r = _py_client.get("/api/agent-loop/capabilities")
    assert r.status_code == 200
    caps = r.json()
    assert "features" in caps or "supported" in str(caps).lower()
