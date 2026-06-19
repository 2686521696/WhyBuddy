# 后端 NodeJS 到 Python 迁移：real vector retrieval runtime

## 执行状态

- 状态：待执行
- 目标：把 real vector retrieval smoke（真实向量检索冒烟）推进到可控 runtime wiring（运行时接线）
- 角色分工：Grok 负责补最小 runtime wiring 和测试；Codex 负责审查是否误接生产服务、误提交密钥或夸大成完整生产级 RAG

### 状态清单

- [x] 已执行 AgentLoop
- [x] Python runtime test 覆盖 vector store 命中、无命中、不可用三条路径
- [x] evidence retrieval（证据检索）能注入 fake vector runtime，不依赖真实 Qdrant
- [x] fallback（回退）和 provenance（证据来源）标记诚实
- [x] gate 全绿
- [x] Codex review（审查）确认没有真实 key、真实网络依赖或运行产物

## 目标

上一片已经有 `backend-python-real-vector-retrieval-smoke`，证明 fake embedding + fake vector client 能跑通 retrieved（检索命中）路径。下一步要把它整理成更像 runtime（运行时）的接线方式：evidence retrieval 不直接写死 fake，而是通过清晰入口拿到 vector runtime。

这个任务只做“可测试的 runtime wiring”，不接生产 Qdrant，也不做完整 RAG（检索增强生成）重构。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/evidence.py`
- `tws-ai-slide-rule-python/sliderule_llm/vector.py`
- `tws-ai-slide-rule-python/tests/test_real_vector_retrieval_runtime.py`
- `tws-ai-slide-rule-python/tests/test_real_vector_retrieval_smoke.py`
- `agent-loop/tasks/backend-python-real-vector-retrieval-runtime.md`

## 禁止扩大范围

- 不连接真实 Qdrant。
- 不发真实 embedding 或 LLM 请求。
- 不提交 `.env`、缓存、日志、向量数据或运行产物。
- 不把 fake/in-memory runtime 宣传成 production RAG。
- 不改 Node route 行为。
- 不更新全局迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `realVectorRetrievalRuntimeGates`。

## 成功标准

- `test_real_vector_retrieval_runtime.py` 能证明 evidence retrieval 可通过注入的 fake vector runtime 返回 `provenance="retrieved"`。
- 无命中和 vector 不可用时仍走 `fallback` 或 degraded（降级）形状，不能伪装成 retrieved。
- 现有 smoke 和 evidence vector contract 不退化。
- 所有 gate 通过，且不依赖外部服务和真实 key。
