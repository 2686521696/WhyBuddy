# 后端 NodeJS 到 Python 迁移：LLM stream runtime adapter

## 执行状态

- 状态：待执行
- 目标：在 LLM stream contract（流式契约）之后补 Python runtime adapter（运行时适配器）的最小测试
- 角色分工：Grok 负责补 adapter 和测试；Codex 负责审查是否误称为完整 live streaming 迁移

### 状态清单

- [x] 已执行 AgentLoop
- [x] Python test 覆盖 fake SSE source 到 normalized stream events
- [x] 错误事件和 done 事件形状稳定
- [x] 不发真实网络请求
- [x] gate 全绿
- [x] Codex review（审查）确认没有迁 Node SSE/WebSocket 生产链路

## 目标

上一片已经有 SSE / stream parser contract。下一步补一个 runtime adapter：从 fake SSE source 迭代事件，输出统一的 `chunk`、`done`、`error` 事件。

这个任务只做 Python 侧 adapter，不迁 Node SSE/WebSocket live path。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/client.py`
- `tws-ai-slide-rule-python/tests/test_stream_runtime_adapter.py`
- `tws-ai-slide-rule-python/tests/test_stream_contract.py`
- `agent-loop/tasks/backend-python-llm-stream-runtime-adapter.md`

## 禁止扩大范围

- 不发真实 OpenAI/LLM 请求。
- 不改 Node SSE/WebSocket 生产链路。
- 不改 UI。
- 不引入长连接服务。
- 不更新全局迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `llmStreamRuntimeAdapterGates`。

## 成功标准

- Python runtime adapter test 能从 fake SSE source 生成 `chunk`、`done`、`error` 三类事件。
- parser contract 旧测试继续通过。
- 错误事件不会被吞成普通 chunk。
- 所有 gate 通过。
