# AgentLoop Settings 107: schema and configuration surface

## Execution status
- Status: pending
- Goal: finish the public `agentLoop.*` setting schema so every Settings page field has a declared, validated workspace setting.
- Required gate: `agentLoopSettingsSchemaConfigSurface107Gates`

## Context
The 106 wave landed the core Settings page, but the schema surface still needs an audit pass for defaults, enums, descriptions, and unsupported value handling.

## Allowed files
- `agent-loop/vscode-extension/package.json`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not store raw secrets in workspace configuration.
- Do not change queue task entries.
- Do not change dashboard visual layout.

## Acceptance criteria
- Add tests named `settings schema 107 declares all non-secret setting keys` and `settings schema 107 rejects unsupported enum values`.
- Every non-secret field visible in Settings has a package schema entry or an explicit reason in tests.
- Unsupported enum values are normalized or rejected before save.
- Raw key fields remain SecretStorage-only.
