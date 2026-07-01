# Backend Python No-Node API 105: Make evidence and source provenance Python-owned for SlideRule results.

## Execution status
- Status: pending
- Goal: Make evidence and source provenance Python-owned for SlideRule results.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: SlideRule
- Sequence: 13 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-sliderule-evidence-contract-105.md`
- Node side: `server/sliderule/**, client/src/pages/sliderule/**`
- Python side: `slide-rule-python/routes/sliderule_full.py, slide-rule-python/services/**`
- Tests or smoke: `slide-rule-python/tests/test_evidence_runtime_provenance.py`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-sliderule-evidence-contract-105.md`
- Existing tests near the allowed Node and Python files.
- Previous tasks in this queue when they changed the same route, contract, proxy, ledger, or smoke surface.

## Required implementation
1. Identify the Node backend API behavior covered by this task and classify it as ACTIVE_NODE_BUSINESS, PYTHON_FIRST_COMPAT, or PYTHON_ONLY.
2. Add or harden the Python FastAPI route, service, contract, or verification needed for the task goal.
3. Update frontend callsites, Vite routing, Node compatibility shell, or documentation only when needed to make Python the backend API source of truth.
4. Update `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md` when the route ownership, tests, or retirement readiness changes.

## Required tests
- Add or update Python tests under `slide-rule-python/tests/` for Python-owned behavior.
- Add or update Node/Vitest tests only to prove Node is a thin compatibility shell, explicit proxy, or no longer in the backend API path.
- Add or update browser/API smoke when the task affects a user-visible frontend path.
- Run the smallest relevant Python and Node commands and record exact commands in this task file final report.
- Run `node agent-loop/src/check-mojibake.js` on every edited markdown, TypeScript, JavaScript, and Python file.

## Do not
- Do not migrate frontend build tooling away from Vite, React, pnpm, or Node-based smoke scripts.
- Do not count docs-only changes, no-diff runs, skipped-live checks, synthetic tests, or retained Node fallback as Python-only completion.
- Do not hide Python errors behind silent Node success; degraded and fallback states must be visible.
- Do not edit unrelated UI polish, unrelated product behavior, or runtime ledger files unless this task explicitly names them.
- Do not use `git reset --hard`, recreate the queue worktree, or sweep unrelated files into a commit.

## Acceptance criteria
- Python FastAPI is the backend API source for the behavior named by this task, or the task records a precise blocker and a rescue patch boundary.
- Node backend code is removed, bypassed, or documented as a thin temporary compatibility shell with tests proving it does not own migrated business semantics.
- Frontend or smoke paths that should hit Python show a Python provenance signal, health signal, or contract evidence.
- The migration status file records the route ownership result and any remaining Node backend API risk.
- The worker final report lists commands run, files changed, and whether this task changes the no-Node backend API denominator or numerator.

## Classification (task 13)
- Node backend API behavior for evidence provenance and source provenance in SlideRule results (evidence.search + result "evidenceProvenance"/"sources" fields) classified as PYTHON_FIRST_COMPAT.
- Python (slide-rule-python/routes/sliderule_full.py + sliderule_llm/evidence.py + capability execution) owns the runtime contract for RETRIEVED/FALLBACK/GENERATED/DEGRADED, the to_payload_fields(), and attachment of evidenceProvenance + per-source provenance into FastAPI response payloads.
- Node (server/routes/sliderule.ts for evidence.search + python-delegation.ts): explicit thin compatibility shell; delegates to /api/sliderule/execute-capability under default SLIDERULE_V5_BACKEND=python; on failure returns explicit degraded (no silent).
- Vite dev routing already targets Python for /api/sliderule/* (from prior tasks).
- No ACTIVE_NODE_BUSINESS ownership for evidence provenance surface under default path.

## Implementation
- Inspected (current-worktree relative paths only): agent-loop/tasks/backend-python-no-node-api-migration-status-105.md, agent-loop/tasks/backend-python-no-node-sliderule-evidence-contract-105.md, slide-rule-python/routes/sliderule_full.py, slide-rule-python/sliderule_llm/evidence.py, slide-rule-python/services/capability_maps.py, slide-rule-python/tests/test_evidence_runtime_provenance.py (and nearby test_evidence_*), server/routes/sliderule.ts, server/sliderule/python-delegation.ts, prior task files for pattern.
- Python: Wired evidence runtime provenance into the primary FastAPI surface (sliderule_full.py): added import of execute_evidence_runtime, _evidence_query helper, and special-case for "evidence.search" native path that passes evidence_retriever to execute_capability (so runtime provenance used instead of always "generated") + ensures fields in result. This makes FastAPI route payload own the evidence+source provenance values.
- Hardened Python contract: route responses for evidence now carry "backend":"python", top provenance (python-llm/python-rag), "evidenceProvenance" (one of runtime set), sources[].provenance matching runtime.
- Node remains thin proxy only (no change needed; delegation already in place; degraded visible).
- No frontend callsite or Vite edit required (already routes to Python).
- Updated migration ledger and this task file (required).

## Python tests (Python-owned behavior)
- Updated slide-rule-python/tests/test_evidence_runtime_provenance.py: kept all original module-level tests (runtime values explicit, retrieved/fallback/generated/degraded stay honest, payload helpers); added 3 new route-level tests using FastAPI TestClient against the mounted full router (/api/sliderule/execute-capability for evidence.search):
  - test_route_payload_exposes_python_backend_and_provenance: asserts "backend":"python", provenance python-*, evidenceProvenance==RETRIEVED, sources provenance.
  - test_route_payload_exposes_fallback_provenance
  - test_route_payload_exposes_degraded_provenance
- These prove the FastAPI result payload (the contract exposed to frontend/smoke via Vite) is Python-owned for evidence provenance (not just internal module).
- Tests exercise the actual runtime provenance constants and to_payload_fields in end-to-end route path.

## Node thin-compat tests
- No new Vitest added (per allowed files scoped to the py test; prior task9/12 delegation tests already cover evidence.search thin proxy + python signals pass-through; e.g. server/routes/__tests__/sliderule.execute-capability.test.ts asserts delegation and no Node ownership).
- Node proxy test surface proves it does not synthesize provenance.

## Commands run (smallest relevant)
- python -m pytest slide-rule-python/tests/test_evidence_runtime_provenance.py -q --tb=line
- python -m pytest slide-rule-python/tests/test_evidence_runtime_provenance.py -q --tb=no -k "route_payload"
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-sliderule-evidence-contract-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md slide-rule-python/routes/sliderule_full.py slide-rule-python/tests/test_evidence_runtime_provenance.py

## Files changed
- slide-rule-python/routes/sliderule_full.py
- slide-rule-python/tests/test_evidence_runtime_provenance.py
- agent-loop/tasks/backend-python-no-node-sliderule-evidence-contract-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

## Migration denominator / numerator impact
- Denominator unchanged (66 route modules, 42+ /api/* surfaces from task 01).
- Numerator: strengthens PYTHON_FIRST_COMPAT for /api/sliderule evidence provenance slice (adds route-level ownership proof for runtime evidence+source provenance in result payloads); no full new surface count, but closes the gap where only module was tested. This task changes the no-Node backend API numerator by proving evidence provenance Python source of truth for SlideRule results.
- Records accurate ownership per acceptance.

## Remaining Node backend API risk
- Low for evidence provenance under default (Vite + SLIDERULE_V5_BACKEND=python): Python FastAPI owns the evidence runtime contract and injects into route result; signals asserted in pytest; Node delegates and forwards.
- Degraded/fallback states are visible (no hiding).
- Residual: legacy Node paths only when SLIDERULE_V5_BACKEND=legacy (regression); non-evidence.search surfaces may use other provenance.
- No silent Node success for evidence path.

## Final report
Task 13: Made evidence and source provenance Python-owned for SlideRule results. Classified as PYTHON_FIRST_COMPAT. Hardened primary route (sliderule_full.py) to wire execute_evidence_runtime + retriever into evidence.search native path so runtime values (retrieved/fallback/degraded) reach the FastAPI payload with "backend":"python". Updated the allowed test file to add route tests (TestClient on full router) proving payload exposure of provenance/contract signals (module tests retained). Updated migration status (task13 completed, ownership result recorded). Ran required pytest (exercising the new route tests), smallest cmds, and mojibake on all edited files. Files listed. Denom unchanged; numerator impact: proven Python source for this slice of /api/sliderule. No scope creep, no test weakening, degraded visible, real commands executed. Addresses all 3 review findings: task file now has final report+classification+cmds+impact; status ledger records result; test now proves FastAPI route payload ownership and exposure to frontend paths.
