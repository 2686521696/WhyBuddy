# SlideRule Python V5.2 Full Authority 105: Run browser smoke for reset session and no mojibake after Python DELETE/GET flow.

## Execution status
- Status: pending
- Goal: Run browser smoke for reset session and no mojibake after Python DELETE/GET flow.
- Queue: `sliderule-python-v52-full-authority-cutover-105-queue`
- Phase: NodeRetirement
- Sequence: 70 / 72
- Worktree policy: single queue-scoped worktree for the whole SlideRule V5.2 Python authority cutover.
- State authority target: Python FastAPI owns durable V5.2 reasoning state and backend API semantics.

## Context
This task is part of the SlideRule V5.2 full-authority Python migration. React, Vite, pnpm, and browser tooling stay Node-based. Backend API business semantics, durable reasoning state, trust gates, coverage, driver behavior, and capability execution must move to Python FastAPI.

Keep all tasks in the same queue-scoped worktree named `sliderule-python-v52-full-authority-cutover-105` to reduce drift. Do not reset or recreate the worktree. Treat existing dirty files as user or prior-agent work unless this task explicitly edits them.

## Allowed files
- `agent-loop/tasks/sliderule-python-v52-migration-status-105.md`
- `server/routes/sliderule.ts`
- `server/sliderule/python-delegation.ts`
- `slide-rule-python/routes/sliderule_full.py`
- `client/src/lib/sliderule-http-store.ts`
- `slide-rule-python/tests/test_v5_smoke.py`
- Closely related tests under `slide-rule-python/tests/`, `server/**/__tests__/`, or `client/src/lib/**/__tests__/` only when needed for this task goal.

## Evidence to read
- `docs/sliderule_v5.2.md`
- `docs/Sliderule v5.1.md`
- `agent-loop/tasks/sliderule-python-v52-migration-status-105.md`
- `agent-loop/scripts/sliderule-python-v52-full-authority-cutover-105-queue.json`
- Current task file: `agent-loop/tasks/sliderule-python-v52-reset-session-browser-smoke-105.md`
- Existing tests around the allowed files.

## Required implementation
1. Classify the current behavior as TS_RUNTIME_OWNED, NODE_BACKEND_OWNED, PYTHON_COMPAT, or PYTHON_AUTHORITY.
2. Add or harden the smallest Python implementation slice needed for this task goal.
3. Add compatibility only when necessary; do not hide missing Python semantics behind Node fallback.
4. Update `agent-loop/tasks/sliderule-python-v52-migration-status-105.md` with route/state/capability ownership evidence when this task changes ownership.
5. Preserve frontend Vite/React/pnpm tooling; only backend API business ownership is in scope.

## Required tests
- Add or update focused pytest coverage under `slide-rule-python/tests/` for Python-owned behavior.
- Add or update Vitest only to prove Node is a thin compatibility proxy or frontend contract consumer.
- Add browser/API smoke only when this task changes user-visible `/agent-loop/sliderule` behavior.
- Run the smallest relevant command set and record exact commands in the final report.
- Run `node agent-loop/src/check-mojibake.js` on every edited Markdown, TypeScript, JavaScript, and Python file.

## Do not
- Do not migrate the frontend build toolchain away from Vite, React, pnpm, or Node-based browser tooling.
- Do not claim V5.2 closure from docs-only changes, skipped-live tests, synthetic mocks, or retained Node fallback.
- Do not default artifacts to trusted unless trust gates and provenance ledger justify it.
- Do not let frontend PUT bodies forge server-owned ledgers, coverage, or trust state.
- Do not edit unrelated UI polish, unrelated AgentLoop queue behavior, or unrelated backend routes.
- Do not use `git reset --hard`, recreate the queue worktree, or sweep unrelated files into a commit.

## Acceptance criteria
- The task goal is implemented or a precise blocker is recorded with a rescue patch boundary.
- Python owns the named V5.2 behavior or the task records exactly why ownership cannot move yet.
- Tests prove the Python behavior directly, and any Node tests prove only thin proxy or compatibility behavior.
- The migration status file reflects current ownership and residual risk.
- Worker final report lists files changed, commands run, and whether this task advances Python state authority, driver authority, capability parity, or Node retirement.

## Node behavior classification (step 1)
- Reset session (DELETE /sessions + subsequent GET 404) for /agent-loop/sliderule browser flow: PYTHON_AUTHORITY (Python FastAPI delete_session + persistence delete + route envelope with stateAuthority/provenance/backend; prior SessionAuthority task moved ownership).
- Client: TS_RUNTIME_OWNED thin contract consumer (HttpSlideRuleSessionStore.deleteSession does fetch DELETE; normalizes no business).
- Node server: THIN_PROXY_COMPAT / NODE_BACKEND_OWNED retired for this path (delegates via python-delegation to Python; no local persist).
- Classification: PYTHON_AUTHORITY for the V5.2 durable reset semantics exercised by browser reset; no Node fallback hiding delete/404 behavior.

## Implementation
- Python DELETE/GET + chinese no-mojibake already exercised by focused pytest (test_reset...); no new py code change needed.
- Hardened Vitest in client/src/lib/__tests__/sliderule-http-store.test.ts: now full sequence load (chinese) -> deleteSession -> load (404->undefined), with direct assert on exact chinese goal.text fidelity from http response (addresses review finding 2).
- Browser smoke path: the `node scripts/sliderule-browser-smoke.mjs` (playwright real browser on /agent-loop/sliderule + reset btn click exercising delete flow via http-store / proxy to Python).
- No Node semantics; client thin; Python owns durable reset + envelope.
- Ran check-mojibake + pytest + vitest + browser-smoke-cmd (no placeholders).
- Edits strictly in allowed files.
- No frontend toolchain change.

## Evidence / smoke execution (addresses review finding 1)
- Real browser smoke for reset requires: live vite dev:frontend on 3000 (proxy /api/sliderule to python 9700), python server running, playwright browsers available.
- Script: `node scripts/sliderule-browser-smoke.mjs` drives real playwright browser to /agent-loop/sliderule, loads UI, performs flows including step 5 click on [data-testid="sliderule-reset-session"] or text "重置会话" (which triggers client deleteSession -> DELETE to python via proxy, then subsequent load sees 404->undefined).
- Client contract fidelity (per review minor finding): vitest mocks full sequence load(chinese) -> delete -> load(404) and asserts exact chinese goal.text fidelity + loadedPost===undefined.
- Python side (no-mojibake + durable reset): pytest `test_reset_session_browser_smoke_python_delete_get_no_mojibake` proves: create chinese goal, pre GET returns exact chinese + substrs, DELETE returns envelope with stateAuthority/provenance/backend=python, post-GET=404.
- Vitest = TS_RUNTIME_OWNED thin frontend contract proof only. Pytest proves Python-owned DELETE/GET/no-mojibake directly.
- Browser smoke cmd was executed (see below); it auto-spawned dev:frontend but server never became ready within wait window -> error before any browser launch, page load, or reset click. Therefore no Playwright success evidence for reset button path + Python flow in actual browser. Cannot claim "run+recorded" as proof of passing browser smoke.

## Commands run (exact, recorded for final report; run with these)
- node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_v5_smoke.py client/src/lib/__tests__/sliderule-http-store.test.ts agent-loop/tasks/sliderule-python-v52-reset-session-browser-smoke-105.md agent-loop/tasks/sliderule-python-v52-migration-status-105.md client/src/lib/sliderule-http-store.ts
- $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_v5_smoke.py -q --tb=line -k "reset_session_browser_smoke"
- pnpm dlx vitest run client/src/lib/__tests__/sliderule-http-store.test.ts --reporter=dot --no-watch
- node scripts/sliderule-browser-smoke.mjs   (real playwright browser smoke attempt for /agent-loop/sliderule + reset path; auto-spawn vite attempted but failed to ready)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-python-v52-reset-session-browser-smoke-105.md
- node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-python-v52-migration-status-105.md
- node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_v5_smoke.py client/src/lib/__tests__/sliderule-http-store.test.ts agent-loop/tasks/sliderule-python-v52-reset-session-browser-smoke-105.md agent-loop/tasks/sliderule-python-v52-migration-status-105.md

## Test runs
- $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_v5_smoke.py -q --tb=line -k "reset_session_browser_smoke" : 1 passed
- pnpm dlx vitest run client/src/lib/__tests__/sliderule-http-store.test.ts --reporter=dot --no-watch : Test Files 1 passed (1), Tests 5 passed (5)
  - The delete+load test asserts: loadedPre.goal.text === exact chinese; delete called as DELETE; loadedPost === undefined (404 contract)
- Browser smoke cmd run: `node scripts/sliderule-browser-smoke.mjs` : exited 1 after ~71s. Logs: "dev server not responding on :3000", "auto-spawning `pnpm dev:frontend`", "ERROR: dev server still not responding after auto-start attempt", "FAILED: dev:frontend not reachable even after auto-spawn". No browser launched, no page.goto /agent-loop/sliderule, no reset button click, no DELETE observed in browser context. (No persistent frontend server in worker.)
- All prove Python behavior directly via pytest (DELETE/GET 404 + exact chinese no-mojibake in envelopes); vitest proves only thin client contract. The playwright script exists for browser smoke but live successful execution of reset path requires persistent servers.
- No Node business logic; no synthetic fallback hiding semantics.

## Files changed
- agent-loop/tasks/sliderule-python-v52-reset-session-browser-smoke-105.md (revised evidence/commands/test-runs to stop claiming successful browser smoke; accurately records the executed `node scripts/sliderule-browser-smoke.mjs` result which failed before browser launch due to missing persistent dev server; records blocker + rescue boundary per major finding)
- agent-loop/tasks/sliderule-python-v52-migration-status-105.md (updated entry for accuracy; includes slide-rule-python/tests/test_v5_smoke.py in files changed list to address minor finding; records actual smoke run outcome)
- (note: no additional code edits; client vitest + py test from prior provide contract + python proof; no re-edit to tests)

## Advancement
- Python state authority retained for DELETE/GET 404 + chinese no-mojibake (direct pytest proof).
- Client: TS_RUNTIME_OWNED thin contract (vitest proves delete/load fidelity + 404).
- Node: THIN_PROXY_COMPAT.
- Browser smoke for user-visible /agent-loop/sliderule reset: attempted via `node scripts/sliderule-browser-smoke.mjs` (required by task goal + required tests); run produced exact failure "dev:frontend not reachable even after auto-spawn" (no browser, no reset click executed). Task goal for browser smoke not met in this env.
- Addresses review needs_changes: major 1 (no longer claims successful browser smoke; accurately records the cmd run + full error output + explains why no proof of reset flow in browser; adds explicit BLOCKED + rescue boundary), minor 2 (status will list py test file).
- Exact commands; no ellipses.
- Migration status updated with truth.
- Mojibake clean.

## Final report summary (per acceptance)
Files changed: agent-loop/tasks/sliderule-python-v52-reset-session-browser-smoke-105.md, agent-loop/tasks/sliderule-python-v52-migration-status-105.md
Commands run: see exact list above (check-mojibake on mds+py+ts, pytest -k reset_session_browser_smoke, vitest on client test, "node scripts/sliderule-browser-smoke.mjs", mojibake again)
Advances: Python state authority (DELETE/GET + no-mojibake proven directly by pytest), Node retirement (client contract via vitest thin only); browser smoke script run recorded but did not achieve live browser execution of reset path due to server readiness in worker.
Status: addresses review. Browser smoke (the explicit goal) BLOCKED here: rescue boundary = start persistent `pnpm dev:frontend` (in separate shell until :3000 ready, proxy to python 9700), ensure python uvicorn serving, `npx playwright install` if needed, then `node scripts/sliderule-browser-smoke.mjs` and confirm logs for step 5 reset + provenance + exit 0. Python owns the behavior; this worker run of smoke cmd + pytest + vitest recorded exactly. No overclaim.
