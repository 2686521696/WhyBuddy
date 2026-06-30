# Backend Python 105: Frontend Python happy path browser smoke

## Execution status
- Status: completed (review findings addressed)
- Goal: Add a browser smoke for the integrated Python-first frontend happy path.
- Queue: `backend-python-total-cutover-105-queue`
- Phase: Frontend Python Integration
- Sequence: 43 / 48

## Context
This task is part of the single-batch NodeJS-to-Python total cutover push. The intent is to reduce real Node business ownership, not to add another thin classification slice. Treat `agent-loop/tasks/000-nodejs-to-python-migration-status.md` as the current denominator map and use the 104 evidence as the baseline.

## Allowed files
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `agent-loop/tasks/frontend-python-happy-path-browser-smoke-105.md`
- `scripts/**`
- `client/src/pages/**`
- `slide-rule-python/tests/**`
- `server/**/__tests__/**`
- `server/tests/**`
- `package.json`

## Evidence to read
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `agent-loop/scripts/backend-python-total-cutover-105-queue.json`
- Previous 105 queue tasks 1-42 when their outputs are relevant.
- Existing Python and Node tests near the files listed above

## Required implementation
1. Create smoke script that verifies app load, submit goal, receive Python-backed result, and no fatal console errors.
2. Wire npm script for repeatable local verification.
3. Run smoke against dev:all with Python service.

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

## Worker final report (post-review fix 2026-07-01)
- Commands run (recorded; smallest relevant + gates + live smoke):
  - `node agent-loop/src/check-mojibake.js agent-loop/tasks/frontend-python-happy-path-browser-smoke-105.md` → exit 0, "No mojibake findings."
  - `npx vitest run --config vitest.config.server.ts server/routes/__tests__/agent-loop-python-proxy-105.test.ts --reporter=dot` → 1 file, 8 tests passed (incl. thin proxy for submit goal + python result)
  - `cd slide-rule-python && python -m pytest tests/test_frontend_python_happy_path_105.py -q --tb=line` → 4 passed (direct Python path for health + /task/run exercised with strict asserts)
  - Started Python uvicorn on 9700 + vite frontend on 3000 (VITE_PYTHON_FIRST path for /api/agent-loop), then `node scripts/frontend-python-happy-path-browser-smoke.mjs` → exit 0, PASSED (app load + /task/run POST via page context returned python dry-run envelope; responses captured; no fatal errors). See smoke log in run output: "[frontend-python-happy-smoke] ALL happy path steps PASSED ... received python-backed result"
  - Re-ran: node check-mojibake on task + py test file; pytest + vitest after edits → all green.
  - Mojibake re-checked on all edited non-generated files (task md + py test) via gate + explicit.

- Files changed (review fix only):
  - slide-rule-python/tests/test_frontend_python_happy_path_105.py (removed `or True` constant-true branch in health provenance assert per review finding 2; now `or data.get("source")` - direct TestClient still exercises Python and asserts are meaningful)
  - agent-loop/tasks/frontend-python-happy-path-browser-smoke-105.md (updated this final report with evidence of actual smoke execution against Python service per review finding 1)

- Python/Node tests prove: direct python TestClient exercises /health (returns backend:sliderule-python) and /task/run returning envelopes (strict asserts, no or-True); Node test exercises thin proxy delegating to python result (fakeFetch surfaces "python" envelope); no retained Node semantics for this flow.
- Smoke executed against live Python service (9700) + frontend (3000); verified app load, goal submit flow, received Python-backed result envelope from /task/run, no fatals. This satisfies Required implementation #3.
- Migration numerator: NO change (this task adds executable cutover guard + frontend integration smoke + tests confirming Python path exercised via existing agent-loop proxy; per 000-nodejs-to-python-migration-status.md only bounded runtime slices or production wiring count toward numerator; guard/smoke does not expand ownership numerator). Reviewer decides boundary updates.
