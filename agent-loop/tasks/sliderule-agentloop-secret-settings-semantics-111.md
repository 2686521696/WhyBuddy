# SlideRule AgentLoop 111: secret settings semantics rescue

## Execution status
- Status: DONE_REVIEWED
- Goal: remove the false-success secret save behavior in the main-project AgentLoop settings page so LLM key actions match real backend semantics.
- Required gate: `slideruleAgentLoopSecretSettingsSemantics111Gates`

## Context
The current main-project AgentLoop page ports the settings UI from the VS Code dashboard, but the Python `/api/agent-loop/settings` surface only persists non-secret fields and exposes secret configured status only. The current browser bridge accepts LLM key submits and clear actions, then reports success even though the backend intentionally drops those fields. This task must eliminate that semantic lie.

## Allowed files
- `client/src/pages/agent-loop/AgentLoopPage.tsx`
- `client/src/pages/agent-loop/dashboard/DashboardApp.tsx`
- `client/src/pages/agent-loop/dashboard/agentLoopApi.ts`
- `client/src/pages/agent-loop/dashboard/dashboardTypes.ts`
- `client/src/pages/agent-loop/AgentLoopPage.test.tsx`
- `agent-loop/tasks/sliderule-agentloop-secret-settings-semantics-111.md`
- This task file

## Do not
- Do not invent browser-side secret persistence.
- Do not claim secrets were saved when the Python backend cannot store them.
- Do not expose raw key values in tests, logs, or JSON.
- Do not silently keep the old success toast behavior.

## Acceptance criteria
- Add a test named `agentloop secret settings semantics 111 does not report secret save success against nonsecret backend`.
- LLM key save/clear UX no longer reports persisted success when only `/settings` is available.
- UI presents the capability truthfully: configured status may be shown, but persistence/clear flows must be disabled, blocked, or explicitly labeled unsupported in this web slice.
- Non-secret settings save flow continues to work.
