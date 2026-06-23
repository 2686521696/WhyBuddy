# 后端 NodeJS 到 Python 迁移：Task mission event replay runtime 97

## 执行状态

- 状态：待执行
- 目标：在 task route lifecycle 之后，把 mission store、event replay、cancel/error projection 的最小边界推进到 Python runtime。
- 角色分工：worker 负责 Python mission event replay runtime、Node mission bridge 和测试；reviewer 确认 project/resource auth、cancel/error 语义没有被绕过。

### 状态清单

- [ ] Python runtime 支持 mission event append/replay/projection/cancel/error envelope。
- [ ] Node mission store/runtime 能映射 Python replay result，并保留 projectId、resourceId、actor 和 auth metadata。
- [ ] cancelled/failed/error 不伪装成 running/completed。
- [ ] gate 全绿。
- [ ] Codex review 确认没有迁完整任务调度器或真实 executor worker。

## 目标

96 阶段补了 `/api/tasks` lifecycle 小切片，但 mission store、event replay、projection、cancel/error 全链路仍是阻碍整体 95 的分母。这个任务只迁事件回放和投影边界，不动完整调度器。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/task_lifecycle_runtime.py`
- `tws-ai-slide-rule-python/services/mission_event_replay.py`
- `tws-ai-slide-rule-python/tests/test_task_mission_event_replay_runtime.py`
- `tws-ai-slide-rule-python/tests/test_task_lifecycle_runtime_boundary.py`
- `server/routes/tasks.ts`
- `server/tasks/mission-store.ts`
- `server/tasks/mission-runtime.ts`
- `server/tasks/mission-projection.ts`
- `server/tasks/mission-operator-service.ts`
- `server/tests/task-mission-event-replay-python-runtime.test.ts`
- `server/tests/task-lifecycle-python-runtime.test.ts`
- `server/tests/mission-store.test.ts`
- `server/tests/mission-routes.test.ts`
- `server/tests/mission-cancel.test.ts`
- `shared/mission/contracts.ts`
- `shared/mission/projection.ts`
- `shared/mission/socket.ts`
- `agent-loop/tasks/backend-python-task-mission-event-replay-runtime-97.md`

## 禁止扩大范围

- 不启动真实 executor worker、CrewAI、LangGraph 或外部 agent。
- 不迁完整任务调度器、队列持久化 schema、mission UI 或 websocket transport。
- 不降低 project/resource auth 校验。
- 不删除现有 mission/task tests。
- 不提交 `.agent-loop` 运行产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `taskMissionEventReplayRuntime97Gates`。

## 成功标准

- Python 测试覆盖 append/replay/projection/cancel/error、invalid transition、project/resource metadata。
- Node 测试确认 mission store/runtime 可以映射 Python replay result。
- 现有 task lifecycle、mission routes、mission cancel 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
