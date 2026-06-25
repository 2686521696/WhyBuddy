# SlideRule AgentLoop 110: artifact index

## Execution status
- Status: pending
- Goal: expose stable, event-referenced artifact metadata for logs, reports, diffs, and state projections.
- Required gate: `slideruleAgentLoopArtifactIndex110Gates`

## Context
The UI should not guess newest log files. Artifacts need stable ids and event references so Review, Diff, Agent Output, and Artifacts tabs all agree.

## Allowed files
- `tws-ai-slide-rule-python/services/agent_loop_artifacts.py`
- `tws-ai-slide-rule-python/services/agent_loop_runs.py`
- `tws-ai-slide-rule-python/services/agent_loop_paths.py`
- `tws-ai-slide-rule-python/services/agent_loop_redaction.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_artifact_index.py`
- `agent-loop/tasks/sliderule-agentloop-artifact-index-110.md`
- This task file

## Do not
- Do not expose absolute file paths.
- Do not select active logs by newest mtime alone.
- Do not read unbounded artifacts.
- Do not duplicate artifact rendering logic in Web code.

## Acceptance criteria
- Add a test named `agentloop artifact index 110 exposes stable event referenced artifacts`.
- Artifact ids are stable across repeated reads.
- Artifacts include kind, safe name, size, and optional event reference.
- Active log selection can use explicit event references when present.
- Secret-like output is redacted.
