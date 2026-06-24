# AgentLoop Settings 107: CLI worker routing

## Execution status
- Status: pending
- Goal: route fix/review agents, models, turn budgets, and retry budgets from Settings into the actual queue runner invocation.
- Required gate: `agentLoopSettingsCliWorkerRouting107Gates`

## Context
The UI can edit CLI worker fields. This task ensures saved values change the next queue run rather than only changing labels.

## Allowed files
- `agent-loop/vscode-extension/src/runController.ts`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/phaseLabels.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not pass unsupported `--max-turns` flags to Codex if the existing CLI adapter rejects them.
- Do not mutate task files or queue task entries.
- Do not change SecretStorage behavior.

## Acceptance criteria
- Add tests named `CLI worker routing 107 forwards settings to run queue args` and `CLI worker routing 107 skips review args when reviewAgent none`.
- `fixAgent`, `reviewAgent`, models, max turns, and retries are visible in generated run args where supported.
- Existing queue-entry overrides still win over global settings.
- Tests cover `grok`, `codex`, and `none`.
