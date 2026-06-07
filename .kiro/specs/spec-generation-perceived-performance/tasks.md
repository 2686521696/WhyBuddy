# Implementation Plan: SPEC 树生成感知性能与状态一致性增强

## Overview

本实现计划在现有 React 19 + Vite + TypeScript + Zustand 主干上，以 compatibility-first、加法式、最小侵入的方式落地 SPEC 树生成的感知性能与状态一致性增强。实现顺序遵循"先纯逻辑核心、再 UI 反馈层、再组件接线、最后父级透传与一致性约束"的增量路径：

1. 先实现并以属性测试锁定纯函数核心 `deriveGenerationState`（PBT 主目标，8 条正确性属性）。
2. 再实现 `SpecTreeProgressLayer` 进度反馈层（骨架 + 进度信号）。
3. 再把状态机与反馈层接入规范实现 `SpecTreeWorkbench`（乐观标记、超时计时、`data-state`、重试入口）。
4. 再做父级 `AutopilotRightRail` 的最小透传（`generationError` + `onRetry`）并接通 In_Flight_Lock 并发语义。
5. 最后加固 shim（`SpecTreePanel`）与遗留面板（`SpecTreeWorkbenchPanel`）的一致性 / 变体约束。

所有新增业务读取均只读既有真相源（`latestJob` + `rightRailView` 派生层），不引入第二套状态源，不改服务端契约。

## Tasks

- [x] 1. 建立生成状态机纯函数核心 `deriveGenerationState`
  - [x] 1.1 实现 `deriveGenerationState` 纯函数与类型
    - 在 `client/src/pages/autopilot/right-rail/spec-tree-workbench/derive-generation-state.ts` 新建文件
    - 定义 `GenerationScope`、`GenerationPhase`、`OptimisticMark`、`DeriveGenerationStateInput`、`GenerationStateView` 类型
    - 实现折算规则（优先级自上而下）：(1) `error` → `failure`；(2) 未超时乐观标记或 `inFlight !== null` → `pending`，乐观标记超时（`now - startedAt >= timeoutMs`）→ `failure` 且 `timedOut = true`；(3) `authoritativeSettled` → `authoritativeHasDocs ? success : empty`；(4) 其余 → `idle`
    - `timeoutMs` 缺省 60000ms；返回 `phase` / `scope`（取乐观标记或 `inFlight` 范围）/ `timedOut`
    - 不读取 store、不产生副作用、不依赖外部时间（`now` 由入参注入）
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.5, 2.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.4, 5.5_

  - [x]* 1.2 Write property test for 乐观反馈同步置入即 pending
    - 文件：`client/src/pages/autopilot/right-rail/spec-tree-workbench/__tests__/derive-generation-state.property.test.ts`
    - **Property 1: 乐观反馈同步置入即 pending** — 存在未超时乐观标记且无 error 时，`phase` 恒为 `pending`，与权威投影、并发锁无关
    - fast-check `numRuns >= 100`；标注 `// Feature: spec-generation-perceived-performance, Property 1`
    - **Validates: Requirements 1.1, 4.1**

  - [x]* 1.3 Write property test for in-flight 期间恒 pending（反闪烁核心）
    - **Property 2: in-flight 期间恒 pending** — 任意权威投影组合下，存在未超时乐观标记或 `inFlight !== null` 且无 error 时 `phase` 恒为 `pending`，绝不为 `idle` 或 `empty`
    - fast-check `numRuns >= 100`；标注 Property 2
    - **Validates: Requirements 4.2, 4.4**

  - [x]* 1.4 Write property test for error 优先级恒 failure
    - **Property 3: error 优先级 → 恒 failure** — `error !== null` 时 `phase` 恒为 `failure`，与乐观标记、并发锁、权威投影无关
    - fast-check `numRuns >= 100`；标注 Property 3
    - **Validates: Requirements 2.3, 2.5, 4.6, 5.6**

  - [x]* 1.5 Write property test for settled 决定终态且绝不 idle
    - **Property 4: settled 决定终态、绝不 idle** — `authoritativeSettled === true` 时 `phase ∈ {pending, success, failure, empty}`；无 in-flight/未超时乐观且无 error 时由 `authoritativeHasDocs` 唯一决定（`true → success`，`false → empty`）
    - fast-check `numRuns >= 100`；标注 Property 4
    - **Validates: Requirements 2.1, 2.2, 2.8, 4.3, 5.4**

  - [x]* 1.6 Write property test for 超时边界 → failure
    - **Property 5: 超时边界 → failure（timedOut）** — `optimistic !== null` 且 `now - startedAt >= timeoutMs` 时 `phase === "failure"` 且 `timedOut === true`；`< timeoutMs` 时不因超时落入 failure（覆盖阈值两侧边界）
    - fast-check `numRuns >= 100`；标注 Property 5
    - **Validates: Requirements 4.5, 5.5**

  - [x]* 1.7 Write property test for pending 与终态互斥
    - **Property 6: pending 与终态互斥** — `phase === "pending"` 当且仅当处于 in-flight/未超时乐观档（且无 error）；任一终态下进行中信号必然关闭，不存在 pending 与终态并存
    - fast-check `numRuns >= 100`；标注 Property 6
    - **Validates: Requirements 2.9**

  - [x]* 1.8 Write property test for failure → retry → 同范围 pending
    - **Property 7: failure → retry → 同范围 pending** — 处于 `failure(scope = s)` 时，清除 error 并以范围 `s` 置入乐观标记后，下一次派生为 `pending` 且 `scope === s`
    - fast-check `numRuns >= 100`；标注 Property 7
    - **Validates: Requirements 2.7**

- [x] 2. Checkpoint - 纯函数核心与属性测试
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. 实现进度反馈层 `SpecTreeProgressLayer`
  - [x] 3.1 实现 `SpecTreeProgressLayer` 组件
    - 在 `client/src/pages/autopilot/right-rail/spec-tree-workbench/SpecTreeProgressLayer.tsx` 新建文件
    - 定义 `SpecTreeProgressLayerProps`（`locale`、`scope`、可选只读 `progress: { processed; total } | null`）
    - 渲染骨架占位行（沿用既有冷灰板 + Tailwind 工具类），覆盖在节点行区域之上/之内，不卸载/不清空既有真实内容
    - 进度信号：有 `progress` 时渲染 determinate 进度条，缺失时退化为 indeterminate 动画；只读，不写 store
    - 暴露 `data-testid="spec-tree-progress-layer"` 与 `data-progress-kind="skeleton|determinate|indeterminate"`；文案随 `locale`（`zh-CN`/`en-US`）
    - _Requirements: 1.2, 2.11, 5.2_

  - [x]* 3.2 Write unit tests for `SpecTreeProgressLayer`
    - 验证 `data-testid` 与 `data-progress-kind` 在有/无 progress 两种情形下正确切换
    - 验证文案随 locale 切换
    - _Requirements: 1.2, 5.2_

- [x] 4. 将状态机与反馈层接入规范实现 `SpecTreeWorkbench`
  - [x] 4.1 扩展 `SpecTreeWorkbench` props 与瞬态状态
    - 修改 `client/src/pages/autopilot/right-rail/spec-tree-workbench/SpecTreeWorkbench.tsx`
    - 加法式新增可选 props：`generationError?: { message?; detail? } | null`、`onRetry?: (scope, nodeId?) => void`；保留既有 `generating` prop 与行为
    - 维护瞬态 `optimistic: OptimisticMark | null`（`useState`）与 `now` 计时（`requestAnimationFrame` 或 `setInterval(1000)` 仅推进超时判定，不持业务数据）；组件卸载或离开 `pending` 时清理计时器
    - 计算 `authoritativeHasDocs`（复用既有 `hasAnyDocs`/`docsByNodeId`）、`authoritativeSpecTreeReady`（`hasPersistedSpecTree` 语义）、`authoritativeSettled`（文档计数/job 版本前进）
    - _Requirements: 5.1, 5.2, 4.4_

  - [x] 4.2 在 CTA onClick 同步置入乐观标记并接派生状态
    - 在双 CTA 的 `onClick` 同步处理内立即 `setOptimistic({ scope, startedAt: performance.now() })`，再调用 `onGenerateAll` / `onGenerateNode`
    - 调用 `deriveGenerationState(...)` 得到 `phase`，设置容器 `data-state={phase}` 并保留既有 `data-generating`
    - CTA disabled 判定改为 `phase === "pending"`（覆盖 `all` 与 `single` 全部触发器同时 disabled）
    - 权威状态就绪后在同一渲染帧内清除 `optimistic`，使乐观态与权威态并存不超过一帧、中间无 `idle`/空白帧
    - _Requirements: 1.1, 1.3, 1.4, 4.1, 5.4_

  - [x] 4.3 按 phase 渲染反馈层、重试入口与空/成功态
    - `phase==="pending"` 渲染 `<SpecTreeProgressLayer>`（传入只读 `progress`，来自 `specDocsProgress` 派生）
    - `phase==="failure"` 渲染重试入口（CTA 恢复 enabled），点击走 `onRetry(lastScope, nodeId?)`，并记忆上次失败 scope
    - `phase==="empty"` 渲染空结果说明文案，保留既有树/节点内容不清空
    - `phase==="success"` 正常渲染完整树文档或目标节点文档内容
    - 三态（success/failure/empty）文案随 `locale`
    - _Requirements: 2.1, 2.2, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 4.3_

  - [x]* 4.4 Write unit tests for `SpecTreeWorkbench` 反馈渲染
    - `pending`：渲染 `spec-tree-progress-layer`、两个 CTA 同时 disabled；点击后同一 `act` 内 `data-state="pending"` 且 CTA disabled（免异步等待）
    - `failure`：渲染重试入口、CTA 恢复 enabled，点击 `onRetry` 以上次 scope 调用
    - `failure`/`empty`：保留既有树/节点内容容器不清空
    - 三态文案随 `zh-CN`/`en-US`
    - 成功路径不直接写业务真相源（组件不维护独立业务并发/数据副本）
    - _Requirements: 1.2, 1.3, 1.4, 2.6, 2.7, 2.10, 2.11, 5.1, 5.2_

- [x] 5. Checkpoint - 反馈层与组件接线
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. 父级 `AutopilotRightRail` 最小透传与并发语义接通
  - [x] 6.1 透传 `generationError` 与 `onRetry` 并接通失败/重试路径
    - 修改 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`
    - 向 `SpecTreeWorkbench` 透传 `generationError={specDocsError}`；新增 `onRetry(scope, nodeId?)` 复用 `triggerSpecDocsGeneration(scope, nodeId)`，进入时 `setSpecDocsError(null)` 把 `failure → pending` 交还既有路径
    - 保留既有失败 toast（`showToast.error` + Locale 兜底文案）作为唯一反馈通道，不新增通道
    - `triggerSpecDocsGeneration` 继续作为唯一 In_Flight_Lock（`specDocsGenerating`）、API 调用与 `onSpecDocumentsGenerated` 回写锚点；不在子组件维护独立并发标志
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 3.2, 5.3_

  - [x] 6.2 实现 In_Flight_Lock 并发幂等与超时/回写失败映射
    - 在 `triggerSpecDocsGeneration` 中：当 `specDocsGenerating !== null` 时对任意范围（相同或不同）触发 early return，不改变当前锁、不发起新 API 调用
    - 乐观标记存活超过 60s（超时）→ 结束乐观、派生 `failure`（`timedOut`）、CTA 恢复 enabled、toast 超时原因、不向真相源写入部分结果
    - `onSpecDocumentsGenerated` 回写失败（回调抛错）→ 映射为 `failure` + toast，不留部分写入
    - _Requirements: 1.5, 1.6, 3.5, 4.5, 4.6, 5.5, 5.6_

  - [x]* 6.3 Write property test for In_Flight_Lock 并发幂等
    - **Property 8: In_Flight_Lock 并发幂等** — 当锁已被某范围标记进行中时，后续任意范围触发都不改变当前锁、不产生新的生成 API 调用，直至当前请求结束
    - 以纯逻辑/可注入 mock 形式建模锁与触发序列；fast-check `numRuns >= 100`；标注 Property 8
    - **Validates: Requirements 1.5, 1.6, 3.5**

  - [x]* 6.4 Write unit tests for 失败 toast 与超时映射
    - 失败有原因 → toast 呈现可读 detail/message；失败无原因 → toast 使用 Locale 兜底文案（随 zh/en）
    - 超时 → 派生 `failure`、CTA 恢复 enabled、真相源未被部分写入
    - 回写失败 → 映射为 `failure`
    - _Requirements: 2.3, 2.4, 2.10, 4.5, 5.5, 5.6_

- [x] 7. 加固 shim 与遗留面板一致性约束
  - [x] 7.1 约束 `SpecTreePanel` shim 为纯转发
    - 确认/调整 `SpecTreePanel` 为纯 re-export 转发到 `SpecTreeWorkbench`，不实现独立 Generation_State_Machine 或 Progress_Feedback_Layer
    - _Requirements: 3.1, 3.3_

  - [x] 7.2 收敛 `SpecTreeWorkbenchPanel` 遗留面板变体语义
    - 修改 `client/src/pages/specs/SpecTreeWorkbenchPanel.tsx`
    - 若遗留面板暴露生成动作：复用同一 `deriveGenerationState` + `SpecTreeProgressLayer`，经父级统一 In_Flight_Lock
    - 若仅做结构操作、不触发 spec 文档生成：在代码注释与设计中明确标注为"故意保留的结构操作变体"，不承载 Generation_State_Machine
    - _Requirements: 3.1, 3.2, 3.4_

  - [x]* 7.3 Write unit tests for shim 等价与一致性
    - `SpecTreePanel` 渲染输出等价于 `SpecTreeWorkbench`，且不含独立状态机（3.1/3.3）
    - 三实现对相同范围呈现相同状态取值集合与转换序列；触发均经父级 `triggerSpecDocsGeneration`，组件不维护独立业务并发标志
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 8. 集成接线与回归保护
  - [x] 8.1 端到端接线整棵树与单节点两条生成路径
    - 串联 `AutopilotRightRail` → `SpecTreeWorkbench` → `SpecTreeProgressLayer`，确认 `all` 与 `single` 两种 scope 的 idle→pending→success/failure/empty 全链路状态过渡，无悬挂/孤立代码
    - 确认乐观→权威单帧交接、pending 期间不回退 idle、不误判 empty
    - _Requirements: 1.1, 2.1, 2.2, 4.1, 4.2, 4.3, 4.4_

  - [x]* 8.2 回归保护：进度 store 只读不变式
    - 复用既有 `spec-docs-progress-store.property.test.ts` 与 `spec-docs-progress-assembled.test.ts`，确认 `SpecTreeProgressLayer` 只读 `specDocsProgress` 未改变其既有不变式
    - _Requirements: 5.1, 5.2_

- [x] 9. Final checkpoint - 全量测试与类型检查
  - Ensure all tests pass, ask the user if questions arise.
  - 运行 `node --run check`（不扩大既有 TypeScript 基线错误数）与相关 Vitest 套件单次执行（`--run`）

## Notes

- 标记 `*` 的子任务为可选（单元测试、属性测试、回归测试），可为快速 MVP 跳过；顶层任务与核心实现子任务不可跳过。
- 每个任务引用具体需求子条款以保证可追溯性。
- 属性测试与 `deriveGenerationState` / In_Flight_Lock 纯逻辑一一对应（8 条属性），靠近实现放置以尽早捕获错误。
- Checkpoint 用于增量验证；属性测试用 fast-check 且 `numRuns >= 100`。
- 全程 compatibility-first：只读既有真相源，不新增 job/spec 状态源，不改服务端契约，不改 `/tasks` 深链，不重做设计系统。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1"] },
    { "id": 3, "tasks": ["4.2"] },
    { "id": 4, "tasks": ["4.3"] },
    { "id": 5, "tasks": ["4.4", "6.1"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["6.3", "6.4", "7.1", "7.2"] },
    { "id": 8, "tasks": ["7.3", "8.1"] },
    { "id": 9, "tasks": ["8.2"] }
  ]
}
```
