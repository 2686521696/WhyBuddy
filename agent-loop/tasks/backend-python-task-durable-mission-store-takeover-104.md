# Backend Python 104: Task durable mission store takeover

## Execution status
- Status: pending
- Goal: move a bounded durable mission store read/write slice into Python runtime, or formally retain the store with denominator evidence.
- Required gate: `taskDurableMissionStoreTakeover104Gates`

## Context
103 kept durable mission store as `node-retained`. This task should prove whether Python can own a minimal durable mission state operation without breaking Node routes.

## Allowed files
- `tws-ai-slide-rule-python/services/task_durable_mission_store_takeover.py`
- `tws-ai-slide-rule-python/tests/test_task_durable_mission_store_takeover_104.py`
- `server/tasks/mission-store.ts`
- `server/tasks/mission-runtime.ts`
- `server/tests/task-durable-mission-store-takeover-104.test.ts`
- `shared/mission/contracts.ts`
- This task file

## Do not
- Do not replace the full mission store.
- Do not count replay-only or projection-only behavior as durable store ownership.
- Do not weaken existing auth checks.

## Acceptance criteria
- Python service can classify and execute one deterministic mission-store operation.
- Node tests prove existing create/read/cancel semantics remain intact.
- Takeover flag is true only for the proven slice.
- Retained store responsibilities are explicit.
