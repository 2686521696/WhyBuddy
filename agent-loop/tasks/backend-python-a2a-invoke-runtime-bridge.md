# 后端 NodeJS 到 Python 迁移：A2A invoke runtime bridge

## 执行状态
- 状态：待执行
- 目标：把 A2A invoke/list/cancel 从 contract 推进到 Python runtime bridge，不碰复杂 stream 长链路。
- 角色分工：worker 负责 invoke/list/cancel bridge 和测试；reviewer 确认不启动真实外部 agent。

### 状态清单
- [ ] Python runtime bridge 支持 invoke、list agents、cancel。
- [ ] Node route/client 能映射 Python completed/failed/cancelled。
- [ ] cancelled/error 不伪装成 completed。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实 agent 副作用。

## 目标

A2A stream（流式）长链路复杂，先不迁。这个任务只做最小 invoke/list/cancel bridge，让状态语义硬起来。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/a2a_runtime.py`
- `tws-ai-slide-rule-python/tests/test_a2a_invoke_runtime_bridge.py`
- `tws-ai-slide-rule-python/tests/test_a2a_runtime_contract.py`
- `server/routes/a2a.ts`
- `server/core/a2a-client.ts`
- `server/core/a2a-server.ts`
- `server/routes/__tests__/a2a-python-invoke-runtime.test.ts`
- `server/routes/__tests__/a2a-python-runtime-contract.test.ts`
- `shared/a2a-protocol.ts`
- `agent-loop/tasks/backend-python-a2a-invoke-runtime-bridge.md`

## 禁止扩大范围
- 不启动真实 CrewAI、LangGraph、Claude agent 或外部 agent。
- 不迁 stream 长链路。
- 不改 agent registry 持久化。
- 不提交 session 运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `a2aInvokeRuntimeBridgeGates`。

## 成功标准

- Python 测试覆盖 invoke completed/failed、list agents、cancel。
- Node 测试确认 cancelled/error 不伪装成 completed。
- envelope/session/error 字段稳定。
- 所有 gate 通过。
