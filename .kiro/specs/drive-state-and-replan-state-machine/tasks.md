# 任务清单：Drive State 与 Replan 状态机

- [x] 梳理当前主仓中 Mission Runtime、workflow instance、node run、review / audit / verify 的状态来源，形成底层状态清单
- [x] 明确十个高层 `Drive State` 的最终定义、边界与命名口径
- [x] 输出 `Drive State` 与现有 workflow / runtime state 的归并映射表
- [x] 输出 `Drive State` 主链路迁移图，覆盖 understanding 到 delivered 的标准推进路径
- [x] 输出澄清链路迁移图，明确 `clarifying` 与 `takeover-required` 的关系
- [x] 输出阻塞链路迁移图，明确 `blocked` 的进入条件与退出路径
- [x] 输出重规划链路迁移图，明确 `replanning` 的触发条件、恢复路径与与 `retry` 的区别
- [x] 梳理当前系统中可触发 `replanning` 的真实信号来源，包括 review 失败、依赖失效、约束变更、人工改线等
- [x] 定义高层状态切换所需的最小事件字段，用于 replay / audit 重建状态时间线
- [x] 评估哪些状态可以先由前端 view model 推导，哪些更适合在服务端 projection 层生成
- [x] 评估 `Drive State` 接入 mission-first 任务详情页的最小实现方案
- [x] 评估 `Drive State` 接入驾驶舱主视图的最小实现方案
- [x] 评估 `Drive State` 接入 replay / audit 时间线的最小实现方案
- [x] 明确 `takeover-required` 与现有 HITL / decision / approval / resume 链路的映射方式
- [x] 梳理当前代码和文档中对旧状态命名的依赖，形成“兼容优先、不立即改名”的风险说明

## 审计备注（2026-04-24）

- 当前 `shared/mission/autopilot.ts` 已稳定导出十个高层 `Drive State` 常量与类型，并在 `inferMissionAutopilotDriveState()` 中把 `receive / understand / plan / provision / execute / finalize / waiting / failed / done` 等 mission facts 归并到统一十态口径。
- 设计文档中已经给出主链路、澄清链路、接管链路、重规划链路与阻塞链路；其中 `clarifying` 与 `takeover-required` 的边界也已通过“waiting 且有 decision -> takeover-required，否则 -> clarifying”的共享实现形成最小代码支撑。
- `blocked` 的进入与退出也已有直接事实链：`inferMissionAutopilotDriveState()` 已把 `failed / operatorState=blocked / blocker` 归并为 `blocked`；共享测试已覆盖 blocked 重试与 recovery/replan 投影；服务端测试也覆盖了 `escalate -> blocked` 与 `resume -> active` 清除 blocker 的退出路径。
- `TaskAutopilotPanel` 与 client store 已消费 `driveState.state / label / detail / currentStageLabel / waitingForUser / blocked`，因此“接入任务详情页”和“接入驾驶舱主视图的最小实现方案”都已有直接实现证据。
- 当前仍缺少 replay / audit 专用的高层状态事件字段落地，以及对旧命名依赖面的系统盘点；因此相关条目继续保持未勾选。

## 复核备注（2026-04-25）

- 本轮保守新增勾选“评估 `Drive State` 接入 replay / audit 时间线的最小实现方案”。依据不是 replay / audit 事件契约已经完备，而是最小接入骨架已经有代码与测试闭环：`shared/mission/autopilot.ts` 产出 `evidence.timeline` 与 `evidence.correlation`，`server/tasks/mission-projection.ts` 会把它随 projection 输出并对齐 `workflowId / replayId / sessionId`，`client/src/lib/tasks-store.ts` 与 `client/src/components/tasks/TaskAutopilotPanel.tsx` 已继续消费这些字段。
- `server/tests/mission-routes.test.ts` 已直接校验 projection 中的 `evidence.timeline`、`evidence.correlation.replayId / sessionId / routeIds / operatorActionIds`，并覆盖 “replay-aware consumers” 的 link 对齐；`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 也已覆盖 evidence correlation 标识、indexed counts 与 explanation timeline 标识的渲染。
- `server/tests/hitl-decision.test.ts` 进一步补强 `takeover-required` 映射证据：等待中的 decision 可提交、恢复 running、再次进入 waiting、以及 timeout reject；这说明 HITL / decision / resume 链路本身已有稳定行为证据，但它仍不等于 replay / audit 的高层状态事件字段已经统一。
- 继续不勾选的项包括：主链路 understanding -> delivered 的全段闭环、真实 replanning 信号来源清单、replay / audit 的最小状态事件字段、以及旧命名依赖盘点。当前代码与测试更多证明的是“最小接入路径已存在”，还不足以证明“全链路迁移与事件契约已经完成”。

## 追加审计备注（2026-04-25）

- 本轮没有新增其他勾选项。原因是这条 spec 当前最需要补的是“边界说明”，而不是继续扩大“已完成”范围。
- 继续不勾选 `梳理当前主仓中 Mission Runtime、workflow instance、node run、review / audit / verify 的状态来源，形成底层状态清单`：
  - 当前能直接锚定的是 mission / projection / explanation 层的状态来源；
  - 但 node run、review、audit、verify 全量来源并未在单一文档或实现中完成系统盘点。
- 继续不勾选 `输出 Drive State 主链路迁移图，覆盖 understanding 到 delivered 的标准推进路径`：
  - 当前已经有十态定义与若干阶段映射；
  - 但并没有一套被实现和测试直接支撑的完整主链路迁移事件闭环。
- 继续不勾选 `梳理当前系统中可触发 replanning 的真实信号来源`：
  - 当前直接实现锚点主要是 `attempt > 1`、`retry / escalate`、`blocked` 与 `route.replan` 联动；
  - review quality gap、dependency unavailable、constraint changed、risk exceeded、human reroute 仍主要停留在设计层。
- 继续不勾选 `定义高层状态切换所需的最小事件字段，用于 replay / audit 重建状态时间线`：
  - 当前已有 `evidence.timeline`、`evidence.correlation`、`explanation.currentState`、`explanation.remainingSteps` 这类最小骨架；
  - 但仍缺少 `previousDriveState / nextDriveState / triggerType / triggerReason` 这一类统一 transition-level 事件字段契约。
- 继续不勾选 `梳理当前代码和文档中对旧状态命名的依赖，形成“兼容优先、不立即改名”的风险说明`：
  - 当前设计里已经补了兼容策略；
  - 但这只说明“不建议怎么改”，不等于依赖盘点已经完成。

## 追加审计备注（2026-04-26，文档收口完成项与实现边界分层）

- 本轮只在 `requirements.md`、`design.md`、`tasks.md` 三个 spec 文件内继续收口，没有改代码文件；因此本轮新增勾选只表示 **文档/设计收口完成**，不表示运行时代码已新增实现。
- 本轮安全新增勾选的条目如下：
  - `梳理当前主仓中 Mission Runtime、workflow instance、node run、review / audit / verify 的状态来源，形成底层状态清单`
    - 依据：`design.md` 已补出“最小底层状态清单（2026-04-26）”，将 mission lifecycle、stage、waiting/decision、operator/blocker、recovery、workflow runtime、execution summary、evidence、explanation 等最小状态族群按“当前可支持的高层语义 / 当前未完成边界”分层写清。
    - 说明：这里完成的是“最小清单文档”，不是全仓所有 node run / review / audit / verify 状态已盘点完毕。
  - `输出 Drive State 主链路迁移图，覆盖 understanding 到 delivered 的标准推进路径`
    - 依据：`design.md` 已新增“标准主链路迁移图（2026-04-26）”，以表格形式明确 `understanding -> planning -> fleet-forming -> executing -> reviewing -> delivered` 的进入条件、最小实现锚点与退出分支。
    - 说明：这里完成的是设计层主链路图，不代表完整 transition event contract 已存在。
  - `梳理当前系统中可触发 replanning 的真实信号来源，包括 review 失败、依赖失效、约束变更、人工改线等`
    - 依据：`design.md` 已新增“replanning 真实触发信号清单（2026-04-26）”，把 A 类“当前已有直接实现或测试锚点”、B 类“已有部分事实锚点但未独立闭环”、C 类“仍停留在目标态设计”的信号来源拆开列明。
    - 说明：这里完成的是“真实信号来源分层梳理”，不是所有触发器都已在代码里闭环。
  - `定义高层状态切换所需的最小事件字段，用于 replay / audit 重建状态时间线`
    - 依据：`design.md` 已新增 `DriveStateTransitionEvent` 结构建议，覆盖 `previousDriveState / nextDriveState / triggerType / triggerReason / missionId / workflowId / routeId / decisionId / operatorActionId / runtimeEventId / correlationTimelineId / source`。
    - 说明：这里完成的是最小字段定义；当前实现仍只到 `evidence.timeline / evidence.correlation / explanation.currentState / explanation.remainingSteps` 的骨架层。
  - `梳理当前代码和文档中对旧状态命名的依赖，形成“兼容优先、不立即改名”的风险说明`
    - 依据：`design.md` 已新增“旧命名兼容风险矩阵（2026-04-26）”，把 `MissionStatus`、workflow status、execution step status、recovery state、timeline event type、route selection status 的承载位置、不可直接改名原因与兼容策略逐项列清。
    - 说明：这里完成的是风险说明与最小兼容矩阵，不代表所有旧字段依赖点已逐文件排查。
- 本轮勾选后仍需保留的实现边界：
  - 这些新增完成项主要是 spec 文档层成果；
  - 当前仓库仍未形成统一的高层 Drive State transition 事件实现契约；
  - `review / audit / verify` 驱动 `replanning` 的真实自动改线闭环，仍没有足够直接代码与直接测试证据。
