# Backend Python 104: Task production denominator reconciliation

## Execution status
- Status: pending
- Goal: reconcile durable store, project auth, scheduler, and event persistence into one Task lifecycle denominator report.
- Required gate: `taskProductionDenominatorReconciliation104Gates`

## Context
The Task lifecycle status must not depend on scattered task files. This task aggregates 104 evidence into a code-consumable decision.

## Allowed files
- `tws-ai-slide-rule-python/services/task_production_denominator_reconciliation.py`
- `tws-ai-slide-rule-python/tests/test_task_production_denominator_reconciliation_104.py`
- `server/tasks/mission-runtime.ts`
- `server/tests/task-production-denominator-reconciliation-104.test.ts`
- Relevant 104 Task services/tests
- This task file

## Do not
- Do not raise Task lifecycle to complete unless retained blockers are gone or excluded.
- Do not count docs-only or readiness-only evidence.
- Do not hide blocked surfaces.

## Acceptance criteria
- Reconciliation returns counts for `pythonOwned`, `nodeRetained`, `blocked`, and `outOfScope`.
- Node and Python tests agree on denominator math.
- Remaining blockers are named in a machine-readable list.
- Review can use the output to update migration status safely.
