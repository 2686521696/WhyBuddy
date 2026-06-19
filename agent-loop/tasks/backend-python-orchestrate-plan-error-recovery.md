# 后端 NodeJS 到 Python 迁移：orchestrate.plan error recovery

## 执行状态

- 状态：待执行
- 目标：锁住 orchestrate.plan Python 路径的错误恢复和降级语义
- 角色分工：Grok 负责补错误恢复测试和最小修复；Codex 负责审查是否把运行时错误误报成配置缺失

### 状态清单

- [x] 已执行 AgentLoop
- [x] Python test 覆盖 bad input、planner exception、timeout/degraded
- [x] Node test 覆盖 Python unavailable、bad JSON、planner error
- [x] 错误分类不再把 runtime LLM error 混成 no_api_key
- [x] gate 全绿
- [x] Codex review（审查）确认错误形状清楚且不吞异常

## 目标

`orchestrate.plan` 深水区最怕的不是“没输出”，而是错误被混成一个模糊 fallback。这个任务专门锁错误恢复：Python 输入错误、planner 异常、超时、Node 代理失败都要有明确分类。

这个任务不新增大功能，只补错误边界，方便后续逐步迁 planner。

## 允许修改的文件

- `tws-ai-slide-rule-python/routes/sliderule.py`
- `tws-ai-slide-rule-python/routes/sliderule_full.py`
- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_error_recovery.py`
- `server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts`
- `server/routes/__tests__/sliderule.orchestrate-plan.test.ts`
- `docs/backend-python-orchestrate-plan-contract.md`
- `agent-loop/tasks/backend-python-orchestrate-plan-error-recovery.md`

## 禁止扩大范围

- 不重写主编排。
- 不接真实 LLM。
- 不把所有错误压成 `no_api_key` 或 `fallback`。
- 不删除现有 orchestrate plan 测试。
- 不更新全局迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `orchestratePlanErrorRecoveryGates`。

## 成功标准

- Python test 覆盖 bad input、planner exception、timeout/degraded 三类错误。
- Node test 覆盖 Python unavailable、bad JSON、planner error 三类代理错误。
- runtime error、config missing、fallback unavailable 三类语义不混淆。
- 所有 gate 通过。
