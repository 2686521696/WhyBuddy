# 后端 NodeJS 到 Python 迁移：executor callback contract

## 执行状态
- 状态：待执行
- 目标：为 executor callback（执行器回调）建立 Python contract，锁住事件回写边界。
- 角色分工：worker 负责契约和测试；reviewer 确认不破坏 Node callback routing（回调路由）。

### 状态清单
- [x] Python 有 callback event contract。
- [x] Node callback routing 测试能映射 Python event。
- [x] duplicate/out-of-order（重复/乱序）形状明确。
- [x] gate 全绿。
- [x] Codex review 确认不吞事件、不伪造完成。

## 目标

executor callback 是任务系统迁移的关键边界。先锁 contract，再迁 runtime。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_executor_callback_contract.py`
- `server/core/executor-callback-routing.ts`
- `server/tests/executor-callback-routing.test.ts`
- `server/tests/executor-callback-python-contract.test.ts`
- `server/core/executor-event-mapper.ts`
- `agent-loop/tasks/backend-python-executor-callback-contract.md`

## 禁止扩大范围
- 不改真实 executor。
- 不改任务存储。
- 不删除现有 callback 测试。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `executorCallbackContractGates`。

## 成功标准

- Python 测试覆盖 callback success/progress/error/duplicate。
- Node 测试验证 Python event 能映射到现有 callback routing。
- duplicate/out-of-order 不伪造成成功完成。
- 所有 gate 通过。
