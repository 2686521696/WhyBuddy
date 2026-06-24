# AgentLoop Settings 107: import/export files

## Execution status
- Status: pending
- Goal: support redacted Settings import/export through file-like dashboard commands, not only prompt text.
- Required gate: `agentLoopSettingsImportExportFiles107Gates`

## Context
Operators need repeatable sharing of non-secret settings. Export must remain redacted and import must reject secret-looking values.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not export raw keys.
- Do not import raw keys into SecretStorage.
- Do not require native file dialogs in unit tests.

## Acceptance criteria
- Add tests named `settings import export files 107 downloads redacted payload` and `settings import export files 107 rejects raw secret fields`.
- UI provides copy/download/import controls using AntD Upload or Button.
- Export includes schemaVersion, active profile, non-secret settings, and key status only.
- Import validates schema and returns structured errors.
