# Backend Python 105: A2A registry session takeover

## Execution status
- Status: pending
- Goal: Move A2A agent registry and session state to Python-owned runtime.
- Queue: `backend-python-total-cutover-105-queue`
- Phase: A2A
- Sequence: 34 / 48

## Context
This task is part of the single-batch NodeJS-to-Python total cutover push. The intent is to reduce real Node business ownership, not to add another thin classification slice. Treat `agent-loop/tasks/000-nodejs-to-python-migration-status.md` as the current denominator map and use the 104 evidence as the baseline.

## Allowed files
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `agent-loop/tasks/backend-python-a2a-registry-session-takeover-105.md`
- `server/routes/a2a.ts`
- `server/core/a2a-server.ts`
- `server/core/a2a-client.ts`
- `slide-rule-python/services/a2a_runtime.py`

## Evidence to read
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `agent-loop/scripts/backend-python-total-cutover-105-queue.json`
- Previous 105 queue tasks 1-33 when their outputs are relevant.
- Existing Python and Node tests near the files listed above

## Required implementation
1. Implement Python registry/session store operations.
2. Route Node A2A registry/sessions endpoints to Python-first adapter.
3. Test register/list/session create/read/update and missing agent.

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

## Post-review-fix execution report (addresses review findings 1,2,3,4)

### Pre-edit diagnosis
- failureKind: review_needs_changes
- rootCause: callPythonA2ASessionStore (and routes adapter) only hardcoded venv python (absent in "no venv here" env) and swallowed exceptions from create/update/get/list/terminate (and getActive in routes fallback) so invoke/stream continued and returned normal A2A responses/[] when py session store unavailable.
- editNeeded: true
- intendedFiles: ["server/core/a2a-client.ts", "server/routes/a2a.ts", "agent-loop/tasks/backend-python-a2a-registry-session-takeover-105.md"]
- gatesToRun: mojibake + section checks on md + ts; py pytest + python -c for register/list/get + session create/read/update/list + missing agent; vitest on server/tests/a2a-routes.test.ts and server/routes/__tests__/a2a-python-runtime-contract.test.ts

### Files changed (relative, only allowed)
- server/core/a2a-client.ts
- server/routes/a2a.ts
- agent-loop/tasks/backend-python-a2a-registry-session-takeover-105.md

### Commands run (smallest relevant + gate)
- `node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-a2a-registry-session-takeover-105.md server/core/a2a-client.ts server/routes/a2a.ts` → "No mojibake findings."
- `node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } console.log('sections ok') " agent-loop/tasks/backend-python-a2a-registry-session-takeover-105.md` → sections ok
- (repeated mojibake + section after edits)
- `python -m pytest slide-rule-python/tests/test_a2a_runtime_contract.py -q --tb=line` → 7 passed in 0.09s
- `python -c "..."` (register/get/list + create/read/update/list_active + get missing + "Python-owned store exercised successfully") → ok
- `npx vitest run -c vitest.config.server.ts server/tests/a2a-routes.test.ts --passWithNoTests` → 14 passed (1 file)
- `npx vitest run -c vitest.config.server.ts server/routes/__tests__/a2a-python-runtime-contract.test.ts --passWithNoTests` → 3 passed (1 file)
- (stores cleaned before vitest runs to ensure fresh asserts; tests exercise py via ctor seed for /agents and client.getActive for sessions shell)
- `node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-a2a-registry-session-takeover-105.md server/core/a2a-client.ts server/routes/a2a.ts` (final) → "No mojibake findings."

### Implementation addressing review
- Finding 1 (blocker): in a2a-client, create in invoke now errors with explicit INTERNAL + {degraded:true, pythonError, source} on py session create fail (instead of silent catch+proceed); stream create throws early (no external http + normal yield); updates/get/list/terminate/cancel now record pythonSessionError on fail (instead of blind catch{}); getActive/get/terminate return []/undef on fail but error state recorded. No path returns normal A2A success when py session create unavailable.
- Finding 2 (major): callPythonA2ASessionStore rewritten with venv+system candidates + temp .py runner (identical pattern to a2a-server registry); no longer only-venv, works in "no venv here" using system python + sys.path; always throws on failure so callers can surface.
- Finding 3 (major): callPythonA2ARegistrySessions in routes rewritten with venv+system+temp.py (no longer only-venv); /agents still falls to listExposed (compat shell) only on py error with degraded; /sessions catch now returns {sessions:[], degraded:true, pythonError, source} without calling a2aClient.getActiveSessions (which would swallow to []); direct py path for both endpoints.
- Finding 4 (minor): this report now accurately lists exactly the files changed in this fix (client+routes+md); previous report overstated narrow scope.
- Retained: listExposedAgents and A2AClient ctor compat + getActive on py fail return [] are explicit thin proxy / compat shell boundaries (no public API break, as before). Runtime critical paths (create for invoke/stream, get for agents/sessions) are py-first.
- Python-owned exercised: registry seeds and list/get via py in routes+server tests; session stores via robust callPython in client (create blocks success on fail).

### Migration numerator
Real Python-owned runtime for registry (register/get) and sessions (create/read/update/list/terminate) via file-backed py; Node a2a-server/client/routes are thin proxies or explicit compat shells. No silent Node success on py failure. Per acceptance, A2A slice numerator can change.

Mojibake re-checked on edited md + ts files.
Sections verified.
