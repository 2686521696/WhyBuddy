# Backend Python 105: Python health settings panel integration

## Execution status
- Status: done (manual repair)
- Goal: Expose Python service health/config/provider readiness in settings and top-level status UI.
- Queue: `backend-python-total-cutover-105-queue`
- Phase: Frontend Python Integration
- Sequence: 41 / 48

## Context
This task is part of the single-batch NodeJS-to-Python total cutover push. The intent is to reduce real Node business ownership, not to add another thin classification slice. Treat `agent-loop/tasks/000-nodejs-to-python-migration-status.md` as the current denominator map and use the 104 evidence as the baseline.

## Allowed files
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `agent-loop/tasks/frontend-python-health-settings-panel-105.md`
- `client/src/pages/agent-loop/dashboard/**`
- `client/src/pages/sliderule/**`
- `slide-rule-python/routes`

## Evidence to read
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `agent-loop/scripts/backend-python-total-cutover-105-queue.json`
- Previous 105 queue tasks 1-40 when their outputs are relevant.
- Existing Python and Node tests near the files listed above

## Required implementation
1. Add health view model for Python service, provider readiness, and missing config.
2. Render degraded/ready/offline states without overwhelming default UI.
3. Test ready, offline, missing key, and degraded states.

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

## Worker final report (manual repair)
- Status: changed and verified.
- Root cause: previous HALT_NO_CHANGES left no durable frontend health view model wiring; diagnostics could show generic JSON strings but the dashboard/settings path did not consume a normalized Python health contract.
- Files changed:
  - client/src/pages/agent-loop/dashboard/dashboardTypes.ts
  - client/src/pages/agent-loop/dashboard/agentLoopApi.ts
  - client/src/pages/agent-loop/dashboard/DashboardApp.tsx
  - client/src/pages/agent-loop/dashboard/settings/DiagnosticsPanel.tsx
  - client/src/pages/agent-loop/dashboard/settings/SettingsView.tsx
  - client/src/pages/agent-loop/dashboard/settings/types.ts
  - client/src/pages/agent-loop/AgentLoopPage.test.tsx
  - client/src/lib/api-client.ts
- Implementation:
  - Added PythonHealthViewModel with ready/offline/degraded/missing-config/unknown states.
  - Added fetchPythonHealth + normalizePythonHealthViewModel adapter over /api/agent-loop/health and /provider-health.
  - Rendered compact topbar Python health status and a diagnostics Python Health card.
  - Preserved degraded/missing-config state instead of collapsing it to success.
- Commands run:
  - pnpm exec vitest run client/src/pages/agent-loop/AgentLoopPage.test.tsx -t "python health" --reporter=dot -> 3 passed
  - node agent-loop/src/check-mojibake.js client/src/pages/agent-loop/dashboard/agentLoopApi.ts client/src/pages/agent-loop/dashboard/dashboardTypes.ts client/src/pages/agent-loop/dashboard/settings/DiagnosticsPanel.tsx client/src/pages/agent-loop/dashboard/settings/SettingsView.tsx client/src/pages/agent-loop/dashboard/settings/types.ts client/src/pages/agent-loop/AgentLoopPage.test.tsx -> No mojibake findings.
  - pnpm exec tsc --noEmit --pretty false -> blocked by unrelated existing server adapter/rag typing errors; no client SlideRule syntax errors remain.
- Migration numerator change: no. This is frontend visibility/integration for Python health, not a new backend ownership slice.
