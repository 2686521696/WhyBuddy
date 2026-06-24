# AgentLoop Settings 107: runner task generation audit

## Execution status
- Status: pending
- Goal: ensure future Settings task waves can be generated, enabled, disabled, and validated without manual queue drift.
- Required gate: `agentLoopSettingsRunnerTaskGeneration107Gates`

## Context
Settings waves 105 and 106 revealed queue drift and tasks with gates that were too broad. This task adds guardrails for task generation itself.

## Allowed files
- `agent-loop/scripts/migration-queue.json`
- `agent-loop/test/run-queue.test.js`
- `agent-loop/tasks/agent-loop-settings-runner-task-generation-107.md`
- This task file

## Do not
- Do not edit product runtime code.
- Do not enable old settings waves together with 107.
- Do not create a gate that can pass before the task-specific marker exists.

## Acceptance criteria
- Add a test named `migration queue 107 settings wave has task specific red gates`.
- All enabled 107 Settings tasks have existing task files and gate keys.
- 100-106 Settings tasks are disabled while 107 is active.
- Each 107 gate contains a task-specific marker check plus mojibake check.
