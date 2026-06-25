# SlideRule AgentLoop 109: release runbook rescue

## Execution status
- Status: pending
- Goal: rescue the operator runbook for the merged SlideRule + AgentLoop bridge phase after the 108 Grok 403 halt.
- Required gate: `slideruleAgentLoopReleaseRunbook109Gates`

## Context
Once AgentLoop is controlled by SlideRule Python, operators need one clear runbook for startup, queue execution, settings, troubleshooting, security, and rollback. This documentation must be explicit that Node runner ownership still exists during the bridge phase.

## Allowed files
- `tws-ai-slide-rule-python/AGENT_LOOP_RUNBOOK.md`
- `tws-ai-slide-rule-python/README.md`
- `tws-ai-slide-rule-python/tests/test_agent_loop_release_runbook.py`
- `agent-loop/tasks/sliderule-agentloop-release-runbook-109.md`
- This task file

## Do not
- Do not claim the Node runner has been removed.
- Do not document raw secret storage.
- Do not remove existing SlideRule V5 README sections.
- Do not claim full production cutover beyond the bridge phase.

## Acceptance criteria
- Add a test named `agentloop release runbook 109 documents startup queue settings security and rollback`.
- Runbook includes startup commands, API routes, queue execution, settings, provider health, run inspection, security, and rollback.
- README links to the runbook from the development or integration section.
- The runbook states that 109 is a bridge rescue phase with Node runner still present.
