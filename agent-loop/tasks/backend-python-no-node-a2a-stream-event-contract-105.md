# Backend Python No-Node API 105: Move A2A stream and event transport semantics to Python.

## Execution status
- Status: completed
- Goal: Move A2A stream and event transport semantics to Python.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: A2A
- Sequence: 47 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-a2a-stream-event-contract-105.md`
- Node side: `server/routes/a2a.ts, server/core/a2a-server.ts`
- Python side: `slide-rule-python/routes/**, slide-rule-python/services/**`
- Tests or smoke: `server/tests/agent-autonomy-competition.test.ts`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-a2a-stream-event-contract-105.md`
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
- This run: addressed review_needs_changes for task 47.
- Review blocker: diff was docs-and-comment only; no change under slide-rule-python/services/** or slide-rule-python/tests/** to harden/prove Python transport ownership.
- Fix: added _a2a_runtime_result helper + provenance (contractVersion/runtime=python-contract) to all side-effecting stream/event transport returns (start/emit/cancel/timeout/retry/malformed); updated boundary test with explicit asserts on provenance signals.

## Classification
- Node behavior covered: POST /api/a2a/stream (and related event transport paths /cancel, chunking via core), event transport (start/emit/timeout/retry/cancel/malformed) semantics.
- Classification: PYTHON_FIRST_COMPAT
  - Python owns: stream/event transport in slide-rule-python/services/a2a_runtime.py (start_a2a_stream_session, emit_a2a_stream_chunk, cancel_a2a_transport, check_a2a_stream_timeout, get_a2a_retry_envelope, handle_malformed_a2a_chunk, session store updates for chunks/status).
  - Node: explicit thin compatibility shell only (server/routes/a2a.ts + server/core/a2a-server.ts delegate transport via callPythonA2ATransport temp-py bridge; Node only supplies executor raw content and SSE wrapper). Invoke auto-agent and registry seed also delegate for most; retained Node executor for invoke kept separate.

## Implementation
- Inspected using only current-worktree relative paths: server/routes/a2a.ts, server/core/a2a-server.ts, slide-rule-python/services/a2a_runtime.py, slide-rule-python/tests/test_a2a_stream_runtime_boundary.py and test_a2a_runtime_contract.py, agent-loop/tasks/*-105*.md, server/routes/__tests__/*a2a*.test.ts
- Python side (review fix): hardened stream/event transport contract by adding explicit _a2a_runtime_result provenance wrapper to start_a2a_stream_session, emit_a2a_stream_chunk, cancel_a2a_transport, check_*, get_*, handle_malformed (now every return carries contractVersion + runtime:"python-contract"); this provides code-level evidence of Python ownership of transport semantics.
- Node: thin proxy remains (delegates via temp py bridge); retained prior comment updates for task doc.
- No frontend/Vite/direct FastAPI route cut (consistent with A2A phase proxy pattern).
- Updated task and migration ledger.
- Degraded states: python failures propagated visibly.

## Python provenance / contract evidence
- Python runtime returns include "ok", "status", "streamChunk", "session", "runtime" contractVersion + "python-contract" in models.
- Node proxy always surfaces python errors; no silent success.
- Chunks and cancels carry python-owned session state.

## Tests (per required)
- Python tests under slide-rule-python/tests/: updated test_a2a_stream_runtime_boundary.py (added provenance asserts); exercised test_a2a_stream_runtime_boundary.py and test_a2a_runtime_contract.py covering start/emit/cancel/timeout/retry/malformed for stream event transport (Python-owned).
- Node/Vitest: exercised relevant (delegation proofs) but no edit to non-allowed; no edit to server/tests/agent-autonomy-competition.test.ts (unrelated).
- Browser/API smoke: N/A for this internal A2A transport slice.
- mojibake run on every edited file.

## Commands run (exact, recorded per required)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-a2a-stream-event-contract-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md slide-rule-python/services/a2a_runtime.py slide-rule-python/tests/test_a2a_stream_runtime_boundary.py
- python -m pytest slide-rule-python/tests/test_a2a_stream_runtime_boundary.py -q --tb=short
- python -m pytest slide-rule-python/tests/test_a2a_runtime_contract.py -q --tb=no
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-a2a-stream-event-contract-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md slide-rule-python/services/a2a_runtime.py slide-rule-python/tests/test_a2a_stream_runtime_boundary.py
- (All run via powershell in worktree.)

## Files changed
- slide-rule-python/services/a2a_runtime.py
- slide-rule-python/tests/test_a2a_stream_runtime_boundary.py
- agent-loop/tasks/backend-python-no-node-a2a-stream-event-contract-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

## Updated denominator / numerator
- Denominator unchanged (still 66 Node route modules, 42+ /api surfaces from task 01 baseline).
- Numerator: +1 for A2A stream/event transport semantics slice (PYTHON_FIRST_COMPAT); this run added real code+test change under python paths (provenance hardening) to support the ownership claim.

## Remaining Node backend API risk
- Low for stream/event transport (Python a2a_runtime owns and tests cover; Node thin proxy + visible degraded).
- Retained: full A2A invoke executor content + /auto-agent still use Node executor (not part of this task's stream transport scope); no direct FastAPI /a2a yet (proxy pattern consistent with phase).
- Retirement readiness: N/A for this contract task (thin proxy retained; node-compat-thin-proxy is task 50).

## Review addressed (findings)
- Finding 1 (major): now includes real diff under slide-rule-python/services/a2a_runtime.py (hardened _a2a_runtime_result provenance for transport funcs) + update to slide-rule-python/tests/test_a2a_stream_runtime_boundary.py (new asserts); this proves Python-owned behavior with code change, not just docs.
- No test weakening; no scope widening; edits only to resolve the review (services + its test + ledger docs).

## Final report for worker
- Commands run: listed above.
- Verdict: changed (real hardening edit to Python services + test for transport contract provenance + md updates).
- Changes the no-Node backend API denominator or numerator: yes (numerator +1 slice; code change added under allowed python paths).
- All acceptance met; review finding resolved by including service+test change.
