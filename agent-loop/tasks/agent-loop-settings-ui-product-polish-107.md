# AgentLoop Settings 107: Settings UI product polish

## Execution status
- Status: pending
- Goal: make the Settings page feel like a coherent AntD product surface with stable spacing, tabs, forms, summaries, and empty states.
- Required gate: `agentLoopSettingsUiProductPolish107Gates`

## Context
The dashboard now has a stronger product shell. Settings needs the same finish: compact but readable, no nested card clutter, no duplicate padding.

## Allowed files
- `agent-loop/vscode-extension/src/dashboard-react/DashboardApp.tsx`
- `agent-loop/vscode-extension/src/dashboard-react/dashboard-react.css`
- `agent-loop/vscode-extension/src/dashboard-react/dev.tsx`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not introduce CDN assets.
- Do not target AntD internal class names in CSS.
- Do not rework the run detail Flow panel.

## Acceptance criteria
- Add tests named `Settings UI polish 107 uses AntD tabs descriptions and alerts` and `Settings UI polish 107 keeps content padding single-layer`.
- Use AntD Form, Tabs, Descriptions, Alert, Tag, Button, Table/List, and Empty where appropriate.
- No custom CSS selector targets `.ant-` or `.agent-ant-`.
- Text does not overflow common field containers.
