"""Contract tests for the Python Blueprint brainstorm slice.

This task locks the wire shape for future Python ownership of Blueprint
brainstorm reasoning graphs. It intentionally does not register a FastAPI route,
call an LLM, or migrate the existing Node brainstorm runtime.
"""

from __future__ import annotations

from copy import deepcopy


CONTRACT_VERSION = "blueprint.brainstorm.reasoning-graph.v1"
VALID_NODE_TYPES = {
    "question",
    "clarification",
    "hypothesis",
    "evidence",
    "constraint",
    "risk",
    "gap",
    "decision",
    "synthesis",
    "critique",
    "rebuttal",
}
VALID_NODE_STATUSES = {
    "open",
    "active",
    "supported",
    "challenged",
    "resolved",
    "failed",
}
VALID_EDGE_TYPES = {
    "supports",
    "refines",
    "conflicts",
    "cites",
    "questions",
    "depends_on",
    "synthesizes",
}
VALID_GRAPH_SOURCES = {"llm", "runtime", "fallback"}
VALID_RESULT_STATUSES = {"completed", "partial", "error"}


def _sample_graph() -> dict:
    return {
        "id": "graph-job-brainstorm-spec-tree",
        "jobId": "job-brainstorm",
        "stage": "spec_tree",
        "subStage": "early-intake",
        "centralQuestion": {
            "id": "q-root",
            "title": "Which migration boundary should the brainstorm explore?",
            "body": "Lock the reasoning graph contract before moving runtime code.",
            "sourceRefs": [{"kind": "job", "id": "job-brainstorm", "label": "Job"}],
        },
        "nodes": [
            {
                "id": "q-root",
                "type": "question",
                "title": "Which migration boundary should the brainstorm explore?",
                "body": "Lock the reasoning graph contract before moving runtime code.",
                "roleId": "planner",
                "roleLabel": "Planner",
                "conclusionBadge": "question",
                "capabilityId": "brainstorm.contract",
                "status": "open",
                "confidence": 0.72,
                "sourceRefs": [{"kind": "job", "id": "job-brainstorm"}],
                "order": 0,
                "turnId": "turn-1",
                "round": 1,
                "capabilityRunId": "cap-run-1",
                "producedRunId": "run-1",
                "producedArtifactId": "artifact-1",
                "derivedFrom": ["input-1"],
            },
            {
                "id": "hypothesis-contract",
                "type": "hypothesis",
                "title": "Keep Node as runtime owner for this slice",
                "body": "Python only proves graph/input/output/error compatibility.",
                "roleId": "architect",
                "roleLabel": "Architect",
                "status": "supported",
                "confidence": 0.84,
                "sourceRefs": [{"kind": "stage", "id": "spec_tree"}],
                "order": 1,
                "turnId": "turn-1",
                "round": 1,
                "capabilityRunId": "cap-run-1",
                "producedRunId": "run-1",
                "producedArtifactId": "artifact-1",
                "derivedFrom": ["q-root"],
            },
        ],
        "edges": [
            {
                "id": "edge-q-hypothesis",
                "source": "q-root",
                "target": "hypothesis-contract",
                "type": "refines",
                "label": "contract boundary",
                "confidence": 0.81,
                "sourceKind": "llm",
                "capabilityId": "brainstorm.contract",
            }
        ],
        "telemetry": {
            "tokenBurn": 128,
            "sourceCount": 2,
            "elapsedMs": 42,
            "remainingBudget": 4096,
            "activeRoleCount": 2,
        },
        "consoleLines": [
            {
                "id": "console-1",
                "kind": "Thinking",
                "text": "Projecting brainstorm reasoning graph shape.",
                "roleId": "architect",
                "timestamp": "2026-06-20T00:00:00.000Z",
            }
        ],
        "source": "llm",
        "createdAt": "2026-06-20T00:00:00.000Z",
        "updatedAt": "2026-06-20T00:00:01.000Z",
    }


def _sample_input() -> dict:
    return {
        "contractVersion": CONTRACT_VERSION,
        "jobId": "job-brainstorm",
        "stageId": "spec_tree",
        "stageContext": "Generate a spec tree from early intake.",
        "request": {
            "targetText": "Migrate only the contract boundary.",
            "locale": "en-US",
        },
        "graph": _sample_graph(),
    }


def _success_output() -> dict:
    return {
        "contractVersion": CONTRACT_VERSION,
        "ok": True,
        "status": "completed",
        "graph": _sample_graph(),
        "decision": "Keep this task at the contract boundary.",
        "reasoning": "The runtime remains Node-owned while Python locks the graph shape.",
        "metadata": {
            "source": "python-contract",
            "promptId": "blueprint.brainstorm.reasoning-graph.v1",
            "promptFingerprint": "sha256:contract",
            "responseDigest": "sha256:response",
        },
    }


def _partial_output() -> dict:
    payload = _success_output()
    payload["ok"] = False
    payload["status"] = "partial"
    payload["partialReason"] = "reasoning graph projected, synthesis incomplete"
    payload.pop("decision")
    return payload


def _error_output() -> dict:
    return {
        "contractVersion": CONTRACT_VERSION,
        "ok": False,
        "status": "error",
        "error": {
            "code": "invalid_graph",
            "message": "nodes must be non-empty",
            "retryable": False,
        },
    }


def _is_non_empty_string(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _assert_graph_contract(graph: dict) -> None:
    assert _is_non_empty_string(graph.get("id"))
    assert _is_non_empty_string(graph.get("jobId"))
    assert _is_non_empty_string(graph.get("stage"))
    assert graph.get("source") in VALID_GRAPH_SOURCES

    nodes = graph.get("nodes")
    edges = graph.get("edges")
    assert isinstance(nodes, list) and nodes
    assert isinstance(edges, list)

    node_ids = set()
    for node in nodes:
        assert _is_non_empty_string(node.get("id"))
        assert node["type"] in VALID_NODE_TYPES
        assert _is_non_empty_string(node.get("title"))
        assert node["status"] in VALID_NODE_STATUSES
        if "confidence" in node:
            assert 0 <= node["confidence"] <= 1
        if "sourceRefs" in node:
            assert isinstance(node["sourceRefs"], list)
        if "derivedFrom" in node:
            assert isinstance(node["derivedFrom"], list)
        node_ids.add(node["id"])

    for edge in edges:
        assert _is_non_empty_string(edge.get("id"))
        assert edge.get("source") in node_ids
        assert edge.get("target") in node_ids
        assert edge["type"] in VALID_EDGE_TYPES
        if "sourceKind" in edge:
            assert edge["sourceKind"] in VALID_GRAPH_SOURCES
        if "confidence" in edge:
            assert 0 <= edge["confidence"] <= 1


def _assert_contract_output(payload: dict) -> None:
    assert payload.get("contractVersion") == CONTRACT_VERSION
    assert payload.get("status") in VALID_RESULT_STATUSES
    assert isinstance(payload.get("ok"), bool)

    if payload["status"] == "completed":
        assert payload["ok"] is True
        assert _is_non_empty_string(payload.get("decision"))
        assert _is_non_empty_string(payload.get("reasoning"))
        _assert_graph_contract(payload["graph"])
        return

    assert payload["ok"] is False
    if payload["status"] == "partial":
        assert _is_non_empty_string(payload.get("partialReason"))
        _assert_graph_contract(payload["graph"])
        assert "decision" not in payload
        return

    assert payload["status"] == "error"
    assert "graph" not in payload
    assert "decision" not in payload
    error = payload.get("error")
    assert isinstance(error, dict)
    assert _is_non_empty_string(error.get("code"))
    assert _is_non_empty_string(error.get("message"))
    assert isinstance(error.get("retryable"), bool)


def test_brainstorm_input_contract_preserves_reasoning_graph_fields():
    payload = _sample_input()

    assert payload["contractVersion"] == CONTRACT_VERSION
    assert payload["jobId"] == payload["graph"]["jobId"]
    assert payload["stageId"] == payload["graph"]["stage"]
    assert _is_non_empty_string(payload["stageContext"])
    _assert_graph_contract(payload["graph"])

    node = payload["graph"]["nodes"][0]
    assert node["conclusionBadge"] == "question"
    assert node["capabilityId"] == "brainstorm.contract"
    assert node["turnId"] == "turn-1"
    assert node["round"] == 1
    assert node["capabilityRunId"] == "cap-run-1"
    assert node["producedRunId"] == "run-1"
    assert node["producedArtifactId"] == "artifact-1"
    assert node["derivedFrom"] == ["input-1"]
    assert payload["graph"]["edges"][0]["capabilityId"] == "brainstorm.contract"


def test_brainstorm_output_contract_accepts_completed_and_partial_shapes():
    _assert_contract_output(_success_output())
    _assert_contract_output(_partial_output())


def test_brainstorm_error_contract_cannot_look_like_completed_success():
    payload = _error_output()

    _assert_contract_output(payload)
    assert payload["ok"] is False
    assert payload["status"] == "error"
    assert "graph" not in payload
    assert "decision" not in payload


def test_partial_output_cannot_be_promoted_to_completed_without_decision():
    payload = _partial_output()
    disguised = deepcopy(payload)
    disguised["ok"] = True
    disguised["status"] = "completed"

    try:
        _assert_contract_output(disguised)
    except AssertionError:
        return

    raise AssertionError("partial brainstorm output must not validate as completed")
