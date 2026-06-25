"""
SlideRule AgentLoop 108: data model alignment tests.
Pydantic contracts covering run summary, run detail, task entry, event, artifact,
settings status, command request, and command receipt.

Models preserve unknown fields via bounded `metadata`.
Serialization uses stable camelCase fields (no snake_case drift).
"""

import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.agent_loop import (  # noqa: E402
    AGENT_LOOP_MODEL_VERSION,
    AgentLoopArtifact,
    AgentLoopCommandReceipt,
    AgentLoopCommandRequest,
    AgentLoopEvent,
    AgentLoopRunDetail,
    AgentLoopRunSummary,
    AgentLoopSettingsStatus,
    AgentLoopTaskEntry,
)


def test_agentloop_data_model_108_validates_run_summary():
    """agentloop data model 108 validates run summary

    Covers:
    - AgentLoopRunSummary (primary), RunDetail, TaskEntry, Event, Artifact
    - SettingsStatus, CommandRequest, CommandReceipt
    - unknown fields folded into bounded metadata
    - camelCase stable serialization (model_dump matches expected keys)
    """
    summary_payload = {
        "runId": "2026-06-25T12-00-00-000Z",
        "status": "DONE_GATE_ONLY",
        "task": "agent-loop/tasks/sliderule-agentloop-data-model-alignment-108.md",
        "iterations": 0,
        "grokRan": False,
        "codexRan": False,
        "reviewAgentRan": False,
        "fixAgent": "grok",
        "reviewAgent": None,
        "runTimeLocal": "2026-06-25 20:00:00 (Asia/Shanghai)",
        "runTimeUtc": "2026-06-25 12:00:00 (UTC)",
        # unknown optional AgentLoop state fields must land in metadata
        "extraFlag": True,
        "nestedUnknown": {"x": 1},
    }

    summary = AgentLoopRunSummary.model_validate(summary_payload)
    dumped = summary.model_dump(mode="json")

    # stable camelCase
    assert dumped["runId"] == "2026-06-25T12-00-00-000Z"
    assert dumped["status"] == "DONE_GATE_ONLY"
    assert dumped["task"] == "agent-loop/tasks/sliderule-agentloop-data-model-alignment-108.md"
    assert dumped["iterations"] == 0
    assert "extraFlag" not in dumped
    assert dumped["metadata"]["extraFlag"] is True
    assert dumped["metadata"]["nestedUnknown"] == {"x": 1}
    assert AGENT_LOOP_MODEL_VERSION  # version present

    # task entry
    task_entry = AgentLoopTaskEntry.model_validate({
        "path": "agent-loop/tasks/sliderule-agentloop-data-model-alignment-108.md",
        "title": "data model alignment",
        "status": "pending",
        "fooBar": "preserved-in-meta",
    })
    task_dump = task_entry.model_dump(mode="json")
    assert task_dump["path"] == "agent-loop/tasks/sliderule-agentloop-data-model-alignment-108.md"
    assert "fooBar" not in task_dump
    assert task_dump["metadata"]["fooBar"] == "preserved-in-meta"

    # event
    event = AgentLoopEvent.model_validate({
        "ts": "2026-06-25T12:00:01Z",
        "status": "running",
        "iteration": 0,
        "extra": "ok",
    })
    assert event.status == "running"
    ev_dump = event.model_dump(mode="json")
    assert ev_dump["status"] == "running"
    assert ev_dump["metadata"]["extra"] == "ok"

    # artifact
    artifact = AgentLoopArtifact.model_validate({
        "id": "a1",
        "kind": "gate-result",
        "title": "baseline",
        "path": "baseline-gate.json",
    })
    assert artifact.id == "a1"
    art_dump = artifact.model_dump(mode="json")
    assert art_dump["kind"] == "gate-result"

    # run detail
    detail = AgentLoopRunDetail.model_validate({
        "runId": "2026-06-25T12-00-00-000Z",
        "status": "DONE_GATE_ONLY",
        "task": {"path": "t.md", "title": "T"},
        "iterations": [{"iteration": 0}],
        "events": [{"ts": None, "status": "done"}],
        "artifacts": [{"id": "f", "kind": "final-report.md"}],
        "unknownRunField": "goes-to-meta",
    })
    detail_dump = detail.model_dump(mode="json")
    assert detail_dump["runId"] == "2026-06-25T12-00-00-000Z"
    assert detail_dump["metadata"]["unknownRunField"] == "goes-to-meta"

    # settings status
    settings = AgentLoopSettingsStatus.model_validate({
        "loaded": True,
        "source": "config",
        "effective": {"timeoutMs": 120000, "autoFix": True},
        "redacted": ["openai"],
        "anotherExtra": 42,
    })
    set_dump = settings.model_dump(mode="json")
    assert set_dump["effective"]["autoFix"] is True
    assert set_dump["metadata"]["anotherExtra"] == 42

    # command request
    req = AgentLoopCommandRequest.model_validate({
        "command": "grok",
        "args": ["--prompt-file", "p.md"],
        "cwd": ".",
        "timeoutMs": 300000,
        "reqExtra": "yes",
    })
    assert req.command == "grok"
    req_dump = req.model_dump(mode="json")
    assert req_dump["args"][0] == "--prompt-file"
    assert req_dump["metadata"]["reqExtra"] == "yes"

    # command receipt
    receipt = AgentLoopCommandReceipt.model_validate({
        "command": "grok",
        "exitCode": 0,
        "stdout": "ok",
        "timedOut": False,
        "recExtra": "rec",
    })
    rec_dump = receipt.model_dump(mode="json")
    assert rec_dump["exitCode"] == 0
    assert rec_dump["metadata"]["recExtra"] == "rec"

    # serialization stability: keys remain camelCase across roundtrips
    for m in [summary, detail, settings, req, receipt]:
        d = m.model_dump(mode="json")
        for k in d.keys():
            # no accidental snake
            assert "_" not in k or k == "metadata", f"unexpected snake_case key {k}"


def test_agentloop_data_model_108_rejects_raw_secret_fields():
    """agentloop data model 108 rejects raw secret fields

    Ensures no raw secret fields (apiKey, token, password, etc) are accepted
    in settings/status or other response models.
    """
    # top level effective
    with pytest.raises(ValidationError) as exc1:
        AgentLoopSettingsStatus.model_validate({
            "effective": {"openaiApiKey": "sk-secret-123", "timeout": 1},
        })
    assert "secret" in str(exc1.value).lower()

    # nested
    with pytest.raises(ValidationError) as exc2:
        AgentLoopSettingsStatus.model_validate({
            "effective": {"llm": {"authToken": "tok123"}},
        })
    assert "secret" in str(exc2.value).lower()

    # direct key in payload
    with pytest.raises(ValidationError) as exc3:
        AgentLoopSettingsStatus.model_validate({
            "password": "hunter2",
            "effective": {},
        })
    assert "secret" in str(exc3.value).lower()

    # command receipt should not reject but settings is the gate; also test request would allow? only response rejects per spec
    # ensure receipt doesn't accidentally have secret validator
    rec = AgentLoopCommandReceipt.model_validate({"command": "x", "exitCode": 1})
    assert rec.command == "x"
