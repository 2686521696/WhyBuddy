# Backend Python No-Node API 105: Move visual capability execution contracts to Python.

## Execution status
- Status: completed
- Goal: Move visual capability execution contracts to Python.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: SlideRule
- Sequence: 15 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-sliderule-visual-contract-105.md`
- Node side: `server/sliderule/visual-exec-map.ts, shared/blueprint/**`
- Python side: `slide-rule-python/routes/sliderule_full.py, slide-rule-python/services/**`
- Tests or smoke: `server/sliderule/__tests__/visual-exec-map.test.ts`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-sliderule-visual-contract-105.md`
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
- Node backend API behavior for visual (ux.preview, outcome.visualize): PYTHON_FIRST_COMPAT.
- Python FastAPI route is now the source of truth for visual capability execution contract (VISUAL_CAP_IDS + visualContract signal).
- Node visual-exec-map.ts remains only as explicit legacy thin compatibility shell.

## Implementation summary
- Identified in Node: visual-exec-map.ts (direct impl + is fn), called from routes/sliderule.ts legacy branch only (after isPythonV5Cap guard that includes the two visual caps).
- Python: hardened sliderule_full.py with VISUAL_CAP_IDS contract definition + visualContract signal on execute results (for native and mapped paths). Leverages existing execute_mapped_capability in services/capability_maps.py and native paths.
- Node compat: updated visual-exec-map.ts with explicit legacy header; updated its Vitest test (no original asserts removed/weakened) to prove thin shell.
- Updated migration status ledger with result for task 15.
- No frontend, vite, or unrelated edits.
- Python provenance for visual now includes "visualContract":"python-native-llm" + "backend":"python".

## Commands run (smallest relevant)
node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-sliderule-visual-contract-105.md
node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
node agent-loop/src/check-mojibake.js server/sliderule/visual-exec-map.ts
node agent-loop/src/check-mojibake.js server/sliderule/__tests__/visual-exec-map.test.ts
node agent-loop/src/check-mojibake.js slide-rule-python/routes/sliderule_full.py
node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_v5_contract_expansion.py
node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-sliderule-visual-contract-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md server/sliderule/visual-exec-map.ts server/sliderule/__tests__/visual-exec-map.test.ts slide-rule-python/routes/sliderule_full.py slide-rule-python/tests/test_v5_contract_expansion.py
$env:PYTHONPATH='slide-rule-python'; python -m pytest slide-rule-python/tests/test_v5_contract_expansion.py -q --tb=no -k "visual or native"
$env:PYTHONPATH='slide-rule-python'; python -m pytest slide-rule-python/tests/test_capabilities.py -q --tb=no -k "visualize or preview"
npx vitest run --config vitest.config.server.ts server/sliderule/__tests__/visual-exec-map.test.ts --reporter=basic

## Files changed (this fix iteration; prior changes in diff)
- slide-rule-python/routes/sliderule_full.py
- slide-rule-python/tests/test_v5_contract_expansion.py
- server/sliderule/visual-exec-map.ts
- server/sliderule/__tests__/visual-exec-map.test.ts
- agent-loop/tasks/backend-python-no-node-sliderule-visual-contract-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

## Migration denominator / numerator impact
- Denominator unchanged (66 route modules, 42+ /api/* surfaces from task 01).
- Numerator: this task adds explicit PYTHON_FIRST_COMPAT ownership proof + contract signal for visual execution slice of /api/sliderule. Python becomes source for visual caps contract. Changes numerator (visual contract now counted under proven Python surfaces). Node risk isolated to legacy opt-in.
- Worker final report records this delta.

## Final report
Task 15: Moved visual capability execution contracts to Python. Classified visual caps (ux.preview, outcome.visualize) as PYTHON_FIRST_COMPAT. Hardened Python route (sliderule_full.py) with VISUAL_CAP_IDS and "visualContract" signal attachment in execute-capability (both native and mapped paths now emit explicit Python contract evidence; TestClient on /execute-capability). Updated route test (test_v5_contract_expansion.py) to assert the signal for visual caps. Marked Node visual-exec-map as legacy-only with header; updated its Vitest test (without removing/weakening any original asserts) to stub legacy env for map tests, prove bypass under python backend via spy+route call. Added dedicated route-exercising proof it() in visual-exec-map.test.ts: sets python backend, spies executeVisualCapabilityMapped before dynamic router load, calls POST /api/sliderule/execute-capability with ux.preview, asserts response has backend+visualContract from python, python delegate was called, and execSpy not called (map bypassed). Updated migration status (task 15 completed, table + full result section with ownership, tests, risk). Ran pytest for the visual-included native test (passes with signal), vitest on visual test (passes, proves shell + bypass), and node agent-loop/src/check-mojibake.js on every edited file (the two agent-loop mds + server/sliderule/visual-exec-map.ts + its test + the two slide-rule-python py files; all returned no mojibake). Exact commands listed above (explicit per-file + combined to cover all). Files changed listed in full. This changes the no-Node backend API numerator (Python visual contract now proven source; denom static). No scope creep, no test rewrite, degraded visible on legacy fail, only scoped/allowed files. Review findings addressed: 1) task file now has full final report with classification/commands/files/denom; 2) migration status updated from pending with visual result + ownership; 3) Python FastAPI route + test snapshot added proving visual contract by Python source of truth; 4) Node test now includes thin-compat proof (bypass it + isVisual under python) not just ux/audit Node exec. All gates run post-edit with no mojibake.
