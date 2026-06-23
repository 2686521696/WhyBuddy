# 后端 NodeJS 迁 Python：Task store/auth/scheduler cutover 101

## 执行状态
- 状态：待执行
- 目标：继续压缩 Task lifecycle 里 mission store、project/resource auth、scheduler/cancel/error/replay 的 Node-owned gap。
- 角色分工：worker 负责 Python runtime、Node bridge 和任务生命周期测试；reviewer 必须确认没有把单次 replay 或 fake scheduler 写成完整生产接管。

### 状态清单
- [x] Python 能表达 mission store decision、project/resource auth decision、scheduler decision。
- [x] Node bridge 能消费 Python decision，并保留当前 Node durable store 和路由权限边界。
- [x] scheduler、cancel、error、replay 的分类能被测试锁住。
- [x] gate 全绿。
- [x] review 确认不是 docs-only，也不是只更新任务勾选。

## 背景

97/100 阶段已经补了 mission event replay 和 task lifecycle closure，但状态表里仍然写着 mission store、project auth、full scheduler 仍是 Node-owned gap。101 这一刀只做任务生命周期剩余短板的最小闭环：让 Python 能参与判断和生成 runtime decision，让 Node 保留真实存储和 transport。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/task_store_auth_scheduler_cutover.py`
- `tws-ai-slide-rule-python/services/task_lifecycle_production_closure.py`
- `tws-ai-slide-rule-python/services/task_lifecycle_runtime.py`
- `tws-ai-slide-rule-python/services/mission_event_replay.py`
- `tws-ai-slide-rule-python/services/task_executor_runtime.py`
- `tws-ai-slide-rule-python/tests/test_task_store_auth_scheduler_cutover_101.py`
- `server/tasks/mission-store.ts`
- `server/tasks/mission-runtime.ts`
- `server/tasks/mission-projection.ts`
- `server/routes/tasks.ts`
- `server/tests/task-store-auth-scheduler-cutover-101.test.ts`
- `server/tests/task-lifecycle-production-closure-100.test.ts`
- `server/tests/task-lifecycle-python-runtime.test.ts`
- `server/tests/task-mission-event-replay-python-runtime.test.ts`
- `shared/mission/contracts.ts`
- `shared/mission/projection.ts`
- `agent-loop/tasks/backend-python-task-store-auth-scheduler-cutover-101.md`

## 禁止扩大范围

- 不替换真实任务数据库。
- 不重写完整 scheduler 系统。
- 不接管所有 project/resource auth 中间件。
- 不改客户端任务 UI。
- 不删除既有 mission/task 测试。
- 不提交运行产物、日志、缓存或真实用户数据。
- 不因为本任务通过就把 Task lifecycle 写成完全 100%。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `taskStoreAuthSchedulerCutover101Gates`。

## 成功标准

- Python 测试覆盖 mission store/auth/scheduler 的 ready、blocked、degraded、unsupported 分类。
- Node 测试确认 route 层能消费 Python decision，并且不会绕过现有权限和取消语义。
- 既有 task lifecycle、mission store、mission routes、cancel、replay 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。

## 给 worker 的大白话

这次别试图造一个全新的任务系统。要做的是把“任务能不能交给 Python 接管”这件事说清楚、测清楚，并且别破坏 Node 现在还负责的真实存储、权限和调度边界。
