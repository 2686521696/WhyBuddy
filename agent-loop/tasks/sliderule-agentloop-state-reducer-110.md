# SlideRule AgentLoop 110: deterministic state reducer

## Execution status
- Status: pending
- Goal: derive runtime snapshots from v2 events using a pure reducer.
- Required gate: `slideruleAgentLoopStateReducer110Gates`

## Context
The reducer is the core SSOT bridge: UI state, flow graph, timeline, and final status must come from replayed events instead of artifact guessing.

## Allowed files
- `tws-ai-slide-rule-python/services/agent_loop_event_schema.py`
- `tws-ai-slide-rule-python/services/agent_loop_state_reducer.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_state_reducer.py`
- `agent-loop/tasks/sliderule-agentloop-state-reducer-110.md`
- This task file

## Do not
- Do not read files inside the reducer.
- Do not parse raw log text to decide final status.
- Do not make `state.json` authoritative.
- Do not add Web UI logic.

## Acceptance criteria
- Add a test named `agentloop state reducer 110 derives deterministic run snapshots`.
- Replaying the same events produces the same snapshot.
- `RUN_FINALIZED` is required for a final done state.
- `REVIEW_RESULT` controls review verdict and `GATE_RESULT` controls gate status.
- Flow nodes and edges are derived with stable ids.
