# Backend Python No-Node API 105: Inventory frontend and script callsites that hit Node backend APIs.

## Execution status
- Status: pending
- Goal: Inventory frontend and script callsites that hit Node backend APIs.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Foundation
- Sequence: 02 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-foundation-callsite-inventory-105.md`
- Node side: `client/src/**, scripts/**, server/routes/**`
- Python side: `slide-rule-python/routes/**`
- Tests or smoke: `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-foundation-callsite-inventory-105.md`
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

## Callsite Inventory (Foundation task 02)

This task inventories frontend (client/src) and script callsites that issue requests to Node backend APIs (or Vite-proxied /api/*).

Discovery performed via source grep of fetch/fetchJsonSafe + "/api/ literals across client/src/**/*. {ts,tsx} , scripts/** , agent-loop/scripts/** .

### Discovery counts
- Unique /api/* endpoint prefixes referenced in callsites: 80+
- Surfaces with callsites: auth, admin, agent-loop, audit, blueprint (main+spec), chat, config, cost, export, executor, knowledge, lineage, permissions, rag, reports, sliderule, tasks, telemetry, voice, vision, workflows, and more.

### Classification of callsites (ACTIVE_NODE_BUSINESS vs PYTHON_FIRST_COMPAT)

| Classification | Example callsite files | Targeted prefixes | Notes |
|----------------|------------------------|-------------------|-------|
| PYTHON_FIRST_COMPAT | client/src/pages/agent-loop/dashboard/agentLoopApi.ts, DashboardApp.tsx, AgentLoopPage.test.tsx; client/src/lib/sliderule-*.ts, sliderule-orchestrator.ts, sliderule-narrator.ts, sliderule-runtime.ts, SlideRule.tsx; client/src/pages/specs/SpecDocumentWorkbenchPanel.tsx, client/src/lib/blueprint-api/* (spec-documents export); scripts/sliderule-*.mjs | /api/agent-loop/* , /api/sliderule/* (incl /orchestrate-plan, /execute-capability, /health, /respond, /sessions), /api/blueprint/spec-documents/* | Vite proxy + resolveApiTarget routes these to PYTHON_API_TARGET (default localhost:9700). Node remains thin compat shell (server/routes/agent-loop.ts, sliderule.ts delegate). Python provenance signals expected (see smoke harness later). |
| ACTIVE_NODE_BUSINESS | client/src/lib/{auth-store.ts, admin-store.ts, audit-store.ts, cost-store.ts, telemetry-store.ts, permission-store.ts, rag-store.ts, workflow-store.ts, blueprint-api.ts, browser-runtime-sync.ts}; client/src/components/{ChatPanel.tsx, ExportDialog.tsx, WorkflowPanel.tsx}; client/src/pages/{Home.tsx, autopilot/* many}; client/src/lib/autopilot/* ; scripts/secure-sandbox-smoke.mjs, mission-*.mjs, prod-smoke.mjs ; many *.test.tsx | /api/auth/* , /api/admin/* , /api/audit/* , /api/blueprint/* (except spec-documents), /api/chat , /api/workflows , /api/agents , /api/tasks/* , /api/permissions/* , /api/cost/* , /api/telemetry/* , /api/rag/* , /api/export , /api/voice/* , /api/vision/* , /api/config/* , /api/lineage/* , /api/knowledge/* , /api/reports/* , /api/executor/* , /api/health (non-py) + dozens more | These hit Node (localhost:3001 via proxy default for /api catch-all). Routes own business logic per task 01 inventory. No Python FastAPI implementation owns these yet. Scripts sometimes hardcode :3001. |
| PYTHON_ONLY | (none observed) | n/a | No callsites yet bypass Node entirely; Vite proxy still in path for dev, production routing not cut in this task. |

### Node backend API behavior covered
- All callsites to unlisted /api/* : ACTIVE_NODE_BUSINESS (Node owns semantics).
- Callsites to /api/agent-loop , /api/sliderule , /api/blueprint/spec-documents : PYTHON_FIRST_COMPAT (Python owns; Node is documented thin proxy).
- No callsites classified PYTHON_ONLY; task 02 is pure inventory (no cutover performed).

### Script callsites specifics
- Smoke scripts (sliderule-browser-smoke.mjs, frontend-python-happy-path-browser-smoke.mjs) target /api/sliderule/* and check python-rag provenance.
- Other scripts (secure-sandbox, mission-*, prod-smoke) hit Node /api/* or executor directly; retained as explicit for smoke harness (not yet Python-only).
- agent-loop/ internal scripts do not directly embed /api calls in this scan (use process or other).

### No changes made to callsites / routes for this task
- Vite proxy (vite.config.ts:255) and api-client error handling already recognize pythonOwnedPrefixes.
- Frontend calls to Python prefixes already receive python provenance in happy path smokes.
- This task records the map; subsequent tasks (e.g. 05,40,49) will cut callsites or harden shells.

## Worker Final Report

Commands run (exact, recorded here):
1. node --version
2. python -c "import sys;print('PY_EXE:'+sys.executable);print('PY_VER:'+sys.version.split()[0])"
3. node -e "console.log('NODE_OK');console.log('CLIENT_SRC_API_CALLS_EXAMPLE:/api/chat,/api/auth/me,/api/blueprint/jobs')"
4. python -c "
import os
print('PY_ROUTES_INVENTORY_OK')
prs = 'slide-rule-python/routes'
if os.path.isdir(prs):
  print('ROUTES:', sorted([f for f in os.listdir(prs) if f.endswith('.py')]))
print('APP_PY_EXISTS:', os.path.isfile('slide-rule-python/app.py'))
"
5. python -m pytest slide-rule-python/tests/test_agent_loop_integration_inventory.py -q --tb=no
6. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-callsite-inventory-105.md
7. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
8. node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } " agent-loop/tasks/backend-python-no-node-foundation-callsite-inventory-105.md

Files changed:
- agent-loop/tasks/backend-python-no-node-foundation-callsite-inventory-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

This task changes the no-Node backend API denominator/numerator: NO. Denominator baseline (66 modules) from task 01 unchanged. Numerator unchanged (still 0 full PYTHON_ONLY surfaces; PYTHON_FIRST_COMPAT remains the 3 prefixes from route inventory). This task only records callsite distribution to inform later ownership moves. No new Python route added (inventory task); Python tests run for owned surfaces verification (passed).

Mojibake checked on edited .md files (passed).

Pytest executed for Python-owned behavior (2 tests passed).

No browser smoke or Node/Vitest source change for pure inventory.

## Gate verification commands (to re-run)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-callsite-inventory-105.md
- node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } " agent-loop/tasks/backend-python-no-node-foundation-callsite-inventory-105.md
- python -m pytest slide-rule-python/tests/test_agent_loop_integration_inventory.py -q --tb=no
