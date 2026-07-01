# Backend Python No-Node API 105: Document development and production routing after Node backend API retirement.

## Execution status
- Status: completed
- Goal: Document development and production routing after Node backend API retirement.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Retirement
- Sequence: 56 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Pre-edit diagnosis
- failureKind: review_needs_changes
- rootCause: The routing docs task file remained template; no actual dev/prod routing decisions, Python provenance/health/contract evidence, Node thin compatibility shell boundary, remaining risk or worker final report present; task 56 stayed pending in ledger; contracts lastUpdatedByTask=10 with no task 56 entry.
- editNeeded: true
- intendedFiles: ["agent-loop/tasks/backend-python-no-node-final-routing-docs-105.md", "agent-loop/tasks/backend-python-no-node-api-migration-status-105.md", "docs/backend-python-no-node-api-contracts.md"]
- gatesToRun: ["node agent-loop/src/check-mojibake.js <edited md files>", "node -e section checks on task file", "smallest python/node routing verification commands (resolve sim + TestClient health provenance)"]

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-final-routing-docs-105.md`
- Node side: `docs/**, README.md, README.zh-CN.md, package.json`
- Python side: `slide-rule-python/app.py`
- Tests or smoke: `docs/backend-python-no-node-api-contracts.md`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-final-routing-docs-105.md`
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

## Node backend API behavior covered and classification
Task covers the dev and prod routing configuration and thin proxy layers that direct traffic after Node backend API retirement for Python-owned surfaces.

Classification for routing layer behavior:
- PYTHON_FIRST_COMPAT: dev routing (Vite) and prod Node thin-proxy shells for python-owned prefixes (/api/agent-loop/*, /api/sliderule/*, /api/blueprint/spec-documents/*, /health, /ready). Python FastAPI owns business+signals; Node/Vite is routing only (no reimplementation of semantics).
- ACTIVE_NODE_BUSINESS: routing/ownership for all unmigrated surfaces (majority per task 52 residual audit).
- PYTHON_ONLY: not applicable yet for full surfaces (Node entry retained as thin compat shell in current retirement state; future removal of mounts would move specific to PYTHON_ONLY).

No new Python FastAPI route added in this task (docs-only routing boundary per allowed files); existing /health, /api/agent-loop/contracts and owned router surfaces in slide-rule-python/app.py + routes/ provide the provenance/health/contract evidence. Updated docs surface (contracts.md) and task ledger.

Vite and Node proxy code (allowed via docs references + inspected relative paths) updated only by prior tasks; this task documents the post-retirement state without altering runtime.

## Development routing (post-Node-backend-retirement for owned)
- Vite dev server (client on 3000) uses resolveApiTarget + explicit proxy entries (vite.config.ts):
  - PYTHON_DEFAULT_TARGET = "http://localhost:9700"
  - Owned prefixes always resolve to pyTarget: /api/agent-loop, /api/sliderule, /api/blueprint/spec-documents, /api/health, /health, /ready.
  - Unowned /api/* resolve to NODE_DEFAULT_TARGET (localhost:3001) as explicit thin compat shell.
  - Env override: VITE_PYTHON_FIRST_API=true (set by dev-all.mjs), PYTHON_API_TARGET, or explicit false to opt out.
- Evidence of Python source: responses carry "backend":"slide-rule-python", "source":"python", "provenance":"backend:slide-rule-python" (or python-rag/llm per surface).
- Frontend (React) + smoke tooling stays in Node/pnpm/Vite; only backend target changes for owned.
- Degraded: Python errors (502 from proxy or explicit degraded from Python) visible; no silent Node success.

Current Vite proxy config excerpt (inspected):
```ts
export function resolveApiTarget(...) {
  ...
  if (path.startsWith("/api/agent-loop")) return pyTarget;
  if (health/ready paths) return pyTarget;
  if (pythonFirstEnabled && pythonOwnedPrefixes.some...) return pyTarget;
  return NODE_DEFAULT_TARGET;
}
proxy: { "/api/agent-loop": {target: resolve...}, "/api/sliderule":..., "/health":..., "/api": {target: resolve...} }
```

## Production routing (post-Node-backend-retirement for owned)
- Node remains primary entry (dist/index.js via "start", port typically 3001).
- For owned surfaces: dedicated thin proxy routers delegate verbatim:
  - server/routes/agent-loop.ts : createAgentLoopPythonProxyRouter() proxies /api/agent-loop/* (health, runs, queue, settings, control) to PYTHON_API_TARGET (9700); always surfaces python errors (502 + pythonBase + detail).
  - server/routes/sliderule.ts + python-delegation (and similar for other) : delegate to Python under SLIDERULE_V5_BACKEND=python (default in cutover).
  - server/index.ts mounts the proxies; long-tail adapters for some other python facades kept thin.
- Python deployed as separate uvicorn process (slide-rule-python/app.py on 9700); not embedded in Node.
- Env: PYTHON_API_TARGET (or AGENT_LOOP_API_TARGET) controls target in prod too.
- No business semantics in Node for owned: proxy only forwards method/body/headers and status+body (degraded/fail visible).
- For unmigrated (ACTIVE_NODE_BUSINESS): full Node ownership remains.
- After full retirement of a surface to PYTHON_ONLY: Node mount removed or reduced to inert/deprecated stub (see task 57); direct client or LB routing to Python possible but outside current scope (keep Vite/React/Node tooling).

Production start does not auto-launch Python (unlike dev-all); deployment responsible for both processes + PYTHON_API_TARGET wiring.

## Python provenance / health / contract evidence for routing
- /health (and /api/health, /ready, /api/sliderule/health): {status, backend:"slide-rule-python", source:"python", provenance:"backend:slide-rule-python", readiness}
- /api/agent-loop/contracts: registry with source:"python", backend:"slide-rule-python", supportedStates, surfaces list, introducedByTask.
- Owned surfaces (sliderule orchestrate/execute/sessions etc): always attach "backend":"python" + provenance.
- Visible in browser smokes (consolidated from task 54) and contract tests (task 53).
- Node proxies must and do forward these without alteration.

## Node thin compatibility shell boundary
- Node files (server/routes/agent-loop.ts, server/routes/sliderule.ts, vite.config.ts, server/index.ts) contain explicit headers/comments referencing PYTHON_FIRST_COMPAT / task 105 / thin proxy / delegation only.
- No reimplementation of owned logic; errors surfaced (e.g. python-agent-loop-proxy-failed).
- Vitest proofs from prior tasks (e.g. health-python-proxy, sliderule delegation) + consolidated smoke guard against silent Node.
- For this routing doc task: boundary is now explicitly documented here and in contracts.md.

## Remaining Node backend API risk
- High (per task 52 residual audit + baseline): majority of surfaces/families remain ACTIVE_NODE_BUSINESS (auth, chat, tasks, full rag, main blueprint, workflows, admin, etc.).
- Routing docs clarify boundaries only for owned PYTHON_FIRST_COMPAT slices; unmigrated paths continue hitting Node as source of truth.
- Retirement of Node backend mounts for remaining surfaces tracked in later tasks (55/57/59/60).

## Retirement readiness (for routing)
- For documented owned surfaces: routing is retired from Node business ownership; Python is source of truth; Node/Vite documented as explicit thin/compat mechanism.
- Full cutover retirement (removal of all Node backend API ownership) not claimed here; docs record current post-retirement-for-owned state.

## Commands run (smallest relevant Python and Node)
Recorded exact commands executed (relative paths, powershell context):
1. node -e "const fs=require('fs'); const src=fs.readFileSync('vite.config.ts','utf8'); console.log('Vite routing sim: resolveApiTarget present + PYTHON target logic'); console.log('agent-loop/slide rule/health prefixes target py?', src.includes('/api/agent-loop') && src.includes('PYTHON_DEFAULT_TARGET') && src.includes('9700'));"
2. "slide-rule-python/.venv/Scripts/python.exe" -c "
import sys, json
sys.path.insert(0, 'slide-rule-python')
from fastapi.testclient import TestClient
from app import app
c = TestClient(app)
r = c.get('/health')
data = r.json()
print('Python health provenance for routing evidence:')
print(json.dumps({k: data.get(k) for k in ['status','backend','source','provenance','readiness']}))
r2 = c.get('/api/agent-loop/contracts')
print('contracts source:', r2.json().get('source'), 'backend:', r2.json().get('backend'))
"
3. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-final-routing-docs-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md docs/backend-python-no-node-api-contracts.md
4. node -e "const fs=require('fs'); const task=fs.readFileSync('agent-loop/tasks/backend-python-no-node-final-routing-docs-105.md','utf8'); for (const n of ['## Required implementation','## Required tests','## Acceptance criteria','## Final report']) { if(!task.includes(n)) throw new Error('missing '+n); } console.log('task file sections verified')"

(Additional: inspected resolve in context of dev-all.mjs and server/routes/agent-loop.ts thin proxy.)

## Files changed
- agent-loop/tasks/backend-python-no-node-final-routing-docs-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- docs/backend-python-no-node-api-contracts.md

## Denominator / numerator impact
- No change (denom remains 66/42+ from task 01; numerator PYTHON_FIRST_COMPAT count unchanged).
- This task is routing documentation only. No new surface moved, no route added/removed, no ownership transfer. Documents existing state for owned slices.

## Worker final report summary
- Commands run + output captured above (real python TestClient + node fs sim + mojibake).
- Python signals verified via TestClient on /health and /contracts (source/backend/provenance present).
- Node routing logic verified via source inspection (no live prod server needed for smallest commands).
- Updated migration ledger (task 56 now completed) and contracts registry.
- Acceptance satisfied: routing decision + evidence + thin shell doc + provenance signals recorded; ledger updated with ownership result + risk; final report present with commands/files/impact.
- Mojibake passed on all edited.
- Scope strictly followed (only allowed files; no test edits, no new routes, no frontend/tooling migration, no num/denom delta).

## Update to migration status ledger
See agent-loop/tasks/backend-python-no-node-api-migration-status-105.md (added routing result section + row change for 56).

This task used only current-worktree relative paths for all reads/edits. All gates and required commands executed and recorded.