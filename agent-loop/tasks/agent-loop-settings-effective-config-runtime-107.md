# AgentLoop Settings 107: effective config runtime reader

## Execution status
- Status: pending
- Goal: make one effective-config reader drive overview, detail, diagnostics, and run-controller defaults.
- Required gate: `agentLoopSettingsEffectiveConfigRuntime107Gates`

## Context
106 added `settingsConfig.ts`, but several consumers can still drift if they read defaults directly. This task closes that drift.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/paths.ts`
- `agent-loop/vscode-extension/src/stateReader.ts`
- `agent-loop/vscode-extension/src/phaseLabels.ts`
- `agent-loop/vscode-extension/src/runController.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not expose raw secret values.
- Do not make network calls.
- Do not edit React UI except for labels fed by config.

## Acceptance criteria
- Add tests named `effective config 107 merges package defaults workspace values and profile overrides` and `effective config 107 reviewAgent none removes reviewer labels`.
- Overview and detail agent labels use the same reader.
- Diagnostics shows the same effective config used by run execution.
- `reviewAgent: none` is represented consistently.
