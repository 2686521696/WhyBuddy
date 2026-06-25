# SlideRule AgentLoop 110: append-only event store

## Execution status
- Status: pending
- Goal: add the Python-side append-only JSONL event store for AgentLoop v2 runtime events.
- Required gate: `slideruleAgentLoopEventStore110Gates`

## Context
After the envelope exists, Python needs a bounded, redacted, append-only event store that can later back replay APIs and dashboard streams.

## Allowed files
- `tws-ai-slide-rule-python/services/agent_loop_event_schema.py`
- `tws-ai-slide-rule-python/services/agent_loop_event_store.py`
- `tws-ai-slide-rule-python/services/agent_loop_paths.py`
- `tws-ai-slide-rule-python/services/agent_loop_redaction.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_event_store.py`
- `agent-loop/tasks/sliderule-agentloop-event-store-110.md`
- This task file

## Do not
- Do not mutate legacy `.agent-loop/runs/*/state.json` as the authority.
- Do not allow user-supplied absolute event paths.
- Do not store raw secrets.
- Do not require a live Node runner.

## Acceptance criteria
- Add a test named `agentloop event store 110 appends redacted jsonl events`.
- Events are written under a documented event root only.
- Appends preserve order and assign or validate monotonic sequence numbers per run.
- Event payloads are redacted before persistence or readback.
