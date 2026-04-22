# 任务清单：Web-AIGC 平台任务投影

- [x] 定义 `workflowId / missionId / instanceId` 关联结构
- [x] 定义节点事件到任务事件的映射规则
- [x] 将节点输出挂接到任务产物与报告
- [x] 定义图执行失败、终止、等待输入的投影规则
- [x] 验证回放链路是否完整

## 状态备注（2026-04-22）

- 本切片当前保持 5 项已完成，但完成口径已收紧为“已有实现与测试支撑”，不再把兼容投影层表述为新的平台事实源。
- `projection / session / replay` 属于已验证闭环，对应 `GET /api/tasks/:id/projection`、`GET /api/tasks/:id/session` 与 `projection.replayId -> /api/replay/:timelineKey`。
- `monitoring` 相关能力当前属于兼容映射：`MissionProjectionView.monitoring` 只提供摘要字段，完整详情仍通过 `aigc-monitoring` 兼容接口派生。
- “任务产物与报告”这一项，已验证部分主要是 `artifacts` 挂接与读取链路；报告能力当前仍以 `mission.summary` 和 `workflow.results.final_report` 的兼容透出为主，尚未形成 `MissionProjectionView` 独立报告字段。
- replay 路由路径参数名仍沿用 `missionId`，但在本切片的真实投影链路中，消费的是 `projection.replayId` 对应的 timeline key。
