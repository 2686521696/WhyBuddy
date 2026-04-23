# 任务清单：机器人回复节点

- [x] 定义回复消息结构
- [x] 接入会话写入链路
- [x] 支持引用与工具摘要
- [x] 验证与 dialogue 节点联动

## 当前状态

- 已新增 `robot_reply` 节点适配器，支持直接文本回复与标准化 `reply` 输出。
- 已接入现有 workflow message / session exchange 底座，可将最终答复落到消息流与会话记录。
- 已支持从 `dialogue` 输出中继承 `citations`、`toolCalls` 与链路元数据，并生成面向前端的 `toolSummaries`。
- 已补节点测试与路由测试，验证 standalone 执行、落链路以及与 `dialogue` 输出衔接。
