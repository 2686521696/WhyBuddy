# Backend Python 104: Task event persistence takeover

## Execution status
- Status: pending
- Goal: add Python-owned task event append/replay persistence for a bounded slice, or explicitly retain event persistence.
- Required gate: `taskEventPersistenceTakeover104Gates`

## Context
Task event append persistence remained a blocker after 103. This task should prove a durable-ish event boundary, not just in-memory replay.

## Allowed files
- `tws-ai-slide-rule-python/services/task_event_persistence_takeover.py`
- `tws-ai-slide-rule-python/tests/test_task_event_persistence_takeover_104.py`
- `server/tasks/mission-store.ts`
- `server/tasks/mission-projection.ts`
- `server/tests/task-event-persistence-takeover-104.test.ts`
- `shared/mission/projection.ts`
- This task file

## Do not
- Do not call an in-memory projection durable persistence.
- Do not remove Node event append behavior.
- Do not widen into unrelated task UI state.

## Acceptance criteria
- Python service records or validates append/replay evidence for one event slice.
- Node tests prove append/replay contract and fallback.
- Envelope separates durable, projection, and retained surfaces.
- Review confirms task lifecycle progress is not overstated.
