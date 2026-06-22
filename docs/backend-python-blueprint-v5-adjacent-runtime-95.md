# Backend Python Blueprint V5 Adjacent Runtime 95

## Scope

This report audits the Blueprint-adjacent evidence around the SlideRule V5
`orchestrate.plan` Python runtime route. It is intentionally narrower than a
full `/api/blueprint` migration audit. The goal is to decide which nearby
Blueprint capabilities support the SlideRule V5 95% closure story and which
remain whole-Blueprint migration gaps.

This report does not update the overall backend migration percentage and does
not claim that the Blueprint route shell, state machine, job store, event bus,
diagnostics, ledger, preview, or prompt package flows have moved to Python.

## Evidence Inputs

The current worktree does not contain `.agent-loop/queue-outcomes.json`, so this
pass does not use queue outcome counts as proof of completion. The classification
below is based on the committed status/audit docs and the named Python and Node
tests in this task.

Primary evidence paths:

- `agent-loop/tasks/sliderule-python-migration-status.md`
- `docs/backend-python-node-route-inventory-90.md`
- `docs/backend-python-runtime-depth-audit-90.md`
- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_state_projection.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_spec_docs_batch_proxy.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_artifact_memory_proxy.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_review_export_proxy.py`
- `server/routes/__tests__/sliderule.orchestrate-plan-state-projection.test.ts`
- `server/routes/__tests__/blueprint.spec-docs-batch-python-proxy.test.ts`
- `server/routes/__tests__/blueprint.artifact-memory-python-proxy.test.ts`
- `server/routes/__tests__/blueprint.review-export-python-proxy.test.ts`

## Classification Rules

| Layer | Meaning in this report | Count posture |
|---|---|---|
| `contract` | Python and Node agree on shape, errors, and envelope semantics. | Supports confidence only; not runtime completion. |
| `proxy` | Node keeps the public route/service owner and forwards a bounded operation to Python behind an env switch or internal endpoint. | Supports adjacent closure only when clearly bounded; not full route ownership. |
| `bounded runtime` | Python performs a scoped runtime operation that Node can consume, while Node still owns surrounding state or persistence. | Can support the SlideRule V5 95% closure story for that slice only. |
| `node-owned` | Node remains the runtime or persistence authority. | Cannot be counted as Python runtime completion. |

## Adjacent Capability Audit

| Capability | Evidence paths | Current layer | Supports SlideRule V5 95%? | Boundary that must not be overstated |
|---|---|---|---|---|
| `orchestrate.plan` state projection | Python: `tws-ai-slide-rule-python/tests/test_orchestrate_plan_state_projection.py`; Node: `server/routes/__tests__/sliderule.orchestrate-plan-state-projection.test.ts`; service path observed from tests: `tws-ai-slide-rule-python/services/slide_rule_orchestrator.py`; Node validation path: `shared/blueprint/sliderule-plan-validation.ts`. | `bounded runtime` support for a read-side projection emitted by the Python plan route. | Yes. It proves Python plan output can expose `planStateProjection` that Node/Blueprint consumers can validate without mutating Node-owned state. | It is not a Blueprint state-machine migration. The projection says `stateAuthority: node` and `stateMutation: none`; the route shell, job store, and event bus remain outside this slice. |
| Blueprint spec docs batch | Python: `tws-ai-slide-rule-python/tests/test_blueprint_spec_docs_batch_proxy.py`; Node: `server/routes/__tests__/blueprint.spec-docs-batch-python-proxy.test.ts`; Python endpoint: `/api/blueprint/spec-documents/generate-batch`; Node entry observed in tests: `/api/blueprint/jobs/:jobId/spec-documents`. | `proxy` plus bounded document-generation runtime. Node delegates generation when `BLUEPRINT_SPEC_DOCS_PYTHON_PROXY=true`, then keeps artifact writes and fallback handling in Node. | Yes, as adjacent closure evidence. It supports the handoff from a Python-generated plan into Python-assisted Blueprint docs generation. | It does not migrate all Blueprint documents, previews, prompt packages, engineering runs, or artifact persistence. Node still owns the public Blueprint route and store mutation. |
| Blueprint artifact memory | Python: `tws-ai-slide-rule-python/tests/test_blueprint_artifact_memory_proxy.py`; Node: `server/routes/__tests__/blueprint.artifact-memory-python-proxy.test.ts`; Node service path: `server/routes/blueprint/artifact-memory/service.ts`; Python endpoint: `/api/blueprint/spec-documents/artifact-memory/contract`. | `proxy` / `contract`; persistence remains `node-owned`. Python validates and echoes ledger, event, replay, feedback, read, list, and write shapes. | Limited. It supports shape compatibility around the SlideRule V5 closure story, but should not be counted as runtime ownership. | Python responses explicitly preserve Node as the persistence owner, and Node falls back to local artifact memory when the proxy fails or is disabled. Real artifact memory storage is still a Blueprint gap. |
| Blueprint review export | Python: `tws-ai-slide-rule-python/tests/test_blueprint_review_export_proxy.py`; Node: `server/routes/__tests__/blueprint.review-export-python-proxy.test.ts`; Python endpoints: `/api/blueprint/spec-documents/review` and `/api/blueprint/spec-documents/export`; Node entries observed in tests: review patch and export routes under `/api/blueprint/jobs/:jobId/spec-documents`. | `proxy` with bounded review/export transformation semantics. Node can delegate review/export when `BLUEPRINT_REVIEW_EXPORT_PYTHON_PROXY=true`, and Node keeps job store authority. | Yes, as adjacent closure evidence for reviewed/exportable spec docs after plan/docs generation. | It does not migrate review authority, UI workflow, production archive storage, or all Blueprint export surfaces. Permission failures are propagated rather than hidden behind Node fallback, but route ownership is still Node. |

## SlideRule V5 95% Support

The evidence can support SlideRule V5 95% only in this narrow sense:

- Python `orchestrate.plan` can emit a stable, validated read-side projection for
  Node/Blueprint consumers.
- Blueprint spec-docs batch generation can be delegated to Python for a bounded
  document-generation step while Node keeps artifact writes.
- Blueprint review/export can be proxied to Python for bounded document review
  and archive response semantics.
- Artifact memory has a compatible proxy contract that prevents the adjacent
  workflow from being shape-blind, but it remains Node-owned for persistence.

These points improve the closure feel around SlideRule V5 because the plan,
docs, review/export, and memory-envelope edges have contract/proxy coverage.
They do not turn the whole Blueprint subsystem into Python runtime.

## Not Counted Toward Whole Blueprint Migration

| Gap | Why it remains outside this 95 slice |
|---|---|
| `/api/blueprint` route shell | `docs/backend-python-node-route-inventory-90.md` still classifies the large Blueprint route shell as Node-owned with selected contract/proxy evidence only. |
| Blueprint state machine | The plan projection is read-only and marks Node as state authority. It does not execute or mutate the Blueprint state machine in Python. |
| Durable job store and job lifecycle | The spec-docs, artifact-memory, and review/export proxies still operate around Node job/store data. This pass does not migrate job durability, event replay, lifecycle transitions, or socket relay. |
| Event bus, diagnostics, and ledger routes | No current evidence in this task proves Python ownership of Blueprint event bus, diagnostics, ledger, lineage, or replay persistence. |
| Preview, effect preview, prompt package, and engineering run routes | These are not covered by the named tests and must stay outside the SlideRule V5 95% claim. |
| Artifact memory persistence | The Python artifact-memory contract keeps `persistenceOwner` as `node`; this is proxy/contract evidence, not runtime storage evidence. |
| Review authority and production export storage | Review/export proxy tests cover bounded response semantics and permission failures, not full production authority, UI workflow, archive persistence, or external storage. |

## Required Follow-Up Blueprint Slices

If the goal is to raise the overall backend or Blueprint migration percentage,
the next work should be split into small, reviewable Blueprint tasks rather than
one broad migration:

| Candidate slice | Required evidence before counting as runtime/prod |
|---|---|
| Artifact memory runtime store | Python-owned read/write/list behavior with durable storage semantics, Node fallback rules, lineage counts, and error contracts. |
| Review/export production boundary | Python-owned review authority, archive generation, permission semantics, and durable export metadata without relying on Node as the only state owner. |
| Selected Blueprint state operations | A bounded Python runtime bridge for explicit state transitions, while keeping replan/staleness and invalidation semantics testable. |
| Job lifecycle and event stream | Python-owned complete/fail/cancel/status or stream behavior that does not merely echo Node job store state. |
| Preview and prompt package surfaces | Separate proxy/runtime tasks for effect preview, prompt package assembly, and engineering handoff artifacts. |
| Diagnostics, ledger, replay, and traceability | Isolated tests for Python ownership or production wiring of these evidence and observability paths. |

## Reviewer Boundary Check

This report deliberately labels proxy-only and contract-only surfaces as such.
The countable SlideRule V5 95% support is limited to adjacent closure around the
Python plan route and its nearby document/review handoff surfaces. It must not be
read as evidence that Blueprint's large route, state machine, job store, event
bus, diagnostics, ledger, preview, or prompt package system is complete in
Python.
