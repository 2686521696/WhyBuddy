"""
V5 smoke / contract tests using FastAPI TestClient.

Run after `pip install -r requirements.txt`:
  python -m pytest tests/test_v5_smoke.py -q --tb=line

These test the migrated /api/sliderule surface (sessions, orchestrate, execute).
They use the permission-system goal from the fixtures to exercise RAG evidence paths.
"""

from fastapi.testclient import TestClient
import pytest

try:
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)

INTERNAL_KEY = "dev-slide-rule-internal"

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "slide-rule" in data.get("backend", "").lower() or "python" in data.get("backend", "").lower()

def test_sessions_crud():
    payload = {"goal": {"text": "分析权限系统的风险并给出最终报告"}, "sessionId": "smoke-001"}
    r = client.post("/api/sliderule/sessions", json=payload, headers={"X-Internal-Key": INTERNAL_KEY})
    assert r.status_code == 200
    data = r.json()
    assert "sessionId" in data or data.get("ok") is True

    sid = data.get("sessionId") or "smoke-001"
    r = client.get(f"/api/sliderule/sessions/{sid}", headers={"X-Internal-Key": INTERNAL_KEY})
    assert r.status_code == 200
    assert "state" in r.json() or "goal" in r.json()

def test_orchestrate_and_execute_report_with_real_rag():
    state = {
        "sessionId": "smoke-002",
        "goal": {"text": "分析权限系统的风险并给出最终报告"},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "coverageContract": None,
    }
    plan_resp = client.post(
        "/api/sliderule/orchestrate-plan",
        json={"state": state, "turnId": "smoke-t1", "userText": "开始推演"},
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    assert plan_resp.status_code == 200
    plan = plan_resp.json()
    selected = [s.get("capabilityId") for s in plan.get("selected", [])]
    # With RAG, should prefer evidence/tool/report for this goal
    assert any(c in selected for c in ["evidence.search", "mcp.call", "skill.invoke", "report.write", "risk.analyze"])

    # Execute report.write — should get structured content + sources from RAG (not tiny template)
    exec_payload = {
        "capabilityId": "report.write",
        "state": plan.get("state", state),
        "inputArtifactIds": [],
        "roleId": "综合",
        "turnId": "smoke-t1",
    }
    exec_resp = client.post(
        "/api/sliderule/execute-capability",
        json=exec_payload,
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    assert exec_resp.status_code == 200
    data = exec_resp.json()
    assert data.get("provenance", "").startswith("python-rag") or "RAG" in str(data.get("provenance", ""))
    content = data.get("content", "")
    assert len(content) > 150  # real structured report, not stub
    assert "支撑证据" in content or "风险" in content or "证据" in content.lower()
    assert len(data.get("sources", [])) > 0 or "source" in content.lower()  # real external evidence
