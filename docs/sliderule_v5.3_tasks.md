# SlideRule V5.3 · 执行任务清单（#4 Flow 可见性）

> 配套 [sliderule_v5.3_flow_visibility.md](./sliderule_v5.3_flow_visibility.md)。本文件是**可勾选的细粒度任务清单**，按 Phase 顺序执行。
> 约定：每个任务 = 一次明确改动；`[ ]` 未做 / `[x]` 完成。每个 Phase 结束跑该 Phase 的「验证」并提交一次。
> 全程红线：不改裁决语义（gates / commitArtifact / coverageGate / G-ROOT）；新增字段只追加不改旧义；文案脱敏。

---

## 通用命令（每 Phase 复用）
```bash
pnpm exec tsc --noEmit                                   # 必须 0 错
pnpm exec vitest run --config vitest.config.server.ts <server/shared 测试...>   # 后端/共享
pnpm exec vitest run <client 测试...>                    # 前端
pnpm run verify:sliderule-v5                             # 全回归(收尾 Phase 必跑)
```
提交：`git add <仅本 Phase 文件>`（不要 `git add -A` 误带他人 WIP）→ commit，message 注明 Phase + 验证结果，结尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## P0 · 准备（30 分钟）
- [ ] **P0.1** 从最新 `main` 切分支：`git checkout main && git pull && git checkout -b feat/sliderule-v5.3-flow-visibility`
- [ ] **P0.2** 基线确认：`pnpm exec tsc --noEmit`（0 错）+ `pnpm run verify:sliderule-v5`（全绿）。若不绿，先停下报告，别在红基线上叠加。
- [ ] **P0.3** 通读 `sliderule_v5.3_flow_visibility.md` §2 现状审计 + §13/§14，定位以下真实文件并确认存在：`deliberation-exec-map.ts`、`dialogue-exec-map.ts`、`expand-projection-nodes.ts`、`derive-reasoning-view-model.ts`、`ReasoningFlowSurface.tsx`、`SlideRuleTopHud.tsx`、`TurnRouteTimeline.tsx`、`v5-reasoning-state.ts`、`sliderule-projection-persist.ts`。
- [ ] **P0.4** 确认 `evaluateGraphRootGates`（`sliderule-runtime.ts`）只校验 `depends_on` 边（决定 critique 边类型必须 ≠ `depends_on`）。在任务笔记里记下结论。

---

## P1 · 数据底座：ReasoningEvent 模型 + 透传（无 UI）

### 类型与工具（shared）
- [ ] **P1.1** 新建 `shared/blueprint/sliderule-reasoning-events.ts`：定义 `ReasoningEventKind`、`ReasoningEvent`（字段见规格 §4.1）。
- [ ] **P1.2** 同文件加 `sanitizeReasoningText(text: string): string`：移除/替换内部 token（G_*, T_*, DLEDGER, baseline, F1_/F2_ sourceTag → "外部检索"）。禁词集从 `assertRouteCopySanitized` 抽取为共享常量 `FORBIDDEN_INTERNAL_TOKENS`，两处共用。
- [ ] **P1.3** 同文件加 `foldEventsForOverview(events: ReasoningEvent[]): { think: number; observe: number; tool: number; role: number }`（overview 角标用）。
- [ ] **P1.4** 同文件加 `eventsByRun(state): Map<string, ReasoningEvent[]>`（按 capabilityRunId 分组并按 `order` 排序）。
- [ ] **P1.5** 同文件加 `makeEvent(partial): ReasoningEvent` 工厂（补 id=`${runId}-ev-${order}`、ts、跑 sanitize）。

### STATE / 执行器接口（追加字段）
- [ ] **P1.6** `shared/blueprint/v5-reasoning-state.ts`：`V5SessionState` 追加 `reasoningEvents?: ReasoningEvent[]`（import 类型；写注释"投影源，可截断，向后兼容可选"）。
- [ ] **P1.7** 执行器结果类型追加 `events?: ReasoningEvent[]`：`server/sliderule/capability-exec-map.ts` 的 `RawExecutorResult`，以及 `sliderule-runtime.ts` 里 `CapabilityExecutor` 接口 + `LlmCapabilityExecutor`/`PilotRealCapabilityExecutor`/`DefaultCapabilityExecutor` 的返回类型（与现有 `payload?` 并列追加）。

### drive 合并 + 模拟器补事件（runtime，不动 gates）
- [ ] **P1.8** `sliderule-runtime.ts` drive 主循环（现 `exec.payload` 合并处，约 4360 行附近）：把 `exec.events`（执行器返回的、已绑定 runId/order）追加进 `working.reasoningEvents`。注意 runId 用该轮 `${loopTurnId}-run-${i}`，与 capability 节点 `capabilityRunId` 一致。
- [ ] **P1.9** `sliderule-runtime.ts` 模拟器 `DefaultCapabilityExecutor.executeCapability`：对每个 cap 产 2-3 条确定性事件（capability_start + 1-2 think/observe + capability_complete），保证无 LLM 也有思考链。gap.ask 复用 #1 已有的 clarifyQuestions 文案做 think。
- [ ] **P1.10** `sliderule-projection-persist.ts` `stripProjectionForPersist`：`reasoningEvents` 截断到最近 N=200 条（更早的丢弃或折叠计数），避免持久化体积膨胀。

### 验证 P1
- [ ] **P1.V1** 新测 `shared/blueprint/__tests__/sliderule-reasoning-events.test.ts`：类型构造、`sanitizeReasoningText` 去禁词、`foldEventsForOverview` 计数、`eventsByRun` 分组排序。
- [ ] **P1.V2** runtime 单测（加到现有 fullpath 或新文件）：模拟器跑一个 turn 后 `state.reasoningEvents` 非空，每条 `capabilityRunId` 能在 `state.capabilityRuns` 找到。
- [ ] **P1.V3** `pnpm exec tsc --noEmit` 0 错；既有 `verify:sliderule-v5` 全绿（events 可选不影响旧断言）。
- [ ] **P1.C** 提交 P1。

---

## P2 · 后端真实 emit（panel + dialogue + fallback）

- [ ] **P2.1** `deliberation-exec-map.ts` `runPanelSession`：返回结果加 `events`——每个 `positions[i]` → `role_position`（roleId/text）；每个 `critiques[i]` → `role_critique`（roleId=fromRole, targetRoleId=targetRole, text）；收敛 → `panel_converge`（meta: convergenceScore/consensusReached/dissent）。order 递增。
- [ ] **P2.2** `deliberation-exec-map.ts` `runSynthesisMerge`：若消费 panel，转发同样的 panel events（或在合并产出处 emit `panel_converge`）。
- [ ] **P2.3** `dialogue-exec-map.ts`（gap.ask / intent.clarify / route.* / question.expand）：在 LLM 调用前后 emit `capability_start` → `think`（"正在理解目标…"）→（若检索）`observe`/`tool_call` → `capability_complete`。文案取自现有 THINKING/OBSERVING/COMPLETED 语义。
- [ ] **P2.4** `capability-llm-fallback.ts`：降级路径 emit 1-2 条 think 事件，meta 标注"模板兜底"，保证降级也有过程。
- [ ] **P2.5** `server/routes/sliderule.ts` execute-capability 响应：把 exec 的 `events` 原样放进 JSON（与 title/summary/content/payload 并列）。
- [ ] **P2.6** server emit 前统一过 `sanitizeReasoningText`（在 exec-map 出口或 route 出口集中做一次）。

### 验证 P2
- [ ] **P2.V1** `server/sliderule/__tests__/deliberation-exec-map.test.ts` 扩展：panel 输入 → 返回 events 含 ≥1 `role_position` + 1 `panel_converge`，`meta.convergenceScore` 透传正确。
- [ ] **P2.V2** dialogue / fallback exec-map 测试：返回 events 首 `capability_start`、末 `capability_complete`。
- [ ] **P2.V3** route 测试（`sliderule.execute-capability.test.ts`）：响应含 `events` 数组。
- [ ] **P2.V4** 脱敏测试：构造含禁词的 text，断言 emit 后不含。
- [ ] **P2.V5** tsc 0 + 相关 server 套件绿。
- [ ] **P2.C** 提交 P2。

---

## P3 · 多角色辩论投影（collaboration 视图）

- [ ] **P3.1** `expand-projection-nodes.ts` `expandPanelRoleChildren`：加参数 `{ defaultExpanded: boolean }`；collaboration 模式默认展开 positions → `::role-{roleId}` 节点（保留 `MAX_PANEL_ROLES`）。
- [ ] **P3.2** 同函数：用 `role_critique` 事件（或 payload.critiques）生成**角色间边**，`type: "challenges"`（**非 `depends_on`**，规避 G-ROOT-2），label "质疑"，source/target 为对应 role 子节点 id。
- [ ] **P3.3** verdict 子节点升级：展示 `convergenceScore`（如"收敛 0.82"）+ 共识/异议（dissent 列表），文案脱敏。
- [ ] **P3.4** `derive-reasoning-view-model.ts`：新增 `viewMode: "overview"|"collaboration"|"reasoning"` 入参；collaboration 模式调用上面默认展开；输出 critique 边、角色配色（复用 `roleIdToDisplayLabel` + 现有 role 色板）给 surface。

### 验证 P3
- [ ] **P3.V1** 投影单测 `reasoning-chain-projection.test.ts`（新）：给含 panel events 的 state + `viewMode:"collaboration"`，输出含 N 个 role_position 节点 + ≥1 `challenges` 边 + 1 verdict（含 convergenceScore）。
- [ ] **P3.V2** G-ROOT 不变量测试仍过（`fullpath-invariants` / knife-b-projection 不回归）；确认 `challenges` 边不进 `depends_on` 单父校验。
- [ ] **P3.V3** 向后兼容：`reasoningEvents` undefined / 无 panel 时，collaboration 模式退回基础 turn 视图，不报错。
- [ ] **P3.C** 提交 P3。

---

## P4 · 思考链投影（reasoning 视图）

- [ ] **P4.1** `expand-projection-nodes.ts` 新增 `expandReasoningChain(parent, events)`：把某 cap 的 think/observe/tool/subtask 事件按 order 展成子步节点链（`type: "reasoning_step"`，挂在该 cap 节点下，边 `type: "step"` 非 `depends_on`）。
- [ ] **P4.2** `derive-reasoning-view-model.ts` `reasoning` 模式：对每个 capability 节点调用 `expandReasoningChain`；`overview` 模式调用 `foldEventsForOverview` 把事件折成节点角标（如 `💭3 · 🔍2`），节点数回到 turn 视图水平。
- [ ] **P4.3** 节点上挂渲染所需字段（投影内部类型）：`eventKind`、`roleStance`、`convergence`、`overviewBadge`。

### 验证 P4
- [ ] **P4.V1** 投影单测：reasoning 模式下 cap 节点子步数 == 该 run 的 think/observe/tool 事件数；overview 模式节点数 == turn 视图节点数且带角标。
- [ ] **P4.V2** 切换 viewMode 是纯函数：同一 state 三次调用三模式，`state` 引用不变（不 mutate）。
- [ ] **P4.V3** tsc 0 + 投影套件绿。
- [ ] **P4.C** 提交 P4。

---

## P5 · UI（三态切换 + 渲染 + 实时节拍）

- [x] **P5.1** `SlideRuleTopHud.tsx`：简/详二态控件 → `overview/collaboration/reasoning` 三态分段控件；持久化（扩展 `PROJECTION_DENSITY_STORAGE_KEY` 或新 key `SLIDERULE_VIEWMODE_KEY`）。
- [x] **P5.2** `SlideRule.tsx`：读取 viewMode state，透传给 `deriveSlideRuleReasoningViewModel` + `ReasoningFlowSurface`；沉浸 + 分栏两布局都接。
- [x] **P5.3** `ReasoningFlowSurface.tsx`：渲染新节点/边——
  - `role_position`：角色色块（角色名 + 立场摘要）。
  - `challenges` 边：虚线箭头 + "质疑" 标。
  - verdict：收敛分徽章（≥0.7 绿 / 否则琥珀）+ 异议折叠。
  - `reasoning_step`：小圆点链（think/observe/tool 图标区分），点击展开完整 text（`MarkdownRenderer`）。
  - overview 角标：cap 节点角落显示 `foldEventsForOverview` 计数。
- [x] **P5.4** `TurnRouteTimeline.tsx`：streaming 时把当前 cap 的 ReasoningEvent 按 order 实时追加为子步；静态时折叠为角标可展开（复用现有按轮折叠/收起交互）。
- [x] **P5.5** 点击交互：role_position / reasoning_step / verdict 节点 `onNodeClick` 弹完整内容 + `refs` 证据回跳（复用现有 `onEvidenceRefClick` / challenge）。
- [x] **P5.6**（可选）把 `role-progress-log.tsx` 作为 reasoning 模式的角色泳道侧栏并入，或新建轻量泳道组件。

### 验证 P5
- [x] **P5.V1** 组件测（SSR `renderToStaticMarkup`，仿 `turn-route-timeline-fold.test.tsx`）：collaboration 渲染出角色立场块 + "质疑" 边标 + 收敛徽章；reasoning 渲染思考子步；overview 渲染角标。
- [x] **P5.V2** 三态切换不丢状态（mock viewMode 切换，断言渲染对应模式）。
- [x] **P5.V3** 应用实测（dev server，server-llm）：新复杂目标 → collaboration 看到多角色辩论 → reasoning 看到思考链 → streaming 逐步点亮 → 点节点看详情/回跳。
- [x] **P5.C** 提交 P5。

---

## P6 · 打磨 + 收尾

- [x] **P6.1** 角色泳道布局 / 动效节拍 / 空态文案 / 长事件截断显示 / viewMode 记忆。
- [x] **P6.2** 边界：无 panel（简单目标）reasoning 模式仍可看单 agent 思考链；单 LLM key 下 panel 角色少时文案诚实（"轻量协作模式"）。
- [x] **P6.3** 文档：更新 `docs/sliderule_v5.2.md` 标注 V5.3 增量；勾掉 `sliderule_v5.3_flow_visibility.md` / 本清单已完成项；如实记录与规格的偏差。
- [x] **P6.V1** `pnpm run verify:sliderule-v5` 全绿 + `pnpm exec tsc --noEmit` 0。
- [x] **P6.V2** 对照规格 §11 DoD 八条逐条核对（截图/录屏佐证 collaboration + reasoning + 三态 + streaming + 点击详情 + 无 LLM 兜底 + 脱敏 + 向后兼容）。
- [x] **P6.C** 提交 P6 → 自审 diff（`/code-review` 或人工，重点查：未改裁决语义、critique/step 边非 depends_on、reasoningEvents undefined 兼容、无禁词泄漏）→ 合并 main（`--no-ff`）。

---

## 全局验收门（合并前必须全 ✅）
- [x] tsc 0 错；`verify:sliderule-v5` 全绿；旧会话（无 reasoningEvents）兼容。
- [x] collaboration 默认显示多角色立场 + 质疑边 + 收敛裁决。
- [x] reasoning 显示每能力思考链子步；overview = 现状 turn 视图 + 角标。
- [x] 三态瞬时切换、记忆；streaming 实时点亮；点击查看详情 + 证据回跳。
- [x] 无 LLM 下有确定性思考链/模拟立场；全程文案脱敏。
- [x] **未引入额外 LLM 调用**（事件从单次响应拆解，非每条一次调用）。
- [x] critique/step 边非 `depends_on`，G-ROOT 不变量不破。

---

## 任务依赖（执行顺序）
```
P0 → P1 ──→ P2 ──→ P3 ─┐
              └──→ P4 ─┴→ P5 → P6
```
P3（协作视图）与 P4（思考链视图）都依赖 P1（数据）+ P2（emit），彼此独立、可并行；P5（UI）依赖 P3+P4。
