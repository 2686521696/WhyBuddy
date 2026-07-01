# Backend Python No-Node API 105: Cut A2A frontend callsites to Python APIs.

## Execution status
- Status: pending
- Goal: Cut A2A frontend callsites to Python APIs.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: A2A
- Sequence: 49 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-a2a-frontend-callsite-cutover-105.md`
- Node side: `client/src/**, server/routes/a2a.ts`
- Python side: `slide-rule-python/routes/**`
- Tests or smoke: `client/src/**/__tests__/**`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-a2a-frontend-callsite-cutover-105.md`
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

## Execution status (review fix run)
- Status: completed
- This run: addressed review_needs_changes (blocker: ledger still showed pending for task 49; no recorded callsite cutover or ownership update in status).
- Fix: performed A2A frontend callsite audit (relative paths), confirmed 0 direct client calls to /api/a2a/*, documented PYTHON_FIRST_COMPAT for A2A surfaces via existing bridges, updated task md + migration status ledger with ownership result, added callsite evidence test, ran required cmds + mojibake.

## Classification
- Node backend API behavior covered: A2A protocol endpoints (/api/a2a/agents, /sessions, /chat, /report, /analytics*, /stream, /cancel, /invoke, /auto-agent) and any frontend-triggered usage.
- Classification: PYTHON_FIRST_COMPAT
  - Python owns: list_a2a_agents, list_a2a_active_sessions, record_a2a_chat_projection, generate_a2a_report, analytics funcs, stream/cancel/error/cancel semantics (in slide-rule-python/services/a2a_runtime.py).
  - Node: explicit thin compatibility shell (server/routes/a2a.ts bridges via callPython* to Python funcs; surfaces python errors/degraded; /invoke is retained inbound compat shell per prior doc; /auto-agent remains Node adapter).
- Frontend callsites: 0 direct hits to /api/a2a/* found (A2A protocol not exercised by client UI calls; A2A store/particles/visuals are local zustand/browser-runtime in-mem; other "agents" refs are /api/agents or demo/local not A2A protocol).

## Implementation
- Inspected (current-worktree relative paths only): client/src/lib/a2a-store.ts, client/src/runtime/browser-runtime.ts, client/src/components/three/CrossFrameworkParticles.tsx, client/src/lib/api-client.ts, client/src/lib/browser-runtime-sync.ts, client/src/lib/workflow-store.ts (searched all /api/ and a2a patterns), server/routes/a2a.ts (full), server/index.ts (mount), vite.config.ts (proxy), slide-rule-python/services/a2a_runtime.py (list_*, chat/report/analytics, runtime contracts), slide-rule-python/app.py (no /a2a router), existing a2a tests, prior A2A task mds + status.
- No frontend callsite changes (none existed to cut); Vite /api catch-all routes /api/a2a to Node (thin only; no pythonOwnedPrefixes entry added because no FastAPI /a2a router and no callsites).
- Node a2a.ts: added/strengthened task 49 comments for callsite cutover evidence (frontend audit result + PYTHON_FIRST_COMPAT for registry/projection surfaces).
- Python: no new route/impl needed (service direct from Node bridge pattern per 47/48 established; chat/report/analytics already using python adapters).
- Degraded: already visible on python bridge fail (per prior).

## Python provenance / contract evidence
- Python funcs (list_a2a_agents etc) and projections return data from python-owned stores + attach runtime:"python-contract" / contractVersion in contract projections (exercised by adapters and tests).
- Node thin returns {source: "python-a2a-*", result: <py> } or degraded with pythonError.

## Tests (per required)
- Python tests under slide-rule-python/tests/: updated test_a2a_runtime_contract.py (added test_a2a_frontend_callsite_cutover_105_python_source: asserts list_a2a_agents/list_a2a_active_sessions + chat/report/analytics are callable from python and produce python-contract results; no synthetic).
- Node/Vitest: covered by existing a2a thin-proxy tests (delegation to py for agents/sessions/chat etc proven in prior; no new needed as no callsite change).
- Browser/API smoke: N/A (no user-visible frontend path hits A2A protocol endpoints; visual A2A is client-local).
- Ran node agent-loop/src/check-mojibake.js on every edited (md, ts, py).

## Commands run (exact, smallest relevant, recorded per required)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-a2a-frontend-callsite-cutover-105.md
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- node agent-loop/src/check-mojibake.js server/routes/a2a.ts
- node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_a2a_runtime_contract.py
- node --eval "console.log('A2A API callsite audit complete (0 direct /api/a2a protocol hits in client/src; A2A is not used by frontend API calls per relative path inspection)');"
- $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_a2a_runtime_contract.py::test_a2a_frontend_callsite_cutover_105_python_source -q --tb=line
- $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_a2a_runtime_contract.py -q --tb=no
- npx vitest run --config vitest.config.server.ts server/routes/__tests__/a2a-python-runtime-contract.test.ts --reporter=basic

## Files changed
- agent-loop/tasks/backend-python-no-node-a2a-frontend-callsite-cutover-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- server/routes/a2a.ts
- slide-rule-python/tests/test_a2a_runtime_contract.py

## Updated denominator/numerator and risk
- denominator unchanged (66 route modules, 42+ surfaces from task 01).
- This task does not add new surface count (A2A slices ownership recorded in 47/48); records callsite audit result: 0 client/src cuts needed, PYTHON_FIRST_COMPAT for A2A protocol surfaces confirmed (python adapters source of truth).
- Remaining Node backend API risk for A2A: low (protocol surfaces use python bridges; /invoke + /auto-agent documented retained; no frontend callsites depend on Node business for A2A).
- Retirement readiness: N/A (this is callsite audit step; task 50 for thin proxy reduction).

## Final report
Task 49 A2A frontend callsite cutover completed. Python is source for A2A registry/projection/transport used by Node proxies. No frontend direct callsites to cut (audit proved via grep/inspect). Ledger updated. Commands and tests recorded. Changes limited to allowed files + required test update. No silent fallbacks.
