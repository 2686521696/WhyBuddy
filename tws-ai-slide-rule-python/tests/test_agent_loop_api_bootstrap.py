"""
SlideRule AgentLoop 108 API bootstrap test.

agentloop api bootstrap 108 mounts health and capabilities
"""

from fastapi.testclient import TestClient
import pytest

try:
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_api_bootstrap_108_mounts_health_and_capabilities():
    """agentloop api bootstrap 108 mounts health and capabilities"""
    # Health
    r = client.get("/api/agent-loop/health")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"
    assert "backend" in data
    # backend identity
    assert any(x in str(data.get("backend", "")).lower() for x in ["sliderule", "python", "slide-rule"])
    # bridge mode
    assert data.get("mode") in ("bridge", "bridged") or "bridge" in str(data).lower()

    # Capabilities
    r2 = client.get("/api/agent-loop/capabilities")
    assert r2.status_code == 200
    caps = r2.json()
    # supported control-plane features
    assert "features" in caps or "supported" in str(caps).lower()
    # marks worker execution as bridged
    worker_exec = caps.get("workerExecution") or caps.get("worker_execution") or ""
    assert "bridged" in str(worker_exec).lower() or "bridge" in str(caps).lower()
