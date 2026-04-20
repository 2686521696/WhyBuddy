# 回放与调试面收口方案 v1

## 目标

保留高价值的回放能力，同时把低频调试能力从主导航中迁走，避免继续干扰主流程。

## 当前状态（2026-04-20）

- 本 spec 当前完成度约 `88%`
- `/replay/:missionId` 与回放主界面已稳定存在，任务详情页也已提供“查看回放”入口
- `/debug` 隐藏壳页已落地，当前承接 `overview / config / permissions / audit / lineage`
- `config / permissions / audit` 已从 `MoreDrawer` 统一导向 `/debug/*`，旧 `/lineage` 路径也已降级为跳转到 `/debug/lineage`
- `help` 说明入口也已并入 `/debug/help`，`MoreDrawer` 的低频入口现已统一导向 `/debug/*`
- 当前剩余缺口主要是 `/debug/*` 与旧深链跳转的一轮人工回归

## 范围

本轮覆盖：

- `/replay/:missionId`
- 隐藏 `/debug` 面
- lineage / audit / permission / config 等低频能力的归口策略

不覆盖：

- 回放引擎彻底重写
- lineage 复杂产品化
- 权限模型扩展
- 在主壳路由尚未定稿前，强行与主导航同步切换所有低频入口

## 必须满足

- `/replay/:missionId` 继续可用
- 回放必须围绕任务主线展示
- 低频调试能力不再占用主导航
- `/debug` 成为内部入口，不面向普通用户暴露
- 若 `/debug` 路由壳已由主壳 spec 预留，本 spec 必须复用该壳而不是重新定义一套路由语义
- lineage、audit、permission、config 等低频能力必须有落点，但不再抢主线
- 旧 `lineage` 深链允许只保留兼容跳转，只要主承接面已经收口到 `/debug`

## 体验要求

- 普通用户默认只感知首页与回放
- 调试能力只在需要时进入
- 回放页面必须能证明“系统真的在干活”

## 验收标准

- 回放页仍可从任务完成后进入
- 主导航不再暴露大量低频页面
- debug 面可以承接低频内部工具
- `/lineage` 旧深链进入后会兼容跳转到 `/debug/lineage`
- 不与主壳收敛 spec 在 `App.tsx` / `Toolbar.tsx` 上形成长期并行冲突
