# AgentLoop Settings 107: provider health cache and history

## Execution status
- Status: pending
- Goal: cache the latest provider health results in memory for the dashboard session and show last-run time/status.
- Required gate: `agentLoopSettingsProviderHealthCache107Gates`

## Context
Repeated provider checks should not flicker or erase useful status on refresh. This is dashboard-session state only, not persisted secrets.

## Allowed files
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not persist raw responses.
- Do not cache raw key values.
- Do not introduce background polling.

## Acceptance criteria
- Add tests named `provider health cache 107 keeps last redacted result` and `provider health cache 107 clears when provider settings change`.
- Cached entries include provider, status, reason, duration, and checkedAt.
- UI labels stale cached results clearly.
- Refreshing the dashboard does not drop the latest health status.
