# AgentLoop Settings 107: profile CRUD UI

## Execution status
- Status: pending
- Goal: let users create, rename, duplicate, delete, and select non-secret Settings profiles from the AntD Settings page.
- Required gate: `agentLoopSettingsProfileCrudUi107Gates`

## Context
The Settings page needs product-grade profile management rather than a single global form.

## Allowed files
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dashboard-react.css`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/vscode-extension/src/dashboardPanel.ts`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not allow deleting the final remaining profile.
- Do not allow active profile switching while a run is active without an explicit guard.
- Do not include raw keys in profile forms.

## Acceptance criteria
- Add tests named `profile CRUD UI 107 renders profile actions` and `profile CRUD UI 107 blocks invalid profile names`.
- UI uses AntD List/Table, Tag, Button, Modal/Form, and Select.
- Create, rename, duplicate, delete, and select commands round-trip through dashboard messages.
- Dev preview mocks all profile commands.
