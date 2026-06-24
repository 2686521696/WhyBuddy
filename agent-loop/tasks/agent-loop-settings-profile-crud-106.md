# AgentLoop Settings 106: profile CRUD

## Execution status
- Status: pending
- Goal: add named non-secret Settings profiles for local, proxy, CI, and production-like AgentLoop runs.
- Required gate: `agentLoopSettingsProfileCrud106Gates`

## Context
Different AgentLoop runs use different worker, proxy, timeout, and queue defaults. Profiles must persist non-secret values only and share or clearly label secret status.

## Allowed files
- `agent-loop/vscode-extension/package.json`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not duplicate raw secrets into profile JSON.
- Do not silently switch profile while a run is active.
- Do not create files outside VS Code workspace configuration.
- Do not edit queue task entries.

## Acceptance criteria
- UI can create, rename, delete, and select profiles.
- Active profile persists in workspace settings.
- Profile payloads contain non-secret fields only.
- Tests cover create, rename, delete, select, and malformed profile rejection.
