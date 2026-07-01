# Backend Python No-Node API 105: Move execute-capability semantics to Python and keep Node as explicit compat only.

## Execution status
- Status: pending
- Goal: Move execute-capability semantics to Python and keep Node as explicit compat only.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: SlideRule
- Sequence: 12 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-sliderule-execute-capability-contract-105.md`
- Node side: `server/routes/sliderule.ts, server/sliderule/**, shared/blueprint/**`
- Python side: `slide-rule-python/routes/sliderule_full.py, slide-rule-python/services/**`
- Tests or smoke: `server/routes/__tests__/sliderule.execute-capability.test.ts`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-sliderule-execute-capability-contract-105.md`
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

## Classification (task 12)
- Node backend API behavior for POST /api/sliderule/execute-capability (V5 caps) classified as PYTHON_FIRST_COMPAT (per prior inventory task 09).
- Core proven subset (report.write + native LLM dialogue* / risk.analyze / structure.* / document.* / traceability.* / instruction.* / outcome.* / handoff.* / ux.preview via sliderule_llm.capabilities + mapped RAG): Python FastAPI provides dispatch, execution and standardized contract signals (provenance/backend).
- Hard boundaries (mcp.call, skill.invoke, evidence.search): routed via Python /execute-capability + capability_maps / slide_rule_executor mapped path; default is RAG fallback (python-rag); opt-in real MCP/skill runtime exercised only in dedicated tests (test_mcp_call_*). Per review, this task does not claim full external-tool semantic migration or ownership for hard boundaries without dedicated audit/contract/smoke in scope.
- Node (server/routes/sliderule.ts + python-delegation.ts): explicit thin compatibility shell only. Default SLIDERULE_V5_BACKEND=python delegates before legacy; 'legacy' env only for regression.
- No ACTIVE_NODE_BUSINESS for the dispatch surface under default. Vite sends to Python.

## Implementation
- Inspected (current-worktree relative only): server/routes/sliderule.ts (v5Backend switch + callPythonSlideRule before legacy at ~610 for listed caps incl mcp/skill/evidence), server/sliderule/python-delegation.ts, slide-rule-python/routes/sliderule_full.py (exec_cap), slide-rule-python/services/capability_maps.py (execute_mapped, execute_mcp_or_skill, execute_*), slide-rule-python/services/slide_rule_executor.py (RAG fallback for mcp/skill/evidence), sliderule_llm/capabilities.py (native LLM + python-llm for report/dialogue*), test files.
- This task hardened Python route return paths (sliderule_full.py): always ensure result.setdefault("provenance", ...) + "backend":"python" for both native LLM path and mapped RAG path (including the special if for mcp/skill/evidence/report/risk). This is provenance contract hardening (matches task 07/11), not new business semantic impl of the caps.
- Node: thin delegation (or explicit 502 degraded); no Node LLM/pool in default python mode.
- No frontend/Vite change (already targets Python for /api/sliderule/*).
- Updated docs/ledger only for accurate ownership recording (no scope expansion).

## Python tests (Python-owned behavior, narrowed per review)
- slide-rule-python/tests/test_v5_smoke.py: test_orchestrate_and_execute_report_with_native_llm (exercises execute-capability for report.write via TestClient + fake json caller, asserts provenance=="python-llm" + backend=="python"); inventory test uses mapped fake + asserts python signals.
- slide-rule-python/tests/test_capabilities.py: ~20+ execute_capability tests for native LLM caps (intent.clarify, gap.ask, critique, synthesis, rebuttal, report.write, risk.analyze, structure.decompose, document.draft, traceability, task.write, instruction, outcome, handoff, ux, evidence.search) asserting "provenance":"python-llm" + backend fields.
- slide-rule-python/tests/test_mcp_call_contract.py: explicitly tests execute_mapped for "mcp.call" asserts provenance=="python-rag" (documents fallback, not real mcp), no invented fields.
- mcp real runtime tests (opt-in) prove when runtime injected, MCP provenance used; default path is honest RAG.
- All exercised paths return python-* provenance + backend="python" signals.

## Node thin-compat tests (proves shell, not owner)
- server/routes/__tests__/sliderule.execute-capability.test.ts: 19+ python-mode cases (report.write, intent.*, gap, critique, synthesis, rebuttal, counter, structure, document, traceability, task, instruction, outcome, ux, handoff, risk, evidence.search, mcp.call, skill.invoke etc): set SLIDERULE_V5_BACKEND=python, spy on callLLMJsonWithUsage + callPoolJsonLlm (not called), assert callPythonSlideRule to /execute-capability and python provenance in response.
- Explicit task12 thin test (appended prior): "execute-capability is thin proxy only in python mode ... never owns LLM".
- Legacy Node paths under 'legacy' env kept only for regression; default always delegates.

## Commands run (smallest relevant)
- python -m pytest slide-rule-python/tests/test_capabilities.py -q --tb=no
- python -m pytest slide-rule-python/tests/test_mcp_call_contract.py -q --tb=no
- python -m pytest slide-rule-python/tests/test_v5_smoke.py -q --tb=no -k "orchestrate or inventory or report"
- npx vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts -t "delegates to Python V5 backend" --reporter=basic
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-sliderule-execute-capability-contract-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

## Files changed
- agent-loop/tasks/backend-python-no-node-sliderule-execute-capability-contract-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

## Migration denominator / numerator impact
- Denominator unchanged (66 route modules, 42+ /api/* surfaces from task 01).
- Numerator: no blanket +1 for "all V5 caps". Records proven core execute-capability dispatch + provenance contract for native/mapped subset (strengthens /api/sliderule PYTHON_FIRST_COMPAT slice signals). Hard boundaries noted with fallback contract evidence only.
- This remediation changes docs to correct overclaim; does not alter no-Node backend API count.

## Remaining Node backend API risk
- Low for execute dispatch under default (SLIDERULE_V5_BACKEND=python + Vite): Python route + signals proven for core caps; delegation tests pass; degraded visible.
- For mcp.call/skill.invoke/evidence.search: Python dispatch + RAG fallback (or runtime); full external semantics boundary documented as separate (mcp runtime tests, not this slice's primary claim). See task 13 for evidence provenance follow-up.
- Residual legacy only under explicit 'legacy'; non-V5 (github/repo) remain Node.
- Degraded from Python always surfaced.

## Final report
Task 12 (remediation): narrowed claims per review findings. Python FastAPI is the dispatch source + contract signal provider for execute-capability V5 (proven for report.write + dialogue/risk/structure family via native LLM + RAG mapped; hard caps mcp/skill/evidence use mapped RAG fallback with explicit contract test). Node is explicit thin shell (tested, no LLM ownership in python mode). Provenance hardening on sliderule_full return paths documented accurately as contract, not full semantic migration. Migration status updated with precise scope + risk note. Commands + files + impact recorded (denom unchanged; no overclaimed numerator). mojibake clean. No test changes/weakening. Real pytest + vitest run. Addresses finding 1 (no blanket claim on hard caps), finding 2 (shrunk status description), finding 3 (no describe py change as complete semantics).
