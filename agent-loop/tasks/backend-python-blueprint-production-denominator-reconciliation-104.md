# Backend Python 104: Blueprint production denominator reconciliation

## Execution status
- Status: pending
- Goal: reconcile the six Blueprint 104 takeover attempts into one code-backed denominator report.
- Required gate: `blueprintProductionDenominatorReconciliation104Gates`

## Context
After job store, event bus, ledger, replan, prompt package, and preview state are attempted, this task must summarize which Blueprint surfaces are truly `python-owned`, which are `node-retained`, and which are `out-of-scope`.

## Allowed files
- `tws-ai-slide-rule-python/services/blueprint_production_denominator_reconciliation.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_production_denominator_reconciliation_104.py`
- `server/routes/blueprint/production-denominator-reconciliation-python.ts`
- `server/routes/__tests__/blueprint.production-denominator-reconciliation-104.test.ts`
- Relevant 104 Blueprint service/test files
- This task file

## Do not
- Do not raise Blueprint to 100% unless the previous tasks prove every in-scope surface.
- Do not count status refresh or docs-only evidence.
- Do not erase retained surfaces; classify them.

## Acceptance criteria
- Reconciliation aggregates all six Blueprint 104 surfaces.
- Node and Python tests agree on counts for `pythonOwned`, `nodeRetained`, `externalOwned`, and `outOfScope`.
- `canClaimBlueprintProductionTakeover` is true only when there are no retained in-scope blockers.
- Review confirms the overall migration status can consume this evidence safely.
