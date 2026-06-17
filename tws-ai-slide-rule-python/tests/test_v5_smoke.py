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

def test_orchestrate_and_execute_report_with_native_llm(monkeypatch):
    from sliderule_llm.client import LlmResult

    def fake_call_llm_json_with_shape(messages, **kwargs):
        content = (
            "结论：pet office feasibility conclusion grounded in goal\n"
            "支撑证据：desk-upgrade experiments support pacing\n"
            "反证/挑战：speed-first rollout risks balance issues\n"
            "风险：retention grind if upgrades feel cosmetic\n"
            "分歧：onboarding depth still unresolved\n"
            "收敛决策：prototype one desk-upgrade loop first\n"
            "未解缺口：retention benchmark missing\n"
            "下一步工程化分支：ship MVP desk loop and measure retention\n"
            "provenance / upstream refs：smoke-native-llm"
        )
        return (
            {
                "title": "Feasibility report",
                "summary": "Pet office feasibility summary",
                "content": content,
            },
            LlmResult(
                content="{}",
                usage={"total_tokens": 90},
                finish_reason="stop",
                model="fake-smoke-report",
                latency_ms=1,
            ),
        )

    monkeypatch.setattr(
        "sliderule_llm.capabilities.call_llm_json_with_shape",
        fake_call_llm_json_with_shape,
    )
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

    # Execute report.write — native JSON LLM path (not RAG canned stub)
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
    assert data.get("provenance") == "python-llm"
    content = data.get("content", "")
    assert len(content) > 150
    assert "支撑证据" in content
    assert "收敛决策" in content
    assert "provenance" in content.lower()
