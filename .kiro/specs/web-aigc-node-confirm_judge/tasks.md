# 任务清单：确认判断节点

- [x] 定义确认节点的选项模型
  - `shared/mission/contracts.ts` 已把 `confirm_judge` 纳入 `WEB_AIGC_HITL_NODE_TYPES`，并允许通过 `WebAigcHitlSubmissionMetadata` / `DecisionHistoryEntry` 承载 `nodeType / sessionId / interactionId / branchKey`。
  - 现有确认类选项模型可直接承接 `approve / reject` 这类 confirm 场景，任务决策历史也能保留已选项与分支元数据。

- [x] 复用现有任务决策接口
  - `POST /api/tasks/:id/decision` 仍是主入口，内部走 `submitMissionDecision(...)`，不需要为 `confirm_judge` 另起一套接口。
  - `server/tests/hitl-decision.test.ts` 已覆盖 `submittedBy`、decision history 追加、metadata 透传等通用 HITL 决策行为。

- [x] 写入确认审计事件
  - 现状已由 `MissionRuntime.emitDecisionSubmitted` + `server/audit/audit-hooks.ts` 接入 `human.decision_submitted` 审计事件。
  - `server/tests/hitl-decision.test.ts` 已验证会写入 `AuditEventType.DECISION_MADE`，并携带 `decisionId / nodeId / submittedBy / optionId / branchKey` 等关键字段。

- [x] 验证批准与驳回分支
  - `server/core/workflow-runtime-engine.ts` 已注册 `confirm_judge` 内置 `HitlChoiceAdapter`，并显式使用 `branchFrom: "branchKey"` 选择 conditional edge。
  - `server/tests/workflow-runtime-engine.test.ts` 已覆盖 `confirm_judge` 节点进入 `WAITING_INPUT`、恢复后按 `branchKey` 命中驳回分支、继续推进到下游节点执行完成。
  - 当前事实是：分支选择结果保留在 `instance.variables.selectedOptionId / branchKey`，终点业务结果保留在 `instance.output`。
  - 现状说明见：`.kiro/specs/web-aigc-node-confirm_judge/现状核查.md`
