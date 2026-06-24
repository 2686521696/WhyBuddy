# AgentLoop Settings 106: runtime config reader

## Execution status
- Status: pending
- Goal: centralize effective AgentLoop configuration resolution for overview, detail, run controller, and diagnostics.
- Required gate: `agentLoopSettingsRuntimeConfigReader106Gates`

## Context
Settings values are currently read in more than one place. This task introduces a single effective-config reader that applies defaults, workspace values, and redacted key status consistently.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/paths.ts`
- `agent-loop/vscode-extension/src/stateReader.ts`
- `agent-loop/vscode-extension/src/phaseLabels.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not add queue defaults editing.
- Do not make network calls.
- Do not change run execution behavior beyond reading the same config fields from the central helper.
- Do not expose raw secret values.

## Acceptance criteria
- One helper returns the effective non-secret config and redacted key statuses.
- Overview/detail agent labels use the same config reader.
- Tests cover defaults, workspace overrides, and `reviewAgent: none`.
- No test needs real VS Code settings storage.
