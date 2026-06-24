# AgentLoop Settings 106: contract schema

## Execution status
- Status: pending
- Goal: extract a durable Settings Center schema so UI, extension host, runtime, import/export, and tests share one contract.
- Required gate: `agentLoopSettingsContractSchema106Gates`

## Context
The 105 wave proved that Settings Center changes are too broad when each task invents its own payload shape. This task creates the shared non-secret schema first, without adding provider checks, profiles, queue editing, or packaging behavior.

## Allowed files
- `agent-loop/vscode-extension/src/settingsConfig.ts`
- `agent-loop/vscode-extension/src/settingsMessages.ts`
- `agent-loop/vscode-extension/src/dashboard-react/types.ts`
- `agent-loop/vscode-extension/src/types.ts`
- `agent-loop/test/vscode-extension.test.js`
- This task file

## Do not
- Do not move SecretStorage handling into the schema file.
- Do not add new Settings UI sections in this task.
- Do not edit `agent-loop/scripts/migration-queue.json` from the worker.
- Do not package a VSIX.

## Acceptance criteria
- A typed schema lists every supported non-secret setting, default value, persistence target, and UI label.
- Unknown settings are rejected or ignored through one shared helper, not ad hoc object spreading.
- Tests cover default shape, unsupported-key rejection, and stable serialization.
- The schema does not include raw LLM key values.
