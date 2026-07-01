# Backend Python No-Node API 105: Unify backend health and readiness probes around Python as the backend API source.

## Execution status
- Status: pending
- Goal: Unify backend health and readiness probes around Python as the backend API source.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Foundation
- Sequence: 04 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-foundation-health-readiness-105.md`
- Node side: `server/index.ts, server/routes/**, vite.config.ts, scripts/**`
- Python side: `slide-rule-python/app.py, slide-rule-python/routes/**`
- Tests or smoke: `slide-rule-python/tests/test_api_health.py`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-foundation-health-readiness-105.md`
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

## Execution log (this run)
- Identified Node behavior: /api/health legacy (features dict) was ACTIVE_NODE_BUSINESS for core health; now classified PYTHON_FIRST_COMPAT (unified under Python).
- Added Python routes in app.py: unified health at /health and /api/health, dedicated /ready probe, with source/backend/provenance/readiness signals.
- Hardened Node to thin shell: /api/health in server/index.ts is now proxy only (extracted handler to server/routes/health.ts for testability, behavior unchanged).
- Made Vite dev prefer Python for /api/health.
- Created dedicated Python test file (required by spec) under allowed test path.
- Added explicit Node/Vitest test (server/routes/__tests__/health-python-proxy-105.test.ts) proving thin compatibility shell: forwards Python provenance, surfaces explicit degraded 502 on failure, no legacy Node ownership.
- Updated migration ledger and this task with ownership + final report (fix run for review finding on missing Node proxy test).

## Route ownership classification
- Behavior: backend health and readiness probes (/health, /api/health, /ready, /api/*/health).
- Classification: PYTHON_FIRST_COMPAT
  - Python FastAPI owns the probes and returns authoritative responses with provenance.
  - Node server/index.ts is thin temporary compatibility shell (proxy or explicit degraded).
- No ACTIVE_NODE_BUSINESS left for unified health/readiness.
- Not yet PYTHON_ONLY (thin proxy kept for compat in Node server and some paths until retirement).

## Worker Final Report

Commands run (exact, recorded here):
1. node -e "console.log('NODE_MOJIBAKE_PREP')"
2. python -c "
import sys
sys.path.insert(0, 'slide-rule-python')
from fastapi.testclient import TestClient
from app import app
c = TestClient(app)
for p in ['/health', '/api/health', '/ready']:
    r = c.get(p)
    print(p, 'STATUS:', r.status_code)
    d = r.json()
    print(p, 'BACKEND:', d.get('backend'))
    print(p, 'READINESS:', d.get('readiness') or d.get('status'))
    print(p, 'SOURCE_PROV:', d.get('source') or d.get('provenance'))
print('PYTHON_HEALTH_READINESS_OK')
"
3. python -m pytest slide-rule-python/tests/test_api_health.py -q --tb=line
4. node agent-loop/src/check-mojibake.js slide-rule-python/app.py
5. node agent-loop/src/check-mojibake.js server/index.ts
6. node agent-loop/src/check-mojibake.js vite.config.ts
7. node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_api_health.py
8. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-health-readiness-105.md
9. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
10. node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria','## Worker Final Report']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } " agent-loop/tasks/backend-python-no-node-foundation-health-readiness-105.md
11. npx vitest run --config vitest.config.server.ts server/routes/__tests__/health-python-proxy-105.test.ts --no-watch
12. node agent-loop/src/check-mojibake.js server/routes/health.ts
13. node agent-loop/src/check-mojibake.js server/routes/__tests__/health-python-proxy-105.test.ts
14. node agent-loop/src/check-mojibake.js server/routes/health.ts server/index.ts server/routes/__tests__/health-python-proxy-105.test.ts agent-loop/tasks/backend-python-no-node-foundation-health-readiness-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

Files changed:
- slide-rule-python/app.py (unified health + added /api/health and /ready probes with python provenance and readiness)
- server/index.ts (replaced legacy Node /api/health with thin PYTHON_FIRST_COMPAT proxy to Python; surfaces degraded explicitly; now uses attachHealthProxy)
- server/routes/health.ts (new: extracted thin proxy handler+attach for /api/health to enable explicit Vitest coverage of PYTHON_FIRST_COMPAT shell)
- server/routes/__tests__/health-python-proxy-105.test.ts (new: Vitest tests proving Node is thin compat shell only - forwards Python source/backend/readiness, explicit 502 degraded, no legacy Node features/ownership)
- vite.config.ts (added /api/health to python target in resolveApiTarget and proxy config)
- slide-rule-python/tests/test_api_health.py (new: dedicated TestClient tests for health/readiness proving Python source, signals, readiness)
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md (marked task 4 completed; added detailed health/readiness result section, ownership classification, numerator note, risk update)
- agent-loop/tasks/backend-python-no-node-foundation-health-readiness-105.md (added execution log, classification, Worker Final Report with commands + evidence; fix run: added explicit Node test per review)

This task changes the no-Node backend API denominator/numerator: denominator unchanged (66 modules / 42+ surfaces baseline from task 01). Numerator: health/readiness probes now count as proven PYTHON_FIRST_COMPAT (Python source of truth for health signals); adds to foundation Python surfaces (registry + health). Task moves health from legacy Node dict to Python baseline. Thin Node shell retained (documented).

Mojibake check: passed on all edited .md .ts .py files.

Python health test: created and executed (direct TestClient, asserts explicit Python backend/readiness/provenance on /health /api/health /ready).

Node proxy test: explicit Vitest coverage added (health-python-proxy-105.test.ts using __TEST_FETCH_OVERRIDE). Tests prove: proxies Python signals (backend/slide-rule-python, source/python, readiness/ready, provenance), forwards error statuses, surfaces 502 degraded with note, never injects legacy features dict or silent ok. All 5 cases pass.

Vite proxy updated so dev frontend hits Python for /api/health .

No browser smoke added (per allowed files; this foundation task focuses API probe unification; smoke harness is task 08).

No unrelated edits.

## Gate verification commands (to re-run)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-health-readiness-105.md
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- node agent-loop/src/check-mojibake.js slide-rule-python/app.py
- node agent-loop/src/check-mojibake.js server/index.ts
- node agent-loop/src/check-mojibake.js vite.config.ts
- node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_api_health.py
- node agent-loop/src/check-mojibake.js server/routes/health.ts
- node agent-loop/src/check-mojibake.js server/routes/__tests__/health-python-proxy-105.test.ts
- npx vitest run --config vitest.config.server.ts server/routes/__tests__/health-python-proxy-105.test.ts --no-watch
- node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } " agent-loop/tasks/backend-python-no-node-foundation-health-readiness-105.md
- python -m pytest slide-rule-python/tests/test_api_health.py -q --tb=line
- node agent-loop/src/check-mojibake.js server/routes/health.ts server/index.ts server/routes/__tests__/health-python-proxy-105.test.ts agent-loop/tasks/backend-python-no-node-foundation-health-readiness-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
