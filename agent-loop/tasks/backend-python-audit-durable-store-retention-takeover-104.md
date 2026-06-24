# Backend Python 104: Audit durable store and retention takeover

## Execution status
- Status: pending
- Goal: move a bounded audit durable store or retention/export slice into Python runtime, or formally retain/externalize audit storage.
- Required gate: `auditDurableStoreRetentionTakeover104Gates`

## Context
103 kept audit durable store and retention as `node-retained`, while external audit platform stayed `external-owned`. This task should close or classify that production compliance blocker.

## Allowed files
- `tws-ai-slide-rule-python/services/audit_durable_store_retention_takeover.py`
- `tws-ai-slide-rule-python/tests/test_audit_durable_store_retention_takeover_104.py`
- `server/audit/audit-store.ts`
- `server/audit/audit-retention.ts`
- `server/routes/audit.ts`
- `server/tests/audit-durable-store-retention-takeover-104.test.ts`
- `shared/audit/contracts.ts`
- This task file

## Do not
- Do not write real audit records outside tests.
- Do not remove existing retention/export safeguards.
- Do not count external platform readiness as Python takeover.

## Acceptance criteria
- Python service can classify/store/export one safe audit evidence slice or explicitly retain it.
- Node tests cover retention/export/fallback semantics.
- External-owned platform remains separate from Python migration.
- Review confirms compliance surfaces are not overstated.
