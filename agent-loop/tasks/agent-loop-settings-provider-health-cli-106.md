# AgentLoop Settings 106: provider health CLI checks

## Execution status
- Status: pending
- Goal: add explicit, bounded CLI binary checks for Grok, Codex, and local AgentLoop commands.
- Required gate: `agentLoopSettingsProviderHealthCli106Gates`

## Context
Users need to know whether worker CLIs are reachable before starting long queues. CLI checks should not call provider APIs and should be safe in offline development.

## Allowed files
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/runController.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not run checks automatically on Settings page load.
- Do not require real Grok or Codex binaries in automated tests.
- Do not include raw environment values in output.
- Do not block saving settings when a CLI check fails.

## Acceptance criteria
- Settings UI has an explicit CLI test action.
- Extension returns `ready`, `skipped`, `failed`, or `timeout`.
- CLI checks use bounded timeouts and redacted stderr/stdout snippets.
- Tests cover success, missing binary, timeout, and redaction.
