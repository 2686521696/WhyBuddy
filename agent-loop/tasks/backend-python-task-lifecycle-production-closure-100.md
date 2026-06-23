# 后端 NodeJS 到 Python 迁移：Task lifecycle production closure 100

## 执行状态

- 状态：已完成（人工 rescue 后门禁已绿）
- 目标：把 `/api/tasks`、mission store、event replay、cancel/error、project/resource auth 的最后 lifecycle（生命周期）闭环补成 Python runtime/production boundary。
- 角色分工：worker 负责 Python lifecycle closure、Node bridge 和测试；reviewer 确认没有重写完整调度器或误报所有任务系统已经 Python-owned。

### 状态清单

- [x] Python closure runtime 覆盖 mission create、append、replay、project、cancel、error、auth-denied。
- [x] Node route/service 能消费 Python closure summary，并保留 missionId、projectId、resourceId、actor、event sequence、projection metadata。
- [x] cancel/error/replay 不能丢事件、不能把 denied 写成 completed。
- [x] gate 全绿。
- [x] Codex review 确认这是真实 lifecycle closure 代码，不是 inventory 或文档刷新。

### 救回验证

- 原队列结果：`HALT_BUDGET` / rescue patch。
- 人工修复：cancel closure 结果保留输入事件序列，并在 `closureSummary.events/eventCount` 中可审计。
- Python gate：`26 passed`。
- Node/Vitest gate：`6 passed` test files / `46 passed` tests。

## 目标

96/97 阶段已经补了 task route lifecycle 和 mission event replay，但完整 task lifecycle 仍有 mission store、projection、project/resource auth、cancel/error 调度和 executor bridge 多个混合所有权点。本任务补一个 final closure runtime，让 Python 产出可审计 lifecycle decision/projection summary，Node 继续保留现有 store/route 的明确边界。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/task_lifecycle_production_closure.py`
- `tws-ai-slide-rule-python/services/task_lifecycle_runtime.py`
- `tws-ai-slide-rule-python/services/task_executor_runtime.py`
- `tws-ai-slide-rule-python/services/mission_event_replay.py`
- `tws-ai-slide-rule-python/tests/test_task_lifecycle_production_closure_100.py`
- `server/tests/task-lifecycle-production-closure-100.test.ts`
- `server/tests/task-mission-event-replay-python-runtime.test.ts`
- `server/tests/task-lifecycle-python-runtime.test.ts`
- `server/routes/tasks.ts`
- `server/tasks/mission-store.ts`
- `server/tasks/mission-runtime.ts`
- `server/tasks/mission-projection.ts`
- `server/tasks/mission-operator-service.ts`
- `shared/mission/contracts.ts`
- `shared/mission/projection.ts`
- `agent-loop/tasks/backend-python-task-lifecycle-production-closure-100.md`

## 禁止扩大范围

- 不重写完整 worker scheduler、executor fleet、project service 或 resource service。
- 不删除现有 mission store、mission route、executor client 测试。
- 不把 fake projection 写成真实生产调度接管。
- 不提交 `.agent-loop`、运行日志、任务执行产物或用户数据。
- 不在本任务直接刷新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `taskLifecycleProductionClosure100Gates`。

## 成功标准

- Python 测试覆盖 create、append、replay、project、cancel、error、auth-denied。
- Node 测试确认 `/api/tasks` 和 mission service 能消费 Python closure result，并保留现有 Node store 边界。
- 既有 task lifecycle、mission replay、mission store、mission cancel 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
