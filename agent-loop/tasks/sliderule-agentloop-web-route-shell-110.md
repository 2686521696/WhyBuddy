# SlideRule AgentLoop 110: Web route shell

## Execution status
- Status: pending
- Goal: move the AgentLoop browser entry toward a first-class `/AgentLoop` route served by the Python app.
- Required gate: `slideruleAgentLoopWebRouteShell110Gates`

## Context
The UI should migrate out of VS Code as the primary product surface. This task makes the Python-served Web route explicit while keeping the bridge shell small.

## Allowed files
- `tws-ai-slide-rule-python/routes/agent_loop.py`
- `tws-ai-slide-rule-python/static/agent-loop/index.html`
- `tws-ai-slide-rule-python/static/agent-loop/agent-loop-dashboard.js`
- `tws-ai-slide-rule-python/tests/test_agent_loop_web_route_shell.py`
- `agent-loop/tasks/sliderule-agentloop-web-route-shell-110.md`
- This task file

## Do not
- Do not introduce a separate frontend build pipeline in this slice.
- Do not use VS Code `postMessage` or `acquireVsCodeApi`.
- Do not remove the existing `/api/agent-loop/dashboard` route.
- Do not require live workers to render the shell.

## Acceptance criteria
- Add a test named `agentloop web route shell 110 exposes agentloop route from python dashboard`.
- `/AgentLoop` or `/agent-loop` serves the AgentLoop shell.
- The shell reads the Python event replay path as the preferred state source.
- Existing dashboard route remains available for compatibility.
