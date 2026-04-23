# 需求文档：对话节点

## 目标

定义 `dialogue` 节点在 Cube 中承接 `web-aigc` 对话编排时的最小可运行边界：能接收对话输入、能承接上游增强信息、能把结果落到会话与监控视图。

## 当前主仓边界（2026-04-23）

- 已具备 `POST /api/chat/nodes/execute` 入口，并支持 `nodeType = "dialogue"`。
- 已支持调用方显式传入 `prompt` 或 `messages`，并透传 `context`、`variables`、`citations`、`toolCalls`、`thinking` 等增强字段。
- 已支持节点在配置 `documentSearch` 时主动触发一次 `document_search`，并将结果归并为 `context`、`citations`、`toolCalls`；该能力既可由 route 级依赖注入提供，也可复用默认检索执行器。
- 已支持将对话结果写入 `workflow message` 与 `session exchange`，并被实例 / 会话监控投影读取；`workflowId / sessionId / missionId / agentId / stage / citations / toolCalls / thinking` 会按统一口径写入元数据。
- 尚未支持 `dialogue` 节点主动回查平台会话历史并自动组装输入消息。
- 尚未支持 `dialogue` 节点完成多工具选择、失败重试、审批治理等完整工具编排。

## 需求

### 需求 1：多轮对话输入

系统应支持调用方以 `prompt` 或显式 `messages` 发起对话请求，并返回标准化的对话节点结果。

补充说明：
当前“多轮”能力的事实口径是“调用方可显式传入历史消息”；不把“节点自动读取平台会话历史”计入已完成能力。

### 需求 2：上下文增强接力

对话节点应支持接收检索结果、工具结果、人工输入等上游增强信息，并把这些信息纳入提示构造与输出元数据。

补充说明：
当前主仓已支持两层能力：
- 上游增强信息透传与回写
- 节点自身基于 `documentSearch` 的最小主动检索增强

但不把“完整多工具编排 / 重试 / 治理链路”计入本项已落地范围。

### 需求 3：会话与监控可见

对话消息、工具调用、引用信息、思考摘要应可在实例与会话监控中查看，并能与 workflow / session 关联。

补充说明：
当前主仓已验证：
- `workflow message` 用户侧与助手侧记录都带有关联元数据
- `session exchange` 会复用与助手消息一致的增强元数据
- 结构化 `toolCalls.result` 会在输出、消息元数据、会话交换记录中保持一致，而不是仅保留字符串结果

## 暂未纳入当前完成口径

- 节点自主加载完整 session 历史。
- 节点自主完成多工具调用、失败重试、工具选择与审批治理。
