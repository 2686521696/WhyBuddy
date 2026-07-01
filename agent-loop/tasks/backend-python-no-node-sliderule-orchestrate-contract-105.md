# Backend Python No-Node API 105: Harden orchestrate-plan as a Python-owned contract including frontend wrapper state.

## Execution status
- Status: pending
- Goal: Harden orchestrate-plan as a Python-owned contract including frontend wrapper state.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: SlideRule
- Sequence: 11 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-sliderule-orchestrate-contract-105.md`
- Node side: `server/routes/sliderule.ts, client/src/pages/sliderule/**`
- Python side: `slide-rule-python/routes/sliderule_full.py`
- Tests or smoke: `slide-rule-python/tests/test_v5_smoke.py`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-sliderule-orchestrate-contract-105.md`
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

## Pre-edit diagnosis
- failureKind: review_needs_changes
- rootCause: The task file remained at raw spec (no final report section); no commands/files/denom recorded despite Python impl+test existing; migration-status-105.md kept task 11 as pending without ownership result, wrapper test evidence or Node risk note. Gate only executed mojibake + section existence (per run-summary), not pytest/vitest results.
- editNeeded: true
- intendedFiles: ["agent-loop/tasks/backend-python-no-node-sliderule-orchestrate-contract-105.md", "agent-loop/tasks/backend-python-no-node-api-migration-status-105.md"]
- gatesToRun: ["node agent-loop/src/check-mojibake.js on edited mds", "node -e section check", "$env:PYTHONPATH=... python -m pytest ... -k wrapper and orchestrate", "npx vitest ... sliderule.orchestrate-plan-python-contract.test.ts"]

## Route ownership classification (this task)
- The orchestrate-plan behavior (POST /api/sliderule/orchestrate-plan, including hardening for frontend session wrapper state) classified PYTHON_FIRST_COMPAT.
- Python source of truth: slide-rule-python/routes/sliderule_full.py (/orchestrate-plan endpoint + _run_orchestrate_plan + _coerce_state_payload at ~100 for wrapper merge), services/slide_rule_orchestrator.py:orchestrate_plan.
- Frontend: client/src/lib/sliderule-orchestrator.ts calls /api/sliderule/orchestrate-plan; vite.config.ts resolveApiTarget routes it to Python (9700).
- Node: server/routes/sliderule.ts direct handler + executeOrchestratePlan (legacy) + python-delegation for 'orchestrate.plan' in execute path remains thin compat shell only. Does not own wrapper coercion or plan business logic. Tests assert delegation and python signals.
- Wrapper state: GET sessions returns {state, provenance, backend}; POST plan now accepts same wrapper shape (Python merges) without forcing client unwrap. Python contract hardened for this.
- Degraded states: explicit _degraded_plan returned by Python (timeout, config, error); visible, no silent Node success.

## Implementation summary
- Python route/service already provided the hardened contract (wrapper coercion + provenance attach + backend signal). Task 11 goal met by prior slice work + verification.
- No source changes in this remediation pass (per guardrails: only edit files to resolve listed review findings; impl direction was correct).
- Test coverage: test_v5_smoke.py:test_orchestrate_plan_accepts_frontend_session_wrapper (monkey + assert wrapper inner, python signals).
- Contract verification in Python tests (test_orchestrate_plan_contract.py etc.).
- Node compat proof updated in prior but exercised: the orchestrate-plan-python-contract vitest.

## Commands run (smallest relevant, recorded exactly)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-sliderule-orchestrate-contract-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md  => exit 0, "No mojibake findings."
- node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } console.log('sections present')" agent-loop/tasks/backend-python-no-node-sliderule-orchestrate-contract-105.md  => exit 0
- $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_v5_smoke.py -q --tb=no -k "orchestrate_plan_accepts_frontend_session_wrapper"  => exit 0, "1 passed"
- $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_v5_smoke.py -q --tb=no -k "orchestrate or wrapper or sessions"  => exit 0, "3 passed"
- $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_orchestrate_plan_contract.py -q --tb=no  => exit 0, "3 passed"
- npx vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts --reporter=basic  => exit 0, "9 passed" (includes "proves Node /api/sliderule is thin compatibility shell (PYTHON_FIRST_COMPAT)")
- (pre-edit runs of mojibake and section gates also executed; full pytest/vitest recorded above)

## Files changed
- agent-loop/tasks/backend-python-no-node-sliderule-orchestrate-contract-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
(Note: per "only edit files needed to resolve the listed review findings"; did not touch slide-rule-python/tests/test_v5_smoke.py (already contained wrapper test + provenance asserts per minor finding), nor any .py/.ts sources.)

## Denominator / numerator impact
- Denominator unchanged (66 route modules; 42+ /api surfaces per task 01 baseline).
- Numerator: no new full surface moved (orchestrate-plan slice was already PYTHON_FIRST_COMPAT from prior inventory/mapping); this task records hardening of Python contract + frontend wrapper state support + explicit thin-shell proof for it. Does not alter the count; improves evidence quality for the slice.

## Worker final report
- verdict: changed
- summary: Added missing final report to task file and ownership/result record + completed status to migration ledger for task 11. All review findings resolved. Python is the backend source for orchestrate-plan contract (wrapper state included); Node thin shell proven by tests; provenance signals present; commands and evidence recorded.
- Acceptance met: Python FastAPI owns the orchestrate-plan + wrapper; migration status updated; frontend via Vite shows Python; ledgers record result and no change to denom/num.
- Mojibake passed on edited mds.
- All required commands run and listed exactly.
- No tests weakened, no scope widened, only ledger updates for the documented gap.
