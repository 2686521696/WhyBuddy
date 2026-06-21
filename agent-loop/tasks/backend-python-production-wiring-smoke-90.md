# 后端 NodeJS 到 Python 迁移：Production wiring smoke 90

## 执行状态
- 状态：待执行
- 目标：把 vector、RAG、Web AIGC、telemetry、deployment 的生产接线冒烟汇总为 90% 证据，不触发真实外部服务副作用。
- 角色分工：worker 负责 production wiring smoke 和缺口表；reviewer 确认 fallback、provenance、degraded 状态没有被吞掉。

### 状态清单
- [ ] real vector retrieval 与 RAG ingestion production storage 有 smoke 证据。
- [ ] Web AIGC search/file/vision-audio runtime bridge 有 safe failure 和 provenance。
- [ ] telemetry production sink 与 observability rollup 能保留 degraded/unknown 状态。
- [ ] deployment live smoke 能覆盖 config missing、timeout、unhealthy。
- [ ] gate 全绿。

## 目标

90% 不只是 contract/proxy 绿，还要能证明关键外部服务接线在缺配置、超时、降级时可诊断、可回退、不会伪装成成功。

## 允许修改的文件
- `tws-ai-slide-rule-python/sliderule_llm/evidence.py`
- `tws-ai-slide-rule-python/sliderule_llm/vector.py`
- `tws-ai-slide-rule-python/sliderule_llm/config.py`
- `tws-ai-slide-rule-python/services/rag_service.py`
- `tws-ai-slide-rule-python/services/web_aigc_search_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_file_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_vision_audio_adapter.py`
- `tws-ai-slide-rule-python/services/telemetry.py`
- `tws-ai-slide-rule-python/tests/test_real_vector_retrieval_production_wiring.py`
- `tws-ai-slide-rule-python/tests/test_rag_ingestion_production_storage.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_search_runtime_bridge.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_file_runtime_bridge.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_vision_audio_runtime_bridge.py`
- `tws-ai-slide-rule-python/tests/test_telemetry_production_sink.py`
- `tws-ai-slide-rule-python/tests/test_production_observability_rollup.py`
- `tws-ai-slide-rule-python/tests/test_deployment_live_smoke_boundary.py`
- `server/routes/__tests__/rag-ingestion-python-production-storage.test.ts`
- `server/routes/__tests__/web-aigc.search-python-runtime.test.ts`
- `server/routes/__tests__/web-aigc.file-python-runtime.test.ts`
- `server/routes/__tests__/web-aigc.vision-audio-python-runtime.test.ts`
- `server/routes/__tests__/telemetry-python-production-sink.test.ts`
- `server/routes/__tests__/python-observability-rollup.test.ts`
- `server/routes/__tests__/python-deployment-live-smoke.test.ts`
- `shared/telemetry/contracts.ts`
- `agent-loop/tasks/backend-python-production-wiring-smoke-90.md`

## 禁止扩大范围
- 不调用真实 LLM、真实外部 agent 或生产服务。
- 不提交真实密钥、token、Qdrant key 或外部服务配置。
- 不把 degraded/unknown/misconfigured 映射成 healthy。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `productionWiringSmoke90Gates`。

## 成功标准

- smoke 覆盖 vector/RAG/Web AIGC/telemetry/deployment 的 happy path、missing config、timeout/degraded 或 safe failure。
- provenance（来源）和 error envelope（错误信封）稳定。
- 不依赖真实外部服务即可通过。
- 所有 gate 通过。
