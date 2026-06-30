# Backend Python 105: A2A chat report analytics cutover

## Execution status
- Status: DONE (chat/report/analytics projection cutover implemented)
- Goal: Move A2A chat/report/analytics projections to Python-owned runtime.
- Queue: `backend-python-total-cutover-105-queue`
- Phase: A2A
- Sequence: 37 / 48

## Context
This task is part of the single-batch NodeJS-to-Python total cutover push. The intent is to reduce real Node business ownership, not to add another thin classification slice. Treat `agent-loop/tasks/000-nodejs-to-python-migration-status.md` as the current denominator map and use the 104 evidence as the baseline.

## Allowed files
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `agent-loop/tasks/backend-python-a2a-chat-report-cutover-105.md`
- `server/routes/a2a.ts`
- `server/core/a2a-server.ts`
- `slide-rule-python/services`

## Evidence to read
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `agent-loop/scripts/backend-python-total-cutover-105-queue.json`
- Previous 105 queue tasks 1-36 when their outputs are relevant.
- Existing Python and Node tests near the files listed above

## Required implementation
1. Implement Python chat/report/analytics projection service.
2. Route Node chat/report endpoints through Python-first adapter.
3. Test projection, report generation, analytics counters, and fallback visibility.

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

## Worker final report
- Commands run (smallest relevant, per required; recorded here):
  - node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_a2a_runtime_contract.py server/routes/__tests__/a2a-python-runtime-contract.test.ts agent-loop/tasks/backend-python-a2a-chat-report-cutover-105.md server/routes/a2a.ts server/core/a2a-server.ts slide-rule-python/services/a2a_runtime.py   => exit 0, "No mojibake findings."
  - node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } console.log('sections ok')" agent-loop/tasks/backend-python-a2a-chat-report-cutover-105.md => exit 0, "sections ok"
  - python -m pytest slide-rule-python/tests/test_a2a_runtime_contract.py -q --tb=line -k "record_a2a_chat_projection or generate_a2a_report or analytics or project_a2a_chat_report_analytics"   => exit 0, ".... 4 passed"
  - python -m pytest slide-rule-python/tests/test_a2a_runtime_contract.py -q --tb=line   => exit 0, "........... 11 passed in 0.12s"
  - npx vitest run --root . server/routes/__tests__/a2a-python-runtime-contract.test.ts -t "thin proxy|degraded state and pythonError" --reporter=basic --passWithNoTests   => exit 0, "Tests passed"
  - npx vitest run --root . server/routes/__tests__/a2a-python-runtime-contract.test.ts --reporter=basic --passWithNoTests   => exit 0, "Test Files 3 passed (3) Tests 12 passed (12)"
  - python -c "import sys; sys.path.insert(0,'slide-rule-python'); from services.a2a_runtime import record_a2a_chat_projection, generate_a2a_report, increment_a2a_analytics_counter, get_a2a_analytics_snapshot, project_a2a_chat_report_analytics; ... smoke calls"   => exit 0, "IMPORT_OK + CHAT/REPORT/ANALYTICS/GET/PROJECT all {'ok': True ...}"
- Files changed (relative):
  - slide-rule-python/services/a2a_runtime.py
  - server/routes/a2a.ts
  - server/core/a2a-server.ts
  - slide-rule-python/tests/test_a2a_runtime_contract.py
  - server/routes/__tests__/a2a-python-runtime-contract.test.ts
  - agent-loop/tasks/backend-python-a2a-chat-report-cutover-105.md
- Migration numerator: yes (can change). This task lands Python-owned runtime for chat/report/analytics projections (record_a2a_chat_projection, generate_a2a_report, increment/get analytics, project_) wired as Python-first in Node a2a routes+server (thin proxy + explicit compat shell only). Node no longer owns the projection business semantics. Addresses 102 retained classification for this slice. Per task acceptance and 000 map.
- Notes:
  - Python tests added to contract test covering all new projection fns + validation + project unified + degraded on unknown.
  - Node vitest updated: added mock for chatrep ops, http tests exercising /chat /report /analytics /inc via mounted router proving source: "python-a2a-..." and called exec for bridge; separate degraded test forces bridge fail and asserts ok:false + degraded:true + pythonError + node-compat* on route and server shell.
  - Full and targeted pytest/vitest passed.
  - Python path exercised directly (smoke + pytest); Node no longer owns semantics.
  - Degraded/fallback always emit pythonError + degraded:true .
  - mojibake passed on md + all edited code + test files.
  - No test weakening, no gate changes, stayed in scope (only added required tests for review findings).
  - No unrelated frontend or other files touched.
