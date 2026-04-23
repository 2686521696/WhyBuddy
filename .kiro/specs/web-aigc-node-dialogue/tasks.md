# 任务清单：对话节点

> 2026-04-23 收口结论：当前主仓已经具备 `dialogue` 节点的最小可运行闭环。节点可通过 `POST /api/chat/nodes/execute` 执行，支持显式传入 `prompt` 或 `messages`，可在配置 `documentSearch` 时主动触发一次 `document_search`，并将检索结果归并为 `context`、`citations`、`toolCalls`。执行结果可写入 `workflow message` 与 `session exchange`，监控链路也能读取 `thinking / citations / toolCalls` 元数据；本轮进一步补齐了 route 级 `documentSearch` 注入验证，以及 `workflowId / toolCalls.result` 在输出与留痕元数据中的一致性。

- [x] 定义对话节点输入输出结构
- [x] 对接聊天与会话记录
- [x] 接入检索与工具增强
- [x] 打通实例关联会话查看

## 本轮补强说明

- [x] 补充 `dialogue + document_search` 联动测试，覆盖从 `messages` 回退提取查询词
- [x] 补充上游 `citations / toolCalls / thinking` 与 `document_search` 结果的合并验证
- [x] 补充写回 `workflow message / session exchange metadata` 的断言
- [x] 补充 route 级 `documentSearch` 注入执行断言
- [x] 补充结构化 `toolCalls.result` 与 `workflowId` 的统一元数据写回断言
- [x] 补充 `qa_search` 作为对话增强上游输入的兼容性断言

## 当前完成边界

- 已完成：调用方显式传入多轮消息，`dialogue` 节点按统一输入结构执行
- 已完成：节点主动触发一次 `document_search`，并将结果折叠为对话增强上下文
- 已完成：对话结果写入 `workflow message`、`session exchange`，并携带一致的监控元数据
- 未纳入本 spec 完成口径：节点自动回查完整 session 历史
- 未纳入本 spec 完成口径：多工具自主选择、失败重试、审批治理等完整工具编排
