# SlideRule AgentLoop 110: event envelope contract

## Execution status
- Status: pending
- Goal: define the v2 normalized runtime event envelope used by Node, Python, Web, Grok, and Codex projections.
- Required gate: `slideruleAgentLoopEventEnvelope110Gates`

## Context
Wave 110 starts the Runtime SSOT migration described in `AGENT_LOOP_V2_RUNTIME_SSOT.md`. The first slice must make the event shape explicit before storage, reducers, streams, or UI projections build on it.

## Allowed files
- `tws-ai-slide-rule-python/AGENT_LOOP_V2_RUNTIME_SSOT.md`
- `tws-ai-slide-rule-python/services/agent_loop_event_schema.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_event_envelope.py`
- `agent-loop/tasks/sliderule-agentloop-event-envelope-110.md`
- This task file

## Do not
- Do not change Node runner behavior in this task.
- Do not add Web UI rendering.
- Do not write event store persistence yet.
- Do not expose raw secret fields in examples or fixtures.

## Acceptance criteria
- Add a test named `agentloop event envelope 110 defines normalized runtime events`.
- Define a normalized event envelope with version, runId, seq, ts, source, phase, type, task, status, payload, artifacts, and redaction metadata.
- Validate required fields, monotonic per-run `seq` expectations, and allowed source/phase/type values.
- Keep `state.json` described as a derived cache, not the source of truth.
