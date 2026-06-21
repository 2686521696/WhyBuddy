# 后端 NodeJS 到 Python 迁移：task lifecycle runtime boundary 88

## 执行状态
- 状态：待执行
- 目标：在 executor client bridge 之外，为 `/api/tasks` 的最小 lifecycle 补 Python runtime boundary 证据。
- 角色分工：worker 负责最小 runtime bridge 和测试；reviewer 确认没有迁完整任务系统或 mission store。

### 状态清单
- [x] Python runtime 支持最小 task lifecycle envelope。
- [x] Node 测试覆盖 Python mode 下 start/status/cancel/error 映射。
- [x] mission store、project/resource auth 仍保持 Node 边界。
- [x] gate 全绿。
- [x] Codex review 确认没有把 executor client bridge 夸大成完整 `/api/tasks` 迁移。

## 目标

当前 task executor runtime bridge 只能计入 executor client 行为，不覆盖 `/api/tasks` route、mission store、event replay 和完整 lifecycle。本任务只补最小 task lifecycle runtime boundary，让后续能更诚实地计入一个小 runtime 切片。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/task_lifecycle_runtime.py`
- `tws-ai-slide-rule-python/tests/test_task_lifecycle_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_task_executor_runtime_bridge.py`
- `server/routes/tasks.ts`
- `server/tests/task-lifecycle-python-runtime.test.ts`
- `server/tests/executor-client-python-runtime.test.ts`
- `shared/blueprint/jobs/types.ts`
- `agent-loop/tasks/backend-python-task-lifecycle-runtime-boundary-88.md`

## 禁止扩大范围
- 不迁完整 mission store。
- 不改生产 task schema。
- 不改 project/resource auth 策略。
- 不改 executor callback ingress。
- 不提交 `.agent-loop` 运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `taskLifecycleRuntimeBoundary88Gates`。

## 成功标准

- Python 测试覆盖 task lifecycle started/running/completed/failed/cancelled/error envelope。
- Node 测试确认 Python mode 不把 failed/cancelled 映射成 success。
- 任务明确仍不拥有 mission store 和完整 task route lifecycle。
- TypeScript、pytest、mojibake gate 通过。
