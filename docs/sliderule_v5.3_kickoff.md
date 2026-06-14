# SlideRule V5.3 · 开工计划（给接手的执行 Agent）

> 你接手的是 #4「多角色/自主执行在 Flow 上可见化」。**P1 数据底座已由前一位完成并提交**，你从 **P2** 开始。
> 三份文档配套读：本文件（开工指引）→ [架构方案](./sliderule_v5.3_flow_visibility.md)（设计 + 图 + 原理）→ [任务清单](./sliderule_v5.3_tasks.md)（逐条勾的 P0–P6）。

---

## 0. 现状（开工前你已拥有什么）
已合入 main（commit `57422987` + `dabf07b7`）：
- ✅ **ReasoningEvent 模型**：`shared/blueprint/sliderule-reasoning-events.ts`（类型 + `sanitizeReasoningText` + `makeEvent`/`makeEventSequence` + `foldEventsForOverview` + `eventsByRun`），5 测试绿。
- ✅ **数据流贯通**：`V5SessionState.reasoningEvents?`；执行器接口 + `RawExecutorResult` 带 `events?`；drive 已把 `exec.events`（绑定 `runId=${loopTurnId}-run-${i}`）合并进 `state.reasoningEvents`；**模拟器已对每个 cap 产确定性事件**（`buildSimulatedReasoningEvents`，无 LLM 也有思考链）；持久化截断最近 200 条。
- ✅ tsc 0；fullpath/交付/replay/events 全绿、零回归。

**含义**：现在每跑一轮，`state.reasoningEvents` 已经有绑定到各 capability run 的有序思考步（来自模拟器）。**投影/UI 还没用它**——那就是你 P3/P4/P5 要做的。P2 是把模拟事件升级成"后端真实事件"。

---

## 1. Day 0 · 环境与基线（30 分钟，必须先做）
```bash
git checkout main && git pull
git checkout -b feat/sliderule-v5.3-p2-emit       # 每个 Phase 一条分支(或一条长分支分段提交,团队定)
pnpm install                                       # 如需
pnpm exec tsc --noEmit                             # 必须 0 错(若非 0,先停下排查,别在红基线叠加)
pnpm run verify:sliderule-v5                       # 必须全绿
```
确认基线绿后再写代码。读完三份文档的 §对应章节再动手。

**红线（每条都不可破）**：
1. 不改裁决语义（gates / commitArtifact / coverageGate / G-ROOT / 调度）。所有新增是事件/投影/UI 叠加。
2. 新字段只追加、不改旧义；消费方必须处理 `reasoningEvents` undefined。
3. 文案脱敏：emit 出去的 `text` 一律过 `sanitizeReasoningText`（禁 G_*/T_*/DLEDGER/baseline/F*_）。
4. 不 `git add -A`：只 add 本 Phase 自己改的文件。
5. **不新增 LLM 调用**：事件从"已有的一次 LLM 响应"里拆阶段 + 确定性补充，绝不是每条事件一次调用（用户单 key，预算敏感）。
6. critique/role/step 边用 **非 `depends_on`** 类型（否则触发 G-ROOT-2 单父校验）。

---

## 2. 你的第一刀 · P2.1（后端 panel 真实事件）—— 手把手
**目标**：让多角色面板执行时，除了写 `payload.panel`，**额外返回 `events`**（role_position / role_critique / panel_converge），覆盖模拟事件。

**改 `server/sliderule/deliberation-exec-map.ts` 的 `runPanelSession`**（产出 `payload.panel = {positions, critiques, convergenceScore, consensusReached, dissent}` 处）：
```ts
import { makeEventSequence } from "../../shared/blueprint/sliderule-reasoning-events.js";

// 在已算出 panel 数据后,组装 events(runId/turnId/capabilityId 从入参取):
const steps = [
  { kind: "capability_start" as const, text: "多角色面板开始评估", roleId: "综合" },
  ...positions.map((p) => ({
    kind: "role_position" as const,
    roleId: String(p.v5Role || p.roleId || "角色"),
    text: String(p.content || "").slice(0, 200),
  })),
  ...(critiques || []).map((c) => ({
    kind: "role_critique" as const,
    roleId: String(c.fromRole || c.roleId || "挑刺"),
    targetRoleId: String(c.targetRole || ""),
    text: String(c.content || "").slice(0, 200),
  })),
  {
    kind: "panel_converge" as const,
    roleId: "综合",
    text: `收敛分 ${convergenceScore?.toFixed?.(2) ?? "—"} · ${consensusReached ? "已共识" : "有分歧"}`,
    meta: { convergenceScore, consensusReached, dissent },
  },
];
const events = makeEventSequence(
  { turnId, capabilityRunId: runId, capabilityId },   // ← 用该 cap 执行的真实 runId(与 commit 节点一致!)
  steps
);
return { /* ...existing title/summary/content/payload... */, events };
```
> ⚠️ **runId 必须对**：events 的 `capabilityRunId` 必须等于该次执行 commit 时的 `capabilityRunId`，否则投影挂不上。确认 deliberation 执行入口能拿到这个 runId（route 传入或 `${turnId}-run-${i}`），拿不到就从 route 层透传下来。

**改 `server/routes/sliderule.ts` execute-capability 响应**：把 exec 的 `events` 原样放进 JSON（与 title/summary/content/payload 并列）。client 的 `createServerLlmCapabilityProvider` 已透传 res.json() 全字段，drive 已合并——所以**只要响应里有 events，链路就通了**。

**验证 P2.1**：
- 扩 `server/sliderule/__tests__/deliberation-exec-map.test.ts`：给 panel 输入 → 返回 `events` 含 ≥1 `role_position` + 1 `panel_converge`，`meta.convergenceScore` 正确，text 不含禁词。
- `pnpm exec tsc --noEmit` 0。
- 提交（message 注明 P2.1 + 验证）。

然后按任务清单做 P2.2（synthesis 转发 panel events）→ P2.3（dialogue gap.ask/clarify emit think/observe）→ P2.4（fallback）→ P2.5（route 透传，若 2.1 已做则确认）→ P2.6（统一脱敏）。

---

## 3. 推进节奏（P2 之后）
| Phase | 一句话 | 依赖 | 关键文件 |
|---|---|---|---|
| **P2** 后端 emit | panel/dialogue/fallback 产真实 events + route 透传 | P1✅ | deliberation-exec / dialogue-exec / capability-llm-fallback / routes/sliderule |
| **P3** 协作视图 | panel events → 默认展开角色立场 + 质疑边 + 收敛裁决 | P1✅P2 | expand-projection-nodes(`expandPanelRoleChildren`) / derive-reasoning-view-model |
| **P4** 思考链视图 | think/observe/tool events → cap 节点下子步链；overview 折叠角标 | P1✅P2 | expand-projection-nodes(`expandReasoningChain` 新增) / derive-reasoning-view-model |
| **P5** UI | 三态切换 + 渲染新节点/边 + streaming 子步节拍 + 点击详情 | P3+P4 | SlideRuleTopHud / SlideRule.tsx / ReasoningFlowSurface / TurnRouteTimeline |
| **P6** 打磨收尾 | 边界/空态/文档/DoD 核对/自审/合并 | P5 | — |

P3 与 P4 都只依赖 P1+P2，**可并行**；P5 依赖二者。每 Phase：写代码 → 该 Phase 验证 → `verify:sliderule-v5` 不回归 → 提交。

---

## 4. 每个 Phase 的收尾动作（固定模板）
```bash
pnpm exec tsc --noEmit                 # 0
pnpm exec vitest run <本 Phase 测试>    # 绿
pnpm run verify:sliderule-v5           # 不回归
git add <仅本 Phase 文件>               # 不要 -A
git commit -m "feat(sliderule): V5.3 P<n> ...（含验证结果）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
卡住超过一个来回排不动，就把现象 + 你的判断写清楚回报，不要在红基线上硬叠。

---

## 5. 验收（全部做完，合并前对照）
逐条核对 [架构方案 §11 DoD](./sliderule_v5.3_flow_visibility.md) 八条 + [任务清单「全局验收门」](./sliderule_v5.3_tasks.md)。重点 5 条：
1. collaboration **默认**显示多角色立场 + 质疑边 + 收敛裁决。
2. reasoning 显示每能力思考链子步；overview = 现状 + 角标。
3. 三态瞬时切换、记忆；streaming 实时点亮；点击查看详情 + 证据回跳。
4. 无 LLM 下有确定性思考链/模拟立场；全程脱敏；旧会话兼容。
5. **未新增 LLM 调用**；critique/step 边非 `depends_on`，G-ROOT 不破。

---

## 6. 最快上手路径（TL;DR）
1. `git pull` → 切分支 → `tsc` + `verify` 确认绿基线。
2. 扫一眼 [架构方案 §2 现状审计](./sliderule_v5.3_flow_visibility.md)（知道每个文件干嘛）。
3. 直接做 §2 这里的 **P2.1**（panel emit events + route 透传 + 测试 + 提交）。
4. 然后照 [任务清单](./sliderule_v5.3_tasks.md) 一条条 `[ ]→[x]` 往下，P3/P4 可并行，P5 收口。
5. 任意 Phase 跑通后用真实应用（server-llm）走一遍复杂目标，眼见为实。

有疑问先读三份文档；文档与代码冲突以**代码为准**并在对应 Phase 注明偏差。开工顺利。
