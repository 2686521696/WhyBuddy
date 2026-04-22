# 任务清单：用户输入节点

- [x] 定义等待输入节点载荷
- [x] 复用任务输入与决策接口
- [x] 写入输入提交与恢复事件
- [x] 验证人工中断与超时场景

## 状态备注（2026-04-22）

- 当前 4 项保持已完成，但完成口径已收紧为“Cube 通用 HITL / mission decision 链路能够承接 `user_input` 类等待与恢复场景”。
- 已验证链路包括：`MissionRuntime.waitOnMission()`、`POST /api/tasks/:id/decision`、`decisionHistory` 持久化、超时失败与审计记录。
- 尚未看到 `WorkflowRuntimeEngine` 为 `user_input` 注册显式节点适配器；当前内置接入的是 `selection` 与 `confirm_judge`，因此这里的完成状态不等价于“`user_input` 节点已在 runtime 中原生跑通”。
- “结构化输入”当前主要通过 `metadata.formData` 兼容承接；“附件补充输入”尚未看到独立提交字段或专项测试证据。
