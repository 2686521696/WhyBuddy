# 后端 NodeJS 到 Python 迁移：production wiring reality check 95

## 执行状态
- 状态：待执行
- 目标：把 95 阶段涉及的 production wiring 证据分成真实接线、可降级接线、fake/synthetic smoke 和仍缺失。
- 角色分工：worker 负责读取当前 HEAD 的 vector/RAG/Web AIGC/telemetry/audit/deployment 证据并产出分层报告；reviewer 确认 degraded、unknown、missing config 没有被写成 healthy。

### 状态清单
- [x] 读取 real vector、RAG ingestion、Web AIGC、telemetry/audit sink、deployment smoke 和 observability 证据。
- [x] 生成 `docs/backend-python-production-wiring-reality-95.md`。
- [x] 标出 fake/synthetic smoke、missing config、timeout/degraded、安全失败和真实接线的区别。
- [x] 给出哪些证据可支撑 SlideRule V5 95%，哪些只能支撑整体后端成熟度但不能算生产完成。
- [x] gate 全绿。
- [x] Codex review 确认没有真实外部服务副作用。

## 目标

95 阶段不能只看 smoke 绿灯。这个任务要把生产接线现实讲清楚：

- real vector retrieval 和 RAG ingestion 是 production wiring、fake provider 还是 synthetic smoke。
- Web AIGC search/file/vision/audio 当前是 bounded fake runtime 还是外部服务生产接管。
- telemetry/audit/deployment smoke 是否能保留 degraded/unknown/misconfigured 语义。
- 哪些仍需要真实 Qdrant、embedding、search、OCR、vision、audio、APM、billing 或 deployment 环境验证。

## 允许修改的文件
- `docs/backend-python-production-wiring-reality-95.md`
- `agent-loop/tasks/backend-python-production-wiring-reality-check-95.md`

## 允许读取和引用的证据
- `.agent-loop/queue-outcomes.json`
- `agent-loop/tasks/sliderule-python-migration-status.md`
- `docs/backend-python-web-aigc-runtime-evidence-reconcile-88.md`
- `docs/backend-python-web-aigc-longtail-inventory-89.md`
- `docs/backend-python-runtime-evidence-reconcile-89.md`
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

## 禁止扩大范围
- 不调用真实外部 search、OCR、vision、audio、Qdrant、APM、billing 或 deployment 服务。
- 不提交真实密钥、token、Qdrant key 或环境配置。
- 不把 degraded/unknown/misconfigured 写成 healthy。
- 不提交 `.agent-loop` 运行产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `productionWiringRealityCheck95Gates`。

## 成功标准

- 报告按能力列出 evidence、current posture、safe-failure semantics、remaining production gap。
- 能解释哪些 production wiring 支撑 SlideRule V5 95%，哪些不应计入真实生产完成。
- 不依赖真实外部服务即可通过。
- mojibake 扫描通过。
