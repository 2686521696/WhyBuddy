# 办公室主壳收敛方案 v1

## 目标

把当前“多入口实验平台”收敛为“一个任务操作系统壳”。

本轮的主目标不是继续扩展页面，而是让用户打开首页后可以自然进入唯一主流程：

输入一句话 -> 生成计划 -> 执行任务 -> 人工决策 -> 查看日志与结果 -> 回放

## 当前状态（2026-04-20）

- 本 spec 已进入收口阶段，当前完成度约 `97%`
- 首页 `/`、任务工作台 `/tasks`、任务详情 `/tasks/:taskId`、回放 `/replay/:missionId`、隐藏调试面 `/debug` 均已落地
- `/command-center` 已改为跳转首页，`Toolbar` 主导航已收敛为 `office / more`
- `config / permissions / audit` 已从 `MoreDrawer` 收口到 `/debug/config`、`/debug/permissions`、`/debug/audit`
- `/lineage` 已降级为兼容跳转，主承接面改为 `/debug/lineage`；`/command-center/legacy` 也已收口为纯兼容跳转
- `help` 说明入口也已并入 `/debug/help`，`MoreDrawer` 的低频治理入口现已统一导向隐藏调试面
- 当前剩余主要是 `/debug/*` 与兼容深链的一轮人工回归

## 范围

本轮只覆盖前端桌面主入口和路由层收敛，包括：

- `/`
- `/tasks`
- `/tasks/:taskId`
- `/command-center`
- `/command-center/legacy`
- `/debug`
- `/lineage`
- 顶部/底部导航
- 低频页面的可见性与降权策略

不在本轮范围内：

- 后端 API 协议重写
- 所有低频工具在同一轮内全部物理迁移完成
- 多租户
- K8s
- VR
- 移动端全量重设计

## 必须满足

- 首页 `/` 成为唯一默认入口
- `/command-center` 不再作为独立主流程入口
- `/command-center/legacy` 不再保留主导航或高频可见入口；当前允许仅以兼容 redirect 壳形式暂存
- `/tasks` 明确降级为“查看 / 跟进 / 深度处理”的全屏工作台，不再承担“发起任务”的主入口职责
- `/tasks/:taskId` 保留深链能力
- `/replay/:missionId` 保留附属能力
- `/debug` 可以先以隐藏壳路由或占位页落地，但普通用户不可见
- `/lineage` 从主导航中移除，不再作为高频入口
- 所有主导航、快捷入口、按钮文案都必须围绕“任务主线”收敛；低频能力允许先通过 `More` 或兼容 redirect 降权，后续再继续收口到 `/debug`

## 体验要求

- 新用户打开首页后，不需要理解“办公室 / 任务台 / 指挥中心”的区别
- 用户不应在多个页面之间寻找“从哪里输入指令”
- 低频能力必须降权到隐藏入口或 debug 面，而不是继续占据主导航
- 当前已有深链不要求全部删除，但必须从主入口中退场

## 兼容要求

- 可以保留 `/tasks/:taskId` 与 `/replay/:missionId` 的现有路径
- 可以保留 `/lineage` 兼容路由，但主承接面应收口为 `/debug/lineage`
- 可以先预留 `/debug` 路由壳，低频能力的完整内容迁移允许在后续 spec 中完成
- 旧页面如暂时保留，必须通过 redirect、兼容壳或明确“已降级”策略处理

## 验收标准

- `App.tsx` 中主路由数量显著减少
- `Toolbar` 和导航配置不再强化多入口心智
- 首页可承接任务发起、澄清、执行追踪三件核心事情
- `/tasks` 的角色定义在路由、文案与入口层保持一致
- 新用户在 10 秒内可以知道系统的唯一入口是首页
