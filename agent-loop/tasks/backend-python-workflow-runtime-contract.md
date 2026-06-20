# 后端 NodeJS 到 Python 迁移：workflow runtime contract

## 执行状态
- 状态：待执行
- 目标：为 workflow runtime engine 建立 Python contract，锁定 graph/run/node-result/error 形状。
- 角色分工：worker 负责 contract；reviewer 确认不迁完整工作流执行器。

### 状态清单
- [x] Python 侧有 workflow runtime contract。
- [x] Node 侧测试覆盖 graph validation、run start、node result、failure。
- [x] workflow id、node id、edge、status 字段稳定。
- [x] gate 全绿。
- [x] Codex review 确认没有真实执行节点副作用。

## 目标

workflow 是 Node 后端大块。此任务只迁最小 runtime contract，避免一口气重写工作流引擎。

## 允许修改的文件
- `agent-loop/tasks/backend-python-workflow-runtime-contract.md`
- `tws-ai-slide-rule-python/services/workflow_runtime.py`
- `tws-ai-slide-rule-python/tests/test_workflow_runtime_contract.py`
- `server/core/workflow-runtime-engine.ts`
- `server/core/workflow-engine.ts`
- `server/routes/workflows.ts`
- `server/routes/__tests__/workflow-python-runtime-contract.test.ts`
- `shared/workflow-runtime.ts`
- `shared/workflow-runtime-engine.ts`
- `shared/workflow-domain.ts`

## 禁止扩大范围
- 不执行真实 workflow nodes。
- 不改前端协议。
- 不改真实持久化。
- 不绕过 node permission。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `workflowRuntimeContractGates`。

## 成功标准

- Python contract 覆盖 graph/run/node_result/error。
- Node 测试确认 failed/cancelled 不伪装成 done。
- graph validation 错误形状稳定。
- gate 全绿。
