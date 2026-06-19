# 后端 NodeJS 到 Python 迁移：LLM stream contract

## 执行状态

- 状态：已完成
- 目标：补 Python LLM stream（流式输出）最小契约，不直接迁所有 Node stream 调用
- 角色分工：Grok 负责补 contract test（契约测试）；Codex 负责审查是否越界改业务能力

### 状态清单

- [x] 已执行 AgentLoop
- [x] Python stream contract test 覆盖 chunk/done/error
- [x] 不依赖真实 LLM key
- [x] telemetry（观测信息）不丢失
- [x] gate 全绿
- [x] Codex review（审查）已确认没有把 stream contract 夸大成全后端 stream 迁移

## 目标

LLM infra（大模型底座）要从 40-50% 往上推，stream 是绕不过去的边界。但第一步只做契约：chunk shape（分片形状）、done event（完成事件）、error event（错误事件）、usage/latency telemetry（用量/耗时观测）怎么表达。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/client.py`
- `tws-ai-slide-rule-python/sliderule_llm/pool.py`
- `tws-ai-slide-rule-python/tests/test_stream_contract.py`
- `tws-ai-slide-rule-python/tests/test_telemetry_cost.py`
- `agent-loop/tasks/backend-python-llm-stream-contract.md`

## 禁止扩大范围

- 不发 live LLM。
- 不迁 Node SSE/WebSocket 主链路。
- 不改业务 capability prompt。
- 不提交真实 key、日志、`.env`。
- 不更新全局迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `llmStreamContractGates`。

## 成功标准

- stream contract test 覆盖 chunk/done/error。
- fake provider 可复现 stream，不依赖外部服务。
- telemetry 字段与已有 chat/JSON/pool telemetry 不冲突。
- 所有 gate 通过。
