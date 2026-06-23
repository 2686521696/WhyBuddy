# 后端 NodeJS 到 Python 迁移：Blueprint job/event stream runtime 97

## 执行状态

- 状态：待执行
- 目标：把 Blueprint job lifecycle 和 event stream 从 Node-owned 深水区推进到 Python-owned bounded runtime，不宣称完整 `/api/blueprint` 主系统迁移完成。
- 角色分工：worker 负责 Python job/event runtime、Node bridge 和测试；reviewer 确认 job store、event bus、diagnostics 没有被假装全迁完。

### 状态清单

- [ ] Python runtime 支持 job created/running/completed/failed/cancelled 的事件 envelope。
- [ ] Node job service/event bus 能映射 Python event stream，并保留 jobId、stageId、projectId、actor 和 causation metadata。
- [ ] failed/cancelled/error 不伪装成 completed。
- [ ] gate 全绿。
- [ ] Codex review 确认这是 job/event stream 小切片，不是完整 Blueprint 主流程迁移。

## 目标

96 阶段已经补了 review/export 和 artifact memory，但 Blueprint 主系统仍有 job store、event bus、diagnostics、ledger 等大分母。这个任务只迁一个硬边界：job lifecycle event stream。它必须产生真实 Python/Node 代码和测试，不能只更新 checklist 或文档。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/blueprint_job_runtime.py`
- `tws-ai-slide-rule-python/services/blueprint_job_event_stream.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_job_event_stream_runtime.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_job_runtime_boundary.py`
- `server/routes/blueprint/jobs/service.ts`
- `server/routes/blueprint/job-store.ts`
- `server/routes/blueprint/event-bus.ts`
- `server/routes/__tests__/blueprint.job-event-stream-python-runtime.test.ts`
- `server/routes/__tests__/blueprint.job-runtime-python-boundary.test.ts`
- `server/routes/blueprint/event-bus.test.ts`
- `shared/blueprint/jobs/types.ts`
- `shared/blueprint/agent-events.ts`
- `agent-loop/tasks/backend-python-blueprint-job-event-stream-runtime-97.md`

## 禁止扩大范围

- 不迁完整 `/api/blueprint` route shell。
- 不重写 durable job store schema、不接真实数据库、不改生产 event bus transport。
- 不迁 diagnostics、ledger、preview、prompt package 或 replan。
- 不删除现有 Blueprint job/event 测试。
- 不提交 `.agent-loop` 运行产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintJobEventStreamRuntime97Gates`。

## 成功标准

- Python 测试覆盖 job event stream 的 created/running/completed/failed/cancelled/error。
- Node 测试确认 Python event stream 能被 job service/event bus 正确映射。
- 现有 Blueprint job runtime boundary 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
