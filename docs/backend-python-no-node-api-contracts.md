# Backend Python No-Node API Contracts Registry

This is the authoritative Python API contract registry for migrated /api surfaces in the backend-python-no-node cutover (queue 105).

Python FastAPI under `slide-rule-python/` is the source of truth for listed contracts. Node routes (if present) are thin PYTHON_FIRST_COMPAT proxies or deprecated.

## Registry Version
- version: "no-node-api-contracts.v1.foundation"
- lastUpdatedByTask: 56
- baselineFrom: tasks 01 (route inventory), 02 (callsite inventory), 03 (registry), 06 (route state model), 10 (sliderule frontend callsite->python route->test mapping), 56 (dev/prod routing documentation after Node backend retirement)

## Contract Classification Model
Route state model introduced by Foundation task 06 (backend-python-no-node-foundation-deprecation-state-model-105).

- ACTIVE_NODE_BUSINESS: Node owns business logic; Python may have partial adapters only.
- PYTHON_FIRST_COMPAT: Python owns behavior and responses; Node (if any) is thin proxy/shell only (must preserve provenance signals).
- PYTHON_ONLY: Node backend route removed or inert; all paths hit Python directly.
- BLOCKED: Concrete blocker recorded; rescue patch boundary noted.
- Formal model lives in Python (slide-rule-python/models/agent_loop.py:RouteState Enum) and is served by the live /api/agent-loop/contracts endpoint (supportedStates). All surfaces use RouteState values.
- All Python responses for owned surfaces MUST surface `backend`, `provenance`, or equivalent signal for smoke verification. Degraded states are explicit (never silent success from wrong owner).

## Registered Python-Owned / Migrated Surfaces (Foundation)

| Surface | Classification | Python Evidence | Key Response Fields / Contract Shape | Node Status | Notes / Risk |
|---------|----------------|-----------------|--------------------------------------|-------------|--------------|
| /health , /api/*/health | PYTHON_FIRST_COMPAT | slide-rule-python/app.py:94 (core health), routes/agent_loop.py:109 (/api/agent-loop/health), routes/sliderule_full.py mounts | `{ "status": "ok", "backend": "slide-rule-python", "migration": "v5-baseline", ... }` ; also /api/sliderule/health delegates | Thin proxy may remain in server for compat | Primary provenance signal. Must be used by smokes to prove Python path. |
| /api/agent-loop/* (health, capabilities, runs/*, queue/*, task/run, settings, dashboard, contracts) | PYTHON_FIRST_COMPAT (ledger/control authoritative) | slide-rule-python/routes/agent_loop.py (full router mounted at /api/agent-loop in app.py:67); services/agent_loop_*.py | Health: `{status, backend, mode: "bridge", version}`; Capabilities include "controlPlane": "python"; Runs return AgentLoopRunSummary etc models (see models/agent_loop.py); /contracts returns registry | server/routes/agent-loop.ts remains thin shell (PYTHON_FIRST_COMPAT) | Python is ledger source of truth. Includes the runtime /api/agent-loop/contracts for this registry. |
| /api/sliderule/* (orchestrate-plan, execute-capability, sessions, drive, coverage, health) | PYTHON_FIRST_COMPAT | slide-rule-python/routes/sliderule_full.py (mounted /api/sliderule); services/slide_rule_*.py + sliderule_llm/ | Orchestrate/execute return selected capabilities + rationale + source:"python-rag" or degraded; state has provenance:"python-rag" | server/routes/sliderule.ts + python-delegation.ts are thin proxy when SLIDERULE_V5_BACKEND=python | Core SlideRule contract slice (task 10: every frontend call mapped; 4 primary to Python, /respond is explicit client fallback BLOCKED/no Python target with rescue boundary recorded). See task agent-loop/tasks/backend-python-no-node-sliderule-route-map-105.md. Degraded states visible. |
| /api/blueprint/spec-documents | PYTHON_FIRST_COMPAT | slide-rule-python/routes/blueprint_spec_docs.py (mounted at /api/blueprint/spec-documents) | Spec doc batch/export shapes with python provenance | Partial thin in server/routes/blueprint.ts | Only this slice of blueprint; main blueprint remains ACTIVE_NODE_BUSINESS. |

## Python Runtime Contract Registry Endpoint

Python serves a live contract registry at:

`GET /api/agent-loop/contracts`

Response shape (enforced by route + pydantic):

```json
{
  "registryVersion": "backend-python-no-node.v1",
  "source": "python",
  "backend": "slide-rule-python",
  "routeStateModel": "foundation-deprecation-state-model",
  "introducedByTask": 6,
  "supportedStates": ["ACTIVE_NODE_BUSINESS", "PYTHON_FIRST_COMPAT", "PYTHON_ONLY", "BLOCKED"],
  "surfaces": [
    { "surface": "/health", "classification": "PYTHON_FIRST_COMPAT", "pythonRoute": "/health", "provenanceSignal": "backend:slide-rule-python" },
    { "surface": "/api/agent-loop", "classification": "PYTHON_FIRST_COMPAT", "pythonRoute": "/api/agent-loop/*", "provenanceSignal": "controlPlane:python" },
    { "surface": "/api/sliderule", "classification": "PYTHON_FIRST_COMPAT", "pythonRoute": "/api/sliderule/*", "provenanceSignal": "source:python-rag | backend", "task10Mapping": "frontend: SlideRule.tsx health, orchestrator orchestrate-plan, runtime execute-capability, http-store sessions -> python routes + tests; respond (sliderule-narrator.ts) is BLOCKED client-fallback no-Python-target (precise blocker+rescue in task 10 map)" },
    { "surface": "/api/blueprint/spec-documents", "classification": "PYTHON_FIRST_COMPAT", "pythonRoute": "/api/blueprint/spec-documents", "provenanceSignal": "python" }
  ],
  "denominatorBaseline": 66,
  "pythonOwnedOrCompatCount": 4,
  "activeNodeBusinessCount": "majority (see migration-status)"
}
```

Task 06 introduced the formal RouteState model and updated the endpoint + ContractSurface to use it (Python source of truth for states).

This endpoint + health signals prove Python is contract source for these surfaces. Callers (smokes, frontend via Vite proxy) must observe "python" or "slide-rule-python" signals; absence or node-only fallback must fail the smoke.

## Verification Requirements
- Direct Python TestClient or live: 200 + explicit python backend signal + supportedStates containing the three route states (plus BLOCKED).
- Node thin-compat (if exercised): must forward or declare PYTHON_FIRST_COMPAT without altering business result.
- Python model test (test_agent_loop_models.py) asserts RouteState enum and ContractSurface use of states.
- Browser/API smokes (later tasks): must hit Python for listed surfaces and assert provenance (see foundation smoke harness task).
- Run `node agent-loop/src/check-mojibake.js` on this file + all edited contract/task md/py.
- Python tests exercising agent-loop and sliderule routes cover contract shapes (e.g. via existing test_agent_loop_*.py , test_orchestrate_plan_contract.py).
- Do not mask errors: degraded must return explicit error + provenance.

## Task 10: /api/sliderule frontend callsite-to-Python-route-to-test evidence
Task 10 completed the explicit mapping required for SlideRule phase (4 primary paths to Python; respond handled per acceptance as blocker).

Frontend callsites (relative paths inspected):
- client/src/pages/SlideRule.tsx -> GET /api/sliderule/health -> Python /api/sliderule/health (app.py) ; covered by slide-rule-python/tests/test_api_health.py + test_v5_smoke.py
- client/src/lib/sliderule-orchestrator.ts -> POST /api/sliderule/orchestrate-plan -> Python /orchestrate-plan ; covered by test_orchestrate_plan_contract.py + test_v5_smoke.py
- client/src/lib/sliderule-runtime.ts -> POST /api/sliderule/execute-capability -> Python /execute-capability ; covered by test_v5_smoke.py (execute report path)
- client/src/lib/sliderule-http-store.ts (used by useSlideRuleSession) -> sessions CRUD -> Python /sessions* ; covered by test_v5_smoke.py:test_sessions_crud
- client/src/lib/sliderule-narrator.ts -> /respond (no Python route/target; explicit client fallback to localNarrationFallback (visible degraded); recorded as BLOCKED with rescue boundary in task 10; not treated as Python-owned)

Python source of truth confirmed by:
- direct route inspection + service tests returning "backend":"python", "provenance":"python-*"
- Vite dev proxy (resolveApiTarget) sends /api/sliderule* to Python
- Node server/routes/sliderule.ts thin shell only (proven by vitest in server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts including task-10 it)
- Full mapping table + blocker/rescue for respond + commands recorded in agent-loop/tasks/backend-python-no-node-sliderule-route-map-105.md

Registry updated by task 10 (lastUpdatedByTask=10; row and callsite evidence hardened for accuracy).

## Update Policy
Every task that moves a surface updates:
1. This registry (add/harden row + endpoint data).
2. agent-loop/tasks/backend-python-no-node-api-migration-status-105.md (ownership + readiness).
3. Adds Python test coverage or smoke evidence when behavior is owned.

Foundation task 03 establishes the initial registry and the /api/agent-loop/contracts exposure.

Task 06 hardens the registry with the formal route state model (RouteState enum + supportedStates in response) and adds Python model verification.

## Remaining Node Backend API Risk (at registry bootstrap)
- Denominator: 66 route modules, 42+ /api surfaces (per task 01).
- PYTHON_FIRST_COMPAT numerator foundation: 4 surfaces/families listed.
- PYTHON_ONLY: 0 full surfaces.
- Majority ACTIVE_NODE_BUSINESS (auth, main blueprint, tasks, rag full, a2a full, web-aigc, workflows, etc.).
- Task 06 did not move additional surface ownership; it established the formal state model (PYTHON_ONLY for the RouteState definition/endpoint payload itself) used by the registry.

No frontend callsites or Vite were changed (not required for pure registry foundation). 

## Commands (recorded by worker)
See worker final report in `agent-loop/tasks/backend-python-no-node-foundation-contract-registry-105.md` for task 03, and `agent-loop/tasks/backend-python-no-node-foundation-deprecation-state-model-105.md` for task 06 (state model hardening, model test, mojibake).

## Task 56: Development and production routing documentation (after Node backend API retirement)
Task 56 documents the authoritative routing for Python-owned surfaces once Node backend API ownership is retired for those surfaces.

- Classification for routing surfaces: PYTHON_FIRST_COMPAT (Python source of truth for behavior; Node/Vite = routing mechanism / thin compat shell only).
- Dev routing (Vite): resolveApiTarget + dedicated proxies always send owned prefixes (/api/agent-loop/*, /api/sliderule/*, /api/blueprint/spec-documents/*, /health, /ready) to PYTHON_API_TARGET (default 9700). Unowned /api/* target Node (3001) as explicit thin shell. Env: VITE_PYTHON_FIRST_API=true (default in dev-all) or PYTHON_API_TARGET override.
- Prod routing: Node remains HTTP entry point (start-prod loads dist/index). Owned surfaces use thin proxy routers (e.g. server/routes/agent-loop.ts fully delegates to 9700, errors surfaced as 502 + python detail; similar delegation in sliderule etc). Python runs standalone (uvicorn slide-rule-python/app.py). No Node business semantics for owned; PYTHON_API_TARGET controls target.
- Provenance contract (must be observed post-retirement): all Python responses for owned surfaces carry "backend":"slide-rule-python", "source":"python", and surface-specific "provenance". Health + /api/agent-loop/contracts provide live signals. Browser/API smokes (task 54 harness) and contract tests (task 53) assert these; absence or Node-only must fail.
- Node thin shell boundary (post-retirement): server/routes/* thin proxies + vite proxy + resolve documented as "PYTHON_FIRST_COMPAT", "thin proxy", "delegation only". No reimpl; degraded/fail from Python visible.
- Update policy alignment: this task updated lastUpdatedByTask to 56 and records routing constraints here + in dedicated agent-loop/tasks/backend-python-no-node-final-routing-docs-105.md (full tables, evidence, risk, commands).
- Current state (task 56): owned slices (health, agent-loop control, sliderule V5, blueprint spec-docs) documented as routed to Python. Majority surfaces remain ACTIVE_NODE_BUSINESS (high remaining risk). No denom/num change from routing docs.
- Verification: run the smallest commands recorded in task 56 final report (node fs sim on resolve + python TestClient on /health + /contracts; mojibake on md files).

Future tasks (57+) may reduce/remove more Node mounts for retired surfaces; routing docs here serve as the reference for dev/prod after retirement of Node backend ownership on listed slices.
