# MiroFish 流式卡片 — 设计文档

## 总览

```
┌──── 阶段卡片（举例：fabric.spec_tree active）──────────────────────────┐
│                                                                         │
│  顶部：驻留 UI（本 spec 不改）                                          │
│    ┌──────────────────────────────────────────────────────────────┐   │
│    │ <SpecTreeWorkbench>                                          │   │
│    │   - 顶部双 CTA：[生成整棵树文档] [生成当前节点文档]            │   │
│    │   - 节点行列表 + chip + 行展开预览                              │   │
│    └──────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ─────────────────────────────────────                                  │
│                                                                         │
│  底部：MiroFishCardStream(stageFilter=["spec_tree","spec_docs"])        │
│    ┌────────────────────────────────────────────────────────────┐     │
│    │ 💭 reasoning · #1 · 13:42:05                                │     │
│    │    "正在分析路线节点结构以派生 SPEC 树..."                   │     │
│    └────────────────────────────────────────────────────────────┘     │
│    ┌────────────────────────────────────────────────────────────┐     │
│    │ ⚡ acting · #1 · 13:42:06                                   │     │
│    │    → llm.spec_tree_derivation                               │     │
│    └────────────────────────────────────────────────────────────┘     │
│    ┌────────────────────────────────────────────────────────────┐     │
│    │ 👁 observing · #1 · 13:42:08                                │     │
│    │    ✓ SPEC 树派生完成：4 个节点（model=gpt-5）                 │     │
│    └────────────────────────────────────────────────────────────┘     │
│    ┌────────────────────────────────────────────────────────────┐     │
│    │ 🌳 node_completed · 13:42:18  ✓ Auth Module                 │     │
│    │    requirements / design / tasks · llm                       │     │
│    └────────────────────────────────────────────────────────────┘     │
│    ┌────────────────────────────────────────────────────────────┐     │
│    │ 🔧 capability · 13:42:21  invoking                           │     │
│    │    aigc-spec-node                                            │     │
│    └────────────────────────────────────────────────────────────┘     │
│    ┌────────────────────────────────────────────────────────────┐     │
│    │ 📦 artifact · 13:42:30  spec_document                        │     │
│    │    Auth Module / requirements                                │     │
│    └────────────────────────────────────────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 模块结构

```
                     ┌──────────────────────────────┐
                     │  AutopilotRoutePage          │
                     │  / AutopilotRightRail        │
                     │  + 既有阶段卡片               │
                     └──────────────┬───────────────┘
                                    │
                                    ▼ 替换 AgentReasoningSubTimeline
                     ┌──────────────────────────────┐
                     │  MiroFishCardStream          │
                     │  - 单纵向轨道                 │
                     │  - stageFilter: string[]      │
                     │  - 实时 fade-in               │
                     │  - 自动 scroll-to-bottom      │
                     └──────────────┬───────────────┘
                                    │ 渲染按 kind 分发
                ┌───────────────────┼───────────────────┬─────────┐
                ▼                   ▼                   ▼         ▼
        ┌──────────────┐    ┌──────────────┐   ┌──────────┐  ┌────────┐
        │ ReasoningCard│    │NodeCompleted │   │  Capa-   │  │ ...    │
        │              │    │ Card         │   │ bility   │  │        │
        └──────────────┘    └──────────────┘   └──────────┘  └────────┘
                                    ▲
                                    │
                     ┌──────────────────────────────┐
                     │ deriveMiroFishStreamEntries  │
                     │ 纯函数，PBT 友好              │
                     │ 输入：6 个 store slice / 派生 │
                     │ 输出：MiroFishStreamEntry[]   │
                     └──────────────┬───────────────┘
                                    │ 读 store slice
                ┌───────────────────┼───────────────────┬───────────┬───────────┐
                ▼                   ▼                   ▼           ▼           ▼
        agentReasoning      capabilityStatuses    capability     artifacts   route /
        .entries            (map)                 Invocations    (job.       node 派生
                                                  (list)         artifacts)
```

## 数据模型

```ts
// shared/blueprint/agent-reasoning.ts 已经定义 AgentReasoningEntry / AgentReasoningPhase。
// 本 spec 不动它们；只在前端 client/src/pages/autopilot/right-rail/mirofish-stream/
// 加新 union 类型。

export type MiroFishStreamEntryKind =
  | "reasoning"
  | "node_completed"
  | "route_decision"
  | "capability_invocation"
  | "artifact_created"
  | "system_note";

export type MiroFishStreamTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export interface MiroFishStreamEntryBase {
  /** 稳定 id，用于 React key + 派生函数去重。 */
  id: string;
  kind: MiroFishStreamEntryKind;
  /** 用于 stageFilter 过滤；缺失视为全局事件。 */
  stageId?: string;
  /** ISO timestamp，用于稳定排序。 */
  timestamp: string;
  /** 视觉色调；由 kind + 内部 status 派生。 */
  tone: MiroFishStreamTone;
}

export interface MiroFishReasoningEntry extends MiroFishStreamEntryBase {
  kind: "reasoning";
  phase: AgentReasoningPhase;     // thinking | acting | observing | completed | error
  iterationLabel: string;          // "#1" / "#2"
  thought?: string;                // ≤ 280 chars (sanitized upstream)
  actionToolId?: string;
  observationSummary?: string;
  observationSuccess?: boolean;
  reason?: string;
  error?: string;
}

export interface MiroFishNodeCompletedEntry extends MiroFishStreamEntryBase {
  kind: "node_completed";
  nodeId: string;
  nodeTitle: string;
  /** 该节点已生成 / 已完成的 BlueprintSpecDocumentType 列表。 */
  documentTypes: ReadonlyArray<"requirements" | "design" | "tasks">;
  /** 多数派 generationSource：llm / fallback / template。 */
  generationSource?: "llm" | "fallback" | "template";
}

export interface MiroFishRouteDecisionEntry extends MiroFishStreamEntryBase {
  kind: "route_decision";
  routeId: string;
  routeTitle: string;
  reason?: string;
  /** 该路线在 RouteSet 中是 primary 还是 alternative。 */
  routeKind?: "primary" | "alternative";
}

export interface MiroFishCapabilityInvocationEntry extends MiroFishStreamEntryBase {
  kind: "capability_invocation";
  capabilityId: string;
  status: "invoking" | "completed" | "failed";
}

export interface MiroFishArtifactCreatedEntry extends MiroFishStreamEntryBase {
  kind: "artifact_created";
  artifactId: string;
  artifactType: string;            // BlueprintGenerationArtifactType
  title: string;
}

export interface MiroFishSystemNoteEntry extends MiroFishStreamEntryBase {
  kind: "system_note";
  message: string;
  /** 主要用于"流为空 + 流量异常"等占位场景。 */
  hint?: string;
}

export type MiroFishStreamEntry =
  | MiroFishReasoningEntry
  | MiroFishNodeCompletedEntry
  | MiroFishRouteDecisionEntry
  | MiroFishCapabilityInvocationEntry
  | MiroFishArtifactCreatedEntry
  | MiroFishSystemNoteEntry;
```

## 派生函数

```ts
// client/src/pages/autopilot/right-rail/mirofish-stream/derive-mirofish-stream-entries.ts

export interface DeriveMiroFishStreamEntriesInput {
  agentReasoning: ReadonlyArray<AgentReasoningEntry>;
  capabilityStatuses: Record<string, CapabilityStatus>;
  capabilityInvocations: ReadonlyArray<BlueprintCapabilityInvocation>;
  /** job.artifacts；从 BlueprintGenerationJob 派生。 */
  artifacts: ReadonlyArray<BlueprintGenerationArtifact>;
  /** 路线选择（如果 job.artifacts 中已经存在 route_selection artifact，从中读）。 */
  routeSelection: BlueprintRouteSelection | null;
  /** specTree 节点元数据（用 nodeId 反查 nodeTitle）。 */
  specTree: BlueprintSpecTree | null;
}

export function deriveMiroFishStreamEntries(
  input: DeriveMiroFishStreamEntriesInput
): MiroFishStreamEntry[];
```

派生顺序（先各类各转成 entries，再合并 + 去重 + 排序）：

```
agentReasoning.entries
  → MiroFishReasoningEntry[]
  - id 直接复用 entry.id
  - stageId 直接复用 entry.stageId（已经在上一波 wave 中由后端 emit 时塞入）
  - tone：thinking/acting → "info"，observing(success=true) → "success"，
          observing(success=false)/error → "warning|danger"，completed → "success"

capability invocations / capabilityStatuses
  → MiroFishCapabilityInvocationEntry[]
  - 优先使用 capabilityInvocations（带 timestamp / capabilityId / status / stageId）
  - 退化用 capabilityStatuses（map）：每条 status 派生一个 entry，但 timestamp 只能用 now
    （这种情况下不进入 stream，避免造成"刚才才发生"的错觉）
  - tone：invoking → "info"，completed → "success"，failed → "danger"

job.artifacts
  → MiroFishArtifactCreatedEntry[]
  - id = artifact.id
  - timestamp = artifact.createdAt
  - title = artifact.title
  - artifactType = artifact.type
  - stageId 派生：spec_tree → "spec_tree"，spec_documents → "spec_docs"，
                  effect_preview → "effect_preview"，prompt_package → "prompt_packaging"，
                  agent_crew → "agent_crew_fabric"，route_set → "route_generation"，
                  route_selection → "route_selection" / "route"

routeSelection
  → MiroFishRouteDecisionEntry（最多 1 条）
  - id = `route-decision-${selection.id}`
  - timestamp = selection.selectedAt
  - stageId = "route_selection"

specTree.nodes 与 spec_documents artifacts 联动
  → MiroFishNodeCompletedEntry[]
  - 用 deriveSpecDocumentTreeStats(job, specTree) 算每节点的 documents
  - 当节点的 generated == 3（全部完成）时派生一条 node_completed entry
  - id = `node-completed-${nodeId}`
  - timestamp = 该节点最后一份 doc 的 createdAt
  - stageId = "spec_docs"
  - documentTypes = ["requirements", "design", "tasks"]
  - generationSource = 多数派（与 deriveSpecTreeChip 同样规则）

合并：
  1. 数组合并
  2. 按 id 去重（后到的覆盖先到的）
  3. 按 timestamp 升序排序（stable）
  4. 跳过非法 timestamp（NaN / undefined）—— 派为 system_note + tone=warning 落到流末尾
```

派生函数遵守：
- 纯函数，无副作用
- 所有输入容忍 undefined / null / 空数组
- O(N+M)，无嵌套循环

## 组件结构

```
client/src/pages/autopilot/right-rail/mirofish-stream/
├── derive-mirofish-stream-entries.ts          # 纯派生函数
├── mirofish-stream-types.ts                   # entry union + tone 类型
├── MiroFishCardStream.tsx                     # 主组件，挂在阶段卡片底部
├── cards/
│   ├── ReasoningCard.tsx                      # kind="reasoning"
│   ├── NodeCompletedCard.tsx                  # kind="node_completed"
│   ├── RouteDecisionCard.tsx                  # kind="route_decision"
│   ├── CapabilityInvocationCard.tsx           # kind="capability_invocation"
│   ├── ArtifactCreatedCard.tsx                # kind="artifact_created"
│   └── SystemNoteCard.tsx                     # kind="system_note"
└── __tests__/
    ├── derive-mirofish-stream-entries.test.ts
    ├── MiroFishCardStream.test.tsx
    ├── ReasoningCard.test.tsx
    ├── NodeCompletedCard.test.tsx
    ├── RouteDecisionCard.test.tsx
    ├── CapabilityInvocationCard.test.tsx
    └── ArtifactCreatedCard.test.tsx
```

## MiroFishCardStream 组件契约

```ts
interface MiroFishCardStreamProps {
  locale?: AppLocale;
  /**
   * 阶段过滤；与既有 AgentReasoningSubTimeline 同语义。
   * 不传时显示所有 entry（含缺失 stageId 的）。
   */
  stageFilter?: string | readonly string[];
}

export const MiroFishCardStream: FC<MiroFishCardStreamProps>;
```

内部实现：

```tsx
const MiroFishCardStream: FC<MiroFishCardStreamProps> = ({ locale = "zh-CN", stageFilter }) => {
  // 6 路 store slice 订阅
  const agentReasoning = useBlueprintRealtimeStore(s => s.agentReasoning.entries);
  const capabilityStatuses = useBlueprintRealtimeStore(s => s.capabilityStatuses);
  // capabilityInvocations / artifacts / routeSelection / specTree 也从既有 store / job
  // 派生层取（与现有 AutopilotRightRail.activeSubStage 取数路径一致）

  const allEntries = useMemo(
    () => deriveMiroFishStreamEntries({
      agentReasoning,
      capabilityStatuses,
      capabilityInvocations: ...,
      artifacts: ...,
      routeSelection: ...,
      specTree: ...,
    }),
    [agentReasoning, capabilityStatuses, ...]
  );

  // stageFilter 归一化（同 AgentReasoningSubTimeline）
  const filterSet = stageFilter === undefined
    ? undefined
    : new Set(typeof stageFilter === "string" ? [stageFilter] : stageFilter);

  const visibleEntries = useMemo(
    () => allEntries.filter(e => {
      if (filterSet && e.stageId && !filterSet.has(e.stageId)) return false;
      return true;
    }),
    [allEntries, filterSet]
  );

  // 自动 scroll
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [visibleEntries.length]);

  if (visibleEntries.length === 0) return null;

  return (
    <div data-testid="mirofish-card-stream" className="flex flex-col gap-2 max-h-[420px] overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
      {visibleEntries.map(entry => <MiroFishCard key={entry.id} entry={entry} locale={locale} />)}
      <div ref={bottomRef} />
    </div>
  );
};
```

`MiroFishCard` 是分发组件：

```tsx
const MiroFishCard: FC<{ entry: MiroFishStreamEntry; locale: AppLocale }> = ({ entry, locale }) => {
  switch (entry.kind) {
    case "reasoning": return <ReasoningCard entry={entry} locale={locale} />;
    case "node_completed": return <NodeCompletedCard entry={entry} locale={locale} />;
    case "route_decision": return <RouteDecisionCard entry={entry} locale={locale} />;
    case "capability_invocation": return <CapabilityInvocationCard entry={entry} locale={locale} />;
    case "artifact_created": return <ArtifactCreatedCard entry={entry} locale={locale} />;
    case "system_note": return <SystemNoteCard entry={entry} locale={locale} />;
  }
};
```

## 卡片样式约定

每张卡片统一布局（确保窄宽度可读）：

```
┌──────────────────────────────────────────────┐
│ {icon} {label}    {timestampHHMMSS}           │ ← 顶部行：icon + 类型 + 时间，h=20px
│ {body row 1：核心内容，single-line truncate}    │
│ {body row 2：补充摘要（可选），line-clamp-2}    │
└──────────────────────────────────────────────┘
```

icon / tone 映射：

| kind | icon | tone (默认) |
|---|---|---|
| reasoning(thinking) | 💭 | info |
| reasoning(acting) | ⚡ | info |
| reasoning(observing, success) | 👁 | success |
| reasoning(observing, fail) | 👁 | warning |
| reasoning(completed) | ✓ | success |
| reasoning(error) | ⚠ | danger |
| node_completed | 🌳 | success |
| route_decision | 🛣 | info |
| capability_invocation(invoking) | 🔧 | info |
| capability_invocation(completed) | 🔧 | success |
| capability_invocation(failed) | 🔧 | danger |
| artifact_created | 📦 | neutral |
| system_note(info) | ℹ | neutral |
| system_note(warning) | ⚠ | warning |

tone 决定 chip / 边框颜色（沿用 `derive-spec-tree-chip.ts` 的 `ChipTone` 调色）。

## AgentReasoningSubTimeline 兼容路径

保留 `client/src/pages/autopilot/right-rail/AgentReasoningSubTimeline.tsx` 文件 + export。
内部改为 thin wrapper：

```tsx
// AgentReasoningSubTimeline.tsx（重写）
export const AgentReasoningSubTimeline: FC<AgentReasoningSubTimelineProps> = ({ locale, stageFilter }) => {
  return <MiroFishCardStream locale={locale} stageFilter={stageFilter} />;
};
```

既有 19 个 SubTimeline / StoreObservabilityHud 测试中关于 `stageFilter` / mount 位置 / 实时
事件的断言保持通过；不通过的部分（双轨布局相关 class、grid-cols-[1fr_2px_1fr] 字符串
断言）按 R-2 重构现实更新断言到新单纵向轨道。

## 后端补齐事件

```
shared/blueprint/contracts.ts
  - BlueprintEventName 加 3 个值：route.selected / spec_node.completed / artifact.created
  - BlueprintEventFamily 不变，沿用 route / spec_tree / artifact 现有家族

shared/blueprint/events.ts
  - 注册 3 个事件名 → family 映射

server/routes/blueprint.ts
  - selectRouteForSpecTree(...) 中：emit "route.selected" 事件
    after `const selection: BlueprintRouteSelection = { ... };`
  - buildSpecTreeFromRouteSet(...) 不动；spec_node.completed 由 spec-docs-llm-generation
    路径补
  - 任何 `job.artifacts.push(...)` 调用点附近：emit "artifact.created" 事件

server/routes/blueprint/spec-docs-llm-generation.ts
  - 在 emitter?.observing(true, "✓ ${node.title} — 规格文档已生成") 之后追加
    eventBus.emit({ id: ..., type: "spec_node.completed", jobId, family: "spec_tree",
                    stage: "spec_docs", payload: { nodeId, nodeTitle: node.title,
                    documentTypes: ["requirements", "design", "tasks"], generationSource } })

server/tests/blueprint-routes.test.ts / blueprint-socket-relay.test.ts / events.test.ts
  - 增 3 个事件名的注册断言；不破坏既有事件枚举测试
```

注意：本 spec 不让 capability bridges totalInvocations 计入新事件。`runtime-enablement/subscriber.ts` 通过
`type.startsWith("capability.")` 识别 capability 事件；新事件 `route.selected` /
`spec_node.completed` / `artifact.created` 都不以 `capability.` 起，自动隔离。

## 测试策略

### 档 1：纯函数 PBT（高度密集）
- `derive-mirofish-stream-entries.test.ts`
  - 至少 12 个用例覆盖：
    - 6 类 entry 各自能从 input 派生出来
    - id 去重（后到覆盖先到）
    - timestamp 排序
    - 缺失 input slice 不抛错（传 undefined / 空数组）
    - stageId 派生（artifact.type → stageId 映射表全覆盖）
    - node_completed 仅在 3 份 docs 都齐时派生
    - source 多数派折算（template > fallback > llm）

### 档 2：每张卡片 SSR 渲染（每张 5-6 用例）
- `ReasoningCard.test.tsx`：5 phase × 状态色组合
- `NodeCompletedCard.test.tsx`：3 source × tone 组合
- `RouteDecisionCard.test.tsx`：primary / alternative
- `CapabilityInvocationCard.test.tsx`：invoking / completed / failed
- `ArtifactCreatedCard.test.tsx`：artifact_type 列表
- `SystemNoteCard.test.tsx`：info / warning

### 档 3：MiroFishCardStream 集成（mock store）
- `MiroFishCardStream.test.tsx`：
  - 空态返回 null
  - 6 类 entry 同时存在时全部按 timestamp 渲染
  - stageFilter string / readonly string[] 两种形态
  - 阶段事件溢出测试（spec_docs 事件不出现在 clarification stageFilter 下）
  - SSR markup 不含 grid-cols-[1fr_2px_1fr]（验证不再双轨）

### 档 4：兼容既有 SubTimeline / StoreObservabilityHud 测试
- 现有测试更新：
  - `AgentReasoningSubTimeline.subtimeline-mount.test.tsx`：保留挂载点 + stageFilter
    断言；删除"双轨布局"具体 class 字符串断言（如有）
  - `StoreObservabilityHud.test.tsx`：`<AgentReasoningSubTimeline>` 引用计数 6 处不变
    （因为本 spec 不改 AutopilotRoutePage 中的 AgentReasoningSubTimeline 挂载位置）

## 落地分波

```
Wave 0（pure 派生 + 卡片基础）：
  - 新建 deriveMiroFishStreamEntries 纯函数 + 12 单测
  - 新建 6 个卡片组件 + 各自 SSR 测试
  - MiroFishCardStream 主组件 + 集成测试
  - 不挂载到任何阶段卡片，feature flag 关

Wave 1（接管挂载点）：
  - 把 AgentReasoningSubTimeline 改为 thin wrapper → 委托 MiroFishCardStream
  - 既有挂载点（intake_created / clarification / route / fabric stages）零改动，
    通过 wrapper 自动获得新流式视觉
  - 更新既有 19 个 SubTimeline / StoreObservabilityHud 测试断言

Wave 2（后端事件补齐）：
  - shared 加 3 个事件名 + family 映射
  - server 在 selectRouteForSpecTree / spec-docs-llm-generation / artifact emit 路径补 emit
  - server 测试更新

Wave 3（手动验证 + commit + spec status）：
  - 硬刷 /autopilot 跑一次完整 input → fabric 流
  - 验证：6 类卡片在不同阶段卡底部按时间序追加
  - 整理 commit 与 spec 完成状态
```

## 不变项

- mission-first 任务壳路由 / wall-mounted SandboxMonitor 中区不动
- 阶段卡片驻留 UI（textarea / ClarificationPanel / 路线列表 / SpecTreeWorkbench）不动
- AutopilotRoutePage 主结构 / RAIL_SUB_STAGE_ORDER 不动
- TS 基线 116 不上升
- 既有 5140+ 测试通过率不下降

## 风险

- **派生函数复杂度**：6 路 input 合并 → 性能有上限。如果 entries 累积到 1000+，
  考虑在 Wave 4 加 windowing 截断（按 timestamp 取最近 200 条）。本 spec 不做。
- **卡片 emoji 在某些操作系统下不一致**：Windows / Linux / macOS 渲染 💭 ⚡ 👁 🌳 🛣 🔧
  📦 ℹ ⚠ 等 emoji 字形差异较大，可能影响视觉一致性。如果反馈强烈，可在 Wave 5
  改用 lucide-react icon。本 spec 沿用 emoji（与既有 AgentReasoningSubTimeline 一致）。
- **fade-in 动画**：spring 动画在 reduced-motion 下要降级；CSS 默认 transition 即可，
  不引入 framer-motion。
