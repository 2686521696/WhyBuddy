# Backend Python `orchestrate.plan` contract

This document defines the narrow Node/Python boundary for the first
`orchestrate.plan` migration slice. It does not declare the full Node
orchestrator migrated.

## Current boundary

Node owns session state, artifact mutation, coverage gates, budget accounting,
and the full Blueprint/Autopilot state machine. Python may propose a next-plan
shape that Node can consume or reject.

The thin planner slice adds only deterministic plan-draft selection on the
Python side. For a fixed request, Python may choose a stable ordered capability
fragment such as evidence, risk, and delivery packaging steps. It still does
not drive the session loop, retry policy, fallback decision, state stream, Trust
Gate, GCOV, artifact commits, or final execution.

The Python response shape is intentionally small:

```json
{
  "selected": [
    { "capabilityId": "evidence.search", "roleId": "grounding", "why": "Need evidence first" }
  ],
  "rationale": "Evidence boundary first",
  "source": "python-rag"
}
```

Allowed source values in this slice are `python-rag`, `heuristic_fallback`, or
`llm`. A Python plan must not include mutated session state, artifacts,
capability run records, coverage contracts, coverage gaps, or coverage gate
decisions.

## Node proxy behavior

When `SLIDERULE_V5_BACKEND=python`, Node delegates `orchestrate.plan` through
the Python-specific endpoint `/api/sliderule/orchestrate-plan`, not the generic
`/api/sliderule/execute-capability` endpoint.

Direct calls to Node `/api/sliderule/orchestrate-plan` still execute the Node
orchestrator in `server/sliderule/orchestrate-plan.ts`. The
`/api/sliderule/execute-capability` proxy path delegates only the
`orchestrate.plan` planner fragment to Python.

If Python is unavailable, Node returns HTTP 502 with:

```json
{
  "provenance": "python-delegated-failed",
  "degraded": true,
  "error": "python_unavailable"
}
```

This is a hard degraded shape, not a pseudo-successful plan.

Python-side planner errors stay explicit at the `/api/sliderule/orchestrate-plan`
boundary:

- Bad request input returns HTTP 400 with `error: "invalid_request"` and
  `reason: "bad_input"`.
- Planner runtime exceptions return HTTP 200 with `degraded: true`,
  `error: "planner_error"`, `reason: "runtime_error"`, `selected: []`, and
  `fallbackAvailable: false`.
- Missing planner/LLM configuration returns the same degraded envelope but uses
  `error: "planner_config_missing"` and `reason: "config_missing"`.
- Planner timeout returns the same degraded envelope but uses
  `error: "planner_timeout"` and `reason: "timeout"`.

Runtime planner errors must not be relabeled as `no_api_key`, and unavailable
Python fallback must remain distinct from successful `heuristic_fallback`
planner output.

## Out of scope

- Rewriting `server/sliderule/orchestrate-plan.ts`.
- Moving Blueprint/Autopilot state transitions to Python.
- Connecting live LLM calls.
- Updating global migration percentages.

## Verification

The migration gate locks the contract with:

- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_contract.py`
- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_error_recovery.py`
- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_thin_planner.py`
- `server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts`
- existing `server/routes/__tests__/sliderule.orchestrate-plan.test.ts`
