# Backend Python No-Node API 105: Add an API smoke proving A2A uses Python backend.

## Execution status
- Status: completed
- Goal: Add an API smoke proving A2A uses Python backend.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: A2A
- Sequence: 51 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-a2a-api-smoke-python-only-105.md`
- Node side: `scripts/**, package.json, server/routes/a2a.ts`
- Python side: `slide-rule-python/routes/**`
- Tests or smoke: `scripts/**`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-a2a-api-smoke-python-only-105.md`
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

## Implementation
- Identified Node backend API behavior covered by this task: the /api/a2a/* protocol surfaces (GET /agents, /sessions; GET/POST /analytics*; POST /chat, /report; also stream/cancel) classified as PYTHON_FIRST_COMPAT. Python a2a_runtime.py owns registry, sessions, projections, transport, error/cancel semantics (per tasks 47-50). Node server/routes/a2a.ts is explicit thin compatibility shell/bridge only (no business semantics).
- The prior source signals on happy path (/agents + /sessions success + existing on chat/report/analytics) were already in place from thin-proxy hardening. This task focuses on the smoke.
- Added/fixed API smoke: scripts/a2a-api-smoke-python-only-105.mjs (allowed under scripts/**). Rewritten to use real HTTP: spawns tsx to load+mount the actual router from server/routes/a2a.ts into a minimal express app (ephemeral port), performs fetch requests to /api/a2a/agents, /sessions, /analytics, /analytics/inc, /chat, /report (with auth header where required), and asserts every response carries the exact python provenance source fields (e.g. "python-a2a-registry", "python-a2a-analytics", "python-a2a-chat-projection").
- This ensures smoke hits actual /api/a2a/* paths and executes code inside server/routes/a2a.ts (thin shell -> python bridge) rather than bypassing.
- No Python route added (A2A http surface stays thin shell per prior A2A slices; python services a2a_runtime is source of truth).
- No frontend/Vite changes (0 direct callsites confirmed in task 49).
- No Node business logic added; only the smoke now proves the route's success path.
- Updated migration ledger + this task file (and corrected prior overclaim).
- Classification confirmed: PYTHON_FIRST_COMPAT.

## Tests executed
- API smoke (Node): node scripts/a2a-api-smoke-python-only-105.mjs -- now starts ephemeral express + imports server/routes/a2a.ts + issues real HTTP GET/POST to the A2A endpoints; asserts source provenance from responses; passes cleanly.
- Direct Python (supporting): python -c exercising list_a2a_* + get_a2a_analytics... (verifies backend contract returns expected data; used cross-check).
- Node/Vitest route proof not added in server/tests (out of this task's allowed files); the smoke itself provides the live Node route exercising proof for the success-path signals.
- Mojibake: run on all edited files (md + mjs + ts) - clean.
- Negative/degraded: explicit (smoke fails fast on missing signal; route catch paths use NODE_A2A_COMPAT_SHELL_SOURCE visibly).
- Note: smoke is fully standalone (no external server:3001 needed); uses tsx (devDep) only to load the .ts route module for the HTTP mount.

## Commands run (exact)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-a2a-api-smoke-python-only-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md server/routes/a2a.ts scripts/a2a-api-smoke-python-only-105.mjs
- node scripts/a2a-api-smoke-python-only-105.mjs
- python -c "
import sys, json
sys.path.insert(0, 'slide-rule-python')
from services.a2a_runtime import list_a2a_agents, list_a2a_active_sessions, get_a2a_analytics_snapshot, record_a2a_chat_projection, generate_a2a_report, increment_a2a_analytics_counter
print('PY_AGENTS_LEN:', len(list_a2a_agents()))
print('PY_SESSIONS_LEN:', len(list_a2a_active_sessions()))
snap = get_a2a_analytics_snapshot()
print('PY_ANALYTICS_SOURCE:', snap.get('source'))
print('PY_HAS_PYTHON_A2A:', 'python-a2a' in json.dumps(snap) or snap.get('source','').startswith('python-a2a'))
sid='a2a-smoke-cmd'; print('PY_CHAT_OK:', record_a2a_chat_projection(sid,'user','cmdtest').get('ok'))
print('PY_REPORT_OK:', generate_a2a_report(sid,'summary').get('ok'))
print('PY_INC_OK:', increment_a2a_analytics_counter('a2a.smoke',1).get('ok', True))
"
- node agent-loop/src/check-mojibake.js scripts/a2a-api-smoke-python-only-105.mjs agent-loop/tasks/backend-python-no-node-a2a-api-smoke-python-only-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

## Files changed
- scripts/a2a-api-smoke-python-only-105.mjs (rewritten smoke: now exercises real /api/a2a/* HTTP paths by mounting+fetching the router exported from server/routes/a2a.ts; asserts provenance on responses)
- agent-loop/tasks/backend-python-no-node-a2a-api-smoke-python-only-105.md (updated impl + tests + commands + final report; status completed after smoke fix)
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md (corrected task 51 row + result section)

## Worker final report
- Commands run: see exact list above. Smallest relevant: node smoke (exercises route+HTTP API), python -c (backend contract), mojibake on all edited (md, mjs, ts).
- Files changed: 3 (smoke mjs + 2 task mds). (server/routes/a2a.ts not re-edited in this fix run; its prior source signals are now exercised by the corrected smoke.)
- This task changes the no-Node backend API denominator/numerator? Denominator unchanged (66/42+). Numerator: no new surface (A2A PYTHON_FIRST_COMPAT slice already counted); adds the required API smoke evidence that actually traverses the thin shell route and shows python provenance on HTTP responses.
- Acceptance met: Python a2a_runtime is the backend source for A2A; Node route documented as thin shell (prior); smoke now requests actual /api/a2a/* paths through server/routes/a2a.ts handlers and shows python-a2a-* signals in responses; migration status records completed + ownership + low risk; final report present. Not docs-only. Degraded visible. Mojibake clean. Strictly allowed files.
- Review findings addressed:
  - Finding 1: smoke no longer direct python import; now does real HTTP requests to /api/a2a/agents etc. and loads the route module.
  - Finding 2: reports/commands now accurately describe HTTP API requests + route exercising; no false "end-to-end bridge" claim without evidence.
  - Finding 3: smoke fixed first; ledger now reflects correct "API smoke via route" before/after completed.
- Strictly scoped to allowed (scripts/** + the two task mds); no unrelated edits. No git reset.
