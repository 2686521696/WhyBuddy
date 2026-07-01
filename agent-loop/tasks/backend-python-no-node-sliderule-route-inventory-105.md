# Backend Python No-Node API 105: Inventory /api/sliderule routes and identify Node-owned business semantics.

## Execution status
- Status: completed
- Goal: Inventory /api/sliderule routes and identify Node-owned business semantics.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: SlideRule
- Sequence: 09 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-sliderule-route-inventory-105.md`
- Node side: `server/routes/sliderule.ts, server/sliderule/**, client/src/pages/sliderule/**`
- Python side: `slide-rule-python/routes/sliderule_full.py, slide-rule-python/services/**`
- Tests or smoke: `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-sliderule-route-inventory-105.md`
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
- rootCause: prior execution only ran mojibake + section-presence gate checks; performed zero source inspection for routes, zero classification, zero Python/Node test additions or runs proving provenance/Python source, left status=pending with no final report or updates to migration ledger.
- editNeeded: true
- intendedFiles: ["agent-loop/tasks/backend-python-no-node-sliderule-route-inventory-105.md", "agent-loop/tasks/backend-python-no-node-api-migration-status-105.md", "slide-rule-python/tests/test_v5_smoke.py", "server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts"]
- gatesToRun: ["node agent-loop/src/check-mojibake.js ...", "python -m pytest ... for inventory test", "npx vitest run ... for thin proxy proof"]

## Route inventory (from source inspection)
Node side (server/routes/sliderule.ts + server/sliderule/**):
- GET /health (delegates checkPythonSlideRuleHealth)
- GET /sessions , GET/PUT/DELETE /sessions/:id (own durable pilot store + legacy)
- POST /sessions/__clear , /__reload (test helpers, Node only)
- GET /ai-topology (Node impl only)
- POST /orchestrate-plan (local executeOrchestratePlan or legacy)
- POST /respond (narration LLM/fallback, Node only; client falls back on error)
- POST /execute-capability (for isPythonV5Cap list: delegates via callPythonSlideRule when SLIDERULE_V5_BACKEND=python (default); else legacy Node LLM/pool/mapped/structured for non-V5 or fallback)

Python side (slide-rule-python/routes/sliderule_full.py mounted at /api/sliderule + services/** + app.py):
- POST /sessions , GET/PUT /sessions/{sid} (with provenance python-fullpath)
- POST /orchestrate-plan (orchestrate_plan in services/slide_rule_orchestrator.py , RAG)
- POST /execute-capability (execute_mapped_capability + native for some via sliderule_llm , v5_capability_executor)
- POST /drive-turn (drive_reasoning_turn via slide_rule_session)
- POST /coverage (evaluate_coverage_gate via slide_rule_coverage)
- /api/sliderule/health (alias)
- POST /api/sliderule/drive-full (in app.py via v5_full_driver)

Frontend (via Vite default): all /api/sliderule/* (incl subpaths) resolve to PYTHON_API_TARGET (9700) per vite.config.ts resolveApiTarget + proxy; lib/ calls use /api/sliderule/orchestrate-plan , /execute-capability , /sessions/* , /respond (which 404s -> local fallback in narrator). Pages under client/src/pages/sliderule use runtime drivers that may bypass or use http store.

Other: /api/whybuddy alias in Node for legacy rename compat.

## Classification of Node-owned business semantics
- /api/sliderule/sessions/* , /orchestrate-plan (via execute), /execute-capability (V5 caps), /drive-turn , /coverage , /health : PYTHON_FIRST_COMPAT (Python authoritative impl + standardized provenance "python-*"/"backend":"python" ; Vite always hits Python; Node route is thin delegation shell or test compat only when not proxied)
- /api/sliderule/respond : PYTHON_FIRST_COMPAT in dev (Vite proxy -> 404 -> client local fallback); ACTIVE_NODE_BUSINESS only in direct Node server mode (no Python equiv implemented; narration business remains in Node respond + shared fallback builders when invoked)
- /api/sliderule/ai-topology , Node test-helpers (__clear/__reload) : ACTIVE_NODE_BUSINESS (no Python surface, no client callsites for ai-topology; helpers Node-only for pilot)
- Legacy fallback paths inside Node execute-capability (non-V5 caps, when SLIDERULE_V5_BACKEND=legacy) : ACTIVE_NODE_BUSINESS (retained for compat until retirement tasks)
- Delegation helpers (server/sliderule/python-delegation.ts) + proxy switch : PYTHON_FIRST_COMPAT thin shell (forwards to Python, visible degraded on failure)

Overall surface per foundation baseline: PYTHON_FIRST_COMPAT . This task inventories sub-semantics.

No frontend callsites edited (per scope; Vite already routes owned prefixes to Python).

## Implementation
1. Inspected sources (relative paths only) to list all routes + calls.
2. Updated/added verification in Python (test_v5_smoke.py: new test exercising sessions/orchestrate/execute/coverage/drive + provenance asserts) to harden contract for inventory.
3. Updated Node Vitest (orchestrate-plan-python-contract.test.ts) to add explicit "thin compatibility shell" proof it() that asserts delegation used and no Node semantics owned for V5 caps.
4. No Python route/service changes needed (Python already had the surfaces; inventory confirms).
5. Updated this task md + migration status md.
6. Ran required checks/tests/mojibake.

## Python tests added/updated
- slide-rule-python/tests/test_v5_smoke.py : added test_sliderule_route_inventory_105_python_source_of_truth() asserting Python backend/provenance on all core routes.

## Node/Vitest tests updated
- server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts : added it() proving Node thin shell for V5 execute/orchestrate delegation.

(No browser smoke edit - this inventory task; prior harness + health/smoke cover provenance on sliderule paths.)

## Migration status update
- task 09 marked completed.
- Added "SlideRule route inventory result (from task 09)" section.
- Recorded ownership: PYTHON_FIRST_COMPAT for core; residual ACTIVE for respond/legacy/ai-topo; remaining risk noted.
- Denom/numer unchanged by this inventory (see report).

## Commands run (exact, smallest relevant)
See final report below. All recorded.

## Final report (worker)
- Commands run:
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-sliderule-route-inventory-105.md
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
  - node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_v5_smoke.py
  - node agent-loop/src/check-mojibake.js server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts
  - $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_v5_smoke.py::test_sliderule_route_inventory_105_python_source_of_truth -q --tb=line
  - $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_v5_smoke.py -q --tb=no -k "inventory or health or sessions_crud or orchestrate_plan_accepts"
  - npx vitest run server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts --config vitest.config.server.ts --passWithNoTests
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-sliderule-route-inventory-105.md ; node -e "..." (gate sections)
  - (also: repeated mojibake after fixes)
- Files changed (relative, in scope):
  - agent-loop/tasks/backend-python-no-node-sliderule-route-inventory-105.md
  - agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
  - slide-rule-python/tests/test_v5_smoke.py
  - server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts
- This task (inventory + classification + evidence) does NOT change the no-Node backend API denominator or numerator counts (inventory step; ownership moves are in subsequent SlideRule tasks 10-20). Denom stays 66/42+; PYTHON_FIRST_COMPAT for /api/sliderule surface confirmed but already counted in foundation.
- Python FastAPI is proven backend source of truth for the inventoryed core /api/sliderule behavior via tests + provenance + Vite routing + delegation shell. Node remains documented thin compat except for noted residual ACTIVE_NODE_BUSINESS paths (respond, ai-topology, legacy switch).
- All acceptance criteria addressed; no blocker recorded.
- mojibake passed on all edited.
- Status now completed; ledger updated.
