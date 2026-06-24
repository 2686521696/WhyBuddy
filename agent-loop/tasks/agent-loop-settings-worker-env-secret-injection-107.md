# AgentLoop Settings 107: worker env secret injection

## Execution status
- Status: pending
- Goal: inject configured LLM keys and base URLs into worker processes without leaking them into state, logs, diagnostics, or exports.
- Required gate: `agentLoopSettingsWorkerEnvSecretInjection107Gates`

## Context
Settings can store keys in SecretStorage. Run execution must pass them only to the child process environment and redact all observability surfaces.

## Allowed files
- `agent-loop/vscode-extension/src/runController.ts`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not write keys to queue JSON, state JSON, reports, or exported settings.
- Do not log key values, even in failed health checks.
- Do not require real provider credentials in tests.

## Acceptance criteria
- Add tests named `worker env 107 injects enabled secret keys into runQueue spawn` and `worker env 107 never serializes injected secrets`.
- `injectKeysToWorker: false` prevents all key injection.
- Base URL aliases are injected only when configured.
- Tests use fake SecretStorage and mocked spawn env capture.
