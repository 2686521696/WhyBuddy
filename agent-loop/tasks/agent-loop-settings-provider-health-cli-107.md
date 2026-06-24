# AgentLoop Settings 107: provider health CLI probes

## Execution status
- Status: pending
- Goal: add local CLI health checks for Grok and Codex workers with timeout handling and redacted output.
- Required gate: `agentLoopSettingsProviderHealthCli107Gates`

## Context
LLM HTTP health checks are useful but do not prove local CLI availability. The Settings diagnostics page needs a separate CLI probe.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not invoke real Grok or Codex in tests.
- Do not include raw environment values in probe output.
- Do not block the UI indefinitely.

## Acceptance criteria
- Add tests named `provider health CLI 107 reports available worker command` and `provider health CLI 107 redacts command stderr`.
- Probe status supports `ok`, `failed`, `skipped`, and `timeout`.
- UI shows CLI probe results beside LLM provider checks.
- Dev preview uses mocked CLI probe responses.
