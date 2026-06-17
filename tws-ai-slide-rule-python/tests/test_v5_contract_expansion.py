from fastapi.testclient import TestClient

from app import app


client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"


def test_core_sliderule_paths_are_not_shadowed():
    paths = list(app.openapi()["paths"].keys())
    for path in [
        "/api/sliderule/sessions",
        "/api/sliderule/orchestrate-plan",
        "/api/sliderule/execute-capability",
    ]:
        assert paths.count(path) == 1


def test_structure_visual_delivery_caps_have_real_outputs():
    """Contract matrix for expanded caps via the real mounted execute path (execute_mapped_capability)."""
    state = {
        "sessionId": "smoke-003",
        "goal": {"text": "Analyze permission system risks and produce engineering handoff"},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "coverageContract": None,
    }
    caps = [
        "document.draft",
        "traceability.matrix",
        "instruction.package",
        "handoff.package",
    ]
    for cap in caps:
        response = client.post(
            "/api/sliderule/execute-capability",
            json={
                "capabilityId": cap,
                "state": state,
                "inputArtifactIds": [],
                "roleId": "agent",
                "turnId": f"smoke-{cap}",
            },
            headers={"X-Internal-Key": INTERNAL_KEY},
        )
        assert response.status_code == 200, f"{cap} failed"
        data = response.json()
        assert data.get("provenance", "").startswith("python-rag"), f"{cap} provenance"
        assert data.get("sources"), f"{cap} sources"
        title = data.get("title", "")
        summary = data.get("summary", "")
        content = data.get("content", "")
        assert len(title) > 0
        assert len(summary) > 0
        assert len(content) > 80
        # Must not fall to the most generic basic executor message
        assert f"Capability {cap} for " not in content
        assert "completed with RAG evidence" not in content.lower()  # avoid pure generic fallback

        # Stronger structural/semantic parity assertions (beyond loose keywords)
        cl = content.lower()
        if cap == "traceability.matrix":
            # Require matrix-like structure: multiple key columns/rows indicators
            matrix_hits = sum(1 for k in ["requirement", "证据", "risk", "decision", "matrix", "trace", "row"] if k in cl)
            assert matrix_hits >= 3, f"traceability.matrix should contain matrix rows/columns: {cl[:200]}"
        if cap == "instruction.package":
            # All four core prompt sections should be present
            for section in ["operator prompt", "engineering prompt", "evidence prompt", "verification prompt"]:
                assert section in cl, f"instruction.package missing section: {section}"
        if cap == "handoff.package":
            # Must bundle the key artifacts (flexible on "matrix" vs "traceability" because RAG output varies)
            for bundle in ["report", "traceab", "prompt", "next"]:
                assert bundle in cl, f"handoff.package missing bundle part: {bundle}"


def test_python_native_dialogue_caps_use_real_llm_not_rag_stub(monkeypatch):
    from sliderule_llm.client import LlmResult

    def fake_call_llm(messages, **kwargs):
        joined = "\n".join(m["content"] for m in messages)
        assert "pet office" in joined
        return LlmResult(
            content="## Missing information\n- Desk assignment rules\n## Questions\n- What triggers promotion?",
            usage={"total_tokens": 12},
            finish_reason="stop",
            model="fake-native-dialogue",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.capabilities.call_llm_with_retry", fake_call_llm)

    state = {
        "sessionId": "native-dialogue-001",
        "goal": {"text": "design a pet office task assignment system"},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "coverageContract": None,
    }
    for cap in [
        "intent.clarify",
        "gap.ask",
        "question.expand",
        "critique.generate",
        "synthesis.merge",
        "rebuttal.resolve",
        "counter.argue",
        "structure.decompose",
        "risk.analyze",
        "evidence.search",
    ]:
        response = client.post(
            "/api/sliderule/execute-capability",
            json={
                "capabilityId": cap,
                "state": state,
                "inputArtifactIds": [],
                "roleId": "agent",
                "turnId": f"native-{cap}",
                "userText": "find the missing assumptions before planning",
            },
            headers={"X-Internal-Key": INTERNAL_KEY},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data.get("provenance") == "python-llm"
        assert data.get("model") == "fake-native-dialogue"
        assert "Desk assignment" in data.get("content", "")
        assert "RBAC" not in data.get("content", "")
        assert "data scoping" not in data.get("content", "").lower()


def test_python_native_report_write_uses_real_llm_json_not_rag_stub(monkeypatch):
    from sliderule_llm.client import LlmResult

    def fake_call_llm_json_with_shape(messages, **kwargs):
        joined = "\n".join(m["content"] for m in messages)
        assert "pet office" in joined
        content = (
            "结论：evidence-backed conclusion\n"
            "支撑证据：desk assignment rules from playtests\n"
            "反证/挑战：speed-first concerns\n"
            "风险：retention grind risk\n"
            "分歧：onboarding depth unresolved\n"
            "收敛决策：prototype desk loop first\n"
            "未解缺口：retention benchmark missing\n"
            "下一步工程化分支：ship MVP desk loop\n"
            "provenance / upstream refs：contract-native-report"
        )
        return (
            {
                "title": "Feasibility report",
                "summary": "evidence-backed conclusion",
                "content": content,
            },
            LlmResult(
                content='{"title":"Feasibility report","summary":"evidence-backed conclusion","content":"..."}',
                usage={"total_tokens": 80},
                finish_reason="stop",
                model="fake-native-report",
                latency_ms=2,
            ),
        )

    monkeypatch.setattr(
        "sliderule_llm.capabilities.call_llm_json_with_shape",
        fake_call_llm_json_with_shape,
    )

    state = {
        "sessionId": "native-report-001",
        "goal": {"text": "design a pet office feasibility report"},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "coverageContract": None,
    }
    response = client.post(
        "/api/sliderule/execute-capability",
        json={
            "capabilityId": "report.write",
            "state": state,
            "inputArtifactIds": [],
            "roleId": "综合",
            "turnId": "native-report-write",
            "userText": "write the final feasibility report",
        },
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data.get("provenance") == "python-llm"
    assert data.get("model") == "fake-native-report"
    assert "evidence-backed conclusion" in data.get("content", "")
    assert "支撑证据" in data.get("content", "")
    assert "RBAC" not in data.get("content", "")
