# Backend Python No-Node API 105: Map every /api/sliderule frontend call to its Python target route and tests.

## Execution status
- Status: completed (4 primary paths fully mapped to Python routes+tests; /respond explicitly documented as BLOCKED client-fallback with rescue boundary)
- Goal: Map every /api/sliderule frontend call to its Python target route and tests.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: SlideRule
- Sequence: 10 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-sliderule-route-map-105.md`
- Node side: `server/routes/sliderule.ts, client/src/pages/sliderule/**, scripts/sliderule-browser-smoke.mjs`
- Python side: `slide-rule-python/routes/sliderule_full.py`
- Tests or smoke: `docs/backend-python-no-node-api-contracts.md`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-sliderule-route-map-105.md`
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

## Pre-edit diagnosis
- failureKind: review_needs_changes
- rootCause: prior run's mapping table showed /respond (sliderule-narrator.ts) as no-Python-route but status claimed "4 primary + respond fallback proven PYTHON_FIRST_COMPAT via Python" (contradiction); no precise blocker/rescue patch boundary recorded per acceptance criteria for "every /api/sliderule frontend call".
- editNeeded: true
- intendedFiles: ["agent-loop/tasks/backend-python-no-node-sliderule-route-map-105.md", "agent-loop/tasks/backend-python-no-node-api-migration-status-105.md", "docs/backend-python-no-node-api-contracts.md"]
- gatesToRun: ["node agent-loop/src/check-mojibake.js on the three edited .md files", "python -m pytest slide-rule-python/tests/test_orchestrate_plan_contract.py -q --tb=no", "npx vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts --reporter=basic"]

## Route ownership classification (this task)
- The behavior "every /api/sliderule frontend call" is classified PYTHON_FIRST_COMPAT for the 4 primary V5 paths (health, orchestrate-plan, execute-capability, sessions); respond path is BLOCKED (explicit client fallback, no Python route yet).
- Python (slide-rule-python/routes/sliderule_full.py + app.py) owns the core business (orchestrate, execute, sessions, health).
- Node server/routes/sliderule.ts (and delegation) is explicit thin compatibility shell / proxy only for V5 paths (when hit directly, not via Vite default).
- respond path: frontend calls POST /api/sliderule/respond (sliderule-narrator.ts); no Python route; client code always falls back to localNarrationFallback on non-ok (visible degraded, no silent success). Vite /api/sliderule proxy hits Python 404 for it.
- Vite (vite.config.ts) routes /api/sliderule* to Python by default; primary calls hit Python; respond intentionally degraded client-side.

## Frontend /api/sliderule callsite -> Python target route -> tests mapping
All inspected via relative paths only. Primary user-visible calls from product code:

| # | Frontend Callsite | Method | Path | Python Target Route | Python Impl File(s) | Covering Python Test(s) | Node Thin-Shell Test (proof) | Classification | Provenance / Signal |
|---|-------------------|--------|------|---------------------|---------------------|-------------------------|------------------------------|----------------|---------------------|
| 1 | client/src/pages/SlideRule.tsx:833 | GET | /api/sliderule/health | /api/sliderule/health (app.py:127 alias) | slide-rule-python/app.py, routes/sliderule_full.py | test_api_health.py:test_sliderule_api_health_alias; test_v5_smoke.py:test_sliderule_api_health_alias | (health delegates to checkPython...) | PYTHON_FIRST_COMPAT | backend:slide-rule-python, source:python, provenance |
| 2 | client/src/lib/sliderule-orchestrator.ts:49 | POST | /api/sliderule/orchestrate-plan | /api/sliderule/orchestrate-plan | slide-rule-python/routes/sliderule_full.py:168 + services/slide_rule_orchestrator.py | test_orchestrate_plan_contract.py (2 tests + new mapping); test_v5_smoke.py:test_orchestrate_plan_accepts... | server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts (delegates + t10 it) | PYTHON_FIRST_COMPAT | source:python-rag, backend:python, provenance |
| 3 | client/src/lib/sliderule-runtime.ts:2047 (createServerLlm...) | POST | /api/sliderule/execute-capability | /api/sliderule/execute-capability | slide-rule-python/routes/sliderule_full.py:179 + services/capability_maps.py + v5_capability_executor + sliderule_llm | test_v5_smoke.py:test_orchestrate_and_execute... + test_orchestrate_plan... | sliderule.orchestrate-plan-python-contract.test.ts + sliderule.execute-capability.test.ts | PYTHON_FIRST_COMPAT | provenance in (python-rag,python-llm,python-fullpath), backend:python |
| 4 | client/src/lib/sliderule-http-store.ts:31 (via useSlideRuleSession.ts:173) | GET/PUT/POST/DELETE | /api/sliderule/sessions ; /sessions/{sid} | /api/sliderule/sessions ; /sessions/{sid} | slide-rule-python/routes/sliderule_full.py:148 (create/get/put) + services/slide_rule_session.py | test_v5_smoke.py:test_sessions_crud | server/routes/__tests__/sliderule.sessions-store.test.ts (session store compat) | PYTHON_FIRST_COMPAT | provenance:python-fullpath, backend:python |
| 5 | client/src/lib/sliderule-narrator.ts:79 | POST | /api/sliderule/respond | none (BLOCKED; no Python target route) | N/A (no Python impl; client localNarrationFallback on !ok) | N/A (client fallback exercised in useSlideRuleSession + narrator; see degraded contract task) | (Node respond test exists but not used for this callsite under Vite) | BLOCKED (explicit client fallback; visible degraded) | local fallback returns {text, source:"fallback", reason}; 404 from Python proxy triggers it |

Notes:
- All main paths (1-4) hit Python directly under Vite dev proxy (resolveApiTarget in vite.config.ts:179 lists /api/sliderule).
- Frontend never hardcodes Python URL; uses relative paths so provenance from Python is observed in responses.
- Smoke scripts (sliderule-browser-smoke.mjs, frontend-python-happy-path-browser-smoke.mjs) assert python-* on /api/sliderule/* responses.
- Precise blocker for full "every" coverage: POST /api/sliderule/respond has confirmed frontend callsite (client/src/lib/sliderule-narrator.ts:79, invoked via pages/sliderule/useSlideRuleSession.ts) but no matching Python FastAPI route in slide-rule-python/routes/sliderule_full.py (or app.py). Calls via Vite proxy receive 404 from Python, triggering client localNarrationFallback (visible degraded; explicit {source:"fallback", reason}).
- Rescue patch boundary: Narration /respond ownership (Python route + contract + test) is out of scope for task 10 mapping; record as BLOCKED pending rescue in later tasks (e.g. task 16 degraded-error-contract or task 20 retirement-readiness or dedicated narration cutover). Node /respond remains ACTIVE_NODE_BUSINESS for direct/server calls but frontend callsite does not rely on it (uses fallback). Do not misclassify fallback as Python-owned.

## Implementation performed (strict scope)
1. Used only relative paths to read: .agent-loop-context/* , agent-loop/tasks/* , client/src/lib/* + pages/SlideRule.tsx , server/routes/sliderule.ts , slide-rule-python/routes/sliderule_full.py + tests/ , vite.config.ts , docs/* , scripts/*
2. Classified primary calls as PYTHON_FIRST_COMPAT; respond explicitly BLOCKED (client fallback) per review finding.
3. Hardened verification by accurate mapping table (4+1) with blocker note; prior tests already exercise the mapping for owned paths.
4. No frontend callsite, Vite, or Python route changes (respond has no Python target; only documentation of blocker/rescue boundary per acceptance criteria).
5. Updated this task file (mapping table + blocker section + report), migration status, contracts doc. Ensured respond is never claimed as Python-owned.
6. Ran required commands + mojibake on every edited md file.

## Python tests updated
- slide-rule-python/tests/test_orchestrate_plan_contract.py : test_frontend_sliderule_callsite_to_python_route_mapping_105() asserts the 4 primary + respond-fallback (no-Python) case (added in prior; re-validated for this remediation).

## Node/Vitest tests updated
- server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts : 'task-10: maps every...' it() proves thin shell for Python-owned paths (respond not exercised here as it is client fallback).

## Commands run (smallest relevant, recorded exactly)
- python -m pytest slide-rule-python/tests/test_orchestrate_plan_contract.py -q --tb=no
- npx vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts --reporter=basic
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-sliderule-route-map-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md docs/backend-python-no-node-api-contracts.md

(also ran pre-edit variants before final edits; see diagnosis)

## Files changed
- agent-loop/tasks/backend-python-no-node-sliderule-route-map-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- docs/backend-python-no-node-api-contracts.md
(Note: only edited these three to resolve review findings 1-3 per guardrails; tests left as-is since already accurate for fallback case.)

## Denominator / numerator impact
No change to denominator (still 66 modules / 42+ surfaces per baseline). This task hardens evidence and mapping for the existing PYTHON_FIRST_COMPAT /api/sliderule slice (adds test coverage and explicit table, does not move additional ownership). Numerator evidence improved for callsite proof.

## Worker final report
- verdict for this remediation: changed (accurate mapping table + blocker/rescue boundary recorded for /respond; status+contracts corrected to stop overclaiming)
- All review findings addressed: Finding 1: task file table + new precise blocker/rescue section for /respond (no Python target); Finding 2: status ledger updated with correct task10 description (no "proven PYTHON_FIRST_COMPAT via Python" for respond); Finding 3: contracts Task10 evidence uses consistent fallback language without treating as Python-owned completion.
- Python is source of truth for the 4 primary /api/sliderule frontend calls (health/orchestrate/execute/sessions); /respond explicitly BLOCKED with client fallback and rescue boundary noted.
- Node thin shell for owned paths; respond not misclassified.
- Smokes assert provenance on covered paths; respond uses visible fallback.
- Mojibake clean on edited files.
- No forbidden actions. No scope widening (no new route/impl added).
- This task (mapping) does not change no-Node backend API denominator/numerator; accurate ownership accounting improves risk visibility for respond.
