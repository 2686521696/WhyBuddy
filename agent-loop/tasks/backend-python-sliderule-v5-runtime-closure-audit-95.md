# 后端 NodeJS 到 Python 迁移：SlideRule V5 runtime closure audit 95

## 执行状态
- 状态：待执行
- 目标：把 SlideRule V5 主运行链路的 runtime / production-wiring 证据核成 95% 阶段闭环表。
- 角色分工：worker 负责读取当前 HEAD、queue outcomes、gate-named 测试和现有 docs；reviewer 确认没有把 contract/proxy/docs-only 证据误写成 runtime 或 production 完成。

### 状态清单
- [x] 读取当前 `queue-outcomes.json`、最新 commit、89/90 阶段状态文档和相关 gate。
- [x] 复核 `mcp.call`、`skill.invoke`、`orchestrate.plan`、evidence/vector、RAG、LLM guard 的当前 HEAD 证据。
- [x] 生成 `docs/backend-python-sliderule-v5-runtime-closure-95.md`。
- [x] 明确哪些证据可计入 SlideRule V5 子系统 95%，哪些只能计入整体后端成熟度支撑。
- [x] gate 全绿。
- [x] Codex review 确认没有把整个 NodeJS 后端迁移写成 95%。

## 目标

本任务只做 SlideRule V5 主链路的证据闭环，不新增业务实现。它要回答：

- `mcp.call` 和 `skill.invoke` 是否已经从 contract/proxy 进入 real runtime evidence。
- `orchestrate.plan` 的 Python runtime route、state projection、error recovery 是否能支撑 V5 闭环口径。
- evidence/vector/RAG 和 LLM pool/cost/circuit breaker 是否有当前 HEAD 可见测试或服务路径。
- 哪些能力只是 fake/synthetic smoke、degraded fallback 或 docs-only 支撑，不能写成真实生产接管。

## 允许修改的文件
- `docs/backend-python-sliderule-v5-runtime-closure-95.md`
- `agent-loop/tasks/backend-python-sliderule-v5-runtime-closure-audit-95.md`

## 允许读取和引用的证据
- `.agent-loop/queue-outcomes.json`
- `agent-loop/tasks/sliderule-python-migration-status.md`
- `docs/backend-python-runtime-evidence-reconcile-89.md`
- `docs/backend-python-runtime-depth-audit-90.md`
- `docs/backend-python-node-route-inventory-90.md`
- `tws-ai-slide-rule-python/tests/test_mcp_call_real_runtime.py`
- `tws-ai-slide-rule-python/tests/test_skill_invoke_real_runtime.py`
- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_runtime_route.py`
- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_state_projection.py`
- `tws-ai-slide-rule-python/tests/test_real_vector_retrieval_production_wiring.py`
- `tws-ai-slide-rule-python/tests/test_rag_ingestion_production_storage.py`
- `server/routes/__tests__/sliderule.orchestrate-plan-python-runtime.test.ts`
- `server/routes/__tests__/sliderule.orchestrate-plan-state-projection.test.ts`
- `server/routes/__tests__/rag-ingestion-python-production-storage.test.ts`

## 禁止扩大范围
- 不改业务代码。
- 不新增 runtime bridge。
- 不调用真实 LLM、真实 MCP server、真实 skill registry 或真实外部服务。
- 不提交 `.agent-loop` 运行产物。
- 不把 SlideRule V5 子系统 95% 外推成整个 NodeJS 后端迁移 95%。
- 不把 fake/synthetic smoke 写成真实 production wiring。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `slideruleV5RuntimeClosureAudit95Gates`。

## 成功标准

- 报告按能力列出当前 HEAD 证据、缺失路径、计入口径和风险等级。
- 明确区分 `runtime`、`production-wiring smoke`、`contract-only`、`proxy-only`、`docs-only`。
- 给出 SlideRule V5 子系统是否可进入 95% 的审计结论。
- 不更新整体后端迁移百分比。
- mojibake 扫描通过。
