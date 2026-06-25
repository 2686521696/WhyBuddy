# SlideRule AgentLoop 111: cancel semantics rescue

## Execution status
- Status: DONE_REVIEWED
- Goal: align the main-project AgentLoop cancel action with the real Python bridge semantics instead of pretending a run was stopped.
- Required gate: `slideruleAgentLoopCancelSemantics111Gates`

## Context
The Python bridge exposes `POST /api/agent-loop/cancel`, but the route is explicitly a queued-cancel placeholder and does not kill a running process. The browser AgentLoop UI currently wires the stop action to this endpoint and then refreshes, which reads like a successful cancellation. This task must make the behavior explicit and safe.

## Allowed files
- `client/src/pages/agent-loop/AgentLoopPage.tsx`
- `client/src/pages/agent-loop/dashboard/DashboardApp.tsx`
- `client/src/pages/agent-loop/dashboard/agentLoopApi.ts`
- `client/src/pages/agent-loop/AgentLoopPage.test.tsx`
- `slide-rule-python/routes/agent_loop.py`
- `agent-loop/tasks/sliderule-agentloop-cancel-semantics-111.md`
- This task file

## Do not
- Do not fake a successful stop.
- Do not add process-kill behavior to the Python bridge in this slice.
- Do not swallow queued-cancel placeholder semantics.
- Do not regress refresh behavior for overview/detail.

## Acceptance criteria
- Add a test named `agentloop cancel semantics 111 surfaces queued cancel placeholder instead of stop success`.
- Browser stop action distinguishes queued-cancel placeholder from a real stop.
- UI copy tells the user the bridge queued or advisory cancel is not a real process kill when that is the returned status.
- If future backend returns a real cancellable status, the bridge path remains forward-compatible.
