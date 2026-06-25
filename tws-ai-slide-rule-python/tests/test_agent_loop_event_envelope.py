"""
SlideRule AgentLoop 110: event envelope contract.

Defines the v2 normalized runtime event envelope used by Node, Python, Web, Grok, and Codex projections.

Acceptance:
- test named `agentloop event envelope 110 defines normalized runtime events`
- normalized event envelope with version, runId, seq, ts, source, phase, type, task, status, payload, artifacts, and redaction metadata
- validates required fields, monotonic per-run seq expectations, allowed source/phase/type values
- state.json described as a derived cache, not the source of truth
"""

import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.agent_loop_event_schema import (  # noqa: E402
    VERSION,
    ALLOWED_PHASES,
    ALLOWED_TYPES,
    AgentLoopRuntimeEventEnvelope,
    EventSource,
    validate_event_envelope,
    validate_run_event_sequence,
)


def test_agentloop_event_envelope_110_defines_normalized_runtime_events():
    """agentloop event envelope 110 defines normalized runtime events.

    Covers the core v2 envelope contract for runtime events.
    state.json is a derived cache, not the source of truth.
    """
    # minimal valid event per contract
    minimal = {
        "version": "agentloop.event.v2",
        "runId": "2026-06-25T02-30-12-664Z",
        "seq": 0,
        "ts": "2026-06-25T02:34:51.000Z",
        "source": "node",
        "phase": "queue",
        "type": "RUN_STARTED",
        "task": "agent-loop/tasks/sliderule-agentloop-event-envelope-110.md",
        "status": "GROK_FIX",
        "payload": {},
        "artifacts": [],
        "redaction": {"applied": True},
    }

    env = validate_event_envelope(minimal)
    assert env.version == "agentloop.event.v2"
    assert env.runId == "2026-06-25T02-30-12-664Z"
    assert env.seq == 0
    assert env.ts == "2026-06-25T02:34:51.000Z"
    assert env.source == EventSource.NODE
    assert env.phase == "queue"
    assert env.type == "RUN_STARTED"
    assert env.task == "agent-loop/tasks/sliderule-agentloop-event-envelope-110.md"
    assert env.status == "GROK_FIX"
    assert env.payload == {}
    assert env.artifacts == []
    assert env.redaction.get("applied") is True

    # full required fields check: missing any core required fails
    for missing in ["version", "runId", "seq", "ts", "source", "phase", "type"]:
        bad = dict(minimal)
        del bad[missing]
        with pytest.raises(ValidationError):
            validate_event_envelope(bad)

    # version must be the v2 literal
    bad_ver = dict(minimal)
    bad_ver["version"] = "agentloop.event.v1"
    with pytest.raises(ValidationError):
        validate_event_envelope(bad_ver)

    # missing version must fail (no silent default to v2)
    bad_no_ver = dict(minimal)
    del bad_no_ver["version"]
    with pytest.raises(ValidationError):
        validate_event_envelope(bad_no_ver)

    # allowed sources
    for src in ["node", "python", "grok", "codex", "system"]:
        ok = dict(minimal)
        ok["source"] = src
        ok["seq"] = 1
        e = validate_event_envelope(ok)
        assert e.source.value == src
    bad_src = dict(minimal)
    bad_src["source"] = "web-ui"
    with pytest.raises(ValidationError):
        validate_event_envelope(bad_src)

    # allowed phases
    for ph in sorted(ALLOWED_PHASES):
        ok = dict(minimal)
        ok["phase"] = ph
        ok["seq"] = 2
        e = validate_event_envelope(ok)
        assert e.phase == ph
    bad_ph = dict(minimal)
    bad_ph["phase"] = "unknown"
    with pytest.raises(ValidationError):
        validate_event_envelope(bad_ph)

    # allowed types
    for ty in sorted(ALLOWED_TYPES):
        ok = dict(minimal)
        ok["type"] = ty
        ok["seq"] = 3
        e = validate_event_envelope(ok)
        assert e.type == ty
    bad_ty = dict(minimal)
    bad_ty["type"] = "SOME_OTHER"
    with pytest.raises(ValidationError):
        validate_event_envelope(bad_ty)

    # seq must be non-neg int
    bad_seq_neg = dict(minimal)
    bad_seq_neg["seq"] = -1
    with pytest.raises(ValidationError):
        validate_event_envelope(bad_seq_neg)

    # monotonic per-run seq
    events_ok = [
        {**minimal, "seq": 0, "runId": "run-mono"},
        {**minimal, "seq": 1, "runId": "run-mono"},
        {**minimal, "seq": 2, "runId": "run-mono"},
    ]
    assert validate_run_event_sequence(events_ok) is True

    # out of order / non-monotonic must fail
    events_bad_order = [
        {**minimal, "seq": 0, "runId": "run-bad"},
        {**minimal, "seq": 5, "runId": "run-bad"},
        {**minimal, "seq": 3, "runId": "run-bad"},
    ]
    with pytest.raises(ValueError):
        validate_run_event_sequence(events_bad_order)

    # duplicate seq not monotonic
    events_dup = [
        {**minimal, "seq": 10, "runId": "run-dup"},
        {**minimal, "seq": 10, "runId": "run-dup"},
    ]
    with pytest.raises(ValueError):
        validate_run_event_sequence(events_dup)

    # different runs have independent seqs
    cross = [
        {**minimal, "seq": 0, "runId": "rA"},
        {**minimal, "seq": 99, "runId": "rB"},
        {**minimal, "seq": 1, "runId": "rA"},
    ]
    assert validate_run_event_sequence(cross) is True

    # ensure fixtures/examples do not leak raw secrets (none present here)
    # state.json remains described as a derived cache, not the source of truth.
