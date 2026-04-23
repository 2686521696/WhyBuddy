# Web-AIGC Tools-and-Agents 主线收口纪要

## 更新时间

- 日期：2026-04-23
- 口径：仅记录当前主仓中已确认落地的 `tools-and-agents` 主线事实
- 说明：本文不补写未经最终锁版确认的完成数、测试总数或跨车道结论

## 本轮收口结论

本轮 `tools-and-agents` 的重点，不是继续增加新的入口数量，而是把已经落地的入口、调度与审计语义收拢到同一条主线。当前可以确认，主仓已经形成“统一执行入口 + 统一路由分发 + 最小审计元数据闭环”的收口状态。

## 已确认成立的主线能力

### 1. `auto-agent` 已成为统一执行入口

`/api/a2a/auto-agent` 已支持以下执行类型：

- `agent`
- `guest_agent`
- `skill`
- `internal_api`
- `passthrough_api`

这意味着 `auto-agent` 已不再只是单点能力，而是承担统一调度面的角色，用于承接多类 Web-AIGC 执行目标。

### 2. `skills` 与 `guest-agents` 已纳入同一 dispatch 链

当前主仓中的以下入口，均已通过 `getAutoAgentExecutor().execute(...)` 进入同一执行链路：

- `/api/skills/:id/execute`
- `/api/agents/guest/:id/execute`
- `/api/a2a/auto-agent`

这说明本轮已经把 `skills`、`guest-agents` 与统一执行面打通，避免后续继续演化成多套互不对齐的调用模型。

### 3. `internal_api` 已形成最小可复用闭环

当前 `internal_api` 适配层已沉淀出可复用的目标标识与调用边界，至少覆盖以下主线能力：

- `mission.projection.get`
- `mission.session.get`
- `workflow.graph_instance_snapshot`
- `aigc_monitoring.instances`
- `aigc_monitoring.instance_detail`
- `aigc_monitoring.session_detail`
- `web_aigc.risk_action_catalog`

这说明 `internal_api` 不再只是临时桥接，而是已经具备主仓级别的可复用目标目录与最小治理闭环。

## Route 入口收紧结果

本轮可以确认的入口收紧重点如下：

- 多个入口对 `context`、`workflowId`、`stage`、`version`、`delegateAgentId`、`maxSkills`、`metadata` 的透传口径已经对齐。
- `skills`、`guest-agents`、`a2a auto-agent` 三条入口不再各自维护完全分裂的执行参数模型。
- 当前主线重点已经从“再增加多少条 route”转向“已有 route 是否共享同一执行语义和治理语义”。

## 审计与可观测元数据收紧结果

当前可以保守确认的事实包括：

- `auto-agent` 已围绕 `kind`、`targetId`、`workflowId`、`delegatedAgent`、`targetLabel` 等关键语义收紧元数据。
- `internal_api` 已具备 `permissionEngine`、`auditLogger` 与 `fallback` 的最小闭环。
- `tools-and-agents` 主线已经开始以统一元数据而不是零散日志的方式沉淀执行证据。

需要明确保留的边界如下：

- 现阶段可以确认“最小审计元数据闭环成立”，但不宜表述为“全链路 observability 已一次性统一完成”。
- 现阶段可以确认“统一执行入口已经收口”，但不宜表述为“所有后续节点都已自动接入同等深度的治理能力”。

## 本轮中文 docs/specs 同步口径

本轮文档同步建议统一使用以下中文表述：

- `auto-agent` 已成为统一执行入口。
- `skills` 与 `guest-agents` 已并入同一 dispatch 链。
- `internal_api` 已形成最小可复用闭环。
- 审计元数据已收紧，但最终完成数、测试总数、整体完成率仍待主线锁版后回填。

## 仍待后续主线继续推进的尾项

- 把本轮已收紧的审计元数据进一步并入更统一的 runtime observability 口径。
- 继续核对 `tools-and-agents` 相关节点与 platform 治理面的字段一致性。
- 在最终锁版前统一回填进度 summary、SVG 和测试汇总数字。
