# AgentLoop Settings 106: queue defaults apply

## Execution status
- Status: pending
- Goal: apply supported queue default edits safely after preview, preserving tasks and gates.
- Required gate: `agentLoopSettingsQueueDefaultsApply106Gates`

## Context
This task builds on the preview task by allowing a user-confirmed write to `migration-queue.json`. Writes must preserve valid JSON and must never write secrets.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/scripts/migration-queue.json`
- `agent-loop/test/vscode-extension.test.js`
- `agent-loop/test/run-queue.test.js`
- This task file

## Do not
- Do not overwrite the `tasks` array.
- Do not change enabled task IDs except through explicit tests in this task.
- Do not store LLM keys in `workerEnv`.
- Do not skip JSON validation after write.

## Acceptance criteria
- Apply writes only owned default keys after a preview/confirmation command.
- Queue JSON remains parseable and keeps the task list intact.
- Secrets and Authorization-like keys are rejected.
- Tests cover apply, rollback on invalid write, and task-array preservation.
