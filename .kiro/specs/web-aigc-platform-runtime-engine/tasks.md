# 任务清单：Web-AIGC 平台运行时引擎

- [x] 定义节点执行适配器接口
- [x] 定义边跳转与状态推进逻辑
- [x] 接入等待输入与恢复执行机制
- [ ] 补齐显式终止、重试、失败升级策略闭环
  - `server/core/workflow-runtime-engine.ts` 已新增显式 `terminate()`、`retry()`、`escalate()` 运行时入口。
  - `server/routes/workflows.ts` 已暴露 `/api/workflows/:id/runtime/terminate`、`/runtime/retry`、`/runtime/escalate` 三个控制接口。
  - `server/tests/workflow-runtime-engine.test.ts` 与 `server/tests/workflows-routes.test.ts` 已覆盖三类入口的最小行为验证。
  - 节点现已支持基于 `retryBudget / retryDelayMs / autoEscalateOnFailure / escalateOnRetryExhausted` 的最小自动策略层。
  - `server/tests/workflow-runtime-engine.test.ts` 已新增“自动重试成功”“重试耗尽自动升级”两组验证。
  - 当前仍未形成统一后台重试队列、指数退避策略中心、跨节点治理编排，因此“最小控制面 + 最小自动策略层已成立”，但“完整策略闭环”仍未完成。
- [x] 将运行时节点事件统一接入 replay / telemetry / audit
  - `server/core/workflow-runtime-engine.ts` 已统一发射 `node.started / node.completed / node.waiting_input / node.failed / edge.transitioned` 对应的 runtime 事件。
  - 当前事件通过既有 `eventEmitter -> socket(agent_event)` 通道进入平台公共事件面，形成运行时节点事件的最小统一出口；这里的 `telemetry` 更接近“公共事件面”，而不是独立遥测后端。
  - `server/core/web-aigc-runtime-observability.ts` 已把上述 runtime 事件镜像到 replay / audit，但尚未由 runtime 事件直接写入 lineage。
  - 新增 `instance.terminated / instance.retry_requested / instance.escalated` 三类控制面事件，已进入 replay / audit 映射与测试。

> 说明：`selection`、`confirm_judge`、`end` 已作为内置运行时能力落地，支撑图分支、人工恢复与终态收敛；`terminate / retry / escalate` 与节点级自动重试/自动升级现在已经具备最小能力，但统一治理编排仍未闭环，因此第 4 项暂不应标记为已完成。
