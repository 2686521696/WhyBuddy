# Backend Python 104: Blueprint job store runtime takeover

## Execution status
- Status: pending
- Goal: turn the 103 Blueprint job-state decision into a concrete Python-owned runtime slice where safe, or produce a system-readable retained/out-of-scope decision that removes the surface from fake migration accounting.
- Required gate: `blueprintJobStoreRuntimeTakeover104Gates`

## Context
103 classified Blueprint jobStore/eventBus/ledger/replan/promptPackage/previewState as mostly `node-retained`, with only a thin `jobStateSlice` as `python-owned`. This task must either make job store state read/write behavior demonstrably Python-owned for a small production-shaped slice, or prove with code/tests why the durable store stays retained.

## Allowed files
- `tws-ai-slide-rule-python/services/blueprint_job_store_runtime_takeover.py`
- `tws-ai-slide-rule-python/services/blueprint_job_store_scope_decision.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_job_store_runtime_takeover_104.py`
- `server/routes/blueprint/job-store-runtime-takeover-python.ts`
- `server/routes/blueprint/job-store-scope-decision-python.ts`
- `server/routes/blueprint/jobs/service.ts`
- `server/routes/__tests__/blueprint.job-store-runtime-takeover-104.test.ts`
- `shared/blueprint/jobs/types.ts`
- This task file

## Do not
- Do not rewrite the full Blueprint job system.
- Do not remove existing Node job store semantics.
- Do not mark durable Node storage as `python-owned` unless a test proves Python is now the source of truth for that slice.
- Do not count readiness-only, projection-only, or docs-only changes as takeover.

## Acceptance criteria
- Python returns a stable envelope with `surface`, `ownership`, `productionTakeover`, `migrationDenominator`, `evidence`, and `fallback`.
- Node bridge consumes the envelope and preserves Node fallback when takeover is false.
- Tests prove at least one job-state read/write slice is Python-owned, or prove the durable store is explicitly retained and excluded from migration numerator.
- Review confirms no `node-retained` surface is relabeled as migration complete.
