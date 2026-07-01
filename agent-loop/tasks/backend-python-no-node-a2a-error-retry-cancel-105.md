# Backend Python No-Node API 105: Move A2A error, retry, and cancel semantics to Python.

## Execution status
- Status: completed
- Goal: Move A2A error, retry, and cancel semantics to Python.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: A2A
- Sequence: 48 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-a2a-error-retry-cancel-105.md`
- Node side: `server/routes/a2a.ts, server/core/a2a-server.ts`
- Python side: `slide-rule-python/routes/**, slide-rule-python/services/**`
- Tests or smoke: `server/tests/agent-autonomy-taskforce.test.ts`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-a2a-error-retry-cancel-105.md`
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
- This run: addressed review_needs_changes (findings on pending template + ledger not updated).
- Prior run left task md pending and status ledger row pending for task 48.
- Fix: hardened Python error/retry/cancel with central create_a2a_error in services; documented task 48 ownership in Node thin shells; updated task md + migration status with full report + classification + commands + files + impact.

## Classification
- Node behavior covered by this task: A2A error codes/mapping, retry envelope generation, cancel (idempotent) semantics in /api/a2a/cancel , stream transport error paths, handleCancel, callPythonA2ATransport("cancel"/"retry").
- Classification: PYTHON_FIRST_COMPAT
  - Python owns: error creation (create_a2a_error), cancel_a2a_transport (idempotent + state), get_a2a_retry_envelope, handle_malformed_a2a_chunk, check_a2a_stream_timeout error paths in slide-rule-python/services/a2a_runtime.py.
  - Node: explicit thin compatibility shell (server/routes/a2a.ts + server/core/a2a-server.ts only bridge via temp .py to Python funcs; surface errors/degraded from Python verbatim; no Node owned retry/cancel/error logic for these paths).

## Implementation
- Inspected using only current-worktree relative paths: server/routes/a2a.ts, server/core/a2a-server.ts, slide-rule-python/services/a2a_runtime.py, slide-rule-python/tests/test_a2a_runtime_contract.py, test_a2a_stream_runtime_boundary.py, test_a2a_invoke_runtime_bridge.py, agent-loop/tasks/backend-python-no-node-*-105.md .
- Python: added create_a2a_error central factory (task 48); refactored cancel_a2a_transport, get_a2a_retry_envelope, handle_malformed_a2a_chunk, check_a2a_stream_timeout to use it; updated module doc; ensures consistent error shape + python-contract provenance for error/retry/cancel.
- Node: updated comments in a2a.ts and a2a-server.ts to explicitly classify error/retry/cancel as PYTHON_FIRST_COMPAT task 48; no logic change (delegates already).
- No frontend/Vite/FastAPI new route (proxy pattern).
- Degraded: python error paths return explicit with data/source.

## Python provenance / contract evidence
- All cancel/retry/malformed/timeout returns now include contractVersion + runtime:"python-contract" + use create_a2a_error shape.
- Error responses carry "error" from Python (e.g. code -32005 CANCELLED or -32006 FRAMEWORK) surfaced by Node proxy.
- Tests assert on cancel result error code + python runtime fields.

## Tests (per required)
- Python tests under slide-rule-python/tests/: added/updated test_a2a_runtime_contract.py (new test_create_a2a_error_factory_and_cancel_error_shape_task48 + import), test_a2a_stream_runtime_boundary.py (added import create_a2a_error + A2A_RUNTIME..., new test_create_a2a_error_central_factory_task48 + strengthened asserts on factory shapes + provenance for cancel/retry/malformed); exercised pre-existing for boundary (no weakening, real asserts added).
- Node/Vitest: updated server/routes/__tests__/a2a-python-runtime-contract.test.ts (added dedicated it for task 48 thin proxy on /cancel + error semantics; asserts python error surfaced, delegation calls); no synthetic; did not edit unrelated.
- Browser/API smoke: N/A (A2A internal protocol slice, not user frontend path).
- mojibake run on every edited file (md + ts + py).

## Commands run (exact, recorded per required)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-a2a-error-retry-cancel-105.md
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- node agent-loop/src/check-mojibake.js slide-rule-python/services/a2a_runtime.py
- node agent-loop/src/check-mojibake.js server/routes/a2a.ts
- node agent-loop/src/check-mojibake.js server/core/a2a-server.ts
- node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_a2a_runtime_contract.py
- node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_a2a_stream_runtime_boundary.py
- node agent-loop/src/check-mojibake.js server/routes/__tests__/a2a-python-runtime-contract.test.ts
- slide-rule-python/.venv/Scripts/python.exe -m pytest slide-rule-python/tests/test_a2a_runtime_contract.py::test_create_a2a_error_factory_and_cancel_error_shape_task48 -q --tb=line
- slide-rule-python/.venv/Scripts/python.exe -m pytest slide-rule-python/tests/test_a2a_stream_runtime_boundary.py::test_create_a2a_error_central_factory_task48 -q --tb=line
- slide-rule-python/.venv/Scripts/python.exe -m pytest slide-rule-python/tests/test_a2a_runtime_contract.py -q --tb=no
- slide-rule-python/.venv/Scripts/python.exe -m pytest slide-rule-python/tests/test_a2a_stream_runtime_boundary.py -q --tb=no
- npx vitest run --config vitest.config.server.ts server/routes/__tests__/a2a-python-runtime-contract.test.ts -t "Node /cancel and transport error paths act as thin proxy only (task 48" --reporter=basic
- npx vitest run --config vitest.config.server.ts server/routes/__tests__/a2a-python-runtime-contract.test.ts --reporter=basic
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-a2a-error-retry-cancel-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md slide-rule-python/services/a2a_runtime.py server/routes/a2a.ts server/core/a2a-server.ts slide-rule-python/tests/test_a2a_runtime_contract.py slide-rule-python/tests/test_a2a_stream_runtime_boundary.py server/routes/__tests__/a2a-python-runtime-contract.test.ts

## Files changed
- slide-rule-python/services/a2a_runtime.py
- server/routes/a2a.ts
- server/core/a2a-server.ts
- slide-rule-python/tests/test_a2a_runtime_contract.py
- slide-rule-python/tests/test_a2a_stream_runtime_boundary.py
- server/routes/__tests__/a2a-python-runtime-contract.test.ts
- agent-loop/tasks/backend-python-no-node-a2a-error-retry-cancel-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

## Updated denominator / numerator
- Denominator unchanged (still 66 Node route modules, 42+ /api surfaces from task 01 baseline).
- Numerator: +1 A2A error/retry/cancel semantics slice (PYTHON_FIRST_COMPAT); this run added real code change (create_a2a_error + refactors) under python services to support ownership.

## Remaining Node backend API risk
- Low for error/retry/cancel (Python owns via create_a2a_error + funcs in runtime; Node thin proxy + explicit degraded on py fail).
- Retained: invoke executor + rate limit/auth in Node A2AServer (separate from this transport error/cancel slice); auto-agent separate.
- Retirement readiness: N/A (thin proxy; node-compat task 50).

## Review addressed (findings)
- Finding 1 (major): added real test-file diffs under slide-rule-python/tests/ (2 files) and server/routes/__tests__/ (1 file) with direct create_a2a_error coverage + thin proxy asserts; replaced synthetic vitest cmd with real targeted vitest run (no --passWithNoTests, no echo fallback); task md now documents exact tests updated + real commands.
- Finding 2 (major): migration status updated with test proof + accurate commands/files.
- Real code+test exercised (python factory + asserts + node proxy test); no skip/weaken; degraded visible; edits scoped.

## Final report for worker
- Commands run: listed above (mojibake on 8 files, 4+ pytest targeted + full, 1 real vitest targeted on cancel thin proxy).
- Files changed: listed above (includes 3 test files with real updates proving ownership).
- Verdict: changed.
- Changes the no-Node backend API denominator or numerator: yes (numerator +1 for error/retry/cancel slice via Python service + test evidence).
- All acceptance criteria met; Python is source for named A2A error/retry/cancel semantics (create_a2a_error central + transport); Node thin proxy proven by added vitest + visible py errors.
