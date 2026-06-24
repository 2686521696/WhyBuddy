# AgentLoop Settings 107: security redaction audit

## Execution status
- Status: pending
- Goal: audit every Settings command response, diagnostics artifact, provider result, queue defaults preview, and export payload for secret leakage.
- Required gate: `agentLoopSettingsSecurityRedactionAudit107Gates`

## Context
Settings touches credentials. Redaction must be tested across successful and failing paths.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/runController.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not loosen existing secret tests.
- Do not whitelist realistic-looking fake keys unless the assertion proves they are redacted.
- Do not print raw errors from provider transports.

## Acceptance criteria
- Add tests named `security redaction audit 107 redacts command responses` and `security redaction audit 107 redacts failed provider errors`.
- Shared redaction covers `sk-`, bearer tokens, auth headers, x-api-key, and private key blocks.
- Dashboard messages never include raw SecretStorage values.
- Run state and diagnostics never serialize injected worker env secrets.
