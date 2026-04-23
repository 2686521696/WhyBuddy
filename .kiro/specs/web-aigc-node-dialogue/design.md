# 设计文档：对话节点

## 设计概述

`dialogue` 节点是 `web-aigc` 迁移中的高优先级对象，用来把工作流里的对话类节点接到 Cube 现有聊天、会话记录与监控投影链路上。

当前设计不追求一步到位复刻完整智能对话编排，而是先建立一个可运行、可留痕、可监控的最小闭环。

## 接口映射

- `web-aigc` 节点：`dialogue`
- Cube 承接入口：`/api/chat/nodes/execute`
- Cube 消费落点：`workflow message`、`session exchange`、实例 / 会话监控投影

## 当前主仓实现口径（2026-04-23）

- 节点执行输入由调用方显式提供：`prompt` 或 `messages`。
- 上游增强信息通过输入字段传入：`context`、`variables`、`citations`、`toolCalls`、`thinking`。
- 当节点配置 `documentSearch` 时，可在执行期主动发起 `document_search`，并将检索结果折叠为增强上下文；检索执行器既支持 route 级依赖注入，也支持默认主仓检索适配器。
- 节点执行后写入 workflow 消息与 session 交换记录。
- 监控投影从消息元数据中读取 `thinking`、`citations`、`toolCalls` 等字段。
- `workflow message` 与 `session exchange` 的增强元数据已对齐，能够统一携带 `workflowId / sessionId / missionId / agentId / stage / citations / toolCalls / thinking`。
- `toolCalls.result` 当前允许结构化对象输入，并在输出、消息元数据、会话交换记录中序列化为统一字符串表示。
- 当前不包含“节点自动拉取历史会话”与“多工具选择 / 重试 / 审批治理”这类更完整的主动作业链路。

## 运行流程

1. 调用方提交 `dialogue` 节点执行请求，并显式传入 `prompt` 或 `messages`。
2. 若配置了 `documentSearch`，节点先基于 `query / prompt / 最新用户消息` 主动发起一次 `document_search`。
3. 服务端把检索结果与传入的 `context`、`variables`、`citations`、`toolCalls` 归并为提示补充。
4. 对话链路调用共享 LLM 能力生成回复。
5. 在具备关联标识时，将用户输入与助手输出写入 `workflow message`，并保留统一关联元数据。
6. 在具备 `agentId` 等上下文时，将结果追加到 `session exchange`，并复用与助手消息一致的增强元数据。
7. 监控投影从消息元数据读取 `thinking`、`citations`、`toolCalls` 并展示到实例 / 会话视图。

## 边界与保留项

- 当前“多轮对话”依赖调用方显式传入历史消息，不是节点自行回查 session。
- 当前“检索与工具增强”已具备 `document_search` 主动增强最小闭环，但不等于完整 RAG / 多工具编排平台。
- 更复杂的工具选择、失败重试、审批治理与多阶段工具链路，仍应由后续 `tools / mcp / governance` 主线继续补齐。
