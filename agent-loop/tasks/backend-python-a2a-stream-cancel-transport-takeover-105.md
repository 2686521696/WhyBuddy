# Backend Python 105: A2A stream cancel transport takeover

## Execution status
- Status: completed
- Goal: Move A2A stream and cancel transport semantics to Python-owned runtime.
- Queue: `backend-python-total-cutover-105-queue`
- Phase: A2A
- Sequence: 35 / 48

## Context
This task is part of the single-batch NodeJS-to-Python total cutover push. The intent is to reduce real Node business ownership, not to add another thin classification slice. Treat `agent-loop/tasks/000-nodejs-to-python-migration-status.md` as the current denominator map and use the 104 evidence as the baseline.

## Allowed files
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `agent-loop/tasks/backend-python-a2a-stream-cancel-transport-takeover-105.md`
- `server/routes/a2a.ts`
- `server/core/a2a-server.ts`
- `shared/a2a-protocol.ts`
- `slide-rule-python/services/a2a_runtime.py`

## Evidence to read
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `agent-loop/scripts/backend-python-total-cutover-105-queue.json`
- Previous 105 queue tasks 1-34 when their outputs are relevant.
- Existing Python and Node tests near the files listed above

## Required implementation
1. Implement Python stream chunks, cancel, timeout, and retry envelope.
2. Bridge Node SSE/stream routes to Python transport.
3. Test stream ordering, cancel idempotency, timeout, and malformed chunks.

## Required tests
- Add or update Python tests under `slide-rule-python/tests/` for the Python-owned behavior.
- Add or update Node/Vitest tests under `server/**/__tests__/` or `server/tests/` proving Node is a thin proxy or explicit retained compatibility shell.
- Run the smallest relevant Python and Node test commands and record them in the final task update.
- Keep or add a mojibake check for this task and every edited non-generated markdown/code file named by the queue gate.

## Do not
- Do not count docs-only, no-diff, skipped-live, synthetic, external-owned, or retained Node fallback as Python migration completion.
- Do not remove public API compatibility without a Node bridge or explicit frontend update.
- Do not hide Python failures behind silent Node success; degraded and fallback states must be visible.
- Do not edit unrelated frontend polish or AgentLoop dashboard layout unless the task explicitly names it.

## Acceptance criteria
- The task lands real Python-owned runtime, production wiring, frontend integration, or an executable cutover guard matching the goal.
- Tests prove the Python path is exercised and that Node no longer owns migrated business semantics.
- Any remaining Node behavior is named as thin proxy, compatibility shell, or explicitly retained boundary with a reason.
- The worker final report lists commands run, files changed, and whether the migration numerator can change.

## Worker final report (post-fix for review_needs_changes)
- Status: changed (address review: make py transport failure for cancel return non-CANCELLED main code in handleCancel; tighten report language)
- Commands run (smallest relevant):
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-a2a-stream-cancel-transport-takeover-105.md server/core/a2a-server.ts
  - python -m pytest slide-rule-python/tests/test_a2a_stream_runtime_boundary.py -q --tb=line
  - npx vitest run -c vitest.config.server.ts server/routes/__tests__/a2a-python-stream-runtime.test.ts --passWithNoTests
  - node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); }\" agent-loop/tasks/backend-python-a2a-stream-cancel-transport-takeover-105.md
- Files changed (this fix): server/core/a2a-server.ts , agent-loop/tasks/backend-python-a2a-stream-cancel-transport-takeover-105.md
- (prior files per impl: slide-rule-python/services/a2a_runtime.py, server/routes/a2a.ts, shared/a2a-protocol.ts, slide-rule-python/tests/test_a2a_stream_runtime_boundary.py, server/routes/__tests__/a2a-python-stream-runtime.test.ts)
- Tests: Prior real Vitest (handleStream/handleCancel + route via fetch with execSync mock) + py tests cover ordering/idempotency/timeout/malformed/degraded. This fix ensures handleCancel py-fail path returns FRAMEWORK_ERROR (visible non-success) instead of CANCELLED; route /cancel CANCELLED->200 only applies to successful py cancel path. Degraded is now main error code (5xx path).
- Mojibake: clean (ran on task + edited .ts)
- Migration numerator: yes for this slice (Python-owned runtime for stream chunks/cancel/timeout/retry/malformed in a2a_runtime.py exercised via Node thin proxy bridge in A2AServer + direct in routes for timeout/cancel; Node no longer owns the transport semantics).
- Explicit: Node A2AServer/routes are thin proxy (delegate start/emit via handleStream, cancel/timeout direct in some paths to py a2a_runtime); stream start/emit/retry go through A2AServer delegation (not direct route bridge), route direct transport limited to timeout/cancel. Degraded surfaces (no silent Node success on py fail).
- Gate note: handleCancel py-fail now uses FRAMEWORK_ERROR not CANCELLED, satisfying "Do not hide Python failures behind silent Node success". Report language tightened per review (no overclaim on route /stream direct transport).
- Actual commands run and results (this fix round):
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-a2a-stream-cancel-transport-takeover-105.md server/core/a2a-server.ts  => exit 0, "No mojibake findings."
  - python -m pytest slide-rule-python/tests/test_a2a_stream_runtime_boundary.py -q --tb=line  => exit 0, "7 passed in 0.12s"
  - npx vitest run -c vitest.config.server.ts server/routes/__tests__/a2a-python-stream-runtime.test.ts --passWithNoTests  => exit 0, "8 passed (8)"
  - node -e (section check)  => exit 0, "sections OK"
- Files changed for this review fix: server/core/a2a-server.ts, agent-loop/tasks/backend-python-a2a-stream-cancel-transport-takeover-105.md
- No test files or unrelated files edited. All safety guards followed (real tests not rewritten).
