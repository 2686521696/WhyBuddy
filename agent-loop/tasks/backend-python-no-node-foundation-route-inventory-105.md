# Backend Python No-Node API 105: Inventory all Node backend API routes and classify their Python cutover status.

## Execution status
- Status: completed (inventory baseline)
- Goal: Inventory all Node backend API routes and classify their Python cutover status.
- Queue: `backend-python-api-cutover-no-node-105-queue`
- Phase: Foundation
- Sequence: 01 / 60
- Worktree policy: single queue-scoped worktree for the whole no-Node backend API cutover.

## Context
This task is part of the single-stage backend API no-NodeJS cutover. Keep React, Vite, pnpm, and browser smoke tooling in Node. Remove NodeJS backend API ownership by moving business semantics to Python FastAPI and leaving Node only as explicit temporary compatibility where still required.

The full queue intentionally runs in one queue-scoped worktree to reduce cross-worktree drift. Do not reset or recreate the worktree. Every task must read and update the same migration evidence when it changes route ownership.

## Allowed files
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/tasks/backend-python-no-node-foundation-route-inventory-105.md`
- Node side: `server/routes/**, server/index.ts, client/src/**, scripts/**`
- Python side: `slide-rule-python/app.py, slide-rule-python/routes/**, slide-rule-python/services/**`
- Tests or smoke: `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`

## Evidence to read
- `agent-loop/tasks/backend-python-no-node-api-migration-status-105.md`
- `agent-loop/scripts/backend-python-api-cutover-no-node-105-queue.json`
- Current task file: `agent-loop/tasks/backend-python-no-node-foundation-route-inventory-105.md`
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

## Route Inventory (Foundation task 01)

All Node backend API routes were inventoried by inspecting `server/index.ts` mounts and `server/routes/*.ts` files (excluding __tests__).

### Discovery counts
- Node route modules (non-test .ts): 66
- Unique top-level /api/* mounts extracted: 42+
- Python routes currently serving backend API: 5 files under slide-rule-python/routes/

### Classification of major surfaces (using required states)

| Surface | Classification | Node evidence | Python evidence | Risk / notes |
|---------|----------------|---------------|-----------------|--------------|
| /api/health , /api/health/persistence | PYTHON_FIRST_COMPAT | server/index.ts:2354 (inline), routes/persistence-health.ts | slide-rule-python/app.py:99 (/health), tests for deployment smoke | Python /health used as provenance signal in smokes. Node health remains for compat. |
| /api/sliderule , /api/whybuddy | PYTHON_FIRST_COMPAT | server/routes/sliderule.ts , server/sliderule/python-delegation.ts | slide-rule-python/routes/sliderule_full.py (mounted /api/sliderule), app.py:69 | Explicit delegation target. Node is thin shell when PYTHON_SLIDE_RULE_BASE_URL set. |
| /api/agent-loop | PYTHON_FIRST_COMPAT | server/routes/agent-loop.ts | slide-rule-python/routes/agent_loop.py , app.py:66 (prefix /api/agent-loop), static dashboard | Python is authoritative for run/queue ledger in this queue. Node compat shell remains. |
| /api/blueprint/spec-documents | PYTHON_FIRST_COMPAT | server/routes/blueprint.ts + sub | slide-rule-python/routes/blueprint_spec_docs.py (mounted in app.py) | Spec docs slice is Python routed. Full blueprint still ACTIVE_NODE_BUSINESS. |
| /api/a2a | ACTIVE_NODE_BUSINESS (partial compat) | server/routes/a2a.ts , core/a2a-* | slide-rule-python/services/a2a*.py , some tests (contract) | Contracts exist; runtime still Node primary for most paths. |
| /api/rag , /api/vector-update , /api/vector-delete | ACTIVE_NODE_BUSINESS (partial) | server/routes/rag.ts , web-aigc/*-adapter | slide-rule-python/services/rag_service.py , rag_ingestion.py | Ingestion contracts; retrieval still Node led for production. |
| /api/auth/* (register/login/me/refresh etc) | ACTIVE_NODE_BUSINESS | server/routes/auth.ts , server/auth/* | (none direct) | Full session/persistence Node owned. |
| /api/tasks , /api/executor/events | ACTIVE_NODE_BUSINESS | server/routes/tasks.ts , inline in index.ts | (bridge services only) | Task lifecycle, mission store Node. |
| /api/blueprint (main) | ACTIVE_NODE_BUSINESS | server/routes/blueprint.ts + 400+ sub files under blueprint/ | limited (job runtime, stage, spec-docs partial) | Largest surface; multiple takeover slices in progress but shell Node. |
| /api/workflows , /api/nl-command | ACTIVE_NODE_BUSINESS | server/routes/workflows.ts , nl-command.ts | workflow_runtime.py , nl_command_runtime (contract) | Partial contracts; semantics Node. |
| Web AIGC group (/api/web-search, /api/file-*, /api/vision, /api/voice, /api/ocr, /api/ai-ppt, /api/dynamic-chart, /api/open-*, /api/web-qa, /api/transaction-flow, /api/get-*-info, /api/intent-recognition, etc) | ACTIVE_NODE_BUSINESS (some adapters) | server/routes/*-search.ts , node-adapters/* , many web-aigc | slide-rule-python/services/web_aigc_*.py (adapters for some) | Adapters for smoke; real provider calls still Node or external via Node. |
| /api/chat , /api/agents , /api/reports , /api/reputation , /api/skills , /api/mcp | ACTIVE_NODE_BUSINESS | respective routes/*.ts | (skill/mcp partial python in sliderule context) | Core chat/agent surfaces Node. |
| /api/permissions , /api/audit , /api/knowledge , /api/admin , /api/projects , /api/config , /api/export , /api/telemetry , /api/cost , /api/analytics , /api/replay , /api/feishu , /api/planets , /api/decision-templates , /api/lineage | ACTIVE_NODE_BUSINESS | server/routes/*.ts + server/permission/* + server/audit/* etc | (scattered service contracts in python) | Infrastructure surfaces remain Node owned. |
| /api/guest-agents , other secondary | ACTIVE_NODE_BUSINESS | server/routes/guest-agents.ts etc | none | |

Full Node route module list (for denominator baseline):
a2a-python-runtime.ts, a2a.ts, admin.ts, agent-loop.ts, agents.ts, ai-ppt.ts, aigc-monitoring.ts, analytics.ts, artifact-utils.ts, audio-recognition.ts, audit.ts, auth.ts, blueprint.ts, chat.ts, config.ts, cost.ts, dynamic-chart.ts, excel-read.ts, export.ts, feishu.ts, file-generation.ts, file-slicing.ts, file-translation.ts, format-output.ts, get-device-info.ts, get-location-info.ts, graph-search.ts, guest-agents.ts, image-search.ts, intent-recognition.ts, knowledge-admin.ts, knowledge.ts, lineage.ts, long-text-extraction.ts, mcp.ts, nl-command.ts, ocr-recognition.ts, open-dashboard.ts, open-page.ts, open-report.ts, orchestration-recognition-jump.ts, permissions.ts, persistence-health.ts, planets.ts, projects.ts, rag.ts, replay.ts, reports.ts, reputation.ts, robot-reply.ts, similarity-match.ts, skills.ts, sliderule.ts, static-webpage-read.ts, tasks.ts, telemetry.ts, transaction-flow.ts, ue.ts, vector-delete.ts, vector-update.ts, vision.ts, voice.ts, web-aigc-risk-actions.ts, web-qa.ts, web-search.ts, workflows.ts (plus blueprint/ subdir with 400+ files)

Python currently provides source-of-truth surfaces only for the explicitly mounted in slide-rule-python/app.py: sliderule, blueprint/spec-documents, agent-loop + health + static shells.

### Remaining Node backend API risk at baseline
- No route is PYTHON_ONLY except narrow slices (spec-docs, agent-loop ledger read paths).
- Thin proxy shells exist in several places but business logic still executes in Node for majority.
- Frontend callsites (next task) and Vite proxy still default to Node server in most cases.

This task does not perform cutover; it provides the inventory ledger input for subsequent 59 tasks.

## Worker Final Report

Commands run (exact, recorded here):

1. node -e "console.log('node-inventory-cmd-ok'); console.log('routes-dir-count:', require('fs').readdirSync('server/routes').filter(f=>f.endsWith('.ts')).length )"
2. python -c "import os,sys; print('py-inventory-cmd-ok'); print('py-routes:', len([f for f in os.listdir('slide-rule-python/routes') if f.endswith('.py')]) if os.path.isdir('slide-rule-python/routes') else 0); print('python:', sys.version.split()[0])"
3. node -e "const fs=require('fs');const d=fs.readdirSync('server/routes');const r=d.filter(x=>x.endsWith('.ts')&&!x.includes('__tests__')); console.log('NODE_ROUTE_MODULES:'+r.length); r.sort().slice(0,15).forEach(f=>console.log('  NODE_ROUTE:'+f));"
4. python -c "import os; prs = 'slide-rule-python/routes'; print('PYTHON_ROUTES_FILES:'); [print('  PYTHON_ROUTE:'+f) for f in sorted(os.listdir(prs)) if f.endswith('.py')]; print('PYTHON_ROUTES_COUNT:' + str(len([x for x in os.listdir(prs) if x.endswith('.py')]))) "
5. node -e "const fs=require('fs');const d=fs.readdirSync('server/routes');const r=d.filter(x=>x.endsWith('.ts')&&!x.includes('__tests__')).sort(); console.log('NODE_ROUTE_MODULES:'+r.length); console.log('NODE_ROUTE_SAMPLE_START:'+JSON.stringify(r.slice(0,10))); console.log('NODE_ROUTE_SAMPLE_END:'+JSON.stringify(r.slice(-5)));"
6. python -c "import ast,os; files=['slide-rule-python/app.py','slide-rule-python/routes/agent_loop.py','slide-rule-python/routes/sliderule_full.py']; [print('PY_PARSE_OK:'+f) or ast.parse(open(f,encoding='utf-8').read(),filename=f) for f in files if os.path.isfile(f)]; print('PY_OWNED_VERIF_DONE')"
7. python -m pytest slide-rule-python/tests/test_agent_loop_integration_inventory.py -q --tb=line
8. python -m py_compile slide-rule-python/tests/test_agent_loop_integration_inventory.py
9. node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-route-inventory-105.md agent-loop/tasks/backend-python-no-node-api-migration-status-105.md
10. node agent-loop/src/check-mojibake.js slide-rule-python/tests/test_agent_loop_integration_inventory.py

Files changed:
- agent-loop/tasks/backend-python-no-node-foundation-route-inventory-105.md
- slide-rule-python/tests/test_agent_loop_integration_inventory.py (added executable pytest assertions for PYTHON_FIRST_COMPAT provenance on /health /api/agent-loop /api/sliderule surfaces)

This task changes the no-Node backend API denominator (establishes explicit count of 66 modules / 42+ surfaces) and records baseline numerator (PYTHON_ONLY ~1-2 narrow slices, PYTHON_FIRST_COMPAT ~3-4, majority ACTIVE_NODE_BUSINESS). Numerator does not increase from code change; this is classification baseline only. No Python route added/hardened as task goal is inventory (subsequent foundation tasks will).

Migration status ledger updated with task result.

No browser smoke change needed for pure inventory task.

Mojibake checked on edited .md and .py files (passed).

Pytest executed for the Python-owned behavior test (2 tests passed including new provenance assertions).

## Gate verification commands (to re-run)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-no-node-foundation-route-inventory-105.md
- node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); } " agent-loop/tasks/backend-python-no-node-foundation-route-inventory-105.md
- python -m pytest slide-rule-python/tests/test_agent_loop_integration_inventory.py -q --tb=line
