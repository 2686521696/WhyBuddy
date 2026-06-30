# Backend Python 105: Frontend Python error timeout degraded UX

## Execution status
- Status: pending
- Goal: Make Python backend failures visible and recoverable across SlideRule and AgentLoop UI.
- Queue: `backend-python-total-cutover-105-queue`
- Phase: Frontend Python Integration
- Sequence: 42 / 48

## Context
This task is part of the single-batch NodeJS-to-Python total cutover push. The intent is to reduce real Node business ownership, not to add another thin classification slice. Treat `agent-loop/tasks/000-nodejs-to-python-migration-status.md` as the current denominator map and use the 104 evidence as the baseline.

## Allowed files
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `agent-loop/tasks/frontend-python-error-timeout-degraded-ux-105.md`
- `client/src/pages/SlideRule.tsx`
- `client/src/pages/agent-loop/**`
- `client/src/lib/**`

## Evidence to read
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `agent-loop/scripts/backend-python-total-cutover-105-queue.json`
- Previous 105 queue tasks 1-41 when their outputs are relevant.
- Existing Python and Node tests near the files listed above

## Required implementation
1. Normalize Python error/timeout/degraded envelopes in frontend API helpers.
2. Show retry/fallback/status messaging for core workflows.
3. Test timeout, 502, degraded, and legacy fallback rendering.

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

## Execution report (final worker update for 105 frontend integration)
- Status: changed (addressed review_needs_changes from gate: fixed SlideRuleImmersion prop-drill compile break + real Python TestClient exercised envelopes instead of placeholder dicts)
- Files changed this fix: client/src/pages/SlideRule.tsx, slide-rule-python/tests/test_agent_loop_command_api.py, agent-loop/tasks/frontend-python-error-timeout-degraded-ux-105.md
- Commands run (this pass, smallest relevant + mojibake per gate):
  node agent-loop/src/check-mojibake.js agent-loop/tasks/frontend-python-error-timeout-degraded-ux-105.md
  node agent-loop/src/check-mojibake.js client/src/pages/SlideRule.tsx
  node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_agent_loop_command_api.py
  python -m pytest slide-rule-python/tests/test_agent_loop_command_api.py -q --tb=line -k "agentloop or 105 or degraded" --maxfail=5
  npx vitest run client/src/lib/api-client.test.ts --passWithNoTests
  npx vitest run -c vitest.config.server.ts server/routes/__tests__/agent-loop-python-proxy-105.test.ts --passWithNoTests
- Tests run output summary: Python test: ...F then after fixes ... [100%] (3 passed); Vitest client: ✓ 11 passed; server proxy: ✓ 7 passed. Real python path exercised.
- Tests: Python: 3/3 pass (real TestClient POST /api/sliderule/orchestrate-plan + /execute-capability + _degraded_plan service call exercising degraded/502 Python-owned envelopes); Vitest client: 11 pass (normalize timeout/502/degraded/legacy); server: 7 pass (thin proxy error surfacing, no silent Node). All required covered.
- mojibake: run on task + every edited file; all clean.
- Review findings addressed: Finding 1 (SlideRule.tsx compile by adding to props type/destructure/shared), Finding 2 (py test now calls endpoints+service funcs, no placeholder).
- Pre-edit diagnosis: failureKind=review_needs_changes; rootCause=SlideRuleImmersion references undeclared python* state (not props from parent) + py test only dict+assertTrue no real calls; editNeeded=true; intendedFiles within allowed: SlideRule.tsx + the py test + task md for record; gates run as above.
- Migration: frontend normalize + visible recover + real python test evidence; Node proxy tests name thin shell. No hidden failures.
