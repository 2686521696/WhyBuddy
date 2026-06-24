# Backend Python 104: Blueprint replan runtime takeover

## Execution status
- Status: pending
- Goal: move a bounded Blueprint replan decision/branch validation path into Python runtime, or explicitly retain Node replan ownership.
- Required gate: `blueprintReplanRuntimeTakeover104Gates`

## Context
103 marked Blueprint `replan` as `node-retained`. This task should prove a Python-owned replan slice if feasible: branch validation, downstream invalidation, or conflict classification.

## Allowed files
- `tws-ai-slide-rule-python/services/blueprint_replan_runtime_takeover.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_replan_runtime_takeover_104.py`
- `server/routes/blueprint/replan-runtime-takeover-python.ts`
- `server/routes/blueprint/replan/*`
- `server/routes/__tests__/blueprint.replan-runtime-takeover-104.test.ts`
- This task file

## Do not
- Do not rewrite the whole replan route.
- Do not remove existing 409/conflict behavior.
- Do not treat a static readiness response as runtime takeover.

## Acceptance criteria
- Python service returns deterministic branch/replan classification for a realistic input.
- Node route or helper test proves the Python decision is used for the bounded slice.
- Existing Node fallback and conflict handling stay intact.
- Review confirms retained replan surfaces are still named.
