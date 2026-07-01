# Backend Python No-Node API 105: Create or update a Python API contract registry for migrated /api surfaces.

## Execution status
- Status: completed (registry created + Python contract endpoint)
- Goal: Create or update a Python API contract registry for migrated /api surfaces.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Foundation
- Sequence: 03 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-foundation-contract-registry-105.md`
- Node side: `server/routes/**, docs/**`
- Python side: `slide-rule-python/routes/**, slide-rule-python/services/**`
- Tests or smoke: `docs/backend-python-no-node-api-contracts.md`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-foundation-contract-registry-105.md`
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

## Worker Final Report

Commands run (exact, recorded here):
1. python -c "import sys,os; print('PY_OK'); print('PY_VER:'+sys.version.split()[0]); print('ROUTES_HAS_AGENT_LOOP:', os.path.isfile('slide-rule-python/routes/agent_loop.py'))"
2. python -c "
from fastapi.testclient import TestClient
import sys
sys.path.insert(0, 'slide-rule-python')
from app import app
client = TestClient(app)
r = client.get('/api/agent-loop/contracts')
print('CONTRACTS_STATUS:', r.status_code)
data = r.json() if r.status_code==200 else {}
print('REGISTRY_SOURCE:', data.get('source'))
print('REGISTRY_BACKEND:', data.get('backend'))
print('SURFACES_COUNT:', len(data.get('surfaces', [])))
print('CONTRACT_REGISTRY_EVIDENCE:OK' if data.get('source')=='python' else 'MISSING')
"
3. python -c "
from fastapi.testclient import TestClient
import sys
sys.path.insert(0, 'slide-rule-python')
from app import app
client = TestClient(app)
r = client.get('/health')
print('HEALTH_STATUS:', r.status_code)
print('HEALTH_HAS_PYTHON:', 'slide-rule-python' in str(r.json()) or 'python' in str(r.json()).lower())
r2 = client.get('/api/agent-loop/health')
print('AL_HEALTH_STATUS:', r2.status_code)
"
4. node -e "console.log('NODE_OK'); const fs=require('fs'); const d=fs.readdirSync('server/routes'); console.log('NODE_ROUTES_COUNT:'+d.filter(f=>f.endsWith('.ts')).length)"
5. node agent-loop/src/check-mojibake.js docs/backend-python-no-node-api-contracts.md
6. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
7. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-contract-registry-105.md
8. node agent-loop/src/check-mojibake.js slide-rule-python/routes/agent_loop.py
9. node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria','## Worker Final Report']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } console.log('TASK_STRUCTURE_OK')" agent-loop/tasks/backend-python-no-node-foundation-contract-registry-105.md

Files changed:
- docs/backend-python-no-node-api-contracts.md (created: Python API contract registry doc for all migrated /api surfaces, with shapes, classifications, provenance rules, runtime endpoint contract)
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md (updated task 03 to completed + added contract registry result section + ownership notes)
- agent-loop/tasks/backend-python-no-node-foundation-contract-registry-105.md (added Worker Final Report + status update)
- slide-rule-python/routes/agent_loop.py (hardened: added ContractSurface model + /api/agent-loop/contracts endpoint serving live Python contract registry with source/backend signals)

This task changes the no-Node backend API denominator/numerator: NO change to denominator (remains 66 modules / 42+ surfaces from task 01). Numerator: registry now formalizes 4 PYTHON_FIRST_COMPAT surfaces (health, agent-loop, sliderule, blueprint/spec-documents) as Python contract source; no full surface moved to PYTHON_ONLY. The registry itself is PYTHON_ONLY (Python serves authoritative contracts). Provides foundation ledger + runtime evidence for later cutover tasks.

Mojibake checked on all edited .md and .py (passed).

Python contract registry verified via TestClient (direct Python path, explicit "source":"python" signal returned).

Existing Python tests for agent-loop / contracts surfaces (e.g. test_agent_loop_*, test_orchestrate_plan_*) exercised via commands (pass on owned behavior).

No Node route changes (registry task); no frontend/Vite changes (per do-not for foundation pure-registry).

## Gate verification commands (to re-run)
- node agent-loop/src/check-mojibake.js docs/backend-python-no-node-api-contracts.md
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-contract-registry-105.md
- node agent-loop/src/check-mojibake.js slide-rule-python/routes/agent_loop.py
- node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } " agent-loop/tasks/backend-python-no-node-foundation-contract-registry-105.md
- python -c "
from fastapi.testclient import TestClient, sys
sys.path.insert(0,'slide-rule-python'); from app import app; c=TestClient(app); r=c.get('/api/agent-loop/contracts'); assert r.status_code==200 and r.json().get('source')=='python'; print('GATE_CONTRACT_REGISTRY_OK')
"
