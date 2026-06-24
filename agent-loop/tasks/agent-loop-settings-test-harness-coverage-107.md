# AgentLoop Settings 107: test harness coverage

## Execution status
- Status: pending
- Goal: harden the VS Code shim and test helpers so Settings command tests can mock configuration, SecretStorage, workspace folders, and webview messages consistently.
- Required gate: `agentLoopSettingsTestHarnessCoverage107Gates`

## Context
Several Settings tasks need richer extension-host mocks. This task improves the harness rather than the product UI.

## Allowed files
- `agent-loop/test/vscode-extension.test.js`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- This task file

## Do not
- Do not make tests depend on a real VS Code install.
- Do not weaken existing redaction assertions.
- Do not add global mutable state that leaks between tests.

## Acceptance criteria
- Add tests named `vscode shim 107 isolates workspace config per test` and `vscode shim 107 mocks SecretStorage without leaking values`.
- Helpers can seed and inspect workspace config updates.
- Helpers can capture webview messages and command responses.
- Existing extension tests still pass as a full file.
