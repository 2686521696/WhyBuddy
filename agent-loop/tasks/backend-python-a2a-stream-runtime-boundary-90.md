# 后端 NodeJS 到 Python 迁移：A2A stream runtime boundary 90

## 执行状态
- 状态：待执行
- 目标：为 A2A stream（流式）长链路补 runtime boundary，不启动真实外部 agent。
- 角色分工：worker 负责 stream 状态、cancel/error/envelope 语义和测试；reviewer 确认没有真实 agent 副作用。

### 状态清单
- [ ] Python A2A runtime 支持最小 stream boundary 或明确 stream fallback。
- [ ] Node route/client 能区分 streaming、completed、failed、cancelled。
- [ ] stream error/cancel 不伪装成 completed。
- [ ] gate 全绿。
- [ ] Codex review 确认没有启动真实 CrewAI、LangGraph、Claude 或外部 agent。

## 目标

之前 A2A invoke/list/cancel 已经推进，但 stream 长链路刻意没迁。90% 阶段至少要把 stream boundary（流式边界）的状态语义固定下来。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/a2a_runtime.py`
- `tws-ai-slide-rule-python/tests/test_a2a_stream_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_a2a_runtime_contract.py`
- `server/routes/a2a.ts`
- `server/core/a2a-client.ts`
- `server/core/a2a-server.ts`
- `server/routes/__tests__/a2a-python-stream-runtime.test.ts`
- `server/routes/__tests__/a2a-python-runtime-contract.test.ts`
- `shared/a2a-protocol.ts`
- `agent-loop/tasks/backend-python-a2a-stream-runtime-boundary-90.md`

## 禁止扩大范围
- 不启动真实 CrewAI、LangGraph、Claude agent 或外部 agent。
- 不迁完整生产 stream 编排。
- 不改 agent registry 持久化。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `a2aStreamRuntimeBoundary90Gates`。

## 成功标准

- Python 测试覆盖 stream started/chunk/error/cancel 或等价最小状态。
- Node 测试确认 cancelled/error 不伪装成 completed。
- envelope/session/error 字段稳定。
- 所有 gate 通过。
