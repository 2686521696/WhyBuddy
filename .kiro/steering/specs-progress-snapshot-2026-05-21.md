---
inclusion: auto
---

# Specs 全量进度快照（2026-05-21）

## 统计口径

- 统计范围：`.kiro/specs` 目录下所有 spec 的 `tasks.md`
- 统计方式：仅统计 `- [x]` 与 `- [ ]` 行，不区分缩进层级
- 本次扫描时间：2026-05-21

## 总体数字

| 维度 | 数值 |
| ---- | ---- |
| Spec 目录总数 | `275` |
| 已完成 (done) | `205` |
| 部分完成 (partial) | `43` |
| 未开始 (todo) | `26` |
| 无 tasks.md | `1` |
| 总 checklist 项 | `8218` |
| 已勾选项 | `7133` |
| 未勾选项 | `1085` |
| 整体完成率 | `86.8%` |

## 分类统计

| 分类 | Spec 数 | Done | Partial | Todo | 任务项完成率 |
| ---- | ------- | ---- | ------- | ---- | ------------ |
| `web-aigc-node-*` | 52 | 52 | 0 | 0 | `239/239 (100%)` |
| `web-aigc-platform-*` | 6 | 6 | 0 | 0 | `34/34 (100%)` |
| `blueprint-*` | 13 | 13 | 0 | 0 | `342/342 (100%)` |
| `project-*` (Project-first) | 10 | 10 | 0 | 0 | `123/123 (100%)` |
| `ui-redesign-*` | 11 | 8 | 3 | 0 | `410/418 (98.1%)` |
| `autopilot-*` | 63 | 50 | 10 | 3 | `2536/2613 (97.1%)` |
| `ue-*` (Unreal Engine) | 20 | 5 | 1 | 14 | `155/480 (32.3%)` |
| 核心与其他 | 100 | 61 | 29 | 10 | `3294/3969 (83%)` |

## 已封板基线（100% 完成）

以下分类已全部完成，不再作为推进目标：

- **Web-AIGC 节点层**：`52/52` specs，`239/239` 任务项
- **Web-AIGC 平台层**：`6/6` specs，`34/34` 任务项
- **Blueprint 系列**：`13/13` specs，`342/342` 任务项
- **Project-first 系列**：`10/10` specs，`123/123` 任务项

## 近完成分类（>95%）

- **UI Redesign**：`8/11` done，3 个 partial，完成率 `98.1%`
- **Autopilot 系列**：`50/63` done，10 个 partial，3 个 todo，完成率 `97.1%`

## 未启动分类

### UE (Unreal Engine) 系列：14 个 todo

全部为 `0%` 完成，属于远期规划：

- `ue-camera-system`、`ue-director-prompt-system`、`ue-event-callback-system`
- `ue-fallback-and-degradation`、`ue-interaction-passthrough`
- `ue-local-resource-and-session-governance`、`ue-mobile-lite-viewer`
- `ue-multi-user-session-isolation`、`ue-performance-profiling-and-quality-tier`
- `ue-realtime-narration`、`ue-recording-and-replay-export`
- `ue-scene-asset-pipeline`、`ue-shot-list-planner`、`ue-state-sync-bridge`

### 平台级远期规划：6 个 todo

- `production-deployment`、`multi-user-office`、`multi-tenant-architecture`
- `multi-region-disaster-recovery`、`k8s-agent-operator`、`edge-brain-deployment`

### 其他未启动

- `agent-marketplace-platform`（87 项）
- `admin-audit-and-support-operations`（15 项）
- `i18n-cleanup`（30 项）
- `vr-extension`（75 项）

## 进行中重点 specs（partial，按优先级）

### 核心体验主线

| Spec | 进度 | 说明 |
| ---- | ---- | ---- |
| `task-runtime-visibility-v1` | 114/118 | 运行证据归口，接近收尾 |
| `office-task-cockpit` | 18/21 | 办公室驾驶舱主壳 |
| `office-shell-convergence-v1` | 24/28 | 壳层路由收口 |
| `task-os-home-redesign-v1` | 26/30 | 首页四区骨架 |
| `release-stability-guardrails-v2` | 25/35 | CI 与恢复能力 |
| `office-cockpit-first-screen-refresh` | 15/18 | 首屏风格重构 |
| `office-wall-display-redesign-v2` | 32/41 | 墙面显示器重构 |
| `office-home-performance-stability` | 28/32 | 首页性能稳定性 |

### Autopilot 进行中

| Spec | 进度 | 说明 |
| ---- | ---- | ---- |
| `autopilot-llm-spec-generation` | 60/66 | LLM spec 生成 |
| `autopilot-right-rail-narrative-swiper` | 28/37 | 右栏叙事滑块 |
| `autopilot-stage-progress-indicator` | 18/24 | 阶段进度指示器 |
| `autopilot-streaming-doc-renderer` | 15/22 | 流式文档渲染 |
| `autopilot-mirofish-card-diversity` | 16/21 | Mirofish 卡片多样性 |
| `autopilot-workbench-stage-rhythm` | 13/18 | 工作台阶段节奏 |
| `autopilot-llm-react-loop-inline` | 11/13 | LLM React 循环内联 |
| `autopilot-streaming-lifecycle-weave` | 17/18 | 流式生命周期编织 |

### 历史尾项

| Spec | 进度 | 说明 |
| ---- | ---- | ---- |
| `mission-runtime` | 66/74 | 历史遗留补测 |
| `state-persistence-recovery` | 19/36 | 浏览器端长任务恢复 |
| `nl-command-center` | 103/104 | 自然语言指挥中心 |
| `cross-framework-export` | 21/30 | 跨框架导出 |

## 与既有 steering 口径的对比变化

### Web-AIGC（无变化）

既有 steering 口径：`58/58 specs，238/238 顶层任务`
当前实际：`58/58 specs，273/273 任务项`（含子任务统计口径略有差异，但全部 done）

结论：**维持封板口径不变**。

### Task Autopilot Phase 1（无变化）

既有 steering 口径：`18/18 specs，345/345 顶层任务，602/602 raw checklist`
当前实际：原 18 份 task-autopilot specs 全部 done。

结论：**维持封板口径不变**。

### Autopilot 前端体验落地 specs（新增进展）

既有 steering 口径（2026-04-26）：12 份前端体验 specs 已创建
当前实际：`autopilot-*` 系列已扩展到 63 个 specs，其中 50 个 done，10 个 partial，3 个 todo。

结论：**需要更新 steering 中 autopilot 系列的进度口径**。

### Blueprint 系列（新增完成）

既有 steering 未单独记录 blueprint 系列。
当前实际：`13/13` specs 全部完成，`342/342` 任务项。

结论：**需要在 steering 中补录 blueprint 系列封板事实**。

### Project-first 系列（新增完成）

既有 steering 口径（2026-04-30）：9 份 specs 已创建
当前实际：`10/10` specs 全部完成，`123/123` 任务项。

结论：**需要更新 project-first 进度为已封板**。

### UE (Unreal Engine) 系列（新增规划）

既有 steering 未记录 UE 系列。
当前实际：20 个 specs，仅 5 个 done，14 个 todo，完成率 32.3%。

结论：**需要在 steering 中补录 UE 系列为远期规划**。

### UI Redesign 系列（新增进展）

既有 steering 未单独记录 UI redesign 系列。
当前实际：11 个 specs，8 个 done，3 个 partial，完成率 98.1%。

结论：**需要在 steering 中补录 UI redesign 系列接近完成**。

## 建议的 steering 更新动作

1. `project-overview.md`：更新项目规模数字（275 specs / 8218 任务项 / 86.8% 完成率）
2. `project-overview.md`：补录 Blueprint、UE、UI Redesign 系列的存在与状态
3. `task-autopilot-phase-1-closure-2026-04-26.md`：无需修改，口径仍然成立
4. `web-aigc-58-plan-progress-summary-2026-04-22.md`：无需修改，封板口径仍然成立
5. `project-first-spec-roadmap-2026-04-30.md`：更新为 `10/10` 已完成
6. 新建本文件作为最新全量快照

## 下一阶段推进建议

基于当前数据，推荐优先级：

1. **收尾核心体验主线**：`task-runtime-visibility-v1`、`office-task-cockpit`、`office-shell-convergence-v1` 距离完成最近
2. **收尾 autopilot partial 项**：10 个 partial 中多数接近完成（如 `autopilot-streaming-lifecycle-weave` 17/18）
3. **不急于启动 UE 系列**：14 个 todo 属于远期规划，当前无环境支撑
4. **不急于启动平台级远期项**：`production-deployment`、`multi-tenant-architecture` 等待环境就绪
