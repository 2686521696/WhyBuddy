# 后端 NodeJS 到 Python 迁移：real vector retrieval production wiring

## 执行状态
- 状态：待执行
- 目标：把 real vector retrieval（真实向量检索）从 runtime smoke（运行时冒烟）推进到 production wiring（生产接线）最小形态。
- 角色分工：worker 负责实现和测试；reviewer 负责确认没有真实 key、真实外部服务依赖或虚假 provenance（证据来源）。

### 状态清单
- [x] Python vector store config（向量库配置）有明确运行时入口。
- [x] evidence retrieval（证据检索）可以选择真实 vector runtime（向量运行时）或安全 fallback（回退）。
- [x] 测试覆盖 hit、miss、runtime unavailable（运行时不可用）三条路径。
- [x] gate 全绿。
- [x] Codex review（审查）确认没有把 smoke 冒充 production RAG（生产级检索增强生成）。

## 目标

上一批已经完成 `backend-python-real-vector-retrieval-runtime`，证明可以通过注入 fake vector runtime（假向量运行时）跑通 retrieved / fallback。现在要把入口整理成更接近生产的 runtime wiring：配置读取、runtime 构造、错误降级和 provenance 标记要分层清楚。

这不是接真实 Qdrant 的任务。可以加生产接线接口和配置契约，但测试必须继续使用 fake/in-memory runtime（假/内存运行时）。

## 允许修改的文件
- `tws-ai-slide-rule-python/sliderule_llm/vector.py`
- `tws-ai-slide-rule-python/sliderule_llm/evidence.py`
- `tws-ai-slide-rule-python/sliderule_llm/config.py`
- `tws-ai-slide-rule-python/tests/test_real_vector_retrieval_production_wiring.py`
- `tws-ai-slide-rule-python/tests/test_real_vector_retrieval_runtime.py`
- `agent-loop/tasks/backend-python-real-vector-retrieval-production-wiring.md`

## 禁止扩大范围
- 不连接真实 Qdrant。
- 不发真实 embedding（向量化）或 LLM 请求。
- 不提交 `.env`、缓存、日志、向量数据或运行产物。
- 不改 Node route 行为。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `realVectorRetrievalProductionGates`。

## 成功标准

- Python 测试能证明 vector runtime 可由配置/工厂构造，并可被 evidence retrieval 调用。
- 命中时返回 `provenance="retrieved"`，无命中或 runtime 不可用时不能伪装成 retrieved。
- 现有 runtime/smoke/vector contract 测试不退化。
- 所有 gate 通过，且不依赖外部服务和真实 key。
