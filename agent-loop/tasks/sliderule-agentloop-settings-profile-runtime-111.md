# SlideRule AgentLoop 111: settings profile runtime rescue

## Execution status
- Status: DONE_REVIEWED
- Goal: replace success-stub settings/profile/queue-default behaviors in the main-project AgentLoop page with truthful runtime behavior backed by real persistence where available.
- Required gate: `slideruleAgentLoopSettingsProfileRuntime111Gates`

## Context
The ported settings center currently returns synthetic `profiles`, `queueDefaults`, `queueApply`, and `diagnostics` messages so the UI does not look empty. That keeps the page visible, but it also makes unimplemented capabilities look real. This task should either connect these flows to actual Python persistence/read surfaces or intentionally downgrade the UI into honest read-only/unsupported states.

## Allowed files
- `client/src/pages/agent-loop/AgentLoopPage.tsx`
- `client/src/pages/agent-loop/dashboard/DashboardApp.tsx`
- `client/src/pages/agent-loop/dashboard/agentLoopApi.ts`
- `client/src/pages/agent-loop/AgentLoopPage.test.tsx`
- `slide-rule-python/routes/agent_loop.py`
- `slide-rule-python/services/agent_loop_settings.py`
- `slide-rule-python/tests/test_agent_loop_settings_runtime.py`
- `agent-loop/tasks/sliderule-agentloop-settings-profile-runtime-111.md`
- This task file

## Do not
- Do not keep fake green success for unimplemented profile persistence.
- Do not invent backend routes without tests and clear ownership.
- Do not hide unsupported features behind silent no-ops.
- Do not break existing non-secret settings load/save.

## Acceptance criteria
- Add a test named `agentloop settings profile runtime 111 avoids fake profile and queue default success`.
- Profiles / queue defaults / diagnostics either use real backend state or are clearly marked unsupported/read-only in the web slice.
- Browser bridge stops emitting synthetic success payloads that imply persistence when none exists.
- Existing settings load remains functional and backward compatible.
