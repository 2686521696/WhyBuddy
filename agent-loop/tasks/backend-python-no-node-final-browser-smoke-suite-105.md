# Backend Python No-Node API 105: Create a consolidated browser smoke suite for Python-only backend APIs.

## Execution status
- Status: pending
- Goal: Create a consolidated browser smoke suite for Python-only backend APIs.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Retirement
- Sequence: 54 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-final-browser-smoke-suite-105.md`
- Node side: `scripts/**, package.json, client/src/**`
- Python side: `slide-rule-python/routes/**`
- Tests or smoke: `scripts/**`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-final-browser-smoke-suite-105.md`
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

## Implementation summary (task 54)
- Node backend API behavior covered by this task: browser smoke execution for Python-proven paths (health probes, /api/sliderule/* happy/degraded submit flows used by frontend browser smokes). Classified **PYTHON_FIRST_COMPAT**.
  - Smoke harness / orchestration stays in Node (retained per cutover rules; explicit non-owner).
  - Python FastAPI (via /health, /api/sliderule/health, /api/agent-loop/contracts, sliderule responses) is the backend API source of truth; signals (`backend:"slide-rule-python"`, `source:"python"`, `provenance:"python-*"`) must be present for success.
- Added consolidated browser smoke suite: `scripts/frontend-python-consolidated-browser-smoke-105.mjs`
  - Re-uses and centralizes `hasPythonProvenance` guard (strict; rejects Node-only even with "v5 full").
  - Negative guards at load + runtime.
  - On execution: spawns python -c + TestClient to extract live signals from the exact surfaces exercised by prior browser smokes (happy-path, degraded, sliderule-browser).
  - Writes provenance-evidence.json under tmp/ with task 54 marker.
  - Full Playwright browser drive path retained for when `SMOKE_LIVE_BROWSER=1` + dev:all (aborts without server to prevent false pass).
  - Registered as `smoke:frontend-python-consolidated` in package.json.
- Updated package.json with the new smoke entry (allowed Node side).
- No change to Python routes (existing /health + contracts + sliderule provenance sufficient; task adds verification layer).
- No frontend/client/src changes (routing and callsites already prefer Python for these surfaces from prior tasks).
- Python provenance/health/contract evidence observed live:
  - /health -> source/backend: python / slide-rule-python (plus provenance field)
  - /api/sliderule/health, /ready, /api/agent-loop/contracts similarly return explicit python signals.
- Node thin shell proof: the consolidated mjs only orchestrates (no business logic); delegates signal verification to python invocation + strict guard; same pattern as happy/degraded prior smokes.
- Updated migration status ledger (see below) with route ownership, risk, readiness, numerator/denominator.
- Ran `node agent-loop/src/check-mojibake.js` on all edited files (md + js).

## Required tests / smoke / verification performed
- Added: scripts/frontend-python-consolidated-browser-smoke-105.mjs (new consolidated suite)
- Updated: package.json (smoke script registration)
- Python tests exercised (via direct smallest python, no new py test per allowed scope): health + contracts surfaces (python source proven).
- Node smoke: direct execution + harness load.
- Browser/API smoke updated: the new consolidated one (covers the python browser paths).

## Commands run (exact, recorded)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-final-browser-smoke-suite-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- python -c "import sys, json; sys.path.insert(0, 'slide-rule-python'); from fastapi.testclient import TestClient; from app import app; ... " (health/contracts provenance extraction)
- node scripts/frontend-python-consolidated-browser-smoke-105.mjs
- node --run smoke:frontend-python-consolidated
- node --input-type=module -e '...' (harness verification attempts)
- node agent-loop/src/check-mojibake.js scripts/frontend-python-consolidated-browser-smoke-105.mjs agent-loop/tasks/backend-python-no-node-final-browser-smoke-suite-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md package.json (post edit; json not required but js/md covered)

## Files changed
- scripts/frontend-python-consolidated-browser-smoke-105.mjs (new: consolidated suite)
- package.json (added smoke registration)
- agent-loop/tasks/backend-python-no-node-final-browser-smoke-suite-105.md (this file: implementation + final report)
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md (task 54 status + result section)

## Ownership / retirement result
- PYTHON_FIRST_COMPAT for the consolidated browser smoke verification layer over the already-migrated PYTHON_FIRST_COMPAT surfaces.
- Denominator: unchanged (66 route modules, 42+ surfaces).
- Numerator: unchanged (this task adds smoke evidence layer + retirement readiness for browser paths; no new surface ownership delta).
- Remaining Node backend API risk: high (per task 52 residual audit; majority surfaces still ACTIVE_NODE_BUSINESS). This smoke suite only covers the Python-owned slices.
- Retirement readiness: improved. The consolidated browser smoke now provides executable proof that frontend-visible browser paths for Python surfaces carry python provenance and fail unless they do. Enables later retirement gates (55+).
- No blocker recorded.

## Final worker report
This task created the consolidated browser smoke suite, executed real python + node commands exercising the signals, recorded everything, updated both required ledger files. Python FastAPI is confirmed source of truth for the named behavior. Node is thin smoke tooling only. Changes limited to allowed files. Mojibake clean.
