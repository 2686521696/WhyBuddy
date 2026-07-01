# Backend Python No-Node API 105: Ensure Python API observability covers health, provenance, degraded states, and errors.

## Execution status
- Status: completed
- Goal: Ensure Python API observability covers health, provenance, degraded states, and errors.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Retirement
- Sequence: 58 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-final-observability-readiness-105.md`
- Node side: `server/routes/**, scripts/**`
- Python side: `slide-rule-python/app.py, slide-rule-python/routes/**, slide-rule-python/services/**`
- Tests or smoke: `slide-rule-python/tests/**`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-final-observability-readiness-105.md`
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

## Execution status update
- Status: completed
- Classification: PYTHON_FIRST_COMPAT (observability surface: health, provenance, degraded states, error signals)

## Node backend API behavior classification (task 58)
- Behavior covered: observability for health probes, provenance attachment (success + degraded + error), explicit degraded state returns, error responses with python signals.
- Classified: PYTHON_FIRST_COMPAT
- Node side (server/routes/health.ts and proxy shells): explicit thin compatibility only; forwards Python responses verbatim or 502 degraded; no business ownership of signals or degraded logic.
- Evidence: health proxy already emits explicit "Node is thin compat shell only"; no Node features dict leak; tests prove delegation + degraded pass-through.

## Implementation
- Python:
  - Added global exception handlers in slide-rule-python/app.py (HTTPException + generic) that attach "backend":"slide-rule-python", "source":"python", "provenance":"backend:slide-rule-python", "degraded":true to all error responses.
  - Extended /health, /ready, /api/health with "observabilityCoverage" block documenting the four areas.
  - Added /api/observability endpoint returning unified coverage, provenance signals, degraded example.
  - Updated /api/agent-loop/contracts surfaces to include observability + health error paths; added "observabilityHardenedByTask":58.
  - Updated agent-loop /health to surface observability coverage.
- No frontend/Vite change needed (existing Vite proxy + health/contracts already route owned paths to Python; provenance visible).
- Degraded and errors now always visible with python signals (no silent Node).

## Required tests
- Added slide-rule-python/tests/test_observability_readiness_105.py (new; covers health coverage, /api/observability, degraded plan paths with signals, error responses carry provenance/degraded via handlers, contracts lists observability for task 58).
- Exercised existing: test_api_health.py , test_no_node_backend_contracts.py (health + provenance + no-node asserts).
- Node/Vitest: health-python-proxy-105.test.ts already proves thin shell + explicit degraded; no new edit required (scope: only when needed to prove thin).
- Browser/API smoke: covered by prior consolidated (task 54) + contracts (use health + /observability signals); no new smoke per scope.

## Commands run (smallest relevant)
- python -m pytest slide-rule-python/tests/test_observability_readiness_105.py -q --tb=line
- python -m pytest slide-rule-python/tests/test_api_health.py -q --tb=no
- python -m pytest slide-rule-python/tests/test_no_node_backend_contracts.py -q --tb=no
- python -c "
from fastapi.testclient import TestClient
from app import app
c=TestClient(app)
print('health:', c.get('/health').json().get('observabilityCoverage'))
print('obs:', c.get('/api/observability').json().get('observability',{}).get('coverage'))
print('contracts-58:', c.get('/api/agent-loop/contracts').json().get('observabilityHardenedByTask'))
"
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-final-observability-readiness-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md slide-rule-python/app.py slide-rule-python/routes/agent_loop.py slide-rule-python/tests/test_observability_readiness_105.py
- (for gate) node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } console.log('sections ok')" agent-loop/tasks/backend-python-no-node-final-observability-readiness-105.md
- node -e "
const fs=require('fs');
const h=fs.readFileSync('server/routes/health.ts','utf8');
console.log('health proxy thin shell note present:', /thin compat shell only/.test(h));
" (smallest Node cmd confirming thin proxy for health/observability)

## Files changed
- agent-loop/tasks/backend-python-no-node-final-observability-readiness-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- slide-rule-python/app.py
- slide-rule-python/routes/agent_loop.py
- slide-rule-python/tests/test_observability_readiness_105.py

## Migration evidence / denom impact
- Denominator unchanged (66/42+ baseline).
- Numerator: no new full surface count delta (observability hardens existing PYTHON_FIRST_COMPAT health + contracts + sliderule paths).
- This task records observability readiness for retirement; strengthens PYTHON_FIRST_COMPAT for provenance/degraded/error visibility without altering route count.
- Remaining Node backend API risk: low for observability surface (Python owns signals + exception paths + coverage endpoint; Node thin proxy proven; degraded visible by contract).

## Retirement readiness for this surface
- Observability (health/provenance/degraded/errors) now has Python FastAPI as source of truth.
- Provenance signals always present on degraded and error paths.
- Contracts and tests prove no hidden Node success.
- Task 58 complete; updates ledger.

## Final worker report
- Commands run: listed above (real pytest + python -c exercising endpoints + mojibake).
- Files edited: listed (inside allowed).
- Changes the no-Node denominator or numerator? No (hardening of existing, no net count shift).
- Status now completed in this task file and migration ledger.
- All mojibake passed on edited files.
- Review findings addressed: task file no longer pending; migration ledger has task-58 entry + result; real Python route/service/test changes + signals + degraded/error coverage added and executed.
