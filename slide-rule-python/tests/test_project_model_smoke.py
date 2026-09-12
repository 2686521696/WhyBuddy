"""The live smoke must reject model prose, fabricated events and stale exits.

These tests exercise only the evidence predicates. They make no network calls;
the separate smoke invokes the configured production model and E2B provider.
"""

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


_PATH = Path(__file__).resolve().parents[2] / "scripts" / "project-model-smoke.py"
_SPEC = importlib.util.spec_from_file_location("project_model_smoke", _PATH)
smoke = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(smoke)


def _fixture():
    result = {"tool": "project_read", "ok": True, "content": "real source", "revision": "rev-1"}
    record = {"checkpoint": {"messages": [
        {"role": "assistant", "tool_calls": [{"id": "call-1", "function": {
            "name": "project_read", "arguments": '{"path":"src/main.tsx"}'}}]},
        {"role": "tool", "tool_call_id": "call-1", "content": json.dumps(result)},
    ]}}
    event = {"type": "control_tool_result", "toolCallId": "call-1", **result}
    return record, event


def test_tool_evidence_matches_real_durable_assistant_and_result():
    record, event = _fixture()
    evidence = smoke.correlate(record, [event])
    assert evidence[0]["arguments"] == {"path": "src/main.tsx"}
    assert evidence[0]["result"]["content"] == "real source"


@pytest.mark.parametrize("broken", [None, "request-failed", "not-fed", "different-call", "different-result"])
def test_durable_results_must_reach_a_successful_followup_model_request(broken):
    record, event = _fixture()
    evidence = smoke.correlate(record, [event])
    sample = {"status": "completed", "receivedToolResults": [{
        "toolCallId": "call-1", "content": json.dumps(evidence[0]["result"])}]}
    if broken == "request-failed":
        sample["status"] = "failed"
    elif broken == "not-fed":
        sample["receivedToolResults"] = []
    elif broken == "different-call":
        sample["receivedToolResults"][0]["toolCallId"] = "call-other"
    elif broken == "different-result":
        sample["receivedToolResults"][0]["content"] = '{"ok": true}'
    if broken:
        with pytest.raises(RuntimeError, match="not_sent_back"):
            smoke.require_model_receipts([sample], evidence)
    else:
        smoke.require_model_receipts([sample], evidence)


@pytest.mark.parametrize("broken", ["assistant", "tool", "call-id", "content", "prose-only"])
def test_missing_or_fabricated_model_tool_evidence_is_not_a_pass(broken):
    record, event = _fixture()
    if broken == "assistant":
        record["checkpoint"]["messages"].pop(0)
    elif broken == "tool":
        record["checkpoint"]["messages"].pop()
    elif broken == "call-id":
        event["toolCallId"] = "fabricated"
    elif broken == "content":
        event["content"] = "fabricated source"
    else:
        event = {"type": "control_text", "text": "I read and patched the source successfully."}
    with pytest.raises(RuntimeError, match="correlation|did_not_execute"):
        smoke.correlate(record, [event])


@pytest.mark.parametrize("broken", [None, "unchanged-revision", "extra-file", "missing-edit"])
def test_exact_source_edit_requires_new_revision_and_preserves_other_files(broken):
    before = {"src/main.tsx": "<h1>New Project</h1>\n", "package.json": "{}"}
    after = {**before, "src/main.tsx": "<h1>Smoke title</h1>\n"}
    revision = "rev-2"
    if broken == "unchanged-revision":
        revision = "rev-1"
    elif broken == "extra-file":
        after["extra.ts"] = ""
    elif broken == "missing-edit":
        after = before
    if broken:
        with pytest.raises(RuntimeError, match="requested_exact_edit"):
            smoke.require_edit(before, after, "rev-1", revision, "Smoke title")
    else:
        smoke.require_edit(before, after, "rev-1", revision, "Smoke title")


@pytest.mark.parametrize("broken", [None, "stale", "failed", "bool-exit", "no-status", "no-logs", "fake-log"])
def test_exit_and_model_observation_must_describe_same_real_command(broken):
    operation = SimpleNamespace(expectedRevision="rev-2", input={"command": "check"},
        status="completed", result={"exitCode": 0}, operationId="op-1")
    evidence = [
        {"tool": "project_status", "result": {"operationId": "op-1", "revision": "rev-2", "status": "completed", "exitCode": 0}},
        {"tool": "project_logs", "result": {"operationId": "op-1", "logs": [{"text": "> tsc --noEmit\n"}]}},
    ]
    if broken == "stale":
        operation.expectedRevision = "rev-1"
    elif broken == "failed":
        operation.status = "failed"
    elif broken == "bool-exit":
        operation.result["exitCode"] = False
    elif broken == "no-status":
        evidence.pop(0)
    elif broken == "no-logs":
        evidence.pop()
    elif broken == "fake-log":
        evidence[1]["result"]["logs"] = [{"text": "The model claims that everything passed."}]
    if broken:
        with pytest.raises(RuntimeError, match="not_passed|did_not_observe|did_not_read"):
            smoke.require_verified_command(operation, "rev-2", evidence)
    else:
        smoke.require_verified_command(operation, "rev-2", evidence)
