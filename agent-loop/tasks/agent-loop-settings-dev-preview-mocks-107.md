# AgentLoop Settings 107: dev preview mocks

## Execution status
- Status: pending
- Goal: make `npm run dev:dashboard` exercise Settings profiles, provider checks, diagnostics, import/export, and queue defaults without VS Code.
- Required gate: `agentLoopSettingsDevPreviewMocks107Gates`

## Context
The user edits styling in the browser. The preview must cover Settings behavior without requiring the extension host.

## Allowed files
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not require real network calls.
- Do not store mock keys in local files.
- Do not change production message contracts only for dev.

## Acceptance criteria
- Add tests named `dev preview mocks 107 covers settings commands` and `dev preview mocks 107 never stores raw keys`.
- Browser preview can switch to Settings and exercise save, health, import/export, diagnostics, and queue defaults.
- Mock responses include success and failure examples.
- Dev toolbar documents the mocked mode in one concise line.
