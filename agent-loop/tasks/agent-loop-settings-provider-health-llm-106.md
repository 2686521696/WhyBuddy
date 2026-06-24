# AgentLoop Settings 106: provider health LLM checks

## Execution status
- Status: pending
- Goal: add explicit, redacted LLM provider health checks for configured Grok, OpenAI, and Anthropic credentials.
- Required gate: `agentLoopSettingsProviderHealthLlm106Gates`

## Context
Provider checks should be user-triggered and safe. Automated tests must mock the transport and must not require real keys or network access.

## Allowed files
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/settingsMessages.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not call providers on page load.
- Do not print Authorization headers or raw key fragments.
- Do not add a dependency just for HTTP tests.
- Do not fail Settings save because a provider check fails.

## Acceptance criteria
- Settings UI has an explicit provider test action per provider.
- Results include provider, duration, status, and redacted reason.
- Missing key returns `skipped`, not `failed`.
- Tests use mocked fetch/transport and assert redaction.
