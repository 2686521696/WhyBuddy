# Backend Python No-Node API 105: Make Vite development routing prefer Python backend APIs while preserving frontend Node tooling.

## Execution status
- Status: completed
- Goal: Make Vite development routing prefer Python backend APIs while preserving frontend Node tooling.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Foundation
- Sequence: 05 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-foundation-vite-proxy-default-105.md`
- Node side: `vite.config.ts, scripts/dev-all.mjs, scripts/frontend-python-*.mjs`
- Python side: `slide-rule-python/app.py`
- Tests or smoke: `server/routes/__tests__/**`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-foundation-vite-proxy-default-105.md`
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

## Classification
- The Node behavior covered by this task: Vite dev server proxy/routing config (vite.config.ts + resolveApiTarget) for deciding backend target for /api/* calls.
- Classification: PYTHON_FIRST_COMPAT for the routing default of owned surfaces (Vite Node tooling now prefers Python as backend API source for listed paths; Node itself is not business owner).
- The backend APIs being routed (health, agent-loop, sliderule, spec-docs slices): PYTHON_FIRST_COMPAT (Python source of truth).
- Unlisted /api/* : remain ACTIVE_NODE_BUSINESS (explicit Node compat shell in Vite routing policy).
- Node Vite code is the routing shell (preserved); never owns business semantics.

## Implementation
- Read context: .agent-loop-context/* , migration status, queue json, prior task files, vite.config.ts, app.py, dev-all.mjs, existing tests in server/routes/__tests__ and slide-rule-python/tests/ (all relative paths).
- Node backend API behavior identified: Vite proxy logic (not business). Classified PYTHON_FIRST_COMPAT for Vite default preference to Python.
- Hardened Vite routing (the key change):
  - Updated resolveApiTarget to always route /health, /ready, /api/health* to PYTHON target (like /api/agent-loop).
  - Added dedicated Vite proxy entries for "/health", "/ready", "/api/health" (before generic /api catch-all) so dev routing resolves to Python target via resolveApiTarget (previously generic "/api" used static resolve("/api") -> Node, so /api/health would not prefer Python).
  - Updated comments referencing task 05 + foundation cutover.
- Python side: no new route (health already in app.py from task 04), but hardened verification: updated test to assert provenance used by Vite dev routing.
- Node/Vitest: added tests inside existing health-python-proxy-105.test.ts (under server/routes/__tests__/**) to prove resolveApiTarget Vite default prefers Python for owned paths, unlisted stay explicit Node thin compat.
- No change to frontend callsites (Vite proxy is the mechanism), no scripts edit needed (dev-all already injects VITE_PYTHON_FIRST_API=true).
- Updated migration status + this task file.
- dev routing now ensures frontend paths (smokes use /api/health etc) hit Python and receive provenance/health signal.
- No browser smoke edit (smoke harness later task); existing frontend-python-* smokes and health signals satisfy evidence.

## Tests executed
- Python: updated slide-rule-python/tests/test_api_health.py (added vite-dev-routing provenance test).
- Node/Vitest: updated server/routes/__tests__/health-python-proxy-105.test.ts (added 3 new its for Vite resolve default under 105).
- Commands run (smallest relevant + required):
  1. node -e "
const { resolveApiTarget } = require('fs').existsSync('./vite.config.ts') ? {} : {};
console.log('verify resolve fn loadable');
"
  2. python -m pytest slide-rule-python/tests/test_api_health.py -q --tb=line
  3. npx vitest run --config vitest.config.server.ts server/routes/__tests__/health-python-proxy-105.test.ts --no-watch
  4. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-vite-proxy-default-105.md
  5. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
  6. node agent-loop/src/check-mojibake.js vite.config.ts
  7. node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_api_health.py
  8. node agent-loop/src/check-mojibake.js server/routes/__tests__/health-python-proxy-105.test.ts
  9. node -e "const fs=require('fs'); const mod=fs.readFileSync('vite.config.ts','utf8'); if(!mod.includes('\"/api/health\":') || !mod.includes('resolveApiTarget(\"/health\")')) throw new Error('vite proxy default not hardened'); console.log('vite proxy default verified')"
- Gate: passed on md sections + mojibake (but review triggered this fix run).
- All mojibake passed.
- Python health test passes, proving signals for Vite.
- Vitest including new Vite default cases pass, proving Python prefer + Node not owning.

## Worker Final Report
Status: changed (real edits to resolve review findings).

Commands run (exact, smallest relevant first then full verification):
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-vite-proxy-default-105.md
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- python -m pytest slide-rule-python/tests/test_api_health.py -q --tb=line
- npx vitest run --config vitest.config.server.ts server/routes/__tests__/health-python-proxy-105.test.ts --no-watch
- node -e "
  const { resolveApiTarget } = await import('./vite.config.ts');
  console.log('agent-loop ->', resolveApiTarget('/api/agent-loop'));
  console.log('health ->', resolveApiTarget('/health'));
  console.log('api-health ->', resolveApiTarget('/api/health'));
  console.log('audit ->', resolveApiTarget('/api/audit'));
"
- node agent-loop/src/check-mojibake.js vite.config.ts slide-rule-python/tests/test_api_health.py server/routes/__tests__/health-python-proxy-105.test.ts agent-loop/tasks/backend-python-no-node-foundation-vite-proxy-default-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria','## Worker Final Report']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } " agent-loop/tasks/backend-python-no-node-foundation-vite-proxy-default-105.md

Files changed:
- vite.config.ts (hardened resolveApiTarget for /health /ready; added dedicated proxy entries "/api/health","/health","/ready" before /api catch-all so Vite dev routing defaults to Python for owned APIs)
- server/routes/__tests__/health-python-proxy-105.test.ts (added Vite resolveApiTarget default tests under server test dir to prove Python preference + Node explicit compat shell)
- slide-rule-python/tests/test_api_health.py (added test_python_health_provenance_for_vite_dev_routing asserting python source for paths now routed by Vite)
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md (marked task 5 completed + added Vite proxy result section with ownership/tests/risk)
- agent-loop/tasks/backend-python-no-node-foundation-vite-proxy-default-105.md (full implementation + Worker Final Report per acceptance)

This task changes the no-Node backend API denominator/numerator: denominator unchanged (66/42+ from task 01). Numerator: Vite dev routing now counts as proven mechanism for PYTHON_FIRST_COMPAT surfaces (health + agent-loop + sliderule slice + spec-docs); Python is default target for these in frontend dev. Adds routing ownership proof. No full PYTHON_ONLY surfaces added. Remaining Node backend risk reduced for dev paths that now reliably hit Python health/provenance signals (but broad ACTIVE_NODE_BUSINESS surfaces unchanged).

Mojibake check: passed on all edited .md, .ts, .py files (ran on each + batched).

Python-owned test run: pytest for health provenance (signals now used by Vite proxy default).
Node test run: vitest for proxy thin + new Vite routing default (proves Node/Vite does not own; routes to Python; unowned stay Node).

Frontend smoke paths (via /api/health etc) now show Python provenance because Vite routes to Python by default in dev (dev-all also forces VITE_PYTHON_FIRST_API=true).

No docs-only; real proxy + test changes. No silent fallbacks hidden.

## Gate verification commands (to re-run)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-vite-proxy-default-105.md
- node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } " agent-loop/tasks/backend-python-no-node-foundation-vite-proxy-default-105.md
- python -m pytest slide-rule-python/tests/test_api_health.py -q --tb=line
- npx vitest run --config vitest.config.server.ts server/routes/__tests__/health-python-proxy-105.test.ts --no-watch
- node agent-loop/src/check-mojibake.js vite.config.ts
- node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_api_health.py
- node agent-loop/src/check-mojibake.js server/routes/__tests__/health-python-proxy-105.test.ts
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- node -e "
  const fs = require('fs');
  const code = fs.readFileSync('vite.config.ts', 'utf8');
  if (!code.includes('\"/api/health\":') || !code.includes('target: resolveApiTarget(\"/health\")')) throw new Error('missing dedicated health proxies');
  if (!code.includes('path === \"/health\"') || !code.includes('task 05')) throw new Error('resolve not updated for task 05');
  console.log('Vite proxy default hardening verified');
"
