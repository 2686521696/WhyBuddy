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
        "evidence.search",
        "risk.analyze",
        "report.write",
        "structure.decompose",
        "document.draft",
        "traceability.matrix",
        "instruction.package",
        "handoff.package",
        # Real dialogue/deliberation capability IDs (mapped in capability_maps)
        "intent.clarify",
        "gap.ask",
        "critique.generate",
        "synthesis.merge",
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
        if cap == "structure.decompose":
            # Tree / decomposition structure indicators
            struct_hits = sum(1 for k in ["root", "requirements", "risk", "deliverable", "spec", "tree", "decompose", "分支"] if k in cl)
            assert struct_hits >= 3, f"structure.decompose weak tree structure: {cl[:200]}"

    # Extra shape + semantic check for report.write (9-section intent)
    report_resp = client.post(
        "/api/sliderule/execute-capability",
        json={"capabilityId": "report.write", "state": state, "inputArtifactIds": [], "roleId": "agent", "turnId": "smoke-report"},
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    report_data = report_resp.json()
    assert "RAG" in report_data.get("summary", "") or "证据" in report_data.get("summary", "") or len(report_data.get("content", "")) > 200
    rcl = (report_data.get("content", "") or "").lower()
    assert any(k in rcl for k in ["支撑证据", "风险", "收敛", "下一步", "证据"])  # basic 9-section flavor
