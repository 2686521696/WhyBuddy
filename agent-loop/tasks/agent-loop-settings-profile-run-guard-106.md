# AgentLoop Settings 106: profile run guard

## Execution status
- Status: pending
- Goal: prevent unsafe profile switches or destructive profile edits while an AgentLoop queue is running.
- Required gate: `agentLoopSettingsProfileRunGuard106Gates`

## Context
Profiles are useful only if switching them cannot alter an in-flight run in surprising ways. This task adds a run-state guard and clear UI feedback.

## Allowed files
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/stateReader.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not block read-only viewing of profiles.
- Do not stop or mutate a running queue.
- Do not hide the active profile from overview/detail.
- Do not write raw secrets to run state.

## Acceptance criteria
- Running-state detection disables or rejects profile switch/delete actions.
- UI shows a clear warning when a profile action is blocked.
- Overview/detail show the active profile name when available.
- Tests cover allowed idle switch and blocked running switch.
