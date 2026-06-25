# SlideRule AgentLoop 110: Python worker adapter

## Execution status
- Status: pending
- Goal: define a Python worker adapter that normalizes Python-side execution results into v2 events.
- Required gate: `slideruleAgentLoopPythonWorkerAdapter110Gates`

## Context
Python will increasingly run tools, tests, and control-plane checks. Those results must enter the same event stream as Node, Grok, and Codex instead of becoming a separate truth source.

## Allowed files
- `tws-ai-slide-rule-python/services/agent_loop_python_worker.py`
- `tws-ai-slide-rule-python/services/agent_loop_event_schema.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_python_worker_adapter.py`
- `agent-loop/tasks/sliderule-agentloop-python-worker-adapter-110.md`
- This task file

## Do not
- Do not replace Node queue execution.
- Do not execute arbitrary shell commands from API input.
- Do not return raw env or secrets.
- Do not add long-running background workers in this slice.

## Acceptance criteria
- Add a test named `agentloop python worker adapter 110 normalizes python execution results`.
- Python task results can become `AGENT_FIX_RESULT`, `GATE_RESULT`, or `ARTIFACT_INDEXED` compatible events.
- stdout/stderr are bounded and redacted.
- Failures are represented as events, not uncaught exceptions.
