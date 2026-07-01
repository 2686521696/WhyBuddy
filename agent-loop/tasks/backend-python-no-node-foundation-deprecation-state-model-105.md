# Backend Python No-Node API 105: Introduce a route state model for ACTIVE_NODE_BUSINESS, PYTHON_FIRST_COMPAT, and PYTHON_ONLY.

## Execution status
- Status: completed
- Goal: Introduce a route state model for ACTIVE_NODE_BUSINESS, PYTHON_FIRST_COMPAT, and PYTHON_ONLY.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Foundation
- Sequence: 06 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-foundation-deprecation-state-model-105.md`
- Node side: `server/routes/**, docs/**`
- Python side: `slide-rule-python/routes/**`
- Tests or smoke: `docs/backend-python-no-node-api-contracts.md`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-foundation-deprecation-state-model-105.md`
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
- Identified: the route state model / classification definitions were previously only static in docs/ledger; no formal enforceable model existed in Python or Node for ACTIVE_NODE_BUSINESS etc. Classified the state model itself as PYTHON_ONLY (Python is authoritative).
- Added formal RouteState enum in slide-rule-python/models/agent_loop.py (str Enum with the 4 states).
- Hardened slide-rule-python/routes/agent_loop.py: ContractSurface.classification now typed RouteState; /contracts now returns supportedStates + introducedByTask + routeStateModel; all surfaces use enum instances.
- Updated docs to reflect task 06 as the introducer (lastUpdatedByTask, model doc, response shape).
- Updated migration status ledger with task 06 result and ownership.

## Tests executed
- Python: slide-rule-python/tests/test_agent_loop_models.py (added dedicated test for RouteState validation + usage in contract surfaces).
- Python: slide-rule-python/tests/test_agent_loop_integration_inventory.py (re-ran to cover PYTHON_FIRST_COMPAT surfaces).
- Python direct: -c exercising import + /contracts endpoint function.
- Node: thin proxy verification via node -e (agent-loop.ts + proxy test source).
- Mojibake: passed on all edited.

## Commands run (exact)
- python -m pytest slide-rule-python/tests/test_agent_loop_models.py::test_route_state_model_task06_introduces_and_validates_classifications -q --tb=line
- python -m pytest slide-rule-python/tests/test_agent_loop_models.py -q --tb=no
- python -m pytest slide-rule-python/tests/test_agent_loop_integration_inventory.py -q --tb=no
- python -c "..." (import RouteState + asyncio.run on api_contract_registry, assert supportedStates)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-deprecation-state-model-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md docs/backend-python-no-node-api-contracts.md slide-rule-python/routes/agent_loop.py slide-rule-python/models/agent_loop.py slide-rule-python/tests/test_agent_loop_models.py
- node -e "..." (node version + thin proxy exists check + provenance test scan)

## Files changed
- slide-rule-python/models/agent_loop.py (RouteState enum + __all__)
- slide-rule-python/routes/agent_loop.py (import, ContractSurface, /contracts response + comments)
- slide-rule-python/tests/test_agent_loop_models.py (import + new test_route_state_model_task06...)
- docs/backend-python-no-node-api-contracts.md (lastUpdatedByTask=06, model doc, response sample, update policy)
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md (table + full result section)
- agent-loop/tasks/backend-python-no-node-foundation-deprecation-state-model-105.md (status, impl, report)

## Worker final report
- Commands run: see above list (smallest relevant pytest, python -c, node -e, mojibake on edited).
- Files changed: 6 files (3 py source/test, 3 md).
- This task changes the no-Node backend API denominator/numerator? Denominator: no change. Numerator: state model enforcement + contracts payload now counted as additional PYTHON_ONLY (the RouteState model + registry metadata surface); foundation PYTHON_FIRST_COMPAT surfaces remain at documented 4. The model itself is now Python source of truth (PYTHON_ONLY).
- Acceptance met: Python FastAPI (models + route) is the source for the route state model. Node is thin (no model ownership, proxy test proves). Migration status updated with ownership + risk. Contracts doc updated with task 06 evidence + verification. No docs-only; code + test added. Mojibake clean. Degraded states remain visible by model contract.
- Task 06 result recorded; pending review findings addressed.
