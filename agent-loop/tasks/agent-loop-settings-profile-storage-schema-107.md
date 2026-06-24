# AgentLoop Settings 107: profile storage schema

## Execution status
- Status: pending
- Goal: define the non-secret profile schema, defaults, validation, and migration behavior.
- Required gate: `agentLoopSettingsProfileStorageSchema107Gates`

## Context
Profiles need a stable schema before CRUD UI lands. They must never contain raw secrets.

## Allowed files
- `agent-loop/vscode-extension/package.json`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not duplicate SecretStorage values into profiles.
- Do not write project-local config files.
- Do not build the full UI in this task.

## Acceptance criteria
- Add tests named `profile storage 107 validates non-secret profile schema` and `profile storage 107 rejects secret-looking profile values`.
- Profiles support local, proxy, CI, and production-like presets.
- Active profile key has a fallback when missing.
- Malformed stored profiles are ignored with a redacted warning.
