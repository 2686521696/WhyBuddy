# 后端 NodeJS 到 Python 迁移：workflow staged execution runtime

## 执行状态
- 状态：待执行
- 目标：把 workflow runtime 从 contract 推进到 staged execution（分阶段执行）最小边界。
- 角色分工：worker 负责 graph validation 和 node_result projection；reviewer 确认不迁完整执行器。

### 状态清单
- [ ] Python 支持 graph validation 和 staged node_result projection。
- [ ] Node 测试覆盖 valid graph、invalid graph、node failed、run cancelled。
- [ ] failed/cancelled 不伪装成 done。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实 workflow node 副作用。

## 目标

workflow 是大块，不能一口气重写。这个任务只迁 graph validation（图校验）和 node_result projection（节点结果投影），把真实执行继续留在 Node 或 fake provider 边界。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/workflow_runtime.py`
- `tws-ai-slide-rule-python/tests/test_workflow_staged_execution_runtime.py`
- `tws-ai-slide-rule-python/tests/test_workflow_runtime_contract.py`
- `server/core/workflow-runtime-engine.ts`
- `server/routes/workflows.ts`
- `server/routes/__tests__/workflow-python-staged-runtime.test.ts`
- `server/routes/__tests__/workflow-python-runtime-contract.test.ts`
- `shared/workflow-runtime.ts`
- `shared/workflow-domain.ts`
- `agent-loop/tasks/backend-python-workflow-staged-execution-runtime.md`

## 禁止扩大范围
- 不执行真实 workflow nodes。
- 不改前端协议。
- 不迁真实持久化。
- 不绕过 node permission。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `workflowStagedExecutionRuntimeGates`。

## 成功标准

- Python 测试覆盖 graph validation、node_result projection、failure。
- Node 测试确认 failed/cancelled 不伪装成 done。
- graph validation 错误形状稳定。
- 所有 gate 通过。
