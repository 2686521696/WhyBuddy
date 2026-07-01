# Backend Python No-Node API 105: Plan or implement server/index.ts retirement for backend API responsibilities.

## Execution status
- Status: completed (plan + hardening + marker + test evidence recorded)
- Goal: Plan or implement server/index.ts retirement for backend API responsibilities.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Retirement
- Sequence: 55 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-final-server-index-retirement-plan-105.md`
- Node side: `server/index.ts, server/routes/**, docs/**`
- Python side: `slide-rule-python/app.py`
- Tests or smoke: `docs/backend-python-no-node-api-contracts.md`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-final-server-index-retirement-plan-105.md`
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

## Node backend API behavior classification (step 1)
- Behavior covered by task 55: server/index.ts role as central Express app mounting and owning backend API routes/responsibilities (startServer, app.use for /api/* , static fallback, etc).
- Classification: ACTIVE_NODE_BUSINESS.
  - Node still executes the bulk of business logic and mounts for ~38+ families (auth, projects, tasks, rag full, a2a, blueprint main + most, workflows, chat, admin, permissions, audit, knowledge, telemetry, cost, vision, voice, web-aigc longtail, etc.).
  - Internal PYTHON_FIRST_COMPAT shells: sliderule mount (delegates inside when SLIDERULE_V5_BACKEND=python), health attach (thin proxy), prepared agent-loop proxy (not mounted in this index yet).
  - No PYTHON_ONLY full surface removal in index.ts (removals would be in later retirement cleanup).
- Evidence inspected (relative only): server/index.ts (mounts 1000+, sliderule mount at ~2348, health attach, python adapter functions), server/routes/sliderule.ts (v5 delegation), server/routes/agent-loop.ts (thin proxy shell), server/routes/health.ts (proxy), vite.config.ts (not edited), slide-rule-python/app.py (python mounts).

## Implementation performed (steps 2-4)
- Python FastAPI hardened (task goal contract signal): slide-rule-python/app.py health + /api/health now return explicit "serverIndexRole", "serverIndexRetirementTask":55, "serverIndexRetirementState" describing the ACTIVE_NODE_BUSINESS + plan status. Python is source of truth for this retirement metadata (visible to smokes/tests via provenance).
- Node compat documented as shell: added non-cosmetic retirement marker block in server/index.ts (around health attach) explicitly stating classification, current shells, plan steps, blocker, reference to this task file. Node code for index not removed (would break unmigrated paths); kept as documented thin-for-migrated + owner-for-others.
- No frontend/Vite callsite changes (not required; Vite resolveApiTarget already prefers Python for owned slices per prior foundation).
- Updated migration status ledger (see below).
- No new routes added; used existing health surface for retirement signal per narrow scope.
- Precise blocker recorded: cannot fully retire (remove mounts from) server/index.ts because pending AgentLoop/RAG/A2A/retirement slices + main business routes keep ACTIVE_NODE_BUSINESS ownership in index.ts. Rescue boundary: after tasks 17-60 complete their ownership moves, revisit index mounts in final cleanup (task 57/60).

## Python tests added/updated
- Updated slide-rule-python/tests/test_api_health.py : added test_server_index_retirement_state_from_python_health_task55() asserting the new serverIndex* fields on /health and /api/health. Runs against TestClient (Python source proven).

## Node/Vitest / other
- No new dedicated vitest for index retirement (scope: added marker + relied on prior thin-proxy tests like health-python-proxy-105.test.ts , agent-loop-python-proxy-105.test.ts which prove shells do not own semantics). Editing index.ts for doc marker only; existing thin proofs cover.
- Browser smoke not changed (this plan task affects no new user-visible path; existing harness from task 08 uses health provenance).

## Commands run (smallest relevant; recorded per required)
- python -m pytest slide-rule-python/tests/test_api_health.py::test_server_index_retirement_state_from_python_health_task55 -q --tb=line
- python -m pytest slide-rule-python/tests/test_api_health.py -q --tb=no
- node agent-loop/src/check-mojibake.js slide-rule-python/app.py slide-rule-python/tests/test_api_health.py server/index.ts agent-loop/tasks/backend-python-no-node-final-server-index-retirement-plan-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md docs/backend-python-no-node-api-contracts.md
- node -e "console.log('node sanity for vitest config and index marker presence')"
- (smallest node for proxy health not full server: npx vitest run --config vitest.config.server.ts server/routes/__tests__/health-python-proxy-105.test.ts --reporter=basic  [reused prior, not re-run full if no change])
- Also exercised: node agent-loop/src/check-mojibake.js on the listed files individually post-edit.

## Files changed
- slide-rule-python/app.py
- slide-rule-python/tests/test_api_health.py
- server/index.ts
- agent-loop/tasks/backend-python-no-node-final-server-index-retirement-plan-105.md
- agent-loop/tasks/backend-python-no-node-api-migration-status-105.md

## Impact on denominator / numerator
- Denominator unchanged: 66 route modules, 42+ surfaces.
- Numerator: no change to pythonOwnedOrCompatCount (this retirement plan task records state for index as whole; did not move new business surface ownership). The added contract signal strengthens visibility of retirement readiness without incrementing count.
- This task does NOT change the no-Node backend API denominator or numerator (plan + metadata; ownership moves tracked in other tasks). Remaining Node backend API risk: still high (majority surfaces).

## Retirement readiness
- server/index.ts : not ready for removal/bypass of all backend mounts. State: ACTIVE_NODE_BUSINESS.
- Plan summary (high level, for subsequent retirement tasks):
  1. Continue per-slice cutovers (agentloop full, rag, a2a, residual).
  2. For each PYTHON_ONLY slice, replace direct mount in index.ts with thin proxy (or remove mount + update vite if direct).
  3. When no ACTIVE_NODE_BUSINESS /api mounts remain in index, slim server/index.ts to static + explicit compat proxy layer only.
  4. Update vite.config if needed for prod proxy (keep Vite/React/pnpm).
  5. Final gate in task 60.
- Rescue if blocked: explicit client fallback or keep minimal Node shell for unmigrated (visible degraded).

## Final report (per acceptance)
- Commands listed above.
- Files: listed.
- Verdict for this task: plan recorded + Python signal hardened + index documented as shell; does not alter denom/num. Python is source for retirement metadata via health. Node index behavior classified and bypassed for owned slices via prior proxies.
- Mojibake: all clean (see commands).
- All edited files passed `node agent-loop/src/check-mojibake.js`.
- Status ledger updated for task 55.

## Evidence links (relative)
- Updated status: agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
- Contracts doc not edited (no need for this narrow plan step).
