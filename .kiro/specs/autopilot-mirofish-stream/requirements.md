# MiroFish 流式卡片 — 需求文档

## 背景

`/autopilot` 蓝图驾驶舱右栏当前已经形成"阶段卡片 + 子时间线"的二分结构：

```
┌───────────────────── 阶段卡片（input / clarification / route / fabric.spec_tree / ...） ─────────┐
│                                                                                                   │
│  顶部：驻留 UI                                                                                    │
│    - input：用户输入 textarea + 创建按钮                                                          │
│    - clarification：ClarificationPanel + 提交按钮                                                 │
│    - route：路线列表 + 选择按钮                                                                    │
│    - spec_tree：SpecTreeWorkbench（含双 CTA + 节点行展开预览）                                    │
│    - effect_preview / prompt_packaging / engineering_handoff / artifact_memory：各自专门面板      │
│                                                                                                   │
│  ─────────────────────────────────                                                                │
│                                                                                                   │
│  子时间线：<AgentReasoningSubTimeline stageFilter="..." />                                        │
│    - 仅显示 role.agent.{thinking, acting, observing, completed, error} 五种 entry                 │
│    - 双轨布局：thought 在左，act+observation 在右                                                  │
│                                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

这个结构有三个问题，使整体右栏体验偏离 MiroFish 流式心智：

1. **事件类型不全**。子时间线只承载 reasoning（thinking/acting/observing），但用户在阶段
   卡片底部其实更想看到一条**完整的时间序列流**：路线被选中 → SPEC 树某节点完成 →
   capability 调用 → 产物落库 → 决策提交。这些事件目前散落在不同位置（路线选中后
   只能看右上方 stage 切换；节点完成藏在 SpecTreeWorkbench 行展开里；capability 调用
   藏在 CapabilityRail；产物没暴露在阶段卡片里）。
2. **二分结构造成两套阅读节奏**。用户先看驻留 UI 顶部的最新状态，再扫底部子时间线
   看历史事件——这两段视觉权重相当且互不连贯，窄宽度（右栏 ~360px）下尤其拥挤。
3. **窄宽度不友好**。AgentReasoningSubTimeline 是双轨（grid-cols-[1fr_2px_1fr]），左右
   两轨在窄宽度下挤压严重，长 thought / observation 文本被截。

MiroFish 流式心智（参考你之前 commit `24a4f0b` "rewrite right rail as MiroFish streaming
card layout"）：**所有事件按时间序以紧凑卡片追加到一条流里，每张卡片自包含、单纵向轨道、
无双轨切分、宽度可弹性收缩**。本 spec 把"子时间线"升级为这种 **MiroFishCardStream**，
并把驻留 UI 改造为流式区上方的"锚点"——视觉上形成一条从顶部驻留 UI 流向底部的连续
卡片流。

## 主线约束（必须遵守）

- **driving 真相源不变**：仍由 `useBlueprintRealtimeStore.agentReasoning.entries` /
  `capabilityStatuses` / `agentProgress` 等 slice 驱动；不引入新 store。
- **后端事件目录可以扩**：可以新增 1-2 类事件（`route.selected` / `spec_node.completed`
  / `artifact.created`），但必须由现有 `BlueprintEventBus.emit(...)` 单点发出，
  family 仍归现有 12 家族之一。
- **不改 shared 契约的破坏性字段**：可以在 contracts.ts 加新事件 `type`，但 enum 必须保
  留旧值，避免破坏 events.test.ts / index-barrel.test.ts。
- **驻留 UI 不被压缩成单卡**：input / clarification / route / spec_tree 这五个阶段顶部
  仍是大型驻留 UI（输入框 / ClarificationPanel / 路线列表 / SpecTreeWorkbench），
  R-1 路径（全部卡片化）显式不在范围内。
- **既有 5140+ 测试不能破坏**。`AgentReasoningSubTimeline` 单测现保留 19 个，
  本次重构应保留其外部 API（`stageFilter` prop）兼容性，让既有挂载点（intake_created /
  clarification / route / fabric stages）改动最小。
- **TS 基线 116 不上升**。
- **不引入 @testing-library/react / jsdom / happy-dom**。所有新增前端测试沿用本仓的
  `react-dom/server` SSR + `vi.mock` 策略。

## 用户故事

### Story 1：所有重要事件出现在同一条流里

**作为** `/autopilot` 用户，
**我希望** 在阶段卡片底部看到一条统一的时间序列流，里面同时包含 LLM reasoning、节点完成、
路线决策、能力调用、产物落库这些事件，
**因为** 我现在看 reasoning 在子时间线，看节点完成要进 SpecTreeWorkbench 行展开，看能力
调用要扫右栏底部 CapabilityRail，事件分散让我无法一眼追踪进度。

### Story 2：流式卡片紧凑且窄宽度友好

**作为** `/autopilot` 用户，
**我希望** 每张事件卡片在 360px 右栏宽度下都能完整展示标题 / 摘要 / 时间戳，不被截断也
不再用双轨左右切分，
**因为** 我用的是 1280px 笔记本，右栏宽度有限，长文本经常被截。

### Story 3：驻留 UI 与流共存

**作为** `/autopilot` 用户，
**我希望** 阶段卡片顶部仍能看到我能直接操作的输入框 / 选项（澄清表单、路线列表、
SPEC 树工作台），不要把这些操作藏到流式卡片里点开才能用，
**因为** 主动操作（输入目标、作答澄清、选路线）需要立即可见可操作，不能要我先点开
一张"等你作答"卡片。

### Story 4：阶段过滤一致性

**作为** `/autopilot` 用户，
**我希望** 每个阶段卡片底部的流只显示属于该阶段的事件，与现在 `<AgentReasoningSubTimeline
stageFilter="..." />` 的语义一致，
**因为** 阶段卡折叠为已完成状态后我仍想能回看该阶段当时发生过什么，不希望看到下一阶段
的事件溢入。

### Story 5：流式追加可见

**作为** `/autopilot` 用户，
**我希望** 新事件到达时通过卡片从底部追加 + 短暂高亮 fade-in 让我感知"刚发生"，
**因为** 在没有视觉反馈时长时间静止流容易被误判为系统卡死。

## 验收准则（EARS 格式）

### AC1：MiroFishCardStream 接管子时间线挂载点

THE 系统 SHALL 用一个新组件 `MiroFishCardStream` 取代既有 `AgentReasoningSubTimeline`
的所有挂载点。`AgentReasoningSubTimeline` 文件保留并继续 export，由它内部委托给
`MiroFishCardStream`，保持外部 API（`locale` / `stageFilter` prop）兼容。

`MiroFishCardStream` 单纵向轨道（`flex flex-col`），不再使用双轨 grid-cols 布局。

### AC2：统一 entry 类型

THE 系统 SHALL 引入统一的 `MiroFishStreamEntry` 联合类型，至少包含以下 6 类：

```ts
type MiroFishStreamEntry =
  | { kind: "reasoning"; phase: AgentReasoningPhase; ... }    // 来自 agentReasoning.entries
  | { kind: "node_completed"; nodeId: string; nodeTitle: string; documentTypes: string[]; ... } // SPEC 节点文档完成
  | { kind: "route_decision"; routeId: string; routeTitle: string; ... }                        // 路线选中
  | { kind: "capability_invocation"; capabilityId: string; status: "invoking" | "completed" | "failed"; ... }
  | { kind: "artifact_created"; artifactId: string; artifactType: string; title: string; ... }
  | { kind: "system_note"; tone: "info" | "warning"; message: string; ... };               // 占位 / fallback
```

每类 entry 必须带 `id`（稳定，便于去重）、`stageId`（用于 stageFilter 过滤）、
`timestamp`（ISO 字符串）。

### AC3：派生函数

THE 系统 SHALL 实现一个纯函数 `deriveMiroFishStreamEntries({ agentReasoning,
capabilityStatuses, capabilityInvocations, artifacts, routeSelection, specDocumentEvents })`
把多个 store slice 与 job artifact 派生成 `MiroFishStreamEntry[]`，按 `timestamp`
升序，自动按 `id` 去重。

派生函数必须容忍 slice / artifact 缺失（store 初始空态、SSR mock 部分注入）；缺失时
跳过该类 entry 不抛错。

### AC4：阶段过滤

THE `MiroFishCardStream` SHALL 接受可选 `stageFilter: string | readonly string[]` prop
（语义与既有 `AgentReasoningSubTimeline` 一致）。当 stageFilter 提供时，仅显示
`entry.stageId` 匹配 filter 的条目；缺失 stageId 的条目视为"全局事件"继续显示。

### AC5：每类 entry 一张紧凑卡片

THE 系统 SHALL 为每个 `kind` 提供独立 SSR 友好的卡片渲染器：
- `ReasoningCard`（替代既有双轨布局）
- `NodeCompletedCard`
- `RouteDecisionCard`
- `CapabilityInvocationCard`
- `ArtifactCreatedCard`
- `SystemNoteCard`

每张卡片 SHALL：
- 单纵向布局，max-width: 100%，可在 360px 宽度下完整渲染
- 顶部一行：icon + 类型标签（Reasoning / Node / Route / Capability / Artifact / System） +
  时间戳（HH:MM:SS）
- 主体一行或两行：核心内容（thought 截断 ≤ 160 字符 / nodeTitle / routeTitle / 等）
- 状态色：tone 由 entry kind + 内部状态决定（success / info / warning / danger / neutral）

### AC6：驻留 UI 不被改动

THE 阶段卡片顶部的驻留 UI SHALL 保持现状不变：
- input：textarea + "创建输入记录"按钮
- clarification：ClarificationPanel + "刷新澄清"按钮
- route：路线列表 + "选择路线"按钮（合并的 route_generation + route_selection 卡片）
- fabric.spec_tree：SpecTreeWorkbench（顶部双 CTA + 节点行展开）
- 其它 fabric 子阶段：各自既有面板

仅在驻留 UI 下方挂 `MiroFishCardStream`。

### AC7：后端事件补齐（最小集）

THE 后端 SHALL 在以下时机 emit 新事件，让前端 `deriveMiroFishStreamEntries` 能拿到原始
数据：

- 路线选择确认（`POST /jobs/:jobId/route-selection` 成功后）：emit
  `route.selected` 事件，含 `routeId / routeTitle / stageId="route_selection"`。
- SPEC 节点文档完成（`spec-docs-llm-generation.ts` 已经在 `emitter?.observing(...)`
  发文案，本 spec 不替换它，但**追加**结构化事件 `spec_node.completed` 含
  `nodeId / nodeTitle / documentTypes / generationSource`。
- 产物落库（artifact 写入 job.artifacts 时）：emit `artifact.created` 事件，含
  `artifactId / artifactType / title / stageId`（取自当前 stage）。

这三个事件类型加入 `BlueprintEventName` enum，归到 `family` 现有家族中（不新增家族）。

不强制把 `capability.invoked / capability.completed / capability.failed` 改造——
它们已经在 `capabilityStatuses` slice 里，派生函数直接读 store 即可。

### AC8：实时追加体验

WHEN 新 entry 到达，THE `MiroFishCardStream` SHALL 在卡片入场时使用 fade-in（透明度
0 → 1，duration ~200ms）让用户感知"刚发生"。`prefers-reduced-motion` 时不做动画。

整体流自动 scroll 到底部跟踪最新条目，与现有 `AgentReasoningSubTimeline` 行为一致。

### AC9：去重与稳定性

THE `deriveMiroFishStreamEntries` SHALL 按 `id` 去重；对同一 `id` 的多次输入，取最后
一次为准（与 capabilityStatuses 的 status 推进语义一致）。

排序按 `timestamp` 升序；timestamp 相同的 entries 维持插入顺序（stable sort）。

### AC10：保持既有 SubTimeline 测试

THE 既有 `AgentReasoningSubTimeline.test.tsx` / `StoreObservabilityHud.test.tsx` 中
对挂载位置 + stageFilter 接受 string | readonly string[] 的断言 SHALL 全部保留通过。
组件文件 `AgentReasoningSubTimeline.tsx` 保留 export，但内部委托给
`MiroFishCardStream`。

## 不在范围内（非目标）

- 不改 mission-first 任务壳（`/tasks` 路径下的 sandbox 终端、wall 任务卡片不动）
- 不做 3D 场景联动（PetWorkers / MissionIsland / SceneStageFlow / SandboxMonitor 中区都
  保留现状；进入下一个 spec `autopilot-scene-fusion` 处理）
- 不重构驻留 UI（输入框 / ClarificationPanel / SpecTreeWorkbench / 路线列表 都不改）
- 不引入新 socket / 不改 socket-relay 协议
- 不强制把 capability 事件转换成 reasoning entry——它们仍以 capabilityStatuses 切片为
  真相源，派生函数读 slice
- 不破坏既有 capability bridges 的 totalInvocations 累加（`runtime-enablement/diagnostics-store`
  对 capability.invoked / completed / failed 的统计逻辑保留）

## 风险与边界

- **派生函数性能**：MiroFishCardStream 每次 render 都 `useMemo(deriveMiroFishStreamEntries(...))`。
  当 agentReasoning.entries 累积到几百条 + capability invocations 几十条时单次派生 O(N+M)。
  实测可接受（既有 AgentReasoningSubTimeline 也是每渲染过一遍 entries），但要避免在派生
  函数里做 O(N²) 操作。
- **后端新事件影响 capability bridge 计数**：本 spec 新增 `route.selected` / `spec_node.completed` /
  `artifact.created` 三个事件。这些事件的 `family` 必须落到现有 12 家族里，不能让
  `runtime-enablement/subscriber.ts` 中按 family 统计 totalInvocations 的逻辑误把它们计入
  capability 桥的调用次数。建议：`route.selected` 归 `route` family；`spec_node.completed` 归
  `spec_tree` family；`artifact.created` 归 `artifact` family（现有 family 已涵盖）。
- **同 jobId 重复订阅时事件去重**：`BlueprintRealtimeStore.subscribe(jobId)` 在 jobId 不变时
  不重置切片（spec autopilot-streaming-experience integration-gap-2026-05-16 P0 #2
  已确认）。本 spec 派生函数按 entry.id 去重，所以重连后事件回放不会造成卡片重复。
- **AgentReasoningSubTimeline 文件保留但变成 thin wrapper**：未来如果想完全废弃，可以
  让所有挂载点直接用 `MiroFishCardStream`；本 spec 不强制做这一步以保留兼容路径。
