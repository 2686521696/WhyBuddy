# 后端 NodeJS 迁 Python：A2A session stream runtime slice 103

## 执行状态

- 状态：待执行
- 目标：推进 A2A 的 session / stream / cancel / registry / transport 边界。优先补一个可测试的 Python-owned session-stream runtime slice；如果 production transport 仍属 Node/external，就明确 retained/external/out-of-scope。
- 角色分工：worker 负责 Python runtime/decision、Node A2A bridge 和测试；reviewer 必须确认没有把 invoke/contract readiness 写成 production transport 接管。

### 状态清单

- [ ] 读取 89/101/102 A2A 证据。
- [ ] 明确 registry、session、stream、cancel、chat、report、analytics 的 ownership。
- [ ] 补最小 Python-owned session-stream runtime slice，或明确 retained/external/out-of-scope。
- [ ] Node 测试覆盖 stream/cancel/session 边界。
- [ ] gate 全绿。
- [ ] review 确认没有虚写 A2A production transport 100%。

## 背景

102 结论是 A2A production transport 多数仍 `node-retained` 或 `external-agent-required`。103 要么拿一个 session-stream 小闭环给 Python 接，要么把 transport 层从迁移分母里明确拆掉。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/a2a_session_stream_runtime_slice.py`
- `tws-ai-slide-rule-python/services/a2a_production_transport_ownership_closure.py`
- `tws-ai-slide-rule-python/services/a2a_core_route_cutover.py`
- `tws-ai-slide-rule-python/services/a2a_runtime.py`
- `tws-ai-slide-rule-python/tests/test_a2a_session_stream_runtime_slice_103.py`
- `tws-ai-slide-rule-python/tests/test_a2a_production_transport_ownership_closure_102.py`
- `server/routes/a2a-python-runtime.ts`
- `server/core/a2a-client.ts`
- `server/core/a2a-server.ts`
- `server/routes/__tests__/a2a-session-stream-runtime-slice-103.test.ts`
- `server/routes/__tests__/a2a-production-transport-ownership-closure-102.test.ts`
- `server/routes/__tests__/a2a-core-route-cutover-101.test.ts`
- `server/routes/__tests__/a2a-python-stream-runtime.test.ts`
- `server/tests/a2a-routes.test.ts`
- `server/tests/a2a-protocol.test.ts`
- `shared/a2a/contracts.ts`
- `shared/a2a-protocol.ts`
- `agent-loop/tasks/backend-python-a2a-session-stream-runtime-slice-103.md`

## 禁止扩大范围

- 不重写完整 A2A transport。
- 不迁移真实 registry 或 external agent transport，除非 gate 证明 Python 接管最小闭环。
- 不把 invoke contract、mock stream 或 readiness 当成 production session/stream 接管。
- 不把 external-agent-required 写成 Python-owned。
- 不提交 `.agent-loop`、`.worktrees`、日志、缓存或真实用户数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `a2aSessionStreamRuntimeSlice103Gates`。

## 成功标准

- Python service 能表达 A2A session-stream runtime slice 和 ownership decision。
- Node bridge 能消费该 runtime/decision，并保留 Node/external transport 时的清晰 fallback。
- 测试覆盖 session、stream、cancel 至少一个真实路径。
- 产生真实代码 diff；如果最终只有文档变化，任务应失败。
- 所有 gate 通过。

## 给 worker 的大白话

A2A 不要再停在“协议能测”。你要盯 session、stream、cancel 谁拥有。Python 真接就写 runtime slice；没接就让系统明确说 Node/external 继续拥有。
