# 后端 NodeJS 到 Python 迁移：A2A stream runtime boundary 89

## 执行状态
- 状态：待执行
- 目标：为 A2A stream 补最小 Python runtime boundary 证据，不启动真实外部 agent。
- 角色分工：worker 负责 stream chunk/session/error envelope 和 Node Python-mode 测试；reviewer 确认没有迁完整 stream transport 或 registry。

### 状态清单
- [x] Python runtime boundary 支持 stream chunk running/completed、failed、cancelled 语义。
- [x] Node 测试覆盖 Python mode 下 stream envelope 映射。
- [x] failed/cancelled/partial stream 不伪装成 completed。
- [x] gate 全绿。
- [x] Codex review 确认没有启动真实 CrewAI、LangGraph、Claude 或外部 agent。

## 目标

A2A invoke/list/cancel 已有 bounded runtime bridge，stream 仍主要是 contract 和 Node-owned transport。本任务只补 Python stream runtime boundary 的最小证据：chunk、session status、error/cancelled 语义稳定。完整外部 agent stream、registry persistence 和长链路 transport 仍保留在后续任务。

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
- `agent-loop/tasks/backend-python-a2a-stream-runtime-boundary-89.md`

## 禁止扩大范围
- 不启动真实 CrewAI、LangGraph、Claude 或外部 agent。
- 不迁完整 stream 长链路 transport。
- 不改 agent registry 持久化。
- 不改生产 session store。
- 不提交 `.agent-loop` 运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `a2aStreamRuntimeBoundary89Gates`。

## 成功标准

- Python 测试覆盖 stream running/completed、failed、cancelled/error envelope。
- Node 测试确认 Python mode 不把 failed/cancelled/partial chunk 映射成 completed。
- stream session id、request id、error 字段稳定。
- TypeScript、pytest、mojibake gate 通过。
