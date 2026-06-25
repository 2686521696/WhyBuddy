# SlideRule AgentLoop 110: event read API

## Execution status
- Status: pending
- Goal: expose redacted event replay and derived snapshots from the Python AgentLoop API.
- Required gate: `slideruleAgentLoopEventReadApi110Gates`

## Context
The browser route should read events and snapshots from Python instead of polling raw `state.json`. This slice creates the read side only; writing native Node events is a later task.

## Allowed files
- `tws-ai-slide-rule-python/routes/agent_loop.py`
- `tws-ai-slide-rule-python/services/agent_loop_event_store.py`
- `tws-ai-slide-rule-python/services/agent_loop_legacy_adapter.py`
- `tws-ai-slide-rule-python/services/agent_loop_state_reducer.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_event_read_api.py`
- `agent-loop/tasks/sliderule-agentloop-event-read-api-110.md`
- This task file

## Do not
- Do not return raw secret values.
- Do not expose raw filesystem paths.
- Do not remove existing 108/109 run detail endpoints.
- Do not require a live queue process for tests.

## Acceptance criteria
- Add a test named `agentloop event read api 110 exposes replay events and snapshots`.
- Add a replay endpoint for run events.
- Add or extend a snapshot endpoint that uses the reducer.
- Legacy runs are served through the compatibility adapter.
- Responses are redacted and bounded.
