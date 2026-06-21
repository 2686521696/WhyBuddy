# Backend Python Web AIGC Runtime Evidence Reconcile 88

## Scope

This report reconciles the current `HEAD` evidence for the Web AIGC search,
file, vision/audio, and telemetry sink slices. It is evidence alignment only:
it does not add business code, call external services, or raise the overall
backend migration percentage.

Current `HEAD` used for this reconcile:

- `80ba0cc7c88d3c2ac13f6c469980d709dd8387a1`
- `80ba0cc7 agent-loop queue checkpoint: backend-python-runtime-evidence-reconcile-88`

## Classification Rules

| Tag | Meaning in this report |
|---|---|
| `runtime` | Current `HEAD` has Python-side runtime bridge code and Node/Python tests for a bounded fake-provider or synthetic runtime slice. |
| `contract` | Current `HEAD` has request/response or shared contract tests, but no runtime bridge for that surface. |
| `production-wiring` | Current `HEAD` has a synthetic production sink or smoke boundary with degraded/safe-failure semantics. It does not mean real external services are connected. |
| `node-only` | Current `HEAD` has only Node route or Node adapter ownership for the named surface. |
| `production-gap` | The remaining gap is real external service ownership, long-running production dependency health, credentials, deployment policy, or complete route-shell migration. |

## Evidence Matrix

| Slice | Current `HEAD` paths | Classification | Gap |
|---|---|---|---|
| Web AIGC search: `/api/web-search`, `/api/image-search`, `/api/graph-search`, `/api/static-webpage-read` adapters | Node routes and adapters: `server/routes/web-search.ts`, `server/routes/image-search.ts`, `server/routes/graph-search.ts`, `server/routes/static-webpage-read.ts`, `server/routes/node-adapters/web-search-node-adapter.ts`, `server/routes/node-adapters/image-search-node-adapter.ts`, `server/routes/node-adapters/graph-search-node-adapter.ts`, `server/routes/node-adapters/static-webpage-read-node-adapter.ts`. Node tests: `server/routes/__tests__/web-aigc.search-python-contract.test.ts`, `server/routes/__tests__/web-aigc.search-python-runtime.test.ts`. Python service/tests: `tws-ai-slide-rule-python/services/web_aigc_search_adapter.py`, `tws-ai-slide-rule-python/tests/test_web_aigc_search_adapter_contract.py`, `tws-ai-slide-rule-python/tests/test_web_aigc_search_runtime_bridge.py`. | `runtime` for the bounded Python fake-provider bridge; contract evidence is also present. | Real web, image, graph, and page fetch providers remain a `production-gap`. The runtime tests assert `provider: "fake"` and `externalCalls: False`, so this is not production search ownership. |
| Web AIGC file: `/api/file-generation`, `/api/file-slicing`, `/api/file-translation`, `/api/excel-read`, `/api/long-text-extraction` adapters | Node routes and adapters: `server/routes/file-generation.ts`, `server/routes/file-slicing.ts`, `server/routes/file-translation.ts`, `server/routes/excel-read.ts`, `server/routes/long-text-extraction.ts`, `server/routes/node-adapters/file-generation-node-adapter.ts`, `server/routes/node-adapters/file-slicing-node-adapter.ts`, `server/routes/node-adapters/file-translation-node-adapter.ts`, `server/routes/node-adapters/excel-read-node-adapter.ts`, `server/routes/node-adapters/long-text-extraction-node-adapter.ts`. Node tests: `server/routes/__tests__/web-aigc.file-python-contract.test.ts`, `server/routes/__tests__/web-aigc.file-python-runtime.test.ts`. Python service/tests: `tws-ai-slide-rule-python/services/web_aigc_file_adapter.py`, `tws-ai-slide-rule-python/tests/test_web_aigc_file_adapter_contract.py`, `tws-ai-slide-rule-python/tests/test_web_aigc_file_runtime_bridge.py`. | `runtime` for the bounded Python fake-runtime bridge; contract evidence is also present. | File artifact persistence, real translators, user-path reads, and production storage are still a `production-gap`. The runtime evidence uses memory paths and asserts `externalCalls: False` and `persisted: False`. |
| Web AIGC vision/audio: `/api/vision`, `/api/audio-recognition`, `/api/ocr-recognition`, and voice/vision provider shapes | Node routes and adapters: `server/routes/vision.ts`, `server/routes/audio-recognition.ts`, `server/routes/ocr-recognition.ts`, `server/routes/node-adapters/audio-recognition-node-adapter.ts`, `server/routes/node-adapters/ocr-recognition-node-adapter.ts`, plus providers `server/core/vision-provider.ts`, `server/core/voice-provider.ts`, `server/core/audio-transcription-provider.ts`. Node tests: `server/routes/__tests__/web-aigc.vision-audio-python-contract.test.ts`, `server/routes/__tests__/web-aigc.vision-audio-python-runtime.test.ts`. Python service/tests: `tws-ai-slide-rule-python/services/web_aigc_media_adapter.py`, `tws-ai-slide-rule-python/services/web_aigc_vision_audio_adapter.py`, `tws-ai-slide-rule-python/tests/test_web_aigc_vision_audio_adapter_contract.py`, `tws-ai-slide-rule-python/tests/test_web_aigc_vision_audio_runtime_bridge.py`. | `runtime` for the bounded Python fake-runtime bridge; contract evidence is also present. | Real OCR, vision, STT, TTS, audio, and multimodal provider calls remain a `production-gap`. The current service filename drift is resolved by `web_aigc_vision_audio_adapter.py`, which wraps `web_aigc_media_adapter.py`; tests assert fake providers and `externalCalls: False`. |
| Telemetry route/cost surface: `/api/telemetry`, `/api/cost` | Node routes: `server/routes/telemetry.ts`, `server/routes/cost.ts`. Contract tests: `server/routes/__tests__/telemetry-python-route-contract.test.ts`, `tws-ai-slide-rule-python/tests/test_telemetry_route_contract.py`, `tws-ai-slide-rule-python/tests/test_cost_runtime_accounting.py`. Shared contracts: `shared/telemetry/contracts.ts`. | `contract` for route/cost result shapes. | Route handlers and cost aggregation remain Node-led or mixed. Route/cost contracts alone are not a runtime bridge. |
| Telemetry production sink | Node test: `server/routes/__tests__/telemetry-python-production-sink.test.ts`. Python service/test: `tws-ai-slide-rule-python/services/telemetry.py`, `tws-ai-slide-rule-python/tests/test_telemetry_production_sink.py`. Shared contract: `shared/telemetry/contracts.ts`. | `production-wiring` smoke for a synthetic sink boundary. | This is not a real APM, Datadog, OTLP, billing, or monitoring emission path. The sink evidence asserts `externalEmit: false`, `externalMonitoringRequest: false`, and `externalSink: false`; real external telemetry remains a `production-gap`. |

## Node-Only Web AIGC Surfaces

The following Web AIGC route families remain `node-only` in this reconcile
because no current Python contract, runtime bridge, or production-wiring
evidence was found for their named route surfaces:

| Node-only surface | Current Node evidence | Gap |
|---|---|---|
| `/api/web-qa` | `server/routes/web-qa.ts`, `server/routes/node-adapters/web-qa-node-adapter.ts`, `server/tests/web-qa-routes.test.ts`, `server/tests/web-qa-node-adapter.test.ts`. | No Python Web QA runtime or production bridge evidence in current `HEAD`. |
| `/api/dynamic-chart` | `server/routes/dynamic-chart.ts`, `server/routes/node-adapters/dynamic-chart-node-adapter.ts`, `server/tests/dynamic-chart-routes.test.ts`, `server/tests/dynamic-chart-node-adapter.test.ts`. | No Python dynamic-chart runtime or production bridge evidence in current `HEAD`. |
| `/api/ai-ppt` | `server/routes/ai-ppt.ts`, `server/routes/node-adapters/ai-ppt-node-adapter.ts`, `server/tests/ai-ppt-routes.test.ts`, `server/tests/ai-ppt-node-adapter.test.ts`. | No Python PPT generation runtime or production bridge evidence in current `HEAD`. |
| `/api/transaction-flow` | `server/routes/transaction-flow.ts`, `server/routes/node-adapters/transaction-flow-node-adapter.ts`, `server/tests/transaction-flow-routes.test.ts`, `server/tests/transaction-flow-node-adapter.test.ts`. | No Python transaction-flow runtime or production bridge evidence in current `HEAD`. |
| `/api/orchestration-recognition-jump` | `server/routes/orchestration-recognition-jump.ts`, `server/routes/node-adapters/orchestration-recognition-jump-node-adapter.ts`, `server/tests/orchestration-recognition-jump-routes.test.ts`, `server/tests/orchestration-recognition-jump-node-adapter.test.ts`. | No Python orchestration-recognition-jump runtime or production bridge evidence in current `HEAD`. |
| `/api/get-location-info`, `/api/get-device-info` | `server/routes/get-location-info.ts`, `server/routes/get-device-info.ts`, related node adapters and route tests. | No Python location/device runtime or production bridge evidence in current `HEAD`. |
| `/api/open-page`, `/api/open-dashboard`, `/api/open-report` | `server/routes/open-page.ts`, `server/routes/open-dashboard.ts`, `server/routes/open-report.ts`, related node adapters and route tests. | No Python open-page/dashboard/report runtime or production bridge evidence in current `HEAD`. |

## Reconciled Gaps

- The previously drifted vision/audio Python service name is reconciled:
  `tws-ai-slide-rule-python/services/web_aigc_vision_audio_adapter.py` exists
  in current `HEAD` and delegates to the lower-level
  `tws-ai-slide-rule-python/services/web_aigc_media_adapter.py`.
- The gate-named Web AIGC file runtime paths exist in current `HEAD`:
  `server/routes/__tests__/web-aigc.file-python-runtime.test.ts` and
  `tws-ai-slide-rule-python/tests/test_web_aigc_file_runtime_bridge.py`.
- The gate-named Web AIGC vision/audio runtime paths exist in current `HEAD`:
  `server/routes/__tests__/web-aigc.vision-audio-python-runtime.test.ts` and
  `tws-ai-slide-rule-python/tests/test_web_aigc_vision_audio_runtime_bridge.py`.
- The gate-named telemetry production sink paths exist in current `HEAD`:
  `server/routes/__tests__/telemetry-python-production-sink.test.ts` and
  `tws-ai-slide-rule-python/tests/test_telemetry_production_sink.py`.
- These reconciliations are bounded evidence only. They do not convert Web AIGC
  route shells, real external search/OCR/vision/audio/PPT/chart providers, or
  real telemetry/APM sinks into Python-owned production services.

## External-Service Safety

The reviewed runtime paths are safe for this task boundary:

- Search runtime tests assert fake provider metadata and `externalCalls: False`.
- File runtime tests assert memory artifacts, `persisted: False`, and
  `externalCalls: False`.
- Vision/audio runtime tests assert fake provider metadata and
  `externalCalls: False`.
- Telemetry sink tests assert synthetic provenance, `externalEmit: false`,
  `externalMonitoringRequest: false`, and `externalSink: false`.

No real external search, OCR, vision, audio, PPT, chart, telemetry, APM, or
billing service is called by this evidence reconcile.

## Required Gate

This task uses `webAigcRuntimeEvidenceReconcile88Gates` from
`agent-loop/scripts/migration-queue.json`:

```powershell
node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-web-aigc-runtime-evidence-reconcile-88.md docs/backend-python-web-aigc-runtime-evidence-reconcile-88.md docs/backend-python-node-route-inventory-90.md agent-loop/tasks/sliderule-python-migration-status.md
```
