# 任务清单：Autopilot 右栏数据层 Hook 化与合并

本 spec 的任务按「独立 PR 可合入」原则拆成 12 个任务。每个任务完成后：

- `node --run check` 通过,不扩大现有 TypeScript 基线错误数
- `npm exec vitest run client/src/pages/autopilot/right-rail/hooks` 通过(本 spec 新增 unit + PBT)
- `npm exec vitest run client/src/pages/autopilot` 通过(Spec 3 已有断言不回归)
- `npm exec vitest run client/src/pages/specs` 通过(Spec 2 已有断言不回归)

改动文件范围(Requirement 12.7):

- 新增 `client/src/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data.ts`
- 新增 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-autopilot-right-rail-data.test.ts`
- 新增 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-autopilot-right-rail-data.property.test.ts`
- 可选新增 `client/src/pages/autopilot/right-rail/hooks/index.ts`(barrel)
- 修改 `client/src/pages/autopilot/right-rail/index.ts`(新增 re-export)
- 修改 `client/src/pages/specs/hooks/use-blueprint-progress-data.ts`(占位 → re-export shim)
- 修改 `client/src/pages/autopilot/AutopilotRoutePage.tsx`(fabric 阶段接入 hook)
- 修改 `client/src/pages/specs/BlueprintProgressPanel.tsx`(Phase A 接入 hook)
- 按需修改相关测试文件

---

- [x] 1. 创建 hook 目录骨架 + 类型定义 + barrel
  - 新建 `client/src/pages/autopilot/right-rail/hooks/` 目录
  - 在 `client/src/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data.ts` 中导出以下类型(与 `design.md` 类型定义一致):`RightRailDataFieldStatus<T>`、`RightRailDataView`、`UseAutopilotRightRailDataOptions`;并导出空实现的 `useAutopilotRightRailData(jobId, options)`(当前先返回 `initialData` 包装的 read-only view,所有字段 `loading=false`、`error=null`、`retry=() => {}`)
  - 新建 `client/src/pages/autopilot/right-rail/hooks/index.ts` barrel:`export * from "./use-autopilot-right-rail-data";`
  - 修改 `client/src/pages/autopilot/right-rail/index.ts`:新增 `export { useAutopilotRightRailData } from "./hooks";` 与类型 re-export
  - **涉及文件**:新增 `client/src/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data.ts`、`client/src/pages/autopilot/right-rail/hooks/index.ts`;修改 `client/src/pages/autopilot/right-rail/index.ts`
  - **测试**:`node --run check` 通过;Spec 1 冻结的 `AutopilotRightRailProps` 契约、Spec 2 canonical 面板签名、Spec 3 `AutopilotRoutePage.test.tsx` 全部保持通过
  - **验收**:`useAutopilotRightRailData` 签名与类型导出与 `design.md` 一字不差;其它 spec 的已有测试不回归
  - _需求:Requirement 1.1、1.2、1.3、1.4、Requirement 9.3_

- [ ] 2. 实现 Wave 1 fetch(`job + routeSet + selection + specTree`)+ 初始 loading/error state
  - 在 hook 内部引入 `useReducer` + per-jobId cache `useRef<Map<jobId, CacheEntry>>`
  - 实现 reducer 的 `JOB_CHANGED` / `FETCH_STARTED` / `FETCH_FULFILLED` / `FETCH_REJECTED` action(按 `design.md` 中「Cache 内部实现」示例)
  - 在 `useEffect([jobId])` 中调用 `fetchLatestBlueprintGenerationJob()`;当 `initialData.job` 已提供时跳过首次 fetch,直接 seed job cache
  - `routeSet / selection / specTree` 从 `view.job.data` 派生(复用 `AutopilotRoutePage.tsx` 现有的 `readAutopilot*` helper 规则或在 hook 内复刻)
  - 建立 `RightRailDataFieldStatus<T>.retry` 稳定引用(通过 `useCallback`);`jobId === ""` 时 retry 为 no-op
  - 单字段 fetch 失败时保留 `data = previousCache ?? initialData ?? null`
  - **涉及文件**:修改 `client/src/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data.ts`
  - **测试**:在 `__tests__/use-autopilot-right-rail-data.test.ts` 中先行加入 unit 断言覆盖 Wave 1 路径:`jobId === ""` 零 fetch;`jobId` 非空时 `fetchLatestBlueprintGenerationJob` 被调用一次;fetch 成功后 `view.job.data` 反映响应
  - **验收**:Wave 1 能独立工作,其它 4 个 Wave 字段仍为占位 `loading=false`、`data=null`;`node --run check` 通过
  - _需求:Requirement 1.5、1.6、1.8、2.1、2.2、2.4、2.5、Requirement 4.1、4.6、Requirement 8.1、8.4、8.6_

- [ ] 3. 实现 Wave 2 fetch(`agentCrew + capabilities + capabilityInvocations + capabilityEvidence`)+ 懒加载 gate
  - 实现 `shouldLoadField` helper(按 `design.md` 懒加载表)
  - `agentCrew` 从 `job.agentCrew` 派生(不独立 fetch,与 `routeSet` 同策略)
  - `capabilities` 发起 `Promise.all([fetchBlueprintCapabilities(), fetchBlueprintJobCapabilities(jobId)])` 并合并(合并规则复用 `BlueprintProgressPanel` 现有 registry-first 合并逻辑)
  - `capabilityInvocations` 调用 `fetchBlueprintCapabilityInvocations(jobId)`
  - `capabilityEvidence` 调用 `fetchBlueprintCapabilityEvidence(jobId)`
  - 懒加载 gate:`currentSubStage` 存在(即 fabric 阶段)且 `skipLazyLoad !== true` 时触发
  - 使用 `Promise.allSettled` 收敛结果,单字段失败不阻塞其余
  - **涉及文件**:修改 `client/src/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data.ts`
  - **测试**:unit 断言 Wave 2 在 `currentSubStage !== undefined` 时发起,`currentSubStage === undefined` 时不发起;`skipLazyLoad === true` 时始终发起;单个 fetch 失败时其余字段依然 settle
  - **验收**:Wave 2 4 个字段按规则懒加载;既不延迟 fabric 首屏可用性,也不在 routeset 之前提前拉起
  - _需求:Requirement 2.1、2.2、2.6、Requirement 3.1、3.2、3.3_

- [ ] 4. 实现 Wave 3 fetch(`effectPreviews + promptPackages + landingPlans + engineeringRuns`)+ 按子阶段懒加载
  - `effectPreviews` 调用 `fetchBlueprintEffectPreviews(jobId)`,懒加载阈值:`currentSubStage ∈ { effect_preview, prompt_package, runtime_capability, engineering_handoff, artifact_memory }` 或 `job.stage ∈ { preview, effect_preview, prompt_packaging, runtime_capability, engineering_handoff, engineering_landing }`
  - `promptPackages` 调用 `fetchBlueprintPromptPackages(jobId)`,懒加载阈值:`currentSubStage ∈ { prompt_package, runtime_capability, engineering_handoff, artifact_memory }` 或 `job.stage ∈ { prompt_packaging, runtime_capability, engineering_handoff, engineering_landing }`
  - `landingPlans` 调用 `fetchBlueprintEngineeringLanding(jobId)`,懒加载阈值:`currentSubStage ∈ { engineering_handoff, artifact_memory }` 或 `job.stage ∈ { engineering_handoff, engineering_landing }`
  - `engineeringRuns` 调用 `fetchBlueprintEngineeringRuns(jobId)`,懒加载阈值同 `landingPlans`
  - 当子阶段从浅切到深(例如 `effect_preview → prompt_package`),新解锁的字段以 `loading=true` 进入 fetch;已 cache 的字段不重拉
  - **涉及文件**:修改 `client/src/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data.ts`
  - **测试**:unit 断言每个字段的懒加载阈值;子阶段从浅到深时新字段 fetch 被触发、已 cache 字段 counter 不增
  - **验收**:Wave 3 4 个字段按表懒加载;`/specs` 路径 `skipLazyLoad=true` 时全量发起
  - _需求:Requirement 2.1、2.2、2.5、Requirement 3.1、3.4、3.5_

- [ ] 5. 实现 Wave 4 fetch(`artifactEntries + artifactReplays + artifactFeedback`)
  - `artifactEntries` 调用 `fetchBlueprintArtifactLedger(jobId)`
  - `artifactReplays` 调用 `fetchBlueprintArtifactReplays(jobId)`
  - `artifactFeedback` 从 `artifactReplays` 响应的 `artifactFeedback` 切片派生(字段存在于 `BlueprintArtifactReplaysResponse`);不新增后端路由
  - 懒加载阈值:`currentSubStage === "artifact_memory"` 或 `job.stage === "engineering_landing"`
  - **涉及文件**:修改 `client/src/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data.ts`
  - **测试**:unit 断言 `currentSubStage === "artifact_memory"` 时 3 个字段发起;其它子阶段不发起;`artifactFeedback` 派生自 replay 响应而非独立 fetch
  - **验收**:Wave 4 3 个字段按规则懒加载;不引入新的后端调用
  - _需求:Requirement 2.1、2.2、Requirement 3.1、Requirement 12.5_

- [ ] 6. 实现 jobId / 生命周期管理:invalidate、AbortController、SSE + polling
  - `jobId` 变化时通过 `JOB_CHANGED` reducer action 重置所有字段 `data = initialData?.[field] ?? null`、`error = null`、`loading = false`
  - 所有 in-flight 请求通过 `AbortController.abort()` 取消
  - 切换到一个 `jobId` 然后切回(`[a, b, a]`)时,从 `cacheRef.current.get(a)` 读取已缓存字段 seed view;W1 `job` 始终重新发起确认指针(详见 `design.md` 切回策略)
  - 为 Ignore_Stale_Policy 建立 `pendingRequestId` 字段:reducer 在 `FETCH_FULFILLED` / `FETCH_REJECTED` 时比较 `action.requestId` 与当前 field 的 `pendingRequestId`,不匹配则 early return(忽略 stale)
  - 通过 `fetchBlueprintJobEventStreamUrl(jobId)` 订阅 SSE `EventSource`;`message` 事件解析 `job.stage`,触发 targeted refetch;调用 `options.onJobStageChange?.(next, prev)`
  - SSE 失败(`readyState === CLOSED`)或禁用时降级为 polling,间隔 `options.pollingIntervalMs ?? 15000`;退避:连续 3 次失败后 `interval = min(base * 2^attempt, 120000)`
  - `options.pollingIntervalMs === 0` 或负数时禁用 SSE + polling
  - 组件 unmount 时 `source.close()` + `clearTimeout(pollingTimer)` + `AbortController.abort()`
  - **涉及文件**:修改 `client/src/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data.ts`
  - **测试**:unit 断言 `jobId` 变化触发 abort + reset;切回历史 `jobId` 时 cache 复用;SSE mock 触发 targeted refetch;SSE close 时降级 polling;`pollingIntervalMs === 0` 禁用;unmount 时 close/abort 均被调用
  - **验收**:`jobId` 变化后不泄漏上一个 job 数据;快速连续 stage 推进不出现 stale 覆盖;unmount 不触发 setState warning
  - _需求:Requirement 4.1、4.2、4.3、4.4、4.5、4.6、Requirement 5.1、5.2、5.3、5.4、5.5、5.6、Requirement 8.5_

- [ ] 7. 实现 per-field `retry()` + error recovery + in-flight guard + onXXXChange 回调
  - `retry` 通过 `useCallback(() => dispatch({ type: "RETRY", field, jobId }), [jobId])` 建立稳定引用
  - `retry` 受懒加载规则约束:若当前 `currentSubStage` / `job.stage` 不满足该字段懒加载阈值,retry 为 no-op 并保持 `error` 不变
  - In-flight guard:同字段在 500ms 内重复 retry 时只发起 1 次 fetch(通过 reducer 的 `pendingRequestId !== null` 检查实现)
  - fetch 失败时 `data` 保持 previousCache(reducer 已在任务 2 中实现)
  - 调用 `options.onFieldError?.(field, error)` 让 consumer 感知错误
  - 实现 per-field 的 `onXXXChange` 回调:fetch 成功时调用对应 `options.onXxxChange(data)` 把数据同步给 consumer(Phase A 桥接 `BlueprintProgressPanel` 的 `initial*` / `on*Change` props)
  - **涉及文件**:修改 `client/src/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data.ts`
  - **测试**:unit 断言 retry 成功路径(re-fetch + data 更新)、retry 失败路径(保留 previousCache)、retry 在懒加载阈值不满足时为 no-op、快速连续 retry 只发一次请求、`onFieldError` 与 `onXxxChange` 被正确调用
  - **验收**:单字段失败不影响其它字段;retry 不会造成风暴;consumer 通过 `onXxxChange` 能拿到最新数据
  - _需求:Requirement 7.1、7.2、7.3、7.4、7.5、Requirement 8.1、8.2、8.3、8.4、8.6_

- [ ] 8. 将 `client/src/pages/specs/hooks/use-blueprint-progress-data.ts` 改为 re-export shim
  - 删除占位字符串常量 `USE_BLUEPRINT_PROGRESS_DATA_PLACEHOLDER`
  - 改写为单行 re-export:
    ```ts
    export {
      useAutopilotRightRailData as useBlueprintProgressData,
      type RightRailDataView,
      type RightRailDataFieldStatus,
      type UseAutopilotRightRailDataOptions,
    } from "@/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data";
    ```
  - 通过 `grep` 确认旧常量 `USE_BLUEPRINT_PROGRESS_DATA_PLACEHOLDER` 不再被任何地方引用;若有引用,同步移除
  - **涉及文件**:修改 `client/src/pages/specs/hooks/use-blueprint-progress-data.ts`
  - **测试**:`node --run check` 通过;`grep` 确认旧常量无残留引用
  - **验收**:历史 import `@/pages/specs/hooks/use-blueprint-progress-data` 可以继续工作;删除本 shim 未来只需一次 `git rm` 无需迁移调用方
  - _需求:Requirement 9.1、9.2、9.3、9.4、9.5_

- [ ] 9. 在 `AutopilotRoutePage.tsx` 中接入 hook(替换 5 条派生 useMemo)
  - 在文件顶部新增 `import { useAutopilotRightRailData, resolveRailSubStage } from "./right-rail";`
  - 在 fabric 阶段调用 `useAutopilotRightRailData(latestJob?.id ?? "", { initialData: { job: latestJob, routeSet, selection, specTree, agentCrew: autopilotAgentCrew, capabilities: autopilotCapabilities, capabilityInvocations: autopilotCapabilityInvocations, capabilityEvidence: autopilotCapabilityEvidence, effectPreviews: autopilotEffectPreviews }, currentSubStage })`
  - 用 `view.job.data / view.agentCrew.data / view.capabilities.data / view.capabilityInvocations.data / view.capabilityEvidence.data / view.effectPreviews.data` 替换现有 5 条 `useMemo(readAutopilot*(latestJob))` 派生结果(helper 函数 `readAutopilotAgentCrew` 等可以保留供 hook 内部复用)
  - 把 hook 返回值装配成 `<AutopilotRightRail>` 的 9 个 props(遵守 Spec 1 `AutopilotRightRailProps` 契约)
  - 输入 / 澄清 / routeset / selection 4 个阶段的 `useState` / `useEffect` / 写请求(`createBlueprintIntake / createBlueprintClarificationSession / ...`)保持不变,不接入 hook
  - `onSubStageChange` 保持 `() => {}` no-op(Spec 5 会接入 URL 同步)
  - **涉及文件**:修改 `client/src/pages/autopilot/AutopilotRoutePage.tsx`;按需修改 `client/src/pages/autopilot/AutopilotRoutePage.test.tsx`
  - **测试**:`AutopilotRoutePage.test.tsx` 现有断言(fold removal、fabric 右栏存在、selection → fabric 不导航)继续通过;新增或调整对 hook 返回值映射到 `<AutopilotRightRail>` props 的断言
  - **验收**:fabric 右栏数据仍然正确展示;非 fabric 阶段行为完全不变;Spec 3 的 3 条 edge-case 测试继续通过
  - _需求:Requirement 6.1、6.6、Requirement 11.2、11.5_

- [ ] 10. 在 `BlueprintProgressPanel.tsx` 中接入 hook(Phase A 兼容模式)
  - 在文件顶部新增 `import { useAutopilotRightRailData } from "@/pages/autopilot/right-rail/hooks";`
  - 在组件函数体顶部调用:
    ```ts
    const effectiveJobId = initialJob?.id ?? "";
    const view = useAutopilotRightRailData(effectiveJobId, {
      initialData: pickInitialsFromProps(props),
      skipLazyLoad: autoLoad === true,
      onEffectPreviewsChange: onPreviewsChange,
      onPromptPackagesChange: onPackagesChange,
      onLandingPlansChange: onLandingPlansChange,
      onEngineeringRunsChange: onEngineeringRunsChange,
      onCapabilitiesChange: onCapabilitiesChange,
      onCapabilityInvocationsChange: onInvocationsChange,
      onCapabilityEvidenceChange: onEvidenceChange,
      onAgentCrewChange: onAgentCrewChange,
      onArtifactEntriesChange: onLedgerEntriesChange,
      onArtifactReplaysChange: onReplaysChange,
      onArtifactFeedbackChange: onFeedbackChange,
    });
    ```
  - 删除顶层 `autoLoad` 路径的 `useEffect(Promise.all([fetchBlueprintSpecsProgress, fetchLatestBlueprintGenerationJob]))`(~行 5380-5450)
  - 删除原 `BlueprintProgressPanel` 组合层对各面板 bootstrap 的 per-field `useEffect(() => fetchBlueprint*(jobId), [jobId])` 调用
  - 保留 `initial*` / `on*Change` / `autoLoad` / `show*` props 对外 API 不变
  - 把 `view.XXX.data` 作为 canonical 面板调用处的数据源;`initial*` props 映射为 `options.initialData`
  - 若原来 `BlueprintProgressPanel` 内部维护的本地 state(如 `effectPreviewsState` / `promptPackagesState`)用于缓存面板回写值,Phase A 保留其作为桥接层,但改为 read from `view` + write via `options.onXxxChange` → consumer → `initial*` 循环;避免双写 fetch 层
  - **涉及文件**:修改 `client/src/pages/specs/BlueprintProgressPanel.tsx`;按需修改 `client/src/pages/specs/BlueprintProgressPanel.test.tsx`
  - **测试**:Spec 2 的 `rendering-parity.test.tsx` / `props-narrowing.property.test.ts` / `shim-identity.test.ts` 继续通过;`BlueprintProgressPanel.test.tsx` 的 DOM `data-testid="blueprint-progress-panel"`、文案、className 断言不回归
  - **验收**:`/specs` 页面行为与 Spec 3 完成后一致;8 个 canonical 面板渲染 DOM parity 保持;`initial*` / `on*Change` props 仍被外部调用方识别
  - _需求:Requirement 6.2、6.3、6.4、6.5、6.7、Requirement 7.3、7.4、Requirement 11.1、11.4_

- [ ] 11. **[PBT]** 编写 fast-check 属性测试(3 条)+ unit 测试补全
  - 新建 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-autopilot-right-rail-data.property.test.ts`
  - **P1 — Idempotent fetch dedupe**:
    - 生成器:`jobId ∈ string(非空)`、`consumerCount ∈ [2, 5]`
    - mock 9 个 `@/lib/blueprint-api` fetch 函数为 `vi.fn()`,记录调用次数
    - 在同一 render cycle 内挂载 N 个 `useAutopilotRightRailData(jobId)` 消费者(通过 renderHook + 包装组件循环挂载)
    - `act(async () => { await waitFor(...) })` 等待 settle
    - 断言:对每个 mock,`counter.mock.calls.length === 1`(同一 jobId 在 Wave 内只发起一次)
    - `numRuns: 50`;失败样本最小化:fast-check 自动 shrink 到 `consumerCount = 2` + 最短非空 jobId
  - **P2 — Cache coherence on jobId change**:
    - 生成器:`jobIdSeq: fc.array(fc.constantFrom("a", "b", "c", "d"), { minLength: 4, maxLength: 8 })`
    - mock 每个 `jobId` 的 fetch 响应带 timestamp 标记
    - 循环切换 hook 的 `jobId`;每次切换后 `waitFor(view.job.data?.id === currentJobId)`
    - 断言:a) 切换后首次 render `view.job.data` 不泄漏上一个 `jobId` 的值;b) 切回一个历史 `jobId` 时,W2-W4 字段的 fetch counter **不增加**(cache 复用),但 W1 `job` counter 增加(确认指针)
    - `numRuns: 50`
  - **P3 — Race safety on rapid job.stage updates**:
    - 生成器:`stageSeq: fc.array(fc.constantFrom("spec_tree", "spec_docs", "prompt_packaging", "runtime_capability", "engineering_handoff", "engineering_landing"), { minLength: 2, maxLength: 5 })`
    - mock SSE `EventSource`,用 `vi.useFakeTimers()` 在短时间内连续推送 stageSeq 对应的事件
    - 给每个下游字段 fetch mock 加随机延迟(`fetchDelays: fc.integer({ min: 0, max: 100 })`)
    - 快进 fake timer 到所有事件推完 + fetch settle
    - 断言:最终 `view.promptPackages.data` / `view.landingPlans.data` / `view.artifactEntries.data` 的值来自 stageSeq 中最后一个满足该字段懒加载阈值的 stage 对应的 mock response(不被更早的 in-flight 请求覆盖)
    - `numRuns: 30`
  - 在 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-autopilot-right-rail-data.test.ts` 中补齐 unit 测试覆盖(若在前序任务中未覆盖):`jobId === ""` 零 fetch、`options.skipLazyLoad === true` 时 Wave 1-4 全量发起、`options.pollingIntervalMs === 0` 时禁用 SSE/polling、per-field `retry()` 成功/失败路径、fetch 失败时 `data` 保留 previousCache、unmount 时 `AbortController.abort()` 与 `EventSource.close()` 被调用、`jobId === "a" → "b" → "a"` 切换路径下 W1 counter +1 而 W2-W4 counter 不增
  - **涉及文件**:新增 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-autopilot-right-rail-data.property.test.ts`;补齐 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-autopilot-right-rail-data.test.ts`
  - **测试**:三条 PBT 全部通过;unit 测试全部通过;`numRuns` 控制让测试耗时可接受
  - **验收**:失败时 fast-check 能输出最小化计数示例;PBT 不依赖真实网络或真实 SSE(通过 mock `@/lib/blueprint-api` 与 `vi.stubGlobal("EventSource", MockEventSource)`)
  - _需求:Requirement 10.1、10.2、10.3、10.4、10.5、10.6、10.7_

- [ ] 12. 端到端回归与 parity 验证(`/autopilot` + `/specs`)
  - `node --run check` 通过,不扩大现有 TypeScript 基线错误数
  - `npm exec vitest run client/src/pages/specs client/src/pages/autopilot` 全部通过;特别包含:
    - Spec 1 `resolve-rail-sub-stage.property.test.ts`(P1/P2/P3 三条 resolver PBT)
    - Spec 2 `props-narrowing.property.test.ts` / `shim-identity.test.ts` / `rendering-parity.test.tsx`
    - Spec 3 `fabric-dispatch.property.test.tsx` / fold removal snapshot / selection → fabric no-navigation
    - Spec 4 本 spec 的 3 条 PBT + unit 测试
  - 人工回归:打开 `/autopilot`,推进到 fabric 阶段,确认右列 400px 面板正确展示当前子阶段(AgentCrewFabric / SpecTree / EffectPreview 等);切换 job(可通过多次创建 blueprint job)确认所有字段立即清空不泄漏;观察 job stage 推进时下游字段是否自动刷新(可通过手动触发 SSE 或等待后端推进)
  - 人工回归:打开 `/specs?jobId=<已有 job>`,确认 `BlueprintProgressPanel` 行为与 Spec 3 完成后一致,`data-testid="blueprint-progress-panel"` 保留;所有 canonical 面板 DOM 结构、文案、className 与 Spec 2 rendering-parity 断言一致
  - 人工回归:关闭网络(Chrome DevTools Network 面板 Offline),观察错误态是否正确展示(各字段 `error` 填充、`data` 保留 previousCache、retry 按钮可用)
  - 确认 `git diff --name-only` 涉及文件集合严格符合 Requirement 12.7 限定:只涉及 hook 新增文件、`right-rail/index.ts`、`specs/hooks/use-blueprint-progress-data.ts`、`AutopilotRoutePage.tsx(.test)?`、`BlueprintProgressPanel.tsx(.test)?`
  - **涉及文件**:无新增或修改源文件;仅验证与手测
  - **测试**:上述聚合测试命令全部通过
  - **验收**:`/autopilot` 与 `/specs` 端到端行为无 regression;回滚可通过 `git revert` 单一 commit 完成,不影响 Spec 1/2/3 的产物
  - _需求:Requirement 11.1、11.2、11.3、11.4、11.5、11.6、Requirement 12.7、12.8、12.9_

---

## 任务执行边界

- 本 spec **不**修改 Spec 1 冻结的 `AutopilotRightRailProps` / `resolveRailSubStage` / `<AutopilotRightRail>` scaffolding;hook 只是在 consumer 侧为 `<AutopilotRightRail>` 准备 props。
- 本 spec **不**修改 Spec 2 的 8 个 canonical 面板签名(`Pick<AutopilotRightRailProps, ...>` + 面板私有字段 `initial*` / `on*Change`);面板内部实现与 `client/src/pages/autopilot/right-rail/panels/*` 完全不变。
- 本 spec **不**修改 Spec 3 的 fabric 接管结论;`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时接管 400px 右列,`AutopilotSpecTreeHandoffPanel` 次级 `/specs` 链接保持 Spec 3 的形态。
- 本 spec **不**删除 `BlueprintProgressPanel` 的 `initial*` props(Phase B 未来 spec 承接)。
- 本 spec **不**做 Spec 5 的工作:URL `?sub=xxx` / sticky pin / 自动滚动 / 键盘快捷键 / `<md` 抽屉化布局。
- 本 spec **不**新增后端 REST / Socket / DTO;只复用 `@/lib/blueprint-api` 现有 9 个 fetch 函数 + `fetchBlueprintJobEventStreamUrl` SSE 入口。
- 本 spec **不**订阅 `useAppStore` / `useProjectStore`;hook 是纯 React hook + AbortController + 可选 EventSource。
- 本 spec **不**新增 `data-testid`、**不**删除现有 `data-testid`、**不**修改任何 className 或文案 key。
- 本 spec **不**支持 SSR、**不**做 offline 支持、**不**做乐观更新、**不**做跨 `jobId` dedupe。
- 本 spec **不**引入 feature flag;hook 接入是一次性合入,回滚通过 `git revert`。
