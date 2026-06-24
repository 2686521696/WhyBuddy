# AgentLoop Settings 107: operator runbook

## Execution status
- Status: pending
- Goal: document how to configure CLI workers, LLM keys, profiles, queue defaults, diagnostics, and safe export/import.
- Required gate: `agentLoopSettingsDocsOperatorRunbook107Gates`

## Context
Settings is becoming an operator surface. A short repo-local runbook prevents confusion around SecretStorage and queue defaults.

## Allowed files
- `agent-loop/vscode-extension/README.md`
- `agent-loop/tasks/agent-loop-settings-docs-operator-runbook-107.md`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not include real keys or provider-specific private URLs.
- Do not create marketing copy.
- Do not change runtime behavior.

## Acceptance criteria
- Add a test named `settings docs 107 documents SecretStorage and queue defaults`.
- README explains non-secret workspace settings vs SecretStorage keys.
- README explains provider health checks, CLI checks, and diagnostics export.
- README explains how queue defaults preview/apply protects task arrays and secrets.
