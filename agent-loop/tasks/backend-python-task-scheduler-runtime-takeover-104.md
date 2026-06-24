# Backend Python 104: Task scheduler runtime takeover

## Execution status
- Status: pending
- Goal: implement a Python-owned scheduler/cancel/retry decision slice, or formally retain scheduler ownership.
- Required gate: `taskSchedulerRuntimeTakeover104Gates`

## Context
103 left scheduler boundaries as `node-retained`. This task should move one scheduler decision into Python runtime with tests for cancel/retry/replay interactions.

## Allowed files
- `tws-ai-slide-rule-python/services/task_scheduler_runtime_takeover.py`
- `tws-ai-slide-rule-python/tests/test_task_scheduler_runtime_takeover_104.py`
- `server/tasks/mission-runtime.ts`
- `server/routes/tasks.ts`
- `server/tests/task-scheduler-runtime-takeover-104.test.ts`
- `server/tests/mission-cancel.test.ts`
- This task file

## Do not
- Do not rewrite the scheduler.
- Do not change existing cancel semantics without tests.
- Do not count diagnostics as scheduler takeover.

## Acceptance criteria
- Python computes a scheduler decision for a realistic mission state.
- Node test proves cancel/retry/replay behavior remains safe.
- Retained scheduler responsibilities are named.
- Denominator evidence distinguishes decision slice from full scheduler ownership.
