# AgentLoop Settings 106: import/export redaction

## Execution status
- Status: pending
- Goal: add redacted Settings import/export so users can share non-secret configuration safely.
- Required gate: `agentLoopSettingsImportExportRedaction106Gates`

## Context
Settings export should help move profiles and non-secret defaults between workspaces. It must not expose raw keys or misleadingly claim secrets were exported.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/settingsMessages.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not export raw SecretStorage values.
- Do not import raw keys through the non-secret import path.
- Do not write files automatically without user command.
- Do not add external dependencies.

## Acceptance criteria
- Export contains schema version, profiles, non-secret settings, and key status only.
- Import validates schema version and rejects unknown secret-looking keys.
- UI shows clear redacted labels for secret fields.
- Tests cover export redaction, import validation, and malformed JSON handling.
