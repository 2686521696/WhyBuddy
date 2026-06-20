# 后端 NodeJS 到 Python 迁移：RAG ingestion production storage

## 执行状态
- 状态：待执行
- 目标：把 RAG ingestion（RAG 摄取）从 fake/upsert contract（假写入契约）推进到 production storage（生产存储）最小接线边界。
- 角色分工：worker 负责 Python storage adapter（存储适配器）和测试；reviewer 确认不连接真实生产库、不提交真实数据。

### 状态清单
- [ ] Python 侧有可注入的 ingestion storage adapter。
- [ ] ingest/chunk/embed/upsert/delete/error 路径能区分 fake、memory、unavailable。
- [ ] Node proxy test 能确认 failed/unavailable 不伪装成 success。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实外部服务或真实知识库副作用。

## 目标

上一轮已经有 `backend-python-rag-ingestion-runtime-contract`，但它主要锁住 contract 和 fake runtime。这个任务只往前推进一小步：加 production storage 的接口边界和可测试 adapter，不接真实 Qdrant、真实数据库或真实 embedding。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/rag_service.py`
- `tws-ai-slide-rule-python/sliderule_llm/vector.py`
- `tws-ai-slide-rule-python/tests/test_rag_ingestion_production_storage.py`
- `tws-ai-slide-rule-python/tests/test_rag_ingestion_runtime_contract.py`
- `server/routes/__tests__/rag-ingestion-python-production-storage.test.ts`
- `server/routes/__tests__/rag-ingestion-python-runtime-contract.test.ts`
- `agent-loop/tasks/backend-python-rag-ingestion-production-storage.md`

## 禁止扩大范围
- 不连接真实 Qdrant、Postgres、对象存储或生产知识库。
- 不发真实 embedding 或 LLM 请求。
- 不迁 knowledge admin（知识库管理）后台。
- 不提交 `.env`、向量数据、缓存、日志或运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `ragIngestionProductionStorageGates`。

## 成功标准

- Python 测试覆盖 ingest、chunk、upsert、delete、storage unavailable。
- storage unavailable 必须返回明确失败或 fallback 状态，不能伪装成写入成功。
- Node 测试证明 proxy 能识别 Python storage contract。
- 所有 gate 通过，且不依赖真实外部服务。
