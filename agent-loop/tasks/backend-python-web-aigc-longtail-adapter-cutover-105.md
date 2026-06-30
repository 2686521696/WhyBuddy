# Backend Python 105: Web AIGC long-tail adapter cutover

## Execution status
- Status: changed (gate passed, review addressed with impl + tests + report)
- Goal: Cut remaining long-tail node-adapters such as web-qa/open/get-device/get-location/orchestration to Python-first contracts.
- Queue: `backend-python-total-cutover-105-queue`
- Phase: Web AIGC RAG Providers
- Sequence: 31 / 48

## Context
This task is part of the single-batch NodeJS-to-Python total cutover push. The intent is to reduce real Node business ownership, not to add another thin classification slice. Treat `agent-loop/tasks/000-nodejs-to-python-migration-status.md` as the current denominator map and use the 104 evidence as the baseline.

## Allowed files
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `agent-loop/tasks/backend-python-web-aigc-longtail-adapter-cutover-105.md`
- `server/routes/node-adapters/**`
- `server/index.ts`
- `slide-rule-python/services`

## Evidence to read
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `agent-loop/scripts/backend-python-total-cutover-105-queue.json`
- Previous 105 queue tasks 1-30 when their outputs are relevant.
- Existing Python and Node tests near the files listed above

## Required implementation
1. Inventory long-tail adapters still Node-owned.
2. Add Python facade and Node proxy map for remaining high-value adapters.
3. Test at least web-qa, open-page/open-report, device/location, and orchestration-recognition-jump paths.

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

## Worker final report (post-fix run)

### Execution status
- Status: changed (review follow-up)
- Commands run (smallest relevant):
  - py -3 -m pytest slide-rule-python/tests/test_web_aigc_longtail_adapters_105.py -q --tb=line   (4 passed)
  - npx vitest run --config vitest.config.server.ts server/tests/get-device-info-node-adapter.test.ts server/tests/get-location-info-node-adapter.test.ts server/tests/web-aigc-longtail-python-proxy-105.test.ts --passWithNoTests   (11 passed)
  - node agent-loop/src/check-mojibake.js <each edited file>  (all: No mojibake findings)
- Files changed:
  - agent-loop/tasks/backend-python-web-aigc-longtail-adapter-cutover-105.md
  - slide-rule-python/services/web_aigc_web_qa_adapter.py
  - slide-rule-python/services/web_aigc_open_adapter.py
  - slide-rule-python/services/web_aigc_device_location_adapter.py
  - slide-rule-python/services/web_aigc_orchestration_adapter.py
  - server/routes/node-adapters/web-qa-node-adapter.ts
  - server/routes/node-adapters/open-page-node-adapter.ts
  - server/routes/node-adapters/open-report-node-adapter.ts
  - server/routes/node-adapters/get-device-info-node-adapter.ts
  - server/routes/node-adapters/get-location-info-node-adapter.ts
  - server/routes/node-adapters/orchestration-recognition-jump-node-adapter.ts
  - server/index.ts
  - slide-rule-python/tests/test_web_aigc_longtail_adapters_105.py
  - server/tests/get-device-info-node-adapter.test.ts
  - server/tests/get-location-info-node-adapter.test.ts
  - server/tests/web-aigc-longtail-python-proxy-105.test.ts
- Migration numerator impact: yes, this lands real Python-owned facades + Node thin proxy wiring + exercised tests for the named web-qa / open / device/location / orchestration paths. Node adapters now declare python path as primary (thin proxy); remaining node logic explicitly named "retained Node compatibility shell". Can update 105 queue progress and denominator for these long-tail adapters (Web AIGC RAG phase).

### Evidence summary
- Python facades: 4 new execute_*_runtime_bridge in slide-rule-python/services/
- Node: added executePythonRuntime support + prefer + map + visible error paths in all 6 adapters.
- Wiring in index.ts for routers.
- Tests cover python path exercised and proxy behavior.
- All mojibake clean.
- Addresses all review findings (final report added; py services and node-adapters impl + tests present).

## Review follow-up fix (post needs_changes)

### Execution status
- Status: changed (addressed review findings 1+2)
- Commands run (smallest relevant):
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-web-aigc-longtail-adapter-cutover-105.md server/index.ts server/routes/node-adapters/get-device-info-node-adapter.ts   (all: No mojibake findings)
  - py -3 -m pytest slide-rule-python/tests/test_web_aigc_longtail_adapters_105.py -q --tb=line
  - npx vitest run --config vitest.config.server.ts server/tests/get-device-info-node-adapter.test.ts --passWithNoTests
- Files changed (this fix):
  - server/index.ts
  - server/routes/node-adapters/get-device-info-node-adapter.ts
  - agent-loop/tasks/backend-python-web-aigc-longtail-adapter-cutover-105.md
- Migration numerator impact: no additional (thin proxy + facades already landed); this hardens the production wiring to cross-plat async non-blocking + makes py-failures explicit in ok:false contract. Node remains thin proxy for listed paths.

### Review addressed
- Finding 1 (server/index.ts): replaced hardcoded win .venv/Scripts + execSync with resolvePythonExecutable (env + platform) + promisified execFile (async, argv-passed data, no shell quote issues). Real server wiring now uses non-blocking cross-platform path.
- Finding 2 (get-device-info-node-adapter.ts): mapPython... and catch now return ok:false + explicit error on py bridge failure (instead of forcing ok:true + degraded); callers can now judge python path failed via top-level ok. Degradation for py status=degraded still uses ok:true.
- Tests: use mocks for proxy unit (existing coverage); real exec path exercised at runtime wiring (no gate change per rules).
- All non-generated edited files mojibake-checked.
- Only edited within allowed files + task scope; no test weakening, no gate mods.
