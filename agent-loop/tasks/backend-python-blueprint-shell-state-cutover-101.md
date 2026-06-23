# 后端 NodeJS 迁 Python：Blueprint shell/state cutover 101

## 执行状态
- 状态：待执行
- 目标：把 Blueprint 主入口里仍由 Node 独占的 route shell、state projection、job/event 交接点继续压缩成 Python 可接管的窄边界。
- 角色分工：worker 负责补 Python runtime、Node bridge 和测试；reviewer 必须确认没有把局部 shell/state 任务夸大成完整 Blueprint 全系统迁移。

### 状态清单
- [ ] Python 能输出 shell/state cutover decision，并保留 projectId、jobId、stageId、actor、causation、diagnostics。
- [ ] Node bridge 能消费 Python decision，同时保留 Node 仍负责的 durable store、HTTP transport、权限中间件边界。
- [ ] route shell、state projection、job/event handoff 至少覆盖 success、partial、blocked、diagnostic-only 四类结果。
- [ ] gate 全绿。
- [ ] review 确认这是业务代码闭环，不是文档或空壳。

## 背景

100 阶段已经补了 `blueprint_main_runtime_closure` 这类汇总能力，但状态文档里仍然指出 Blueprint 主 state、job、event bus、ledger、prompt package 等大分母还有 Node-owned gap。101 这一刀不追求“一把全迁完”，只收紧主入口 shell/state/job/event 的交接边界，让 Python 能更明确地说出“我能接哪一段、不能接哪一段、为什么不能接”。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/blueprint_shell_state_cutover.py`
- `tws-ai-slide-rule-python/services/blueprint_main_runtime_closure.py`
- `tws-ai-slide-rule-python/services/blueprint_state_runtime.py`
- `tws-ai-slide-rule-python/services/blueprint_job_runtime.py`
- `tws-ai-slide-rule-python/services/blueprint_job_event_stream.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_shell_state_cutover_101.py`
- `server/routes/blueprint/shell-state-cutover-python.ts`
- `server/routes/blueprint/main-runtime-closure-python.ts`
- `server/routes/blueprint/main-state-python-runtime.ts`
- `server/routes/blueprint/jobs/service.ts`
- `server/routes/blueprint/event-bus.ts`
- `server/routes/__tests__/blueprint.shell-state-cutover-101.test.ts`
- `server/routes/__tests__/blueprint.main-runtime-closure-100.test.ts`
- `shared/blueprint/jobs/types.ts`
- `shared/blueprint/events.ts`
- `agent-loop/tasks/backend-python-blueprint-shell-state-cutover-101.md`

## 禁止扩大范围

- 不重写完整 `/api/blueprint`。
- 不迁移完整数据库 schema、真实 event bus transport、真实 durable job store。
- 不接管 UI、prompt package 生成全流程、effect preview 图片生成或外部 LLM provider。
- 不删除既有 Blueprint 测试。
- 不提交 `.agent-loop`、`.worktrees`、日志、缓存或真实用户数据。
- 不因为本任务通过就把整体迁移写成 100%。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintShellStateCutover101Gates`。

## 成功标准

- 新增 Python 测试覆盖 shell/state cutover decision 的成功、部分接管、阻塞和 diagnostic-only。
- 新增 Node 测试确认 bridge 不会把 diagnostic-only 当成 production takeover。
- 既有 Blueprint main/state/job/event runtime 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。

## 给 worker 的大白话

这不是“把 Blueprint 全部搬到 Python”。你只需要把 Node 主入口里最难判断的那段交接说清楚：Python 能接什么、Node 还负责什么、失败时怎么分类。宁可做窄、做实，也不要做大、做虚。
