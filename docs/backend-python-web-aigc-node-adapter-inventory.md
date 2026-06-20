# Backend Python migration: web-aigc node adapter inventory

## Conclusion

This inventory only defines candidate migration slices for the web-aigc Node adapter surface. It does not mean these adapters have already been migrated to Python. The source of truth is the current NodeJS backend under `server/routes/node-adapters`, `server/routes`, `server/core`, and `shared`; `tws-ai-ask-python` is not a migration target for this repo.

This task does not change adapter runtime code and does not create Python runtime modules.

## Suggested Order

1. Search/read adapters: clear request/response contracts, good first Grok worker slice after Codex pins boundaries.
2. File adapters: split by generation/slicing/translation/excel/long text; high I/O risk, needs Codex-owned contract first.
3. Vision/audio adapters: provider and payload semantics are sensitive; Codex should lock the boundary before worker implementation.
4. Chart/similarity/navigation adapters: mixed data-shaping work, good Grok work after tests exist.
5. Vector and transaction-control adapters: high persistence and side-effect risk; Codex must own the boundary and gates.
6. Report/presentation adapters: output artifact semantics must stay separate from runtime execution; Codex should review first.

## Adapter Groups

| Group | Node adapters and sources | Python target | Suggested tests / gates | Owner split |
| --- | --- | --- | --- | --- |
| Search and webpage read | `server/routes/node-adapters/web-search-node-adapter.ts`; `graph-search-node-adapter.ts`; `image-search-node-adapter.ts`; `image-search-executor.ts`; `static-webpage-read-node-adapter.ts`; routes `server/routes/web-search.ts`, `graph-search.ts`, `image-search.ts`, `static-webpage-read.ts`; shared `shared/web-search.ts`, `shared/web-aigc-graph-search.ts`, `shared/web-aigc-image-search.ts`, `shared/static-webpage-read.ts`, `shared/rag/web-aigc-search.ts` | `tws-ai-slide-rule-python/services/web_aigc/search.py`; optional `routes/web_aigc_search.py` | `tws-ai-slide-rule-python/tests/test_web_aigc_search_adapter_contract.py`; `server/routes/__tests__/web-aigc.search-python-contract.test.ts`; `webAigcSearchAdapterContractGates` | Codex defines contract/error/source metadata; Grok can implement deterministic transformer and proxy tests. |
| File generation and slicing | `file-generation-node-adapter.ts`; `file-slicing-node-adapter.ts`; `file-slicing-parser.ts`; routes `file-generation.ts`, `file-slicing.ts`; shared `shared/web-aigc-file-generation.ts`, `shared/web-aigc-file-slicing.ts` | `tws-ai-slide-rule-python/services/web_aigc/files.py` | `tws-ai-slide-rule-python/tests/test_web_aigc_file_adapter_contract.py`; `server/routes/__tests__/web-aigc.file-python-contract.test.ts`; `webAigcFileAdapterContractGates` | Codex owns upload/artifact/side-effect boundary; Grok can fill schema-preserving adapters. |
| File translation, Excel, and long text | `file-translation-node-adapter.ts`; `excel-read-node-adapter.ts`; `long-text-extraction-node-adapter.ts`; routes `file-translation.ts`, `excel-read.ts`, `long-text-extraction.ts`; shared `shared/web-aigc-file-translation.ts`, `shared/web-aigc-excel-read.ts`, `shared/web-aigc-long-text-extraction.ts` | `tws-ai-slide-rule-python/services/web_aigc/files.py` or split `file_translation.py`, `excel.py`, `long_text.py` | Same file adapter gate plus focused fixtures for empty file, oversized file, parse error, and translation fallback | Codex first for I/O and failure semantics; Grok can implement pure parsing/result shape once fixtures exist. |
| Vision, OCR, and audio | `ocr-recognition-node-adapter.ts`; `audio-recognition-node-adapter.ts`; routes `ocr-recognition.ts`, `audio-recognition.ts`, `vision.ts`, `voice.ts`; core `vision-provider.ts`, `vision-output.ts`, `ocr-provider.ts`, `voice-provider.ts`, `audio-transcription-provider.ts`; shared `shared/web-aigc-ocr-recognition.ts`, `shared/web-aigc-audio-recognition.ts` | `tws-ai-slide-rule-python/services/web_aigc/vision_audio.py` | `tws-ai-slide-rule-python/tests/test_web_aigc_vision_audio_adapter_contract.py`; `server/routes/__tests__/web-aigc.vision-audio-python-contract.test.ts`; `webAigcVisionAudioAdapterContractGates` | Codex owns provider privacy, binary payload, timeout and metadata boundary; Grok can implement normalized contract after that. |
| Chart and similarity | `dynamic-chart-node-adapter.ts`; `similarity-match-node-adapter.ts`; routes `dynamic-chart.ts`, `similarity-match.ts`; shared `shared/web-aigc-dynamic-chart.ts`, `shared/web-aigc-similarity-match.ts` | `tws-ai-slide-rule-python/services/web_aigc/analysis.py` | Candidate future gate: `test_web_aigc_analysis_adapter_contract.py`; Node contract tests for chart spec and similarity score shape | Grok-friendly after Codex pins numeric precision, empty result, and chart schema rules. |
| Vector mutation and RAG adjacency | routes `vector-update.ts`, `vector-delete.ts`; shared `shared/web-aigc-vector-update.ts`, `shared/web-aigc-vector-delete.ts`; core/vector adjacency in `server/memory/vector-store.ts` and existing Python vector/evidence services | `tws-ai-slide-rule-python/services/rag_ingestion.py`; `sliderule_llm/vector.py` | `ragIngestionRuntimeContractGates`; `realVectorRetrievalProductionGates`; focused tests for idempotent update/delete and provenance | Codex-owned boundary. Do not let worker treat generated/fallback evidence as production retrieval. |
| Transaction and orchestration control | routes/shared `web-aigc-transaction-flow.ts`; `web-aigc-orchestration-recognition-jump.ts`; `web-aigc-intent-recognition.ts`; core `web-aigc-controlflow.ts`, `web-aigc-runtime-extra-adapters.ts` | `tws-ai-slide-rule-python/services/web_aigc/controlflow.py` | Candidate future contract tests for intent, transition, rollback, and no-op actions | Codex first. These touch runtime routing and should not be implemented by Grok until contracts are narrow. |
| Observability, governance, device/location | core `web-aigc-runtime-observability.ts`; shared `web-aigc-observability.ts`, `web-aigc-governance.ts`, `web-aigc-risk-actions.ts`, `web-aigc-device-info.ts`, `web-aigc-location-info.ts` | `tws-ai-slide-rule-python/services/telemetry_runtime.py` or `web_aigc/observability.py` | `telemetryRouteContractGates`; future governance contract tests | Codex-owned audit/telemetry boundary, Grok can help only with pure shape mapping. |
| Report and presentation artifacts | `server/routes/ai-ppt.ts`; core `ai-ppt-generation-provider.ts`; shared `shared/web-aigc-ai-ppt.ts` | `tws-ai-slide-rule-python/services/web_aigc/presentation.py` | Candidate future tests for artifact metadata, generation failure, and no binary leakage | Codex defines artifact lifecycle and storage boundary; Grok may implement stub-safe contract. |

## Minimum Adapter Count

The inventory covers at least these 16 concrete Node adapter/source entries:

1. `web-search-node-adapter.ts`
2. `graph-search-node-adapter.ts`
3. `image-search-node-adapter.ts`
4. `image-search-executor.ts`
5. `static-webpage-read-node-adapter.ts`
6. `file-generation-node-adapter.ts`
7. `file-slicing-node-adapter.ts`
8. `file-slicing-parser.ts`
9. `file-translation-node-adapter.ts`
10. `excel-read-node-adapter.ts`
11. `long-text-extraction-node-adapter.ts`
12. `ocr-recognition-node-adapter.ts`
13. `audio-recognition-node-adapter.ts`
14. `dynamic-chart-node-adapter.ts`
15. `similarity-match-node-adapter.ts`
16. `web-aigc-controlflow.ts`

## Boundary Rules

- Do not migrate all adapters in one task.
- Do not treat this inventory as completed migration.
- Do not create Python runtime modules from this task.
- Do not use `tws-ai-ask-python` as source or target evidence.
- Prefer Codex-owned contract tasks before Grok worker implementation for side-effecting, binary, vector, telemetry, and runtime-control adapters.

## Gate

Use `webAigcAdapterInventoryGates`:

```powershell
node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-web-aigc-node-adapter-inventory.md docs/backend-python-web-aigc-node-adapter-inventory.md
```
