# AgentLoop Settings 106: CLI worker routing

## Execution status
- Status: pending
- Goal: route fix/review agents, models, max turns, retries, and worktree mode from Settings into AgentLoop run commands.
- Required gate: `agentLoopSettingsCliWorkerRouting106Gates`

## Context
The UI can save worker choices, but run command construction must prove those choices are respected for queue and single-script runs.

## Allowed files
- `agent-loop/vscode-extension/src/runController.ts`
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/phaseLabels.ts`
- `agent-loop/vscode-extension/src/stateReader.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not edit `agent-loop/scripts/migration-queue.json`.
- Do not add provider health checks here.
- Do not change task markdown.
- Do not package a VSIX.

## Acceptance criteria
- Run command args reflect configured fix agent, review agent, max turns, retries, and worktree scope.
- `reviewAgent: none` is handled intentionally in labels and args.
- Tests cover queue run and single run command construction.
- Invalid worker names fall back to schema defaults.
