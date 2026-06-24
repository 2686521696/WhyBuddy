# AgentLoop Settings 107: queue defaults sync

## Execution status
- Status: pending
- Goal: synchronize supported Settings values into queue defaults through preview/apply while preserving tasks and redacting workerEnv.
- Required gate: `agentLoopSettingsQueueDefaultsSync107Gates`

## Context
106 added preview/apply primitives. This task completes the Settings UI workflow for queue defaults.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- `agent-loop/test/run-queue.test.js`
- This task file

## Do not
- Do not write unsupported keys.
- Do not overwrite `tasks`.
- Do not display or export `workerEnv` secret-like values.

## Acceptance criteria
- Add tests named `queue defaults sync 107 previews settings to defaults diff` and `queue defaults sync 107 applies only after confirmation`.
- UI shows before/after diff with AntD Table or Descriptions.
- Apply validates JSON and task array preservation.
- Failure rolls back and reports a redacted error.
