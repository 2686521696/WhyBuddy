# 后端 NodeJS 到 Python 迁移：task executor proxy contract

## 执行状态
- 状态：待执行
- 目标：为 task executor（任务执行器）建立 Python proxy contract，不迁真实 executor。
- 角色分工：worker 负责契约和测试；reviewer 确认不启动真实任务、不改变生产 executor。

### 状态清单
- [ ] Python 有 task executor proxy contract。
- [ ] Node executor client 测试可验证 start/status/cancel/error 形状。
- [ ] timeout/cancel 不伪装成成功。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实任务副作用。

## 目标

executor/tasks 是整体后端大块。这个任务只锁 proxy contract，让后续迁移可以按 start/status/cancel 分片推进。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_task_executor_proxy_contract.py`
- `server/core/executor-client.ts`
- `server/tests/executor-client-python-proxy-contract.test.ts`
- `server/tests/executor-client-capabilities.test.ts`
- `shared/blueprint/jobs/types.ts`
- `agent-loop/tasks/backend-python-task-executor-proxy-contract.md`

## 禁止扩大范围
- 不启动真实 executor 任务。
- 不改任务调度策略。
- 不迁任务存储。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `taskExecutorProxyContractGates`。

## 成功标准

- Python 测试覆盖 start/status/cancel/error contract。
- Node 测试验证 executor client 可映射 Python contract。
- timeout/cancel/error 语义不退化。
- 所有 gate 通过。
