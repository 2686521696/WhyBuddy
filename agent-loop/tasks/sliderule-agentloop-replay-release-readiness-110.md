# SlideRule AgentLoop 110: replay release readiness

## Execution status
- Status: pending
- Goal: verify the v2 SSOT replay path is documented, testable, and safe to operate beside the Node runner.
- Required gate: `slideruleAgentLoopReplayReleaseReadiness110Gates`

## Context
The wave should finish with a release-readiness slice that proves replay, fallback, rollback, and operator docs are aligned before deeper runner rewrites begin.

## Allowed files
- `tws-ai-slide-rule-python/AGENT_LOOP_V2_RUNTIME_SSOT.md`
- `tws-ai-slide-rule-python/AGENT_LOOP_RUNBOOK.md`
- `tws-ai-slide-rule-python/README.md`
- `tws-ai-slide-rule-python/tests/test_agent_loop_replay_release_readiness.py`
- `agent-loop/tasks/sliderule-agentloop-replay-release-readiness-110.md`
- This task file

## Do not
- Do not claim the Node runner has been removed.
- Do not remove 108/109 compatibility.
- Do not document raw secret storage.
- Do not skip rollback guidance.

## Acceptance criteria
- Add a test named `agentloop replay release readiness 110 verifies v2 ssot rollout and rollback`.
- Runbook references the v2 SSOT replay path and keeps the Node runner bridge caveat.
- Documentation explains fallback to legacy artifact adapter.
- Release readiness covers rollback and Web route verification.
