# AgentLoop Settings 106: worker env injection

## Execution status
- Status: pending
- Goal: safely inject configured LLM keys and provider base URLs into worker processes only when requested.
- Required gate: `agentLoopSettingsWorkerEnvInjection106Gates`

## Context
The Settings Center has a switch for injecting keys into AgentLoop workers. This task makes that behavior explicit, redacted, and testable without invoking real CLIs.

## Allowed files
- `agent-loop/vscode-extension/src/runController.ts`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/settingsMessages.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not log environment values.
- Do not inject keys when `injectKeysToWorker` is false.
- Do not require real SecretStorage in unit tests.
- Do not change dashboard visuals.

## Acceptance criteria
- Worker env construction is a small exported helper with mocked SecretStorage tests.
- Grok, OpenAI, Anthropic, and base URL variables are mapped explicitly.
- Empty secrets are omitted.
- Tests assert no raw key appears in diagnostics or serialized logs.
