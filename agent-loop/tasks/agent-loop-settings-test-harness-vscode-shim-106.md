# AgentLoop Settings 106: VS Code test harness shim

## Execution status
- Status: pending
- Goal: repair Node unit tests that import compiled extension modules requiring `vscode`.
- Required gate: `agentLoopSettingsTestHarnessVscodeShim106Gates`

## Context
The 105 queue exposed a baseline issue: broad extension tests fail with `Cannot find module 'vscode'` when modules import VS Code APIs directly. This task creates a reusable test shim and keeps feature work out of scope.

## Allowed files
- `agent-loop/test/vscode-extension.test.js`
- `agent-loop/vscode-extension/src/paths.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/runController.ts`
- This task file

## Do not
- Do not delete existing tests to make the suite green.
- Do not add real VS Code runtime dependencies to Node tests.
- Do not add Settings UI features in this task.
- Do not package a VSIX.

## Acceptance criteria
- Tests can require compiled Settings-related modules with a mocked `vscode` module.
- `getAgentLoopConfig` defaults are testable without launching VS Code.
- Existing active-log and dashboard tests keep passing with the shim installed.
- The full `agent-loop/test/vscode-extension.test.js` failure set no longer includes `Cannot find module 'vscode'`.
