# AgentLoop Settings 107: workspace trust and path safety

## Execution status
- Status: pending
- Goal: validate queue paths, import paths, and diagnostic paths so Settings commands stay inside the workspace unless explicitly allowed.
- Required gate: `agentLoopSettingsWorkspaceTrust107Gates`

## Context
Settings can read queue files and import/export JSON. Path handling needs explicit boundaries, especially on Windows.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/paths.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not allow arbitrary absolute writes from dashboard messages.
- Do not break existing relative queue path defaults.
- Do not rely on string prefix checks when `path.resolve` is available.

## Acceptance criteria
- Add tests named `workspace trust 107 rejects queue paths outside workspace` and `workspace trust 107 accepts normalized relative queue paths`.
- Queue defaults preview/apply resolves relative paths from workspace root.
- Diagnostics reports rejected paths with redacted errors.
- Windows drive-letter and `..` traversal cases are covered.
