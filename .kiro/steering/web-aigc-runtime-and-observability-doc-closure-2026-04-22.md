# Web-AIGC Runtime / Observability 文档收口（2026-04-22）

## 范围

本文只对账以下两条 spec 的当前主仓真实状态，并给出文档收口建议：

- `web-aigc-platform-runtime-engine`
- `web-aigc-platform-observability-audit`

本轮结论只基于当前主仓已有实现、路由、共享契约和测试，不把“领域模型已预留”写成“运行时闭环已完成”。

## 对账摘要

### 1. `web-aigc-platform-runtime-engine`

当前更准确的结论是：

- 主干运行时已成立
- `selection / confirm_judge / end` 内置节点已成立
- `terminate / retry / escalate` 最小控制面已成立
- 节点级自动重试/自动升级已成立
- 统一治理策略闭环仍未完成

建议口径：

- 可视为 `4/5`
- 不建议把“补齐显式终止、重试、失败升级策略闭环”整体勾为完成

### 2. `web-aigc-platform-observability-audit`

当前更准确的结论是：

- 事件目录层已成立
- replay / audit 最小桥接已成立
- relation index 与 audit 查询能力已成立
- monitoring / replay 最小消费闭环已成立
- runtime -> lineage 统一直写仍未证实

建议口径：

- `tasks.md` 当前 5 项保持勾选是可以成立的
- 但需要通过 requirements / design / 现状核查明确限制性表述

## 当前主仓已确认的事实

### Runtime 事实

来自以下实现与测试：

- `server/core/workflow-runtime-engine.ts`
- `server/routes/workflows.ts`
- `server/tests/workflow-runtime-engine.test.ts`
- `server/tests/workflows-routes.test.ts`

已确认：

- 节点适配器统一执行契约存在
- 条件边推进已存在
- `wait / resume` checkpoint 链路已存在
- `selection / confirm_judge / end` 已有真实运行时行为
- `terminate / retry / escalate` 路由与引擎入口均已存在
- 自动重试成功、重试耗尽自动升级均已有测试

仍未确认完整完成：

- loop 边真实执行闭环
- 平台统一重试治理中心
- 跨节点/跨阶段失败治理编排

### Observability / Audit 事实

来自以下实现与测试：

- `shared/web-aigc-observability.ts`
- `server/core/web-aigc-runtime-observability.ts`
- `server/routes/replay.ts`
- `server/routes/audit.ts`
- `server/routes/aigc-monitoring.ts`
- `server/routes/lineage.ts`
- `server/tests/web-aigc-runtime-observability.test.ts`
- `server/tests/replay-routes.test.ts`
- `server/tests/audit-query.test.ts`
- `server/tests/aigc-monitoring-routes.test.ts`

已确认：

- 事件目录与 required fields 已存在
- relation indexes 已存在
- runtime 事件已镜像到 replay / audit
- replay snapshot 与 audit 补记已形成最小闭环
- monitoring 兼容接口能消费 mission / workflow / graph / session 投影

仍需谨慎：

- `lineage` 当前更像索引模型与独立查询承接面
- 不能据此写成“runtime bridge 已统一落库 lineage”

## 本轮文档收口动作

### 已更新

- `.kiro/specs/web-aigc-platform-runtime-engine/requirements.md`
- `.kiro/specs/web-aigc-platform-runtime-engine/design.md`
- `.kiro/specs/web-aigc-platform-observability-audit/requirements.md`
- `.kiro/specs/web-aigc-platform-observability-audit/design.md`
- `.kiro/steering/web-aigc-runtime-and-observability-doc-closure-2026-04-22.md`

### 本轮未主动改写

以下文件当前存在并行修改痕迹，因此本轮不主动覆盖其主结构：

- `.kiro/specs/web-aigc-platform-runtime-engine/tasks.md`
- `.kiro/specs/web-aigc-platform-runtime-engine/现状核查.md`
- `.kiro/specs/web-aigc-platform-observability-audit/tasks.md`
- `.kiro/specs/web-aigc-platform-observability-audit/现状核查.md`

## 建议的 tasks 勾选状态

### `web-aigc-platform-runtime-engine`

建议保持：

- `[x] 定义节点执行适配器接口`
- `[x] 定义边跳转与状态推进逻辑`
- `[x] 接入等待输入与恢复执行机制`
- `[ ] 补齐显式终止、重试、失败升级策略闭环`
- `[x] 将运行时节点事件统一接入 replay / telemetry / audit`

说明：

- 第 4 项不能因为已有 `terminate / retry / escalate` 和节点级自动策略就整体勾完。
- 当前更准确的描述是“最小控制面已成立，完整治理策略闭环未完成”。

### `web-aigc-platform-observability-audit`

建议保持：

- `[x] 定义节点级事件类型与载荷`
- `[x] 定义边跳转与循环事件`
- `[x] 定义人工决策与终止审计事件`
- `[x] 打通 replay / audit / lineage 的关联索引`
- `[x] 验证监控与回放界面的最小闭环`

说明：

- 第 4 项勾选成立的依据是“关联索引模型与查询能力已存在”。
- 不能把这一项进一步解读成“runtime 事件已经统一写入 lineage”。

## 仍未完成的能力清单

### Runtime 仍未完成

- loop 边的真实运行时执行闭环与测试证据
- 平台统一重试队列/预算/退避中心
- 跨节点、跨阶段的失败治理编排
- runtime 控制与人工恢复的更完整端到端治理联动

### Observability / Audit 仍未完成或未证实

- runtime 事件统一直写 lineage
- 单个真实运行场景同时落 replay / audit / lineage 三路的端到端验证
- 独立 runtime telemetry backend
- 所有 Web-AIGC 节点都统一接入同一条完整 observability pipeline 的证据

## 建议下一步

如果后续继续做文档收口，优先级建议如下：

1. 把 `runtime-engine` 的“loop 未闭环”写进 tasks 边界说明，避免后续误判为图语义已全量完成。
2. 在 `observability-audit` 相关 steering 中统一强调：
   - replay / audit 已有证据
   - lineage 是索引/查询承接面，不等于 runtime 直写已完成
3. 等并行修改收紧后，再决定是否把这两份 spec 的 `tasks.md / 现状核查.md` 做最终统一版回写。
