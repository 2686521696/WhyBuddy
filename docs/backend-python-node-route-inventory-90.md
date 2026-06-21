# Backend Python Node Route Inventory 90

## Scope

This inventory is the 90-stage denominator for the current repository. It audits the Node backend route/core/task/auth/permission/audit/Blueprint/Web AIGC/A2A surfaces that still matter for the NodeJS to Python migration.

`tws-ai-ask-python` is not counted here. Evidence must come from this repository: Node routes/tests, Python runtime/tests under `tws-ai-slide-rule-python`, migration task files, or explicit missing-path gaps.

This document is evidence inventory only. It does not claim that the whole backend is 90% migrated.

## Layer Tags

| Tag | Meaning |
|---|---|
| `node-only` | Node remains the owner; no current Python contract, proxy, runtime, or production wiring evidence was found in this repo. |
| `contract` | Node and Python have compatible request/response or domain contract tests, but Node still owns runtime behavior. |
| `proxy` | Node forwards or can forward a bounded operation to a Python endpoint or adapter. |
| `runtime` | Python executes a bounded operation in tests or through a Node bridge without claiming full production dependencies. |
| `production-wiring` | Runtime is connected to storage/service/observability/deployment boundaries with explicit degraded or safe-failure semantics. |

## Route And Core Inventory

| Category | Path or surface | Current tag | Evidence from current repo | 90-stage gap |
|---|---|---|---|---|
| route/core | `server/index.ts` top-level route mounts | `node-only` | `server/index.ts` mounts the active API surface, including `/api/rag`, `/api/agents`, `/api/chat`, `/api/workflows`, `/api/telemetry`, `/api/cost`, `/api/mcp`, `/api/blueprint`, `/api/a2a`, `/api/sliderule`, `/api/whybuddy`, and Web AIGC node routes. | Route shell remains Node. Each mounted family needs its own contract/proxy/runtime/production-wiring evidence before it can count beyond `node-only`. |
| route/core | `/api/sliderule` and legacy `/api/whybuddy` | `proxy`, `runtime` | `server/routes/sliderule.ts`; `server/sliderule/python-delegation.ts`; `server/routes/__tests__/sliderule.evidence-python-proxy-contract.test.ts`; `server/routes/__tests__/sliderule.evidence-python-runtime.test.ts`; `server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts`; `server/routes/__tests__/sliderule.orchestrate-plan-python-runtime.test.ts`; Python tests `test_evidence_node_runtime_wiring.py`, `test_orchestrate_plan_runtime_route.py`, and `test_orchestrate_plan_contract.py`. | Session shell, response route, capability maps, fallback maps, and production external dependencies are still Node-led or mixed. |
| route/core | `/api/health` and `/api/health/persistence` | `node-only`, `production-wiring` | `server/index.ts` exposes `/api/health`; `server/routes/persistence-health.ts`; `server/routes/__tests__/python-deployment-live-smoke.test.ts`; Python `test_deployment_live_smoke_boundary.py`. | Deployment smoke is bounded evidence. It does not prove all production routes are wired to Python. |
| route/core | `/api/rag`, `/api/vector-update`, `/api/vector-delete`, `/api/rag/risk-actions` | `runtime`, `production-wiring` | `server/routes/rag.ts`; `server/routes/__tests__/rag-ingestion-python-runtime-contract.test.ts`; `server/routes/__tests__/rag-ingestion-python-production-storage.test.ts`; Python `test_rag_ingestion_runtime_contract.py`, `test_rag_ingestion_production_storage.py`, and `test_real_vector_retrieval_production_wiring.py`; services `tws-ai-slide-rule-python/services/rag_service.py` and `rag_ingestion.py`. | Real external vector availability remains smoke/boundary evidence, not full production retrieval ownership. |
| route/core | `/api/telemetry` and `/api/cost` | `contract` | `server/routes/telemetry.ts`; `server/routes/cost.ts`; `server/routes/__tests__/telemetry-python-route-contract.test.ts`; Python `test_telemetry_route_contract.py`, `test_cost_runtime_accounting.py`; shared telemetry contracts. | The configured 90 production sink paths `server/routes/__tests__/telemetry-python-production-sink.test.ts` and `tws-ai-slide-rule-python/tests/test_telemetry_production_sink.py` are absent in this checkout, so production sink is still a blocker. |
| route/core | `/api/mcp`, `/api/skills`, and SlideRule capability calls | `contract`, `runtime` | `server/routes/mcp.ts`; `server/routes/__tests__/sliderule.mcp-call-contract.test.ts`; `server/routes/__tests__/sliderule.skill-invoke-contract.test.ts`; Python `test_mcp_call_contract.py`, `test_mcp_call_real_runtime.py`, `test_mcp_call_runtime_smoke.py`, `test_skill_invoke_contract.py`, `test_skill_invoke_real_runtime.py`, `test_skill_invoke_runtime_smoke.py`. | MCP and skill invocation are bounded runtime slices. Full external tool orchestration and production authorization remain Node-led/mixed. |
| route/core | `/api/workflows` and `/api/nl-command` | `contract`, `runtime` | `server/routes/workflows.ts`; `server/routes/nl-command.ts`; `server/routes/__tests__/workflow-python-runtime-contract.test.ts`; `server/routes/__tests__/nl-command-python-runtime-contract.test.ts`; Python `test_workflow_runtime_contract.py`, `test_nl_command_runtime_contract.py`; service `tws-ai-slide-rule-python/services/workflow_runtime.py`. | Staged workflow execution and production task dispatch are not fully migrated. |

## Task And Executor Inventory

| Path or surface | Current tag | Evidence from current repo | 90-stage gap |
|---|---|---|---|
| `/api/tasks` | `node-only`, `runtime` | `server/index.ts` mounts `createTaskRouter`; `server/routes/tasks.ts`; mission runtime under `server/tasks/*`; Python bridge evidence in `server/tests/executor-client-python-runtime.test.ts`, `server/tests/executor-client-python-proxy-contract.test.ts`, Python `test_task_executor_runtime_bridge.py`, `test_task_executor_proxy_contract.py`, service `tws-ai-slide-rule-python/services/task_executor_runtime.py`. | The task route, mission store, auth-wrapped project/resource handling, and production task lifecycle remain Node-owned. Runtime bridge evidence covers executor client behavior only. |
| `/api/executor/events` | `contract`, `node-only` | `server/index.ts` registers callback middleware and POST handler; `server/tests/executor-callback-python-contract.test.ts`; `server/tests/executor-callback-routing.test.ts`; Python `test_executor_callback_contract.py`. | Callback ingress and mission replay semantics remain Node-owned. |
| `/api/tasks/smoke/dispatch` and `/api/tasks/smoke/seed-running` | `node-only` | Inline handlers in `server/index.ts`; task smoke messages reference replaying executor events into `/api/executor/events`. | No Python route ownership evidence. These are smoke/support endpoints, not migrated production task runtime. |

## Auth Inventory

| Path or surface | Current tag | Evidence from current repo | 90-stage gap |
|---|---|---|---|
| `/api/auth/register`, `/login`, `/email-code/send`, `/email-code/login`, `/me`, `/refresh`, `/logout` | `contract` | `server/routes/auth.ts`; `server/auth/session-service.ts`; `server/auth/middleware.ts`; `server/tests/auth-session-python-contract.test.ts`; `server/tests/auth-session-middleware.test.ts`; Python `test_auth_session_contract.py`. | The 90 runtime gate references `server/tests/auth-session-runtime-boundary.test.ts` and `tws-ai-slide-rule-python/tests/test_auth_session_runtime_boundary.py`, but both files are absent in this checkout. Auth/session therefore remains contract-level, not runtime-level. |
| Auth persistence repositories and email-code mailer | `node-only` | `server/index.ts` wires MySQL repositories and email services before mounting `/api/auth`; `server/auth/*`. | No Python production repository or mailer wiring evidence. |

## Permission Inventory

| Path or surface | Current tag | Evidence from current repo | 90-stage gap |
|---|---|---|---|
| `/api/permissions` | `node-only`, `runtime` | `server/index.ts` mounts `createPermissionRouter`; `server/routes/permissions.ts`; `server/permission/*`; `server/permission/check-engine-python-contract.test.ts`; `server/permission/check-engine-python-runtime.test.ts`; Python `test_permission_check_contract.py` and `test_permission_check_runtime_boundary.py`; shared permission contracts. | Permission route management, role/policy/token stores, dynamic manager, and conflict detector remain Node-owned. Runtime coverage is bounded to check-engine semantics. |
| Permission rate limit | `contract` | `server/permission/rate-limiter.ts`; `server/permission/rate-limiter-python-contract.test.ts`; Python `test_permission_rate_limit_contract.py`. | The 90 runtime gate references `server/permission/rate-limiter-python-runtime.test.ts` and `tws-ai-slide-rule-python/tests/test_permission_rate_limit_runtime_boundary.py`, but both files are absent in this checkout. |
| Permission-mediated Web AIGC/open routes | `node-only` | `server/index.ts` passes `permCheckEngine` and `permAuditLogger` into `/api/open-page`, `/api/open-dashboard`, `/api/transaction-flow`, Web AIGC adapters, and RAG risk actions. | Permission enforcement is still Node runtime wiring even when downstream adapters have Python contracts. |

## Audit Inventory

| Path or surface | Current tag | Evidence from current repo | 90-stage gap |
|---|---|---|---|
| `/api/audit` event/query/stat/export/compliance/anomaly endpoints | `contract`, `proxy`, `node-only` | `server/routes/audit.ts`; `server/audit/*`; `server/tests/audit-event-python-contract.test.ts`; `server/tests/audit-query-python-proxy.test.ts`; `server/tests/audit-query-python-boundary.test.ts`; Python `test_audit_event_contract.py`, `test_audit_query_proxy_contract.py`, `test_audit_query_proxy_boundary.py`; shared audit contracts. | Audit event runtime gate paths `server/tests/audit-event-python-runtime.test.ts` and `tws-ai-slide-rule-python/tests/test_audit_event_runtime_boundary.py` are absent in this checkout. Audit store, retention, verifier, anomaly, and export remain Node-owned. |
| Permission audit logger and Web AIGC audit hooks | `node-only` | `server/index.ts` wires `installAuditHooks`, `AuditLogger`, and Web AIGC observability deps; `server/permission/audit-logger.ts`; `server/core/web-aigc-runtime-observability.ts`. | No Python production audit sink ownership evidence. |

## Blueprint Inventory

| Path or surface | Current tag | Evidence from current repo | 90-stage gap |
|---|---|---|---|
| `/api/blueprint` route shell | `node-only`, `contract`, `proxy` | `server/index.ts` mounts `createBlueprintRouter`; `server/routes/blueprint.ts` contains the large route shell and stateful handlers; `server/routes/blueprint/index.ts` and submodules. | The route shell, service context, event bus, job store, socket relay, diagnostics, and many job artifact routes remain Node-owned. |
| Blueprint main state | `contract` | `server/routes/__tests__/blueprint.main-state-python-contract.test.ts`; Python `test_blueprint_main_state_contract.py`; `tws-ai-slide-rule-python/models/blueprint_state.py`. | Contract-level only; full Node state machine is not replaced. |
| Blueprint jobs | `proxy` | `server/routes/__tests__/blueprint.job-runtime-python-proxy.test.ts`; Python `test_blueprint_job_runtime_proxy.py`; service `tws-ai-slide-rule-python/services/blueprint_job_runtime.py`. | Job lifecycle and event streams are still Node-led. |
| Blueprint stage edit | `proxy` | `server/routes/__tests__/blueprint.stage-edit-python-proxy.test.ts`; Python `test_blueprint_stage_edit_proxy_contract.py`; service `tws-ai-slide-rule-python/services/blueprint_stage_edit.py`. | Stage edit validation/invalidation remains mixed with Node modules. |
| Blueprint spec docs and batch docs | `proxy`, `runtime` | `server/routes/__tests__/blueprint.spec-docs-python-proxy.test.ts`; `server/routes/__tests__/blueprint.spec-docs-batch-python-proxy.test.ts`; `server/routes/__tests__/blueprint.spec-docs-smoke.test.ts`; Python `test_blueprint_spec_docs_proxy.py`, `test_blueprint_spec_docs_batch_proxy.py`, `test_blueprint_spec_docs_smoke.py`; Python route `tws-ai-slide-rule-python/routes/blueprint_spec_docs.py`. | Smoke/proxy evidence does not cover all Blueprint document, preview, prompt-package, and engineering-run routes. |
| Blueprint artifact memory, review export, agent crew, brainstorm | `contract`, `proxy` | `server/routes/__tests__/blueprint.artifact-memory-python-proxy.test.ts`; `blueprint.review-export-python-proxy.test.ts`; `blueprint.agent-crew-python-proxy.test.ts`; `blueprint.brainstorm-python-contract.test.ts`; Python tests `test_blueprint_artifact_memory_proxy.py`, `test_blueprint_review_export_proxy.py`, `test_blueprint_agent_crew_proxy_contract.py`, `test_blueprint_brainstorm_contract.py`. | Agent crew and brainstorm are not full Python runtime orchestration. |
| Blueprint role runtime | `proxy` | `server/routes/__tests__/blueprint.role-runtime-python-proxy.test.ts`; `server/routes/blueprint/role-agent-runtime/python-proxy.ts`; Python `test_role_runtime_proxy_contract.py`, service `tws-ai-slide-rule-python/services/role_runtime.py`. | Real role-agent execution, callback receiver, tool proxy, and production LLM/tool dependencies remain mixed/Node-led. |
| Blueprint route selection, spec-tree edits, previews, prompt packages, engineering runs, ledger routes, replan/staleness/family/traceability | `node-only` | `server/routes/blueprint.ts` route handlers for these paths; submodules under `server/routes/blueprint/*` with Node tests. | No Python route ownership evidence found for these path groups in current inventory. |

## Web AIGC Inventory

| Path or surface | Current tag | Evidence from current repo | 90-stage gap |
|---|---|---|---|
| `/api/web-search` and Web AIGC search adapter | `runtime` | `server/routes/web-search.ts`; `server/routes/__tests__/web-aigc.search-python-contract.test.ts`; `server/routes/__tests__/web-aigc.search-python-runtime.test.ts`; Python `test_web_aigc_search_adapter_contract.py`, `test_web_aigc_search_runtime_bridge.py`; service `tws-ai-slide-rule-python/services/web_aigc_search_adapter.py`. | Real external search remains bounded/safe-failure evidence, not production service ownership. |
| `/api/file-generation`, `/api/file-slicing`, `/api/file-translation` and file adapter | `contract` | Node routes and node adapters; `server/routes/__tests__/web-aigc.file-python-contract.test.ts`; Python `test_web_aigc_file_adapter_contract.py`; service `tws-ai-slide-rule-python/services/web_aigc_file_adapter.py`. | The 90 runtime paths `server/routes/__tests__/web-aigc.file-python-runtime.test.ts` and `tws-ai-slide-rule-python/tests/test_web_aigc_file_runtime_bridge.py` are absent in this checkout. |
| `/api/vision`, `/api/audio-recognition`, multimodal adapter | `contract` | Node routes; `server/routes/__tests__/web-aigc.vision-audio-python-contract.test.ts`; Python `test_web_aigc_vision_audio_adapter_contract.py`; service file present as `tws-ai-slide-rule-python/services/web_aigc_media_adapter.py`. | The production smoke gate references `tws-ai-slide-rule-python/services/web_aigc_vision_audio_adapter.py`, but the current service filename is `web_aigc_media_adapter.py`. Runtime test paths for vision/audio are absent. |
| `/api/web-qa`, `/api/image-search`, `/api/graph-search`, `/api/static-webpage-read`, `/api/ocr-recognition`, `/api/dynamic-chart`, `/api/ai-ppt`, `/api/transaction-flow`, `/api/orchestration-recognition-jump`, `/api/long-text-extraction`, `/api/get-location-info`, `/api/get-device-info`, `/api/open-page`, `/api/open-dashboard`, `/api/open-report` | `node-only` | `server/index.ts` mounts these routes; implementations live under `server/routes/*` and `server/routes/node-adapters/*`; Node tests exist for many route families under `server/tests`. | No Python contract/proxy/runtime evidence found for these path groups in this inventory. |
| Vector update/delete and RAG risk actions | `production-wiring` | `server/web-aigc/vector-update-adapter.ts`; `server/web-aigc/vector-delete-adapter.ts`; RAG production storage tests listed above. | Production dependency readiness is bounded by smoke/degraded semantics, not full external vector service ownership. |

## A2A Inventory

| Path or surface | Current tag | Evidence from current repo | 90-stage gap |
|---|---|---|---|
| `/api/a2a/invoke` | `runtime` | `server/routes/a2a.ts`; `server/core/a2a-server.ts`; `server/core/a2a-client.ts`; `server/routes/__tests__/a2a-python-invoke-runtime.test.ts`; `server/routes/__tests__/a2a-python-runtime-contract.test.ts`; Python `test_a2a_invoke_runtime_bridge.py`, `test_a2a_runtime_contract.py`; service `tws-ai-slide-rule-python/services/a2a_runtime.py`. | Invoke runtime is bounded and does not prove real external agent production execution. |
| `/api/a2a/stream` | `contract`, `node-only` | `server/routes/a2a.ts`; Node A2A stream implementation in `server/core/a2a-server.ts`; shared `shared/a2a-protocol.ts`; Python runtime contract tests listed above. | The 90 stream runtime gate references `server/routes/__tests__/a2a-python-stream-runtime.test.ts` and `tws-ai-slide-rule-python/tests/test_a2a_stream_runtime_boundary.py`, but both files are absent in this checkout. |
| `/api/a2a/cancel`, `/api/a2a/agents`, `/api/a2a/sessions`, `/api/a2a/auto-agent` | `contract`, `node-only` | `server/routes/a2a.ts`; `server/tests/a2a-routes.test.ts`; `server/tests/a2a-protocol.test.ts`; Python `test_a2a_runtime_contract.py`. | Registry/session/cancel production semantics remain Node-led. |

## 90-Stage Blocking Gaps

| Gap | Why it blocks a 90% route claim |
|---|---|
| Auth/session runtime boundary | Current checkout has auth/session contract tests, but the runtime boundary files named by the 90 gate are absent. |
| Permission rate-limit runtime boundary | Contract tests exist; runtime test files named by the 90 gate are absent. |
| Audit event runtime boundary | Event contract and query proxy exist; audit event runtime test files named by the 90 gate are absent. |
| A2A stream runtime boundary | Invoke bridge exists, but stream runtime test files named by the 90 gate are absent. |
| Web AIGC file runtime bridge | File adapter contract exists, but runtime bridge test files are absent. |
| Web AIGC vision/audio runtime bridge | Vision/audio contract exists, but runtime bridge files are absent and the configured service path differs from the current Python service filename. |
| Telemetry production sink | Route/cost contracts exist, but production sink test files named by the production smoke gate are absent. |
| Blueprint main route shell | Many Blueprint slices have contract/proxy tests, but the large `/api/blueprint` route, stateful job lifecycle, event streams, ledgers, prompt packages, previews, engineering runs, replan, staleness, and traceability routes remain Node-owned or mixed. |
| Session persistence/no-diff review | Session persistence contract exists through `server/routes/__tests__/sliderule.sessions-store.test.ts` and Python `test_session_persistence_contract.py`, but the 90 no-diff decision is a separate task and should not be collapsed into this route inventory. |
| Runtime-depth audit document | `docs/backend-python-runtime-depth-audit-90.md` is absent in this checkout, so later status refresh must not use it as completed evidence. |
| Broad production wiring smoke | Some production-wiring slices exist for RAG/vector/deployment, but the broad 90 smoke gate references missing telemetry, file, and vision/audio runtime paths. |

## Counting Rules For Status Refresh

- Count `contract`, `proxy`, `runtime`, and `production-wiring` separately.
- Do not count `node-only` route shells as migrated merely because adjacent contracts exist.
- Do not count a Python test file as production wiring unless the row explicitly has `production-wiring`.
- Do not count missing gate paths as completed work.
- Do not treat SlideRule or Blueprint progress as whole-backend progress.
- Do not count `tws-ai-ask-python` at all.

## Gate

Required gate from `nodeRouteInventory90Gates`:

```powershell
node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-node-route-inventory-90.md docs/backend-python-node-route-inventory-90.md agent-loop/tasks/sliderule-python-migration-status.md
```
