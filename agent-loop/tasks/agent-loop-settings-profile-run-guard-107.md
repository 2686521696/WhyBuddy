# AgentLoop Settings 107: profile run guard UX

## Execution status
- Status: pending
- Goal: prevent unsafe profile or worker configuration changes while a queue run is active, with a clear AntD warning path.
- Required gate: `agentLoopSettingsProfileRunGuard107Gates`

## Context
106 added a basic run guard. This task turns it into a visible, testable UX and backend contract.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not silently discard form edits.
- Do not block safe non-runtime fields unnecessarily.
- Do not require a real queue run in tests.

## Acceptance criteria
- Add tests named `profile run guard 107 blocks runtime fields during active run` and `profile run guard 107 allows safe diagnostic refresh`.
- UI shows an Alert explaining which fields are locked.
- Backend returns structured guard results for blocked saves.
- Dev preview can toggle running state.
