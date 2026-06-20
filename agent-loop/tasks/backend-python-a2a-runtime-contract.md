# 后端 NodeJS 到 Python 迁移：A2A runtime contract

## 执行状态
- 状态：待执行
- 目标：为 A2A invoke/stream/cancel/agent list 建立 Python runtime contract。
- 角色分工：worker 负责 contract；reviewer 确认不启动真实外部 agent。

### 状态清单
- [x] Python 侧有 A2A runtime contract。
- [x] Node 侧测试覆盖 invoke/stream/cancel/list。
- [x] envelope/session/error 字段稳定。
- [x] gate 全绿。
- [x] Codex review 确认没有真实 agent 副作用。

## 目标

A2A 是后端 agent 通信大块。此任务只迁 contract，让 Python 能表达 A2A 基本语义。

## 允许修改的文件
- `agent-loop/tasks/backend-python-a2a-runtime-contract.md`
- `tws-ai-slide-rule-python/services/a2a_runtime.py`
- `tws-ai-slide-rule-python/tests/test_a2a_runtime_contract.py`
- `server/routes/a2a.ts`
- `server/core/a2a-client.ts`
- `server/core/a2a-server.ts`
- `server/core/a2a-adapters/*.ts`
- `server/routes/__tests__/a2a-python-runtime-contract.test.ts`
- `shared/a2a-protocol.ts`

## 禁止扩大范围
- 不启动真实 CrewAI/LangGraph/Claude agent。
- 不发真实 stream。
- 不改 agent registry。
- 不提交 session 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `a2aRuntimeContractGates`。

## 成功标准

- Python contract 覆盖 invoke、stream chunk、cancel、list agents。
- Node 测试确认 cancelled/error 不伪装成 completed。
- envelope 字段稳定。
- gate 全绿。
