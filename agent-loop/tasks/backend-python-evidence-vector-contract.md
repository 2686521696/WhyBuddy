# 后端 NodeJS 到 Python 迁移：evidence vector contract

## 执行状态

- 状态：待执行
- 目标：让 Grok 补一个很窄的 evidence vector contract（证据向量契约）测试
- 角色分工：Grok 负责补测试；Codex 负责审查是否把测试边界夸大成真实生产 RAG

### 状态清单

- [ ] 已执行 AgentLoop
- [ ] 已新增 `tws-ai-slide-rule-python/tests/test_evidence_vector_contract.py`
- [ ] 测试覆盖 retrieved / fallback / generated 三种 provenance（来源）
- [ ] 测试不依赖真实 Qdrant、真实 embedding 或真实 LLM key
- [ ] gate 全绿
- [ ] Codex review（审查）已确认没有把 contract test 夸大成生产级 vector retrieval

## 目标

在现有 `sliderule_llm.evidence` 基础上补一个更聚焦的 contract test，锁住“sources 字段存在不等于真实 vector retrieval”这个边界。

这个任务不是接真实 Qdrant，不是做生产 RAG，只是让下一步真实接线之前有清楚的契约测试。

## 允许修改的文件

- `tws-ai-slide-rule-python/tests/test_evidence_vector_contract.py`
- `agent-loop/tasks/backend-python-evidence-vector-contract.md`

## 禁止扩大范围

- 不改 `tws-ai-slide-rule-python/sliderule_llm/evidence.py`，除非测试暴露了明确 bug。
- 不改 `tws-ai-slide-rule-python/sliderule_llm/vector.py`，除非测试暴露了明确 bug。
- 不接真实 Qdrant。
- 不接真实 embedding provider。
- 不接真实 LLM。
- 不更新全局迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `evidenceVectorContractGates`。

## 成功标准

- 新测试文件存在并可独立运行。
- 测试能证明 retrieved 结果保留 `provenance="retrieved"`、score、sourceId。
- 测试能证明 vector 不可用或无命中时是 `fallback`，不是假 RAG。
- 测试能证明 LLM prose 派生 sources 是 `generated`，不是 `retrieved`。
- 所有 gate 通过，且不依赖外部服务和真实 key。
