# AgentLoop Settings 106: release readiness

## Execution status
- Status: pending
- Goal: verify the Settings Center is shippable in the compiled extension and packaged VSIX.
- Required gate: `agentLoopSettingsReleaseReadiness106Gates`

## Context
AgentLoop dashboard work is only useful if the VSIX includes the compiled extension host code, React bundle, and no secret/debug artifacts. This task is the final release gate for the 106 Settings wave.

## Allowed files
- `agent-loop/vscode-extension/package.json`
- `agent-loop/vscode-extension/package-lock.json`
- `agent-loop/vscode-extension/out/**`
- `agent-loop/vscode-extension/media/**`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not stage old unrelated VSIX files.
- Do not leave `tsc-errors.txt`, logs, `.agent-loop`, or runtime artifacts.
- Do not include raw sample keys in packaged output.
- Do not change Settings behavior in this task.

## Acceptance criteria
- `npm run compile`, `npm run build:dashboard`, and `npm run package` pass.
- Packaged VSIX includes Settings-related compiled modules and dashboard bundle.
- Packaged VSIX does not include runtime logs, task run state, or raw sample keys.
- Tests document the package self-containment expectations.
