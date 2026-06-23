# 后端 NodeJS 迁 Python：A2A core route cutover 101

## 执行状态
- 状态：待执行
- 目标：继续压缩 A2A/core 里的 registry、session、stream、cancel、chat、reports/analytics route ownership Node-owned gap。
- 角色分工：worker 负责 Python A2A route cutover runtime、Node bridge 和测试；reviewer 必须确认没有把 stream/invoke 两个薄桥接夸大成 A2A 全量接管。

### 状态清单
- [x] Python 能输出 A2A core route cutover decision。
- [x] Node bridge 能消费 registry/session/stream/cancel/chat/report readiness。
- [x] 既有 A2A invoke、stream、contract 测试继续通过。
- [x] gate 全绿。
- [x] review 确认未破坏协议兼容。

## 背景

前面阶段已经补了 A2A runtime contract、invoke runtime bridge、stream runtime boundary，但状态口径里 A2A/core 仍属于未完全收口的边缘大分母。101 这一刀只做核心 route ownership 的 cutover readiness，不重写完整协议栈。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/a2a_core_route_cutover.py`
- `tws-ai-slide-rule-python/services/a2a_runtime.py`
- `tws-ai-slide-rule-python/tests/test_a2a_core_route_cutover_101.py`
- `tws-ai-slide-rule-python/tests/test_a2a_runtime_contract.py`
- `tws-ai-slide-rule-python/tests/test_a2a_invoke_runtime_bridge.py`
- `tws-ai-slide-rule-python/tests/test_a2a_stream_runtime_boundary.py`
- `server/routes/a2a-python-runtime.ts`
- `server/routes/__tests__/a2a-core-route-cutover-101.test.ts`
- `server/routes/__tests__/a2a-python-runtime-contract.test.ts`
- `server/routes/__tests__/a2a-python-invoke-runtime.test.ts`
- `server/routes/__tests__/a2a-python-stream-runtime.test.ts`
- `server/tests/a2a-routes.test.ts`
- `server/tests/a2a-protocol.test.ts`
- `shared/a2a/contracts.ts`
- `agent-loop/tasks/backend-python-a2a-core-route-cutover-101.md`

## 禁止扩大范围

- 不重写完整 A2A 协议栈。
- 不接管所有 chat/report/analytics 业务路由。
- 不改变既有协议兼容和错误码语义。
- 不删除既有 A2A 测试。
- 不提交运行产物、日志、缓存或真实会话数据。
- 不因为本任务通过就把 core route 全部写成 100%。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `a2aCoreRouteCutover101Gates`。

## 成功标准

- Python 测试覆盖 registry、session、stream、cancel、chat、report readiness 的分类。
- Node 测试确认 bridge 正确映射 Python decision，并保留协议兼容。
- 既有 A2A contract/invoke/stream/routes/protocol 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。

## 给 worker 的大白话

A2A 这次不要全拆。目标是补一张清楚的路线图和桥接判断：哪些核心 route 已能交给 Python，哪些还必须留在 Node，协议行为不能变。
