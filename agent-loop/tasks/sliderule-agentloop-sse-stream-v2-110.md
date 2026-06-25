# SlideRule AgentLoop 110: SSE stream v2

## Execution status
- Status: pending
- Goal: stream normalized v2 events and reducer snapshots through a deterministic SSE path.
- Required gate: `slideruleAgentLoopSseStreamV2110Gates`

## Context
The current event stream is a finite snapshot helper. v2 needs an event-oriented stream that the Web console can replay incrementally while preserving finite testability.

## Allowed files
- `tws-ai-slide-rule-python/routes/agent_loop.py`
- `tws-ai-slide-rule-python/services/agent_loop_events.py`
- `tws-ai-slide-rule-python/services/agent_loop_event_store.py`
- `tws-ai-slide-rule-python/services/agent_loop_state_reducer.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_sse_stream_v2.py`
- `agent-loop/tasks/sliderule-agentloop-sse-stream-v2-110.md`
- This task file

## Do not
- Do not use long sleeps or infinite generators in tests.
- Do not stream raw logs as authoritative state.
- Do not break the existing 108 `/events/stream` route.
- Do not depend on WebSocket libraries for this task.

## Acceptance criteria
- Add a test named `agentloop sse stream v2 110 streams incremental normalized events`.
- SSE frames use stable event names and compact JSON data.
- The stream can replay existing events and emit a final snapshot frame.
- Tests use finite generators only.
