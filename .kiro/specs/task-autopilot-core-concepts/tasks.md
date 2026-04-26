# 任务清单：任务自动驾驶核心概念

- [x] 定义 `Destination`、`Route`、`Drive State`、`Fleet`、`Takeover Point`、`Replan`、`Confidence`、`Risk` 的统一中文语义
- [x] 明确核心对象的边界，避免与现有 `mission / workflow / task` 直接混用
- [x] 补充核心对象之间的主链路关系与决策关系
- [x] 定义 `Destination -> mission`、`Route -> workflow`、`Drive State -> runtime state` 的映射口径
- [x] 定义 `Fleet -> agents / skills / nodes / executors` 的映射口径
- [x] 定义 `Takeover Point` 与 HITL / decision / approval 的承接关系
- [x] 定义 `Replan`、`Confidence`、`Risk` 的触发与联动原则
- [x] 将本 spec 作为后续目的地解析、路线规划、驾驶状态机与驾驶舱 specs 的前置约束

## 2026-04-25 审计备注

- 本轮按 `shared/mission/autopilot.ts`、`shared/mission/api.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 复核后，保守补勾“定义 `Replan`、`Confidence`、`Risk` 的触发与联动原则”。
- 可直接支撑补勾的证据是：shared 已稳定暴露 `driveState.riskLevel / driveState.confidence / destination.confidence / route.replan / explanation.recommendationDetails / explanation.remainingSteps`；projection、store 与 panel 也已经对这些字段形成持续对齐与消费。
- 当前可成立的是“最小触发与联动原则”而不是“统一全局治理引擎”：高风险/人工门控会推高路线治理深度，waiting / blocked / retry 场景会显式暴露接管与 `replan` 语义，重规划原因会同步进入 route、explanation 与 panel 展示。
- 本轮不额外外推未被直接代码与直接测试覆盖的未来态规则，例如“低置信度必然自动触发接管”“风险与置信度联合决定全局降级矩阵”等。
