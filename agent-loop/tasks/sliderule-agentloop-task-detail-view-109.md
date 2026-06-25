# SlideRule AgentLoop 109: task detail view rescue

## Execution status
- Status: pending
- Goal: rescue the browser run detail view slice that halted in 108 because Grok returned 403/auth.
- Required gate: `slideruleAgentLoopTaskDetailView109Gates`

## Context
Wave 108 landed the run detail API and static dashboard shell. This task ports the first browser detail experience against the Python endpoint without relying on the VS Code webview. Keep the implementation small and browser-native for this bridge phase.

## Allowed files
- `tws-ai-slide-rule-python/static/agent-loop/index.html`
- `tws-ai-slide-rule-python/static/agent-loop/agent-loop-dashboard.js`
- `tws-ai-slide-rule-python/tests/test_agent_loop_task_detail_view.py`
- `agent-loop/tasks/sliderule-agentloop-task-detail-view-109.md`
- This task file

## Do not
- Do not copy VS Code-specific bridge code.
- Do not duplicate artifact cards if the center panel already exposes artifacts.
- Do not fetch unbounded logs.
- Do not replace the dashboard with a frontend build system.

## Acceptance criteria
- Add a test named `agentloop task detail view 109 renders flow timeline review diff output and artifacts`.
- Detail view uses the Python run detail endpoint.
- Flow, timeline, review, diff, agent output, and artifact sections have stable DOM anchors.
- Missing sections render empty states instead of crashing.
