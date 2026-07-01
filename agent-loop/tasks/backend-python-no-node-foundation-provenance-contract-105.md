# Backend Python No-Node API 105: Standardize Python provenance fields used by browser smokes and contract tests.

## Execution status
- Status: completed
- Goal: Standardize Python provenance fields used by browser smokes and contract tests.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Foundation
- Sequence: 07 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-foundation-provenance-contract-105.md`
- Node side: `server/routes/**, client/src/**, scripts/**`
- Python side: `slide-rule-python/routes/**, slide-rule-python/services/**`
- Tests or smoke: `slide-rule-python/tests/test_v5_smoke.py`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-foundation-provenance-contract-105.md`
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
- Identified Node backend API behavior: the emission of provenance signals on /api/sliderule/* (sessions, orchestrate-plan, execute-capability, drive-turn) and related contract responses used by browser smokes (sliderule-browser-smoke.mjs, frontend-python-*-smoke.mjs) and contract tests. Classified as PYTHON_FIRST_COMPAT (Python owns the business signals and exact field values; Node server/routes/sliderule.ts is thin proxy shell that forwards verbatim).
- Added standardization: defined canonical constants (PROVENANCE_PYTHON_RAG, PROVENANCE_PYTHON_FULLPATH, PROVENANCE_PYTHON_LLM, PYTHON_BACKEND) in slide-rule-python/routes/sliderule_full.py and used them for all response attachment points (replaces ad-hoc literals).
- This ensures consistent fields "provenance" and "backend" (plus "source" for orchestrate) across Python responses.
- Updated test_v5_smoke.py (the Python contract test for V5 smokes) with new/hardened asserts verifying the standardized fields on sessions, plan, execute (covers python-fullpath, python-rag, python-llm cases).
- Updated migration status ledger (task table + result section for provenance contract).
- Updated this task file with implementation, tests, commands, files, final report (addresses review finding 1).

## Tests executed
- Python: slide-rule-python/tests/test_v5_smoke.py (5 tests, now includes hardened provenance field checks for standardized contract).
- Python via pytest: run under PYTHONPATH=slide-rule-python to validate import + asserts pass.
- Node: node agent-loop/src/check-mojibake.js on all edited files (md + py source).
- No Node business logic change; thin proxy behavior preserved (no edit to server/routes required for this narrow standardization).
- All commands recorded below; no silent fallbacks, degraded paths still surface explicit signals per prior.

## Commands run (exact)
- cmd /c "set PYTHONPATH=slide-rule-python && python -m pytest slide-rule-python/tests/test_v5_smoke.py -q --tb=short 2>&1"
- cmd /c "set PYTHONPATH=slide-rule-python && python -m pytest slide-rule-python/tests/test_v5_smoke.py -q -k test_orchestrate_and_execute_report_with_native_llm --tb=short 2>&1"
- cmd /c "set PYTHONPATH=slide-rule-python && python -m pytest slide-rule-python/tests/test_v5_smoke.py --collectonly -q --tb=no 2>&1"
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-provenance-contract-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md slide-rule-python/routes/sliderule_full.py slide-rule-python/tests/test_v5_smoke.py
- (also ran pre-edit diagnosis commands to inspect current fields before edits)

## Files changed
- slide-rule-python/routes/sliderule_full.py (added 4 consts for standardized provenance values; replaced all ad-hoc "python-*" / "python" literals with consts for sessions/orchestrate/execute/drive/degraded)
- slide-rule-python/tests/test_v5_smoke.py (added explicit provenance + backend asserts in health, sessions, orchestrate wrapper, execute report paths; added comments referencing standardization and task 07)
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md (updated task 7 row to completed; added full provenance contract result section)
- agent-loop/tasks/backend-python-no-node-foundation-provenance-contract-105.md (status to completed; added Implementation, Tests, Commands, Files, Worker final report)

## Worker final report
- Commands run: see exact list above (smallest relevant: pytest v5_smoke (full + -k targeted), collectonly, mojibake on edited files).
- Files changed: 4 files (2 py for standardization + hardened contract test; 2 md for status + this report).
- This task changes the no-Node backend API denominator/numerator? Denominator: no change (66/42+). Numerator: provenance fields contract for sliderule surfaces now standardized and asserted in Python (strengthens the PYTHON_FIRST_COMPAT slice for /api/sliderule without adding new full surface count; foundation surfaces provenance signal coverage increased). The canonical values are now defined in Python route (source of truth).
- Acceptance met: Python FastAPI (routes + consts + test asserts) is the backend API source for the standardized provenance fields. Browser/contract tests (test_v5_smoke) now prove the fields. Node remains documented thin compat (no ownership of signals). Migration status records ownership + risk. Commands/files/denom impact listed. Mojibake passed on edits. Degraded states still carry signals (no hiding).
- Task 07 provenance standardization complete; review findings addressed (final report added, migration status updated for task 7, test_v5_smoke now has hardened provenance asserts).
- Worker only edited task-scoped allowed files; no unrelated changes.
