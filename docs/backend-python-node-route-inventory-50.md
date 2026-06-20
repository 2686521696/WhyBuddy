# 后端 NodeJS 到 Python 迁移：Node route inventory for 50%

## 结论

本盘点只确认下一批 50% 冲刺的候选迁移范围和排序，不声明后端 Python 迁移已经达到 50%。范围来源只能是当前 NodeJS 后端源头：`server/routes`、`server/core`、`shared`。`tws-ai-ask-python` 只能作为 Python 工程结构参考，不能作为迁移目标、不能作为范围来源，也不能用它的 `routes` 目录反推本仓库要迁移的能力。

本轮只产出文档和任务状态，没有修改 `server/`、`shared/`、`tws-ai-slide-rule-python/` 业务代码。

## 推荐排序

1. `web-aigc adapters`：Node adapter 边界清晰，适合先做 inventory 和分组 contract。
2. `telemetry`：可先迁 contract 和 cost/usage 记录，给后续迁移提供观测口径。
3. `RAG`：已有 Python `rag_service`、vector、evidence 基础，但真实 retrieval 与 ingestion 风险需要拆 gate。
4. `workflow`：共享模型明确，但 runtime 状态、图投影和回调需要 contract 先行。
5. `role runtime`：涉及 role container、tool proxy、MCP/skill binder，必须分 proxy contract 和 real runtime。
6. `Blueprint/Autopilot`：面积最大，应按 main state、job runtime、stage edit、spec docs、agent crew 等切片迁。
7. `NL command`：横跨任务分解、审批、socket、权限和报告，建议在 workflow/telemetry gate 稳定后推进。

## Node 源头大块盘点

| 大块 | source（NodeJS 源头） | Python target（目标位置） | risk（风险） | suggested gates（建议门禁） |
| --- | --- | --- | --- | --- |
| Blueprint / Autopilot | `server/routes/blueprint.ts`; `server/routes/blueprint/**`; `shared/blueprint/**`; `server/core/executor-client.ts`; `server/core/executor-callback-routing.ts`; `server/core/execution-plan-builder.ts`; `server/core/llm-client.ts` | 已有基础：`tws-ai-slide-rule-python/routes/blueprint_spec_docs.py`、`tws-ai-slide-rule-python/services/slide_rule_orchestrator.py`、`tws-ai-slide-rule-python/services/v5_capability_executor.py`。候选新增：`tws-ai-slide-rule-python/routes/blueprint.py`、`tws-ai-slide-rule-python/services/blueprint_state.py`、`tws-ai-slide-rule-python/services/blueprint_jobs.py`、`tws-ai-slide-rule-python/services/blueprint_stage_edit.py` | 覆盖主状态、spec tree/spec docs、job runtime、stage edit、artifact memory、agent crew、LLM prompt/cache、executor callback。风险是状态投影和事件语义被提前合并，导致 proxy contract 通过但主流程未迁。 | `blueprintMainStateContractGates`; `blueprintJobRuntimeProxyGates`; `blueprintStageEditProxyGates`; `blueprintSpecDocsBatchProxyGates`; `blueprintArtifactMemoryProxyGates`; `blueprintReviewExportProxyGates`; `blueprintAgentCrewProxyContractGates`; `blueprintBrainstormContractGates` |
| Role runtime | `server/routes/blueprint/role-agent-runtime/**`; `server/routes/blueprint/role-container-loader/**`; `server/routes/blueprint/role-system-architecture/**`; `server/routes/blueprint/runtime-enablement/**`; `server/core/role-*.ts`; `shared/role-schema.ts`; `shared/runtime-agent.ts`; `shared/blueprint/role-architecture.ts`; `shared/blueprint/role-container/**` | 候选新增：`tws-ai-slide-rule-python/routes/role_runtime.py`、`tws-ai-slide-rule-python/services/role_runtime.py`、`tws-ai-slide-rule-python/services/role_container.py`。可复用边界基础：`tws-ai-slide-rule-python/services/mcp_runtime.py`、`tws-ai-slide-rule-python/services/skill_runtime.py` | role container 生命周期、trace sanitizer、tool proxy、real-mode dispatcher、MCP/skill binder 互相耦合。风险是把 role runtime 当成普通 route contract，遗漏工具调用、回调和状态机。 | `roleRuntimeProxyContractGates`; `mcpCallRealRuntimeGates`; `skillInvokeRealRuntimeGates` |
| web-aigc adapters | `server/routes/node-adapters/**`; `server/routes/image-search.ts`; `server/routes/graph-search.ts`; `server/routes/intent-recognition.ts`; `server/routes/file-translation.ts`; `server/routes/file-slicing.ts`; `server/routes/file-generation.ts`; `server/routes/audio-recognition.ts`; `server/routes/ocr-recognition.ts`; `server/routes/vector-update.ts`; `server/routes/vector-delete.ts`; `server/routes/transaction-flow.ts`; `server/routes/similarity-match.ts`; `server/routes/dynamic-chart.ts`; `server/routes/excel-read.ts`; `server/routes/ai-ppt.ts`; `server/core/web-aigc-*.ts`; `shared/web-aigc-*.ts` | 候选新增：`tws-ai-slide-rule-python/routes/web_aigc.py`、`tws-ai-slide-rule-python/services/web_aigc/search.py`、`tws-ai-slide-rule-python/services/web_aigc/files.py`、`tws-ai-slide-rule-python/services/web_aigc/vision_audio.py`、`tws-ai-slide-rule-python/services/web_aigc/vector.py` | adapter 数量多但单点边界较清晰。风险是把 inventory、search/file/vision-audio contract、vector mutation 和 observability 混成一个大迁移，导致 gate 粒度过粗。 | `webAigcAdapterInventoryGates`; `webAigcSearchAdapterContractGates`; `webAigcFileAdapterContractGates`; `webAigcVisionAudioAdapterContractGates`; `realVectorRetrievalProductionGates` |
| NL command | `server/routes/nl-command.ts`; `server/routes/node-adapters/command-list-node-adapter.ts`; `server/routes/node-adapters/recommended-commands-node-adapter.ts`; `server/core/nl-command/**`; `shared/nl-command/**`; `shared/scene-command/**`; `server/routes/voice.ts`; `server/routes/ue.ts` | 候选新增：`tws-ai-slide-rule-python/routes/nl_command.py`、`tws-ai-slide-rule-python/services/nl_command/orchestrator.py`、`tws-ai-slide-rule-python/services/nl_command/planner.py`、`tws-ai-slide-rule-python/services/nl_command/approval.py` | 横跨 command analyze、mission decompose、plan approval/adjustment、permission guard、socket emitter、report generator、UE/voice 辅助入口。风险是迁 route 壳但遗漏审批、socket 事件和权限语义。 | `nlCommandRuntimeContractGates`; `permissionCheckContractGates`; `permissionRateLimitContractGates`; `auditEventContractGates` |
| Workflow | `server/routes/workflows.ts`; `server/core/workflow-engine.ts`; `server/core/workflow-runtime-engine.ts`; `server/core/workflow-graph-projection.ts`; `shared/workflow-runtime.ts`; `shared/workflow-runtime-engine.ts`; `shared/workflow-domain.ts`; `shared/workflow-graph.ts`; `shared/workflow-input.ts`; `shared/workflow-kernel.ts` | 候选新增：`tws-ai-slide-rule-python/routes/workflows.py`、`tws-ai-slide-rule-python/services/workflow_runtime.py`、`tws-ai-slide-rule-python/services/workflow_graph.py` | shared runtime 既是 contract 又包含执行语义。风险是 Python contract 只覆盖 schema，未覆盖图投影、运行时状态转移、错误恢复和 callback 行为。 | `workflowRuntimeContractGates`; `taskExecutorProxyContractGates`; `executorCallbackContractGates`; `auditEventContractGates` |
| RAG / knowledge / vector | `server/routes/rag.ts`; `server/routes/knowledge.ts`; `server/routes/knowledge-admin.ts`; `server/rag/**`; `server/knowledge/**`; `server/memory/vector-store.ts`; `shared/rag/**`; `shared/knowledge/**`; `shared/web-search.ts`; `server/core/web-search-provider.ts` | 已有基础：`tws-ai-slide-rule-python/services/rag_service.py`、`tws-ai-slide-rule-python/sliderule_llm/vector.py`、`tws-ai-slide-rule-python/sliderule_llm/evidence.py`。候选新增：`tws-ai-slide-rule-python/routes/rag.py`、`tws-ai-slide-rule-python/routes/knowledge.py`、`tws-ai-slide-rule-python/services/knowledge_admin.py` | ingestion、chunking、embedding、retrieval、rerank、metadata store、knowledge admin 和 evidence provenance 是不同层。风险是把 generated/fallback evidence 或 smoke retrieval 宣传成生产级 real vector retrieval。 | `ragIngestionRuntimeContractGates`; `knowledgeAdminProxyContractGates`; `evidenceNodeRuntimeWiringGates`; `realVectorRetrievalProductionGates` |
| Telemetry / audit / cost | `server/routes/telemetry.ts`; `server/routes/aigc-monitoring.ts`; `server/routes/audit.ts`; `server/routes/cost.ts`; `server/core/telemetry-store.ts`; `server/core/aigc-monitoring-projection.ts`; `server/core/cost-tracker.ts`; `server/core/cost-monitor.ts`; `shared/telemetry.ts`; `shared/telemetry/**`; `shared/aigc-monitoring.ts`; `shared/audit/**`; `shared/cost.ts`; `shared/cost-governance.ts` | 已有基础：`tws-ai-slide-rule-python/sliderule_llm/client.py`、`tws-ai-slide-rule-python/sliderule_llm/pool.py`。候选新增：`tws-ai-slide-rule-python/routes/telemetry.py`、`tws-ai-slide-rule-python/routes/audit.py`、`tws-ai-slide-rule-python/services/telemetry.py`、`tws-ai-slide-rule-python/services/cost_accounting.py` | telemetry、audit、cost accounting 和 LLM pool observability 是支撑层，不等于业务迁移完成度。风险是只迁日志写入而遗漏 cost runtime accounting、query contract、socket/event 兼容。 | `telemetryRouteContractGates`; `auditEventContractGates`; `auditQueryProxyContractGates`; `llmCostRuntimeAccountingGates` |

## 50% 口径边界

- 这里的 50% 是下一批候选目标，不是当前完成度。
- 盘点行只说明后续迁移切片的 source、target、risk、gate；不能把单个 proxy contract、smoke gate 或 fallback evidence 计为完整迁移。
- 后续进度统计必须分层描述：Node thin proxy、Python baseline、LLM infra、RAG/vector/evidence、Blueprint/Autopilot 主流程分别计算，不能压成一个总数。
- `tws-ai-ask-python` 不在本任务 source、target 或 gate 中。若后续人工要求参考，只能参考目录拆分风格，不能引用为本仓库迁移完成证据。

## 本轮 gate

使用 `agent-loop/scripts/migration-queue.json` 的 `nodeRouteInventory50Gates`：

```powershell
node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-node-route-inventory-50.md docs/backend-python-node-route-inventory-50.md
```
