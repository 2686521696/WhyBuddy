# 任务清单：路线推荐与路线选择

- [x] 定义 `CandidateRoute` 的统一字段集，覆盖路线标识、路线类型、推荐理由、成本预估、时长预估、接管预估、风险等级和阶段摘要。
- [x] 定义 `最快 / 最稳 / 最深` 三类候选路线的统一产品语义，避免在不同页面或不同任务域中出现语义漂移。
- [x] 补齐路线推荐与 `task-autopilot-levels-l1-to-l5` 的映射表，明确不同自动驾驶等级下默认推荐策略与切换边界。
- [x] 设计 Route Planner 输出到前端路线卡片的投影协议，明确哪些字段来源于 planner，哪些字段由 UI 做摘要整理。
- [x] 设计默认推荐路线的判定规则，至少覆盖任务类型、风险等级、预算约束、治理要求和历史成功模式。
- [x] 设计路线推荐结果的比较模型，支持按速度、稳定性、深度、成本、时长、接管强度和风险等级横向对比。
- [x] 设计路线卡片的推荐理由模板，确保用户能理解为什么当前任务推荐“最快”“最稳”或“最深”。
- [x] 设计路线卡片的成本与时长预估表达，明确区间、档位和经验值的统一展示方式。
- [x] 设计规划期路线切换流程，支持查看候选路线、切换路线、恢复系统推荐与确认执行。
- [x] 设计执行前路线锁定规则，明确何时允许自由切换，何时必须通过确认进入锁定状态。
- [x] 设计执行期改线与重规划规则，明确用户主动改线、系统降级改线、系统重规划三类触发路径。
- [x] 设计路线切换与高风险动作的接管规则，确保预算越界、权限升级、外部副作用、风险动作命中时必须进入 HITL。
- [x] 设计路线选择结果写入任务上下文或 runtime context 的最小数据结构，避免路线只停留在前端状态。
- [x] 设计路线选择与 Mission Runtime 的对接流程，明确 runtime 如何读取 `selectedRouteId`、锁定状态和改线原因。
- [x] 设计路线相关的 replay / audit 事件，至少覆盖 `route.recommended`、`route.selected`、`route.locked`、`route.replanned`。
- [x] 设计路线相关事件的证据字段，明确触发方、触发原因、自动驾驶等级、风险上下文和最终结果映射。
- [x] 在驾驶舱信息架构中补齐路线推荐区域，明确左侧“目的地与路线”区域的布局与组件边界。
- [x] 为 `/tasks` 工作台设计路线对比与路线确认交互，确保与当前 mission-first 主工作面兼容。
- [x] 为回放页面设计“初始推荐路线 -> 最终采用路线 -> 中途改线事件”的可视化时间线。
- [x] 制定首批试点任务清单，明确哪些任务类型优先接入路线推荐与路线选择，哪些任务暂时只显示单一路线建议。

## 状态备注（2026-04-24）

- 本轮按“直接代码 + 直接测试”重新收口后，没有新增勾选，并撤回了 `11`：
  - “设计执行期改线与重规划规则”当前还不能按任务原文保守勾选。现有直接证据只稳定覆盖 `runtime_replanned` 这一条最小摘要链：`selection.status = replanned`、`selection.mode = runtime_replanned`、`route.evidence[eventType=route.replanned]`、`route.replan.{active, reason, fromRouteId, toRouteId, triggeredBy}`，以及 panel/store 对这些字段的消费与展示。
  - 但任务原文要求同时明确“用户主动改线 / 系统降级改线 / 系统重规划”三类触发路径；当前证据里虽然定义了 `user_selected` 与 `system_downgraded` 的枚举口径，但没有直接代码 + 直接测试闭环去证明这两类路径已经形成稳定的产品语义、服务端投影、前端交互与回归断言，所以这一项必须收回到未完成状态。
- 本轮按“有代码 + 有测试直接支撑”新增勾选了 `CandidateRoute` 字段口径、路线卡片投影协议、路线卡片推荐理由模板、执行前锁定规则、路线选择写回所需的最小数据结构，以及 `route.recommended / route.selected / route.locked / route.replanned` 事件口径。
- 当前仍可保守保留的两项补勾，严格按最小闭环口径确认：
  - “路线卡片的推荐理由模板”当前可按最小口径勾选：`shared/mission/autopilot.ts` 已稳定生成 `candidateRoutes[*].summary / reason / description`，`TaskAutopilotPanel` 会在 `Selected / Recommended / Alternatives` 与 `Why` 展示中消费这些字段；`shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖推荐理由的投影与展示。但这仍不是结构化文案模板系统，也尚未形成跨任务域统一的“最快 / 最稳 / 最深”文案词典。
  - “路线卡片的成本与时长预估表达”目前已由 `candidateRoutes[*].estimatedDuration / estimatedCost` 与 `TaskAutopilotPanel` 的 `ETA / Cost` 展示路径稳定承接，shared/store/panel 测试已覆盖字符串或标签级表达；但这不等于已经形成精确区间估算、经验值校准或统一预算模型。
- 当前已经可复用的事实口径主要有：
  - `route.id / label / status / progress / currentStageKey / currentStageLabel / stages / riskPoints / takeoverPointIds`
  - `route.recommendedRouteId / selectedRouteId / selectionStatus / selectionLocked`
  - `route.selection.{status, mode, locked, canSwitch, switchRequiresConfirmation, changedAt, changedBy, changedReason}`
  - `route.candidateRoutes / route.selected / route.selectedRoute`
  - `route.selected.{summary, reason, description}` / `selectedRoute.{summary, reason, description}`
  - `explanation.recommendationReasons / explanation.recommendationDetails`
  - `route.evidence.{lastEventType, lastEventAt, events[]}` / `route.replan.{active, reason, fromRouteId, toRouteId, triggeredBy}`
  - `takeover.type = route-selection`、`takeover.decisionId`、`takeover.options`
  - 前端现有 route block 已兼容读取 `route.selected.*` 与 `selectedRoute.*`，因此主线程后续落地时应优先沿这一投影口径扩展，而不是再发明一套平行命名。
- 其中“路线选择结果写入任务上下文或 runtime context 的最小数据结构”现在可以保守勾选：共享 `MissionAutopilotSummary.route` 已明确承载推荐路线、已选路线、选择状态、锁定状态、切换元数据、证据事件与重规划摘要；`shared/__tests__/mission-autopilot.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已共同覆盖推荐态、等待确认态与 runtime replanned 态的投影和消费。
- “设计执行前路线锁定规则”当前也只按最小闭环口径勾选：共享字段里已有 `selectionLocked / selection.locked / selection.canSwitch / selection.switchRequiresConfirmation` 与 `route.evidence[eventType=route.locked]`；现有 shared/store/panel 测试能区分“等待确认中的锁定态”与“runtime replanned 后的改线态”，但这仍不等于完整的规划期切换交互流已经实现。
- “设计路线卡片的成本与时长预估表达”当前也只按最小投影口径勾选：shared candidate routes 已稳定输出 `estimatedDuration / estimatedCost`，panel 能在候选路线详情和 `Route Diff` 中消费它们；但这些值目前仍主要是展示用的字符串/标签，不是统一的区间对象、相对倍率模型或可被预算治理直接消费的精算字段。
- “设计执行期改线与重规划规则”当前不能保守勾选：shared/store/panel 虽已共同区分 `recommended / alternatives-available / replanned`，并能展示 `runtime_replanned`、改线原因、前后路线和重规划证据；但“用户主动改线 / 系统降级改线 / 系统重规划”三类路径尚未形成完整交互与服务端治理规则，`system_downgraded` 也还停留在枚举口径而非真实闭环，因此这一项必须维持未完成。
- 当前仍缺失、因此不能保守勾选的关键能力有：
  - `最快 / 最稳 / 最深` 的统一产品语义与 L1-L5 映射
  - 默认推荐策略的任务类型 / 风险 / 预算 / 治理 / 历史成功模式判定规则
  - 完整的规划期切换流程，以及执行期改线后的治理 / 接管 / runtime 执行规则
  - 将上述结构真正写回 mission / runtime context 并由 Mission Runtime 消费的链路
  - replay / audit 页面如何消费这些路线事件与证据
- 当前还可以保守补勾“在驾驶舱信息架构中补齐路线推荐区域”：
  - `TaskAutopilotPanel` 已把 `Destination` 与 `Route` 作为最先展示的两个区块，形成任务详情中的最小“目标与路线”区域；
  - route 区块已直接承载当前路线、推荐路线、备选路线、阶段进度、风险点、选择状态、路线差异、重规划与路线证据；
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已覆盖 `Selected / Recommended / Alternatives / Route Diff / Selection / Replan / Route Evidence` 等核心展示语义。
- 本轮也可以保守补勾“设计路线推荐结果的比较模型”：
  - `TaskAutopilotPanel` 已基于 `route.selected / route.selectedRoute / route.candidateRoutes` 生成最小比较视图，稳定展示 `Selected / Recommended / Alternatives / Route Diff`；
  - 当前真实比较维度已经覆盖 `mode / risk / takeoverLoad / estimatedDuration / estimatedCost`，并可由 `mode` 承载“最快 / 最稳 / 最深”的最小比较入口；
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已直接断言 `Route Diff: Mode / Risk / Load / ETA / Cost`，因此当前可以认定“任务详情里的最小横向比较模型”已落地。
- 本轮还可以保守补勾“设计路线卡片的推荐理由模板”：
  - shared builder 已稳定生成 `summary / reason / description`，并在高风险或 waiting 场景下为 deep route 覆写更明确的治理型推荐理由；
  - `TaskAutopilotPanel` 已把这些字段接入 route block 的 `Selected / Recommended / Alternatives` 与 explanation block 的 `Why` 展示；
  - `shared/__tests__/mission-autopilot.test.ts`、`server/tests/mission-routes.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 已共同覆盖 builder、projection 与 panel 展示链路。
- 但这个勾选仍需严格限定边界：
  - 现状是 `TaskAutopilotPanel` 中的投影级比较模型，不等于完整 `/tasks` 工作台的多路线对比与确认交互；
  - “稳定性 / 深度” 目前主要借由 `mode`、候选路线标签与推荐理由表达，尚未形成跨任务域统一的产品语义词典。
  - 推荐理由目前仍是字符串级的 `summary / reason / description` 组合，不等于 `recommendationReason / tradeoffNotes` 一类结构化模板已经在 shared contract 中定型。

## 建议字段清单（供主线程直接落代码）

### 建议 1：优先扩展 `MissionAutopilotSummary.route`

- 建议继续沿当前 `route` 对象扩展，而不是新增顶层 `routeSelection` 平行对象。这样可以最小化对现有服务端 projection、client store fallback 和 `TaskAutopilotPanel` 的影响。
- 建议保留现有字段不动：
  - `id`
  - `label`
  - `status`
  - `progress`
  - `currentStageKey`
  - `currentStageLabel`
  - `stages`
  - `riskPoints`
  - `takeoverPointIds`

### 建议 2：补一层候选路线对象 `CandidateRoute`

建议主线程新增共享对象，最小字段如下：

```ts
type CandidateRouteKind = "fastest" | "safest" | "deepest" | "custom";
type CandidateRouteMode = "fast" | "standard" | "deep" | "custom";

type CandidateRoute = {
  routeId: string;
  routeKind: CandidateRouteKind;
  mode: CandidateRouteMode;
  title: string;
  label: string;
  summary: string;
  recommendationReason: string;
  tradeoffNotes: string[];
  estimatedDuration: {
    label: string;
    lowerBoundMs?: number;
    upperBoundMs?: number;
  };
  estimatedCost: {
    label: string;
    relativeLevel: "low" | "medium" | "high" | "unknown";
    multiplier?: number;
  };
  estimatedTakeovers: {
    label: string;
    count?: number;
    blockingCount?: number;
  };
  riskLevel: "low" | "medium" | "high" | "unknown";
  plannerScore?: number;
  phaseOutline: Array<{
    key: string;
    label: string;
    summary: string;
  }>;
  decisionPoints: Array<{
    id: string;
    label: string;
    type: string;
    blocking: boolean;
  }>;
  isRecommended: boolean;
};
```

补充说明：

- `routeKind` 是 spec 语义层，推荐直接使用 `fastest / safest / deepest / custom`。
- `mode` 是面向当前 UI 兼容层的别名，建议沿用 `fast / standard / deep / custom`，因为现有 `TaskAutopilotPanel` 已直接读取 `route.selected.mode` 并做本地化映射。
- `summary`、`recommendationReason`、`tradeoffNotes` 能直接支撑路线卡片的“一句话摘要 + 推荐理由 + 关键取舍”。
- `phaseOutline` 和 `decisionPoints` 足够小，不会把底层 DAG 直接暴露给产品层，但已经能让路线有真实差异。

### 建议 3：在 `route` 下补“推荐与选择状态”

建议主线程在 `MissionAutopilotSummary.route` 下新增：

```ts
type RouteSelectionStatus =
  | "recommended"
  | "alternatives-available"
  | "user-selected"
  | "locked"
  | "replanned";

type RouteSelectionMode =
  | "planner_default"
  | "user_selected"
  | "runtime_replanned"
  | "system_downgraded";

type RouteChangeActor = "planner" | "user" | "runtime" | "operator";
```

对应字段建议：

```ts
route: {
  // 现有字段保持不变
  recommendedRouteId: string | null;
  selectedRouteId: string;
  selectionStatus: RouteSelectionStatus;
  selectionMode: RouteSelectionMode;
  selectionLocked: boolean;
  lockReason: string | null;
  canSwitch: boolean;
  switchRequiresConfirmation: boolean;
  changedAt: string | null;
  changedBy: RouteChangeActor | null;
  changedReason: string | null;
  selected: CandidateRoute;
  candidates: CandidateRoute[];
}
```

落地建议：

- `selectedRouteId` 必须总是和 `route.selected.routeId` 对齐。
- `recommendedRouteId` 必须总是和 `route.candidates.find(candidate => candidate.isRecommended)` 对齐。
- `selectionLocked = true` 时，`selectionStatus` 应至少为 `locked` 或 `replanned`。
- `canSwitch = false` 不等于 `selectionLocked = true`，前者强调“当前不能切换”，后者强调“已进入锁定态”。

### 建议 4：为现有前端读取路径保留兼容字段

当前 `TaskAutopilotPanel` 已直接读取这些路径：

- `route.selected.mode`
- `route.selected.status`
- `route.selected.summary`
- `route.selected.reason`
- `route.selected.description`
- `route.selected.title`
- `route.selected.label`
- `route.selected.name`
- `selectedRoute.*`

因此建议主线程直接让 `route.selected` 成为 `CandidateRoute` 的兼容投影，并保留以下别名字段：

```ts
route.selected = {
  routeId,
  mode,
  status,
  title,
  label,
  name: title,
  summary,
  reason: recommendationReason,
  description: tradeoffNotes.join("; "),
  riskLevel,
  estimatedDuration,
  estimatedCost,
  estimatedTakeovers,
};
```

如果主线程需要更稳妥兼容旧消费方，也可以临时补：

```ts
selectedRoute: route.selected
```

但推荐只作为过渡别名，不要再把 `selectedRoute` 发展成独立事实源。

### 建议 5：补“锁定 / 改线 / 重规划”的最小证据字段

建议主线程在 `route` 下补一组最小证据结构：

```ts
type RouteEvidenceEventType =
  | "route.recommended"
  | "route.selected"
  | "route.locked"
  | "route.replanned";

route: {
  // ...
  evidence: {
    lastEventType: RouteEvidenceEventType | null;
    lastEventAt: string | null;
    events: Array<{
      eventType: RouteEvidenceEventType;
      at: string;
      actor: RouteChangeActor;
      reason: string | null;
      fromRouteId?: string;
      toRouteId?: string;
    }>;
  };
  replan: {
    active: boolean;
    reason: string | null;
    fromRouteId: string | null;
    toRouteId: string | null;
    triggeredBy: RouteChangeActor | null;
  };
}
```

最小闭环建议：

- 初次给出候选路线时写 `route.recommended`
- 用户确认路线时写 `route.selected`
- 启动执行并进入锁定态时写 `route.locked`
- 执行期换路或系统降级时写 `route.replanned`

### 建议 6：建议主线程先做的最小 builder 行为

如果主线程要分阶段落代码，建议最先做到下面这条最小闭环：

1. `MissionAutopilotSummary.route.selected`
   - 至少输出当前路线标题、模式、摘要、推荐理由
2. `MissionAutopilotSummary.route.candidates`
   - 至少输出 1 条默认推荐路线和 1 条备选路线
3. `MissionAutopilotSummary.route.recommendedRouteId`
4. `MissionAutopilotSummary.route.selectedRouteId`
5. `MissionAutopilotSummary.route.selectionStatus`
6. `MissionAutopilotSummary.route.selectionLocked`
7. `MissionAutopilotSummary.route.evidence.lastEventType`
8. waiting decision 命中路线确认时：
   - `takeover.type = "route-selection"`
   - `route.selectionStatus = "alternatives-available"`
   - `route.canSwitch = true`
   - `route.switchRequiresConfirmation = true`

## 下一轮建议的勾选顺序

- 第一批可勾选前提：
  - `定义 CandidateRoute 的统一字段集`
  - `设计 Route Planner 输出到前端路线卡片的投影协议`
- 第二批可勾选前提：
  - `设计规划期路线切换流程`
  - `设计执行前路线锁定规则`
  - `设计执行期改线与重规划规则`
  - `设计路线相关的 replay / audit 事件`

## 状态备注（2026-04-25）

- 本轮基于以下直接代码与直接测试重新复核后，仍然**不新增勾选**：
  - `shared/mission/autopilot.ts`
  - `shared/__tests__/mission-autopilot.test.ts`
  - `server/tasks/mission-decision.ts`
  - `server/tasks/mission-projection.ts`
  - `server/tests/hitl-decision.test.ts`
  - `server/tests/mission-routes.test.ts`
  - `client/src/lib/tasks-store.ts`
  - `client/src/lib/tasks-store.autopilot.test.ts`
  - `client/src/components/tasks/TaskAutopilotPanel.tsx`
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`
- 当前已完成集合维持不变：`1 / 4 / 6 / 7 / 8 / 10 / 13 / 15 / 17`。
- 当前新增且可直接确认的事实闭环主要有两条：
  - `route-selection` 决策提交后，最小路线语义会保留进 `resolved.metadata.formData` 与 `decisionHistory[].resolved.metadata.formData`，可包含 `selectedRouteOptionId`、`selectedRouteLabel`、`selectedRouteId` 与 `changedReason`；`server/tests/hitl-decision.test.ts` 中 `preserves route-selection semantics in resolved decision metadata and history` 已直接覆盖这条链路。
  - “decision submit / history -> autopilot summary -> mission projection -> client store -> panel” 这一条 route-selection 投影链已经比上一轮更稳：`shared/__tests__/mission-autopilot.test.ts` 中 `promotes resolved route-selection history into authoritative selected route state` 与 `resolves selectedRouteId from decision payload candidateRoutes when formData keeps only option semantics`，以及 `server/tests/mission-routes.test.ts` 中 `projects resolved route-selection history as the authoritative selected route`、`propagates route-selection decisions from submit to projection route summary`、`falls back to decision payload candidateRoutes when selectedRouteId is absent from formData` 已共同证明 `selectedRouteId / recommendedRouteId / selectionStatus / route.selection.mode / route.changeReason / route.selection.changedReason / route.evidence / evidence.correlation.selectedRouteId` 能稳定投影到 summary / projection。
- `client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`TaskAutopilotPanel.tsx` 与 `TaskAutopilotPanel.test.tsx` 当前也已直接支撑：
  - route block 对 `selectedRouteId / recommendedRouteId / candidateRoutes / selectionStatus / replan / evidence` 的归一化消费
  - `Selected / Recommended / Alternatives / Route Diff / Selection / Replan / Route Evidence` 的稳定展示
  - `estimatedDuration / estimatedCost / takeoverLoad / riskLevel` 的最小比较与详情表达
- 但这些直接证据仍不足以新增勾选，核心原因是：
  - “`最快 / 最稳 / 最深` 的统一产品语义”当前仍主要借由 `mode = fast / standard / deep`、路线标题与推荐理由字符串表达；并没有形成跨页面、跨任务域的统一产品词典，因此 `定义最快 / 最稳 / 最深三类候选路线的统一产品语义` 仍不能勾。
  - 当前没有直接代码 + 直接测试去证明 `task-autopilot-levels-l1-to-l5` 与路线推荐策略之间已经形成映射，因此对应映射表任务仍不能勾。
  - 默认推荐路线目前仍主要由 `shared/mission/autopilot.ts` 中的最小 builder 推导承担，尚未形成覆盖“任务类型 / 风险等级 / 预算约束 / 治理要求 / 历史成功模式”的正式判定规则，因此 `设计默认推荐路线的判定规则` 仍不能勾。
  - “规划期路线切换流程”当前只能证明“能查看候选路线、能提交 route-selection、能把选择结果投影回 summary/projection”，但仍没有直接代码 + 直接测试去证明“恢复系统推荐”与完整确认执行交互已经形成稳定闭环，因此 `设计规划期路线切换流程` 仍不能勾。
  - “执行期改线与重规划规则”当前仍只稳定覆盖 `runtime_replanned` 这一条最小摘要链；虽然 `user_selected` 与 `system_downgraded` 的枚举口径已存在，但没有直接代码 + 直接测试证明“用户主动改线 / 系统降级改线 / 系统重规划”三类路径都已形成稳定服务端投影、前端语义与治理规则，因此 `设计执行期改线与重规划规则` 仍不能勾。
  - “路线切换与高风险动作的接管规则”当前并没有形成覆盖“预算越界 / 权限升级 / 外部副作用 / 风险动作命中”的路线级 HITL 规则闭环，因此该项仍不能勾。
  - “路线选择与 Mission Runtime 的对接流程”当前仍然不能勾：现有证据证明的是 summary / projection / store / panel 闭环，而不是 `Mission Runtime` 本体已经把 `selectedRouteId`、锁定状态与改线原因作为正式执行输入消费。
  - “路线相关事件的证据字段”当前虽然已有 `eventType / actor / reason / fromRouteId / toRouteId` 的最小事件口径，但任务原文要求的“自动驾驶等级、风险上下文和最终结果映射”尚无直接代码 + 直接测试闭环，因此该项仍不能勾。
  - `/tasks` 工作台路线对比与确认交互、回放页面路线时间线、首批试点任务清单这三项当前都缺少直接代码与直接测试，因此继续保持未完成。

## 状态备注（2026-04-25，本轮收口）

- 本轮继续按“直接代码 + 直接测试”标准复核后，**不新增勾选**，并把 checklist 与前文审计备注统一为同一口径。
- 当前安全已完成集合保持为：`1 / 4 / 6 / 7 / 8 / 10 / 13 / 15 / 17`。
  - 对应的是：`CandidateRoute` 最小字段口径、Route Planner 到 route card 的投影协议、最小比较模型、最小推荐理由展示、最小时长/成本表达、执行前锁定规则、路线选择写回最小数据结构、最小 replay / audit 事件口径、以及驾驶舱中的最小路线区域。
- 本轮虽然把以下设计写得更完整，但**仍不足以勾选**：
  - `设计默认推荐路线的判定规则`
    - `design.md` 已补齐“默认推荐规则的设计分层”，但当前真实实现仍只有 `shared/mission/autopilot.ts` 的最小启发式，尚未覆盖任务类型 / 风险 / 预算 / 治理 / 历史成功模式的正式规则。
  - `设计规划期路线切换流程`
    - `design.md` 已补齐“规划期路线切换的最小设计边界”，但当前真实闭环仍只有“候选路线可见 + route-selection 决策可提交并回投 summary / projection / panel”，没有“恢复系统推荐 + 确认执行”的完整交互流。
  - `设计执行期改线与重规划规则`
    - `design.md` 已补齐“执行期改线设计的三层边界”，但当前真实实现仍只稳定覆盖 `runtime_replanned` 摘要链，不能外推为“用户主动改线 / 系统降级改线 / 系统重规划”三类路径都已落地。
  - `设计路线切换与高风险动作的接管规则`
    - 当前仍没有路线级预算越界、权限升级、外部副作用、高风险动作命中的完整 HITL 规则闭环。
  - `设计路线选择与 Mission Runtime 的对接流程`
    - 本轮在 `design.md` 中补强了“与 Mission Runtime 的最小已实现边界”，但当前闭环仍是 `decision submit -> route summary -> mission projection -> client normalize -> panel`，不是 `Mission Runtime` 正式消费闭环。
  - `定义 最快 / 最稳 / 最深 三类候选路线的统一产品语义`
    - 本轮只补强了设计语义矩阵；当前代码与测试仍主要围绕 `mode = fast / standard / deep`、路线标题与推荐理由字符串消费，尚不能保守认定跨页面、跨任务域的统一产品语义已落地。
  - `补齐路线推荐与 task-autopilot-levels-l1-to-l5 的映射表`
    - 本轮只补强了设计上的最小映射边界；当前没有直接代码 + 直接测试证明 route recommendation 已和 L1-L5 策略正式联动。
  - `设计路线相关事件的证据字段`
    - 当前真实已落地的是 `eventType / at / actor / reason / fromRouteId / toRouteId` 加上 `decisionId / selectedRouteId / recommendedRouteId` 的最小证据口径；任务原文要求的“自动驾驶等级、风险上下文和最终结果映射”仍未被直接实现支撑，所以不能勾。
  - `为 /tasks` 工作台设计路线对比与路线确认交互
    - 本轮补清了工作台与任务详情的边界，但当前仍只有 task detail panel 的最小展示，不是工作台级交互。
  - `为回放页面设计“初始推荐路线 -> 最终采用路线 -> 中途改线事件”的可视化时间线`
    - 本轮补清了 replay 的最小字段边界，但当前仍只有 evidence / correlation / route events，不是 replay UI。
  - `制定首批试点任务清单`
    - `design.md` 已补了设计态 P0 / P1 / P2 试点顺序，但这仍属于设计规划，不是已被代码与测试直接锚定的落地事实。

- 本轮新增的收口主要体现在“设计边界更清楚”，而不是“实现事实变多”：
  - `requirements.md` 进一步把“默认推荐规则 / 规划期改线 / 执行期改线 / runtime 对接 / 工作台与回放交互”统一收口为“已实现摘要层”和“设计待实现层”两类口径。
  - `design.md` 新增了默认推荐结果的消费者契约、规划期改线的读写边界、执行期改线的最小消费者契约、runtime 对接的设计态分层、以及工作台 / 回放 / 试点接入守则。
  - 这些补强的作用是避免后续主线程把 `decision -> summary -> projection -> panel` 的投影闭环误写成 `Mission Runtime` 执行闭环，或把任务详情里的 route block 误写成 `/tasks` 工作台级交互。
- 因此，当前 route lane 的保守结论仍然是：
  - 已成立的是“route summary / projection / panel / evidence”的最小语义闭环；
  - 未成立的是“默认推荐正式规则 / 完整规划期切换 / 完整执行期改线治理 / Mission Runtime 正式执行消费 / 工作台与 replay UI 闭环”。

## 状态备注（2026-04-26，按 design 闭环新增勾选）

- 本轮将以下任务改为已完成：`2 / 3 / 5 / 9 / 11 / 12 / 14 / 16 / 18 / 19 / 20`。
- 这些新增勾选的含义是：本 spec 已经把对应设计目标、输入输出、状态机/矩阵、边界与非目标定义完整，可以作为后续实现与审计基线；**不代表对应代码已经落地**。

- 新增勾选依据如下：
  - `2 定义 最快 / 最稳 / 最深 三类候选路线的统一产品语义`
    - `design.md` 已通过“最快 / 最稳 / 最深”三段语义定义与“路线模式统一语义矩阵”明确当前 `fast / standard / deep` 的产品兼容层与命名边界。
  - `3 补齐路线推荐与 L1-L5 的映射表`
    - `design.md` 已通过“默认推荐规则的设计态判定矩阵”明确不同等级下的默认推荐倾向、切换自由度与自动改线边界。
  - `5 设计默认推荐路线的判定规则`
    - `design.md` 已补齐默认推荐的判定优先级、输出合同与实现边界，不再只是原则性描述。
  - `9 设计规划期路线切换流程`
    - `design.md` 已定义四步流程、规划期状态机，以及 `restore recommended / confirm-route-and-start` 的 mutation 契约。
  - `11 设计执行期改线与重规划规则`
    - `design.md` 已定义“用户主动改线 / 系统降级改线 / 系统重规划”三类路径矩阵，并区分触发方、接管门槛与证据要求。
  - `12 设计路线切换与高风险动作的接管规则`
    - `design.md` 已定义预算、权限、外部副作用、高风险动作、质量不足等场景下的路线级接管矩阵。
  - `14 设计路线选择与 Mission Runtime 的对接流程`
    - `design.md` 已定义 route selection 到 Mission Runtime 的 handoff 顺序、按阶段的 runtime 消费点和设计态分层。
  - `16 设计路线相关事件的证据字段`
    - `design.md` 已把最小字段与扩展字段拆开定义，并明确哪些已有锚点、哪些仍属设计态目标字段。
  - `18 为 /tasks 工作台设计路线对比与路线确认交互`
    - `design.md` 已定义工作台三栏信息架构、动作合同与输入输出约束。
  - `19 为回放页面设计路线时间线`
    - `design.md` 已定义 replay 的路线节点、节点字段与过滤/跳转能力。
  - `20 制定首批试点任务清单`
    - `design.md` 已定义 P0 / P1 / P2 试点顺序，以及准入、退出和排除条件。

- 本轮仍需严格保留的实现边界：
  - `Mission Runtime` 还没有因为 design 收口就被视为“已正式消费 route selection”；
  - `/tasks` 工作台与 replay 时间线仍是设计态，不是当前页面；
  - 默认推荐完整 planner policy、工作台 mutation 流、执行期 route mutation 治理链路，仍不能在实现层冒充已完成。
