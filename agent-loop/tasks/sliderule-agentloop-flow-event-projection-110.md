# SlideRule AgentLoop 110: flow event projection

## Execution status
- Status: pending
- Goal: render Flow from reducer-projected events with stable node and edge identities.
- Required gate: `slideruleAgentLoopFlowEventProjection110Gates`

## Context
The current browser detail view can flicker because it renders sections from snapshots and artifacts. Flow must be derived from event replay so updates are stable and deterministic.

## Allowed files
- `tws-ai-slide-rule-python/static/agent-loop/index.html`
- `tws-ai-slide-rule-python/static/agent-loop/agent-loop-dashboard.js`
- `tws-ai-slide-rule-python/services/agent_loop_state_reducer.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_flow_event_projection.py`
- `agent-loop/tasks/sliderule-agentloop-flow-event-projection-110.md`
- This task file

## Do not
- Do not use `@antv/g6` in this bridge slice.
- Do not rebuild Flow from changing log file selection.
- Do not create duplicate artifact panels.
- Do not require a live SSE server for unit tests.

## Acceptance criteria
- Add a test named `agentloop flow event projection 110 renders stable nodes and edges from events`.
- Flow nodes use stable ids derived from event phases and sequence.
- Retry or review loops render as stable edges.
- Empty or legacy event sets render an empty state instead of crashing.
