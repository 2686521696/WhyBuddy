# SlideRule AgentLoop 110: legacy event adapter

## Execution status
- Status: pending
- Goal: convert 108 and 109 run artifacts into synthetic v2 events for one replay path.
- Required gate: `slideruleAgentLoopLegacyEventAdapter110Gates`

## Context
Existing runs will not have native v2 event logs. The Web console still needs to render them through the same reducer and flow projection used for new runs.

## Allowed files
- `tws-ai-slide-rule-python/services/agent_loop_legacy_adapter.py`
- `tws-ai-slide-rule-python/services/agent_loop_runs.py`
- `tws-ai-slide-rule-python/services/agent_loop_event_schema.py`
- `tws-ai-slide-rule-python/tests/fixtures/agent_loop_run/`
- `tws-ai-slide-rule-python/tests/test_agent_loop_legacy_event_adapter.py`
- `agent-loop/tasks/sliderule-agentloop-legacy-event-adapter-110.md`
- This task file

## Do not
- Do not maintain a separate legacy-only UI path.
- Do not expose absolute filesystem paths.
- Do not read unbounded log contents.
- Do not treat synthetic events as native runner emissions.

## Acceptance criteria
- Add a test named `agentloop legacy event adapter 110 converts 108 and 109 artifacts to v2 events`.
- Synthetic events include `payload.synthetic: true` and a `legacySource`.
- Legacy state, final reports, reviews, diffs, and bounded logs can be represented as v2 events.
- Corrupt or partial legacy artifacts degrade to safe events instead of crashing replay.
