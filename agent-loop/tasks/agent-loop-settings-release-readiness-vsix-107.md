# AgentLoop Settings 107: release readiness and VSIX

## Execution status
- Status: pending
- Goal: verify the Settings center is release-ready and package a self-contained VSIX with compiled outputs and no temporary artifacts.
- Required gate: `agentLoopSettingsReleaseReadinessVsix107Gates`

## Context
The extension ships compiled `out/*`, bundled React media, and versioned VSIX files. Release readiness must prove all pieces match source.

## Allowed files
- `agent-loop/vscode-extension/package.json`
- `agent-loop/vscode-extension/media/dashboard.bundle.css`
- `agent-loop/vscode-extension/media/dashboard.bundle.js`
- `agent-loop/vscode-extension/out/**`
- `agent-loop/vscode-extension/*.vsix`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not stage stale VSIX versions unrelated to the current package version.
- Do not leave temporary logs or `tsc-errors.txt`.
- Do not skip package contents verification.

## Acceptance criteria
- Add tests named `release readiness 107 package version matches latest vsix` and `release readiness 107 vsix includes settingsConfig and dashboard bundle`.
- `npm run compile`, `npm run build:dashboard`, `npm run package`, and full extension tests pass.
- The packaged VSIX includes `out/settingsConfig.js`, `media/dashboard.bundle.js`, and `media/dashboard.bundle.css`.
- No runtime `.agent-loop`, `.worktrees`, or local logs are staged.
