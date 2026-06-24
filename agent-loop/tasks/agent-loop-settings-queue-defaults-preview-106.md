# AgentLoop Settings 106: queue defaults preview

## Execution status
- Status: pending
- Goal: show supported `migration-queue.json` defaults in Settings and preview safe patches without writing the file.
- Required gate: `agentLoopSettingsQueueDefaultsPreview106Gates`

## Context
Users currently edit queue defaults by hand. This task adds read and dry-run preview only; applying changes is a separate task.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- `agent-loop/test/run-queue.test.js`
- This task file

## Do not
- Do not write `agent-loop/scripts/migration-queue.json` in this task.
- Do not expose arbitrary JSON editing.
- Do not include `workerEnv` secret values in preview output.
- Do not change task enabled states.

## Acceptance criteria
- Settings UI shows supported queue default keys and current values.
- Preview returns a structured diff for supported keys only.
- Unsupported keys are rejected with a redacted error.
- Tests cover read, dry-run diff, and no file write.
