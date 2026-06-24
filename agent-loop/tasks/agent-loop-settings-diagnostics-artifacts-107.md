# AgentLoop Settings 107: diagnostics artifacts

## Execution status
- Status: pending
- Goal: make the Diagnostics tab produce a redacted, copyable artifact covering effective config, provider health, queue defaults, and last run state.
- Required gate: `agentLoopSettingsDiagnosticsArtifacts107Gates`

## Context
The diagnostics view should help debug "why did this run use this worker/proxy/key status" without exposing secrets.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not include raw key values, bearer headers, or full workerEnv.
- Do not read large run logs into diagnostics.
- Do not mutate settings.

## Acceptance criteria
- Add tests named `settings diagnostics artifacts 107 redacts all secret surfaces` and `settings diagnostics artifacts 107 includes queue and run context`.
- UI includes Copy JSON and Refresh buttons.
- Artifact contains generatedAt, effective config, key status, queue path, provider health, and last run status.
- Redaction helper is shared with import/export.
