# SlideRule AgentLoop 109: navigation shell rescue

## Execution status
- Status: pending
- Goal: rescue the browser navigation shell slice that halted in 108 because Grok returned 403/auth.
- Required gate: `slideruleAgentLoopNavigationShell109Gates`

## Context
Wave 108 landed the Python AgentLoop bridge foundation, but this UI shell task did not produce business-file changes because the worker failed with `403 Forbidden` before completing the implementation. Continue from the Python-served dashboard now present in `static/agent-loop`.

## Allowed files
- `tws-ai-slide-rule-python/static/agent-loop/index.html`
- `tws-ai-slide-rule-python/static/agent-loop/agent-loop-dashboard.js`
- `tws-ai-slide-rule-python/tests/test_agent_loop_navigation_shell.py`
- `agent-loop/tasks/sliderule-agentloop-navigation-shell-109.md`
- This task file

## Do not
- Do not add unrelated SlideRule pages.
- Do not require a frontend build system in this task.
- Do not use VS Code message APIs.
- Do not modify the already-landed Python API bridge except where the test proves the shell needs a stable endpoint.

## Acceptance criteria
- Add a test named `agentloop navigation shell 109 exposes workbench runs settings and sliderule links`.
- Navigation includes Workbench, Runs, Settings, and a SlideRule back link.
- Active view state is represented in URL hash or documented local state.
- Menu labels are stable enough for later React/AntD replacement.
