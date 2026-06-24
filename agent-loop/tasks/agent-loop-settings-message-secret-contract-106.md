# AgentLoop Settings 106: message and secret contract

## Execution status
- Status: pending
- Goal: complete the save/get message contract for no-change, update, single-key clear, clear-all, and log redaction semantics.
- Required gate: `agentLoopSettingsMessageSecretContract106Gates`

## Context
A minimal safety patch introduced `settingsMessages.ts`. This task finishes the remaining contract so future Settings UI additions cannot accidentally leak keys or mis-handle empty fields.

## Allowed files
- `agent-loop/vscode-extension/src/settingsMessages.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not send raw keys to the webview.
- Do not write raw keys to workspace settings, queue JSON, logs, or `.agent-loop`.
- Do not make provider network calls.
- Do not change the visual Settings layout.

## Acceptance criteria
- Save payload normalization distinguishes absent, empty string, and non-empty string for each key.
- Clear-all uses the same redaction path as single-key clear.
- Dev preview never stores raw sample key values.
- Tests assert serialized webview payloads and preview logs do not contain sample key values.
