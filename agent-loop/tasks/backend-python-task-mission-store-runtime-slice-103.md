# 后端 NodeJS 迁 Python：Task mission store runtime slice 103

## 执行状态

- 状态：待执行
- 目标：推进 Task lifecycle 里最关键的 mission store / event replay / cancel state / scheduler boundary。优先做一个小而真实的 Python-owned runtime slice；如果生产 durable store 仍必须 Node 保留，就用代码产出明确 retained decision。
- 角色分工：worker 负责 Python runtime/decision、Node bridge 和任务路由测试；reviewer 必须确认没有把 projection、readiness 或 skipped path 算成 durable runtime 接管。

### 状态清单

- [ ] 读取 97/100/101/102 的 Task lifecycle 证据。
- [ ] 明确 mission store、project auth、scheduler、cancel、error state 的 ownership。
- [ ] 补一个可测试的 Python-owned mission runtime slice，或明确 retained/out-of-scope。
- [ ] Node 测试覆盖 store/read/replay/cancel 边界。
- [ ] gate 全绿。
- [ ] review 确认没有虚写 Task lifecycle 100%。

## 背景

102 已经确认 durable mission store、projectResourceAuth、scheduler、cancel、error 多数仍是 Node retained。103 要么吃掉其中一个真实 slice，要么把它从迁移分母里明确处理。不能再只做状态口径。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/task_mission_store_runtime_slice.py`
- `tws-ai-slide-rule-python/services/task_lifecycle_durable_ownership_closure.py`
- `tws-ai-slide-rule-python/services/task_store_auth_scheduler_cutover.py`
- `tws-ai-slide-rule-python/services/mission_event_replay.py`
- `tws-ai-slide-rule-python/tests/test_task_mission_store_runtime_slice_103.py`
- `tws-ai-slide-rule-python/tests/test_task_lifecycle_durable_ownership_closure_102.py`
- `server/tasks/mission-store.ts`
- `server/tasks/mission-runtime.ts`
- `server/tasks/mission-projection.ts`
- `server/routes/tasks.ts`
- `server/tests/task-mission-store-runtime-slice-103.test.ts`
- `server/tests/task-lifecycle-durable-ownership-closure-102.test.ts`
- `server/tests/mission-store.test.ts`
- `server/tests/mission-routes.test.ts`
- `server/tests/mission-cancel.test.ts`
- `shared/mission/contracts.ts`
- `shared/mission/projection.ts`
- `agent-loop/tasks/backend-python-task-mission-store-runtime-slice-103.md`

## 禁止扩大范围

- 不重写整个任务系统、调度器或项目权限系统。
- 不删除既有 Node mission store 行为。
- 不把 replay projection 当成 durable store 接管。
- 不把 `node-retained`、`blocked`、`out-of-scope` 写成 `python-owned`。
- 不提交 `.agent-loop`、`.worktrees`、日志、缓存或真实用户数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `taskMissionStoreRuntimeSlice103Gates`。

## 成功标准

- Python 侧能表达 mission store runtime slice 的 ownership 和最小状态变化。
- Node 侧能调用 Python decision/runtime，并保留 Node-owned durable store 时的清晰 fallback。
- 测试覆盖 store classification、event replay、cancel state 和 scheduler boundary 至少一个真实路径。
- 产生真实代码 diff；如果最终只有文档变化，任务应失败。
- 所有 gate 通过。

## 给 worker 的大白话

这次别写大而全的任务系统。挑 mission store 里一个能落地的小切片，把 Python 接上；如果接不上，就让代码明确说“这里 Node 留着”，别让进度表继续猜。
