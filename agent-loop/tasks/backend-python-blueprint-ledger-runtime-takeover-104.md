# Backend Python 104: Blueprint ledger runtime takeover

## Execution status
- Status: pending
- Goal: add a Python-owned ledger/accounting/audit-trail slice for Blueprint jobs, or produce retained evidence for the ledger denominator.
- Required gate: `blueprintLedgerRuntimeTakeover104Gates`

## Context
Blueprint ledger remained `node-retained` after 103. This task should not chase the full ledger if it is too large; it should implement the smallest useful runtime proof or lock the surface as retained.

## Allowed files
- `tws-ai-slide-rule-python/services/blueprint_ledger_runtime_takeover.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_ledger_runtime_takeover_104.py`
- `server/routes/blueprint/ledger-runtime-takeover-python.ts`
- `server/routes/blueprint/jobs/service.ts`
- `server/routes/__tests__/blueprint.ledger-runtime-takeover-104.test.ts`
- `shared/blueprint/jobs/types.ts`
- This task file

## Do not
- Do not invent a fake ledger unrelated to existing Blueprint job state.
- Do not mark audit/accounting as complete without a persisted-or-replayable event trail.
- Do not widen into unrelated telemetry refactors.

## Acceptance criteria
- Python computes or validates a ledger entry from real job/event inputs.
- Node bridge test proves ledger evidence is consumed and fallback remains explicit.
- `productionTakeover` is true only for the proven slice.
- Migration denominator records any retained ledger responsibility.
