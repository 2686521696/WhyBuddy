# SlideRule AgentLoop 109: path security rescue

## Execution status
- Status: pending
- Goal: rescue safe filesystem boundary enforcement for Python AgentLoop run and artifact readers after the 108 Grok 403 halt.
- Required gate: `slideruleAgentLoopPathSecurity109Gates`

## Context
The Python control plane now reads Node AgentLoop artifacts. Before adding richer artifact/log APIs, path resolution must be centralized and bounded so browser input cannot escape documented run roots.

## Allowed files
- `tws-ai-slide-rule-python/services/agent_loop_paths.py`
- `tws-ai-slide-rule-python/services/agent_loop_runs.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_path_security.py`
- `agent-loop/tasks/sliderule-agentloop-path-security-109.md`
- This task file

## Do not
- Do not allow absolute user-supplied paths.
- Do not follow symlink escapes outside the allowed root.
- Do not expose raw filesystem errors to API callers.
- Do not broaden allowed roots beyond documented AgentLoop run/artifact roots.

## Acceptance criteria
- Add a test named `agentloop path security 109 rejects traversal and absolute escapes`.
- Allowed roots include only documented run and artifact roots.
- Traversal, absolute path, symlink escape, and drive-prefix escape cases are rejected.
- Readers use the path helper instead of open-coding path joins.
