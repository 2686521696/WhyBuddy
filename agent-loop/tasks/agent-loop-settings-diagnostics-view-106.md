# AgentLoop Settings 106: diagnostics view

## Execution status
- Status: pending
- Goal: add a Diagnostics tab that shows effective config, provider readiness, paths, and queue/runtime warnings without leaking secrets.
- Required gate: `agentLoopSettingsDiagnosticsView106Gates`

## Context
When AgentLoop feels flaky, users need one place to inspect config, proxy, CLI, active profile, queue path, and recent errors. This task surfaces that data read-only.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/stateReader.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not run network checks automatically.
- Do not show raw env values that look like secrets.
- Do not mutate settings from the Diagnostics view.
- Do not package a VSIX.

## Acceptance criteria
- Diagnostics view lists effective config, config source, key status, queue path, repo root, and last run state.
- Warnings are categorized as `ready`, `skipped`, `failed`, or `unknown`.
- All displayed data passes the shared redaction helper.
- Tests cover diagnostic payload shape and redaction.
