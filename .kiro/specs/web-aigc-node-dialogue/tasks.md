# 任务清单：对话节点

> 2026-04-22 现状核查：当前主仓已具备 `dialogue` 节点统一输入输出结构、`POST /api/chat/nodes/execute` 执行入口，以及基于 `workflow message + session exchange` 的最小会话闭环；实例会话查看也已能消费该链路落下的 `thinking / citations / toolCalls` 元数据。检索 / 工具增强仍停留在薄接线透传，尚未形成主动执行链路，因此第 3 项继续保持未完成。

- [x] 定义对话节点输入输出结构
- [x] 对接聊天与会话记录
- [ ] 接入检索与工具增强
- [x] 打通实例关联会话查看
