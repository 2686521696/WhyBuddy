# 后端 NodeJS 到 Python 迁移：RAG ingestion runtime contract

## 执行状态
- 状态：待执行
- 目标：为 RAG ingestion（检索入库）建立 Python runtime contract，补齐 ingest/chunk/embed/upsert/delete/error。
- 角色分工：worker 负责 contract；reviewer 确认不接真实向量库和真实 embedding。

### 状态清单
- [x] Python 侧有 RAG ingestion contract。
- [x] Node 侧测试覆盖 ingest/chunk/embed/upsert/failure。
- [x] dead-letter、lifecycle、feedback 字段不丢。
- [x] gate 全绿。
- [x] Codex review 确认没有真实外部向量库副作用。

## 目标

上一批已推进 retrieval（检索）。这一步推进 ingestion（入库）侧，但仍只做 fake runtime contract，不接真实 Qdrant/embedding provider。

## 允许修改的文件
- `agent-loop/tasks/backend-python-rag-ingestion-runtime-contract.md`
- `tws-ai-slide-rule-python/services/rag_ingestion.py`
- `tws-ai-slide-rule-python/tests/test_rag_ingestion_runtime_contract.py`
- `server/routes/rag.ts`
- `server/routes/vector-update.ts`
- `server/routes/vector-delete.ts`
- `server/routes/__tests__/rag-ingestion-python-runtime-contract.test.ts`
- `shared/rag/*.ts`

## 禁止扩大范围
- 不接真实 Qdrant。
- 不发真实 embedding 请求。
- 不删除真实向量。
- 不提交 `.env` 或向量数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `ragIngestionRuntimeContractGates`。

## 成功标准

- Python contract 覆盖 ingest/chunk/embed/upsert/delete/error。
- Node 测试确认 unavailable 时进入 safe failure。
- provenance/lifecycle 字段保留。
- gate 全绿。
