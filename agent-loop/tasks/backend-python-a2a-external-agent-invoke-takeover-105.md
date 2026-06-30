# Backend Python 105: A2A external agent invoke takeover

## Execution status
- Status: pending
- Goal: Move external-agent invocation boundary and safe-failure handling into Python.
- Queue: `backend-python-total-cutover-105-queue`
- Phase: A2A
- Sequence: 36 / 48

## Context
This task is part of the single-batch NodeJS-to-Python total cutover push. The intent is to reduce real Node business ownership, not to add another thin classification slice. Treat `agent-loop/tasks/000-nodejs-to-python-migration-status.md` as the current denominator map and use the 104 evidence as the baseline.

## Allowed files
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `agent-loop/tasks/backend-python-a2a-external-agent-invoke-takeover-105.md`
- `server/routes/a2a.ts`
- `server/core/a2a-client.ts`
- `slide-rule-python/services/a2a_runtime.py`

## Evidence to read
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `agent-loop/scripts/backend-python-total-cutover-105-queue.json`
- Previous 105 queue tasks 1-35 when their outputs are relevant.
- Existing Python and Node tests near the files listed above

## Required implementation
1. Implement Python external agent invoke provider contract with no-key degraded mode.
2. Delegate Node invoke paths to Python-first service.
3. Test missing endpoint, provider failure, success, and permission metadata.

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

## Execution evidence (post-review fix)
- Python external agent invoke provider contract: invoke_external_a2a_agent + _adapt_* + no-key degraded + missing-endpoint error + provider failure + success + permissionMetadata all in slide-rule-python/services/a2a_runtime.py (Python-owned).
- A2AClient.invoke (external path) is thin proxy: fully delegates to callPythonA2AExternalInvoke which calls Python provider for adapter/fetch/response/safe-fail (no Node ownership of those semantics).
- server/routes/a2a.ts /invoke: explicitly named retained compatibility shell for inbound local-executor invokes via handleInvoke (registry lookup is py-delegated; external invoke not owned here). Does not count for this migration target.
- Remaining Node: stream/invokeStream + concurrent limit check + local executor in handleInvoke kept as explicit retained boundaries (reason: local compat; degraded always visible).
- Python tests (slide-rule-python/tests/test_a2a_invoke_runtime_bridge.py): missing, no-key degraded, provider failure, success-with-stub + permission metadata. All exercised real contract.
- Node/Vitest tests (server/tests/a2a-protocol.test.ts): 3 new specific tests using controllable py delegate results: missing-endpoint (exact msg+data), provider-failure, no-key degraded + permissionMetadata attach. Proves py path exercised; Node no longer owns adapter/fetch semantics for external.
- Commands run (see run logs):
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-a2a-external-agent-invoke-takeover-105.md
  - node agent-loop/src/check-mojibake.js server/routes/a2a.ts
  - node agent-loop/src/check-mojibake.js server/tests/a2a-protocol.test.ts
  - node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_a2a_invoke_runtime_bridge.py
  - python -m pytest slide-rule-python/tests/test_a2a_invoke_runtime_bridge.py -q --tb=line
  - npx vitest run server/tests/a2a-protocol.test.ts -t "A2AClient external invoke" --passWithNoTests
- Files changed (this fix): server/routes/a2a.ts, server/tests/a2a-protocol.test.ts, slide-rule-python/tests/test_a2a_invoke_runtime_bridge.py, agent-loop/tasks/backend-python-a2a-external-agent-invoke-takeover-105.md
- Migration: Python-owned external agent invoke runtime + contract + tests landed. Node paths for external are thin proxy. Numerator can change for this A2A external-invoke slice. (Route inbound local kept retained, not claimed as Python external.)
