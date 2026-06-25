# SlideRule AgentLoop 111: artifact route truth rescue

## Execution status
- Status: DONE_REVIEWED
- Goal: replace fake detail-derived report and landing URLs with artifact-truth routing so the main-project AgentLoop detail actions open the intended resources.
- Required gate: `slideruleAgentLoopArtifactRouteTruth111Gates`

## Context
The current main-project AgentLoop detail adapter fills `reportPath`, `reportJsonPath`, `landingPath`, and `statePath` using generic run detail and snapshot endpoints. That keeps buttons visible, but it collapses distinct resources into the same JSON endpoints and misrepresents artifact semantics. The Python run detail already returns an artifact index; this task should use that truth source or expose explicit safe artifact routes.

## Allowed files
- `client/src/pages/agent-loop/dashboard/agentLoopApi.ts`
- `client/src/pages/agent-loop/dashboard/DashboardApp.tsx`
- `client/src/pages/agent-loop/AgentLoopPage.test.tsx`
- `slide-rule-python/routes/agent_loop.py`
- `slide-rule-python/services/agent_loop_runs.py`
- `slide-rule-python/services/agent_loop_artifacts.py`
- `slide-rule-python/tests/test_agent_loop_run_detail.py`
- `agent-loop/tasks/sliderule-agentloop-artifact-route-truth-111.md`
- This task file

## Do not
- Do not expose raw filesystem paths.
- Do not remove existing run detail or snapshot endpoints.
- Do not open every artifact through the same generic JSON route.
- Do not fetch unbounded artifact contents.

## Acceptance criteria
- Add a test named `agentloop artifact route truth 111 maps report landing and state actions to distinct safe resources`.
- Detail payload no longer assigns identical placeholder URLs to semantically different artifact actions unless the backend explicitly exposes only one resource.
- Report, structured report, landing, and state actions are derived from artifact truth or explicit safe subroutes.
- Missing artifacts degrade cleanly without crashing or lying.
