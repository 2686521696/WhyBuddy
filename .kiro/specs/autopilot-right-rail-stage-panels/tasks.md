# 任务清单：Autopilot 右栏子阶段面板物理抽离

本 spec 的任务被严格拆分为「**每一个面板一个独立 PR-ready 任务**」，单独合入不破坏构建与 `/specs` 页面，也可单独 `git revert`。所有任务的统一产物都是：

- 新增 `client/src/pages/autopilot/right-rail/panels/<Name>Panel.tsx`
- 更新 `client/src/pages/autopilot/right-rail/panels/index.ts` barrel
- 修改 `client/src/pages/specs/BlueprintProgressPanel.tsx`：删除对应 local function，改为 import 新 canonical panel
- 更新 `client/src/pages/specs/panels/<Name>Panel.tsx`：从字符串占位改为单行 re-export（任务 2 / 3 沿用已有 re-export，改为指向新 wrapper）
- 更新 `client/src/pages/specs/panels/index.ts` barrel
- 扩展 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`：对应 sub-stage 从 placeholder 切换为真实面板

单任务完成标准：

- `node --run check` 通过，不扩大现有 TypeScript 基线错误数
- `npm exec vitest run client/src/pages/specs` 通过（无新增失败）
- `npm exec vitest run client/src/pages/autopilot/right-rail` 通过
- `npm exec vitest run client/src/pages/autopilot/AutopilotRoutePage.test.tsx` 无新增失败
- 新增 PBT / parity 测试（见任务 9 / 10）在每个单面板任务完成后均保持通过

---

- [x] 1. 抽离 `AgentCrewFabricPanel`（对应 `agent_crew_fabric`）
  - 新增 `client/src/pages/autopilot/right-rail/panels/AgentCrewFabricPanel.tsx`
  - 从 `BlueprintProgressPanel.tsx::BlueprintAgentCrewSurface`（~行 1794–2083）完整搬运到新文件，并改名为 `AgentCrewFabricPanel`
  - 定义 `AgentCrewFabricPanelProps = Pick<AutopilotRightRailProps, "jobId" | "job" | "agentCrew" | "capabilities" | "capabilityInvocations" | "capabilityEvidence" | "locale">`，追加一个可选的 `roleEventProjection?: BlueprintRoleEventProjection` 私有字段以保留原 local function 的能力
  - 删除 `BlueprintProgressPanel.tsx` 中 `BlueprintAgentCrewSurface` 定义，把原调用处替换为 `<AgentCrewFabricPanel .../>`
  - 在 `autopilot/right-rail/panels/index.ts` 导出 `AgentCrewFabricPanel` 与 `AgentCrewFabricPanelProps`
  - 在 `<AutopilotRightRail>` 的 fabric switch 中把 `case "agent_crew_fabric"` 从 placeholder 改为渲染 `<AgentCrewFabricPanel jobId={jobId} job={job} agentCrew={agentCrew} capabilities={capabilities} capabilityInvocations={capabilityInvocations} capabilityEvidence={capabilityEvidence} locale={locale} />`
  - 本任务**新增** `specs/panels/AgentCrewFabricPanel.tsx` 作为单行 re-export（此文件历史上不存在，新建为 `export { AgentCrewFabricPanel } from "@/pages/autopilot/right-rail/panels/AgentCrewFabricPanel";`），并在 `specs/panels/index.ts` 中补 barrel 导出
  - _需求：Requirement 1、2.1、3、5、6.1、7、8、10_

- [x] 2. 抽离 `SpecTreePanel`（对应 `spec_tree`，wrap `SpecTreeWorkbenchPanel`）
  - 新增 `client/src/pages/autopilot/right-rail/panels/SpecTreePanel.tsx` 作为**薄 wrapper**：import `SpecTreeWorkbenchPanel` from `@/pages/specs/SpecTreeWorkbenchPanel`
  - 定义 `SpecTreePanelProps = Pick<AutopilotRightRailProps, "jobId" | "specTree" | "selection" | "locale"> & { versions?; onSpecTreeChange?; onSpecTreeVersionsChange? }`
  - `specTree === null` 时渲染与 `BlueprintProgressPanel` 当前空态一致的 DOM（复制 `BlueprintProgressPanel` 在渲染 SpecTree 段时对 `specTree == null` 的降级段落）
  - `BlueprintProgressPanel.tsx` 把原 `<SpecTreeWorkbenchPanel .../>` 调用改为 `<SpecTreePanel .../>` 调用（保留 `onSpecTreeChange` / `onSpecTreeVersionsChange` / `versions` 回调，通过 panel wrapper 转发）
  - 更新 `specs/panels/SpecTreePanel.tsx`：目标 re-export 从 `../SpecTreeWorkbenchPanel.js` 改为 `@/pages/autopilot/right-rail/panels/SpecTreePanel`（导出 `SpecTreePanel` 作为 canonical；为兼容历史 import，同时保留 `SpecTreeWorkbenchPanel` alias re-export 指向原路径）
  - 在 `autopilot/right-rail/panels/index.ts` 导出 `SpecTreePanel` 与 `SpecTreePanelProps`
  - 在 `<AutopilotRightRail>` 的 `case "spec_tree"` 渲染 `<SpecTreePanel jobId={jobId} specTree={specTree} selection={selection} locale={locale} />`
  - 严格约束：不得修改 `client/src/pages/specs/SpecTreeWorkbenchPanel.tsx` 的任何代码（Requirement 9.1）
  - _需求：Requirement 1、2.2、3、5、6.1、7、8、9、10_

- [x] 3. 抽离 `SpecDocumentsPanel`（对应 `spec_documents`，wrap `SpecDocumentWorkbenchPanel`）
  - 新增 `client/src/pages/autopilot/right-rail/panels/SpecDocumentsPanel.tsx`，与任务 2 同构：wrap `SpecDocumentWorkbenchPanel`
  - 定义 `SpecDocumentsPanelProps = Pick<AutopilotRightRailProps, "jobId" | "specTree" | "locale"> & { /* 保留 BlueprintProgressPanel 现有通过额外 prop 注入的回调，如果有 */ }`
  - `BlueprintProgressPanel.tsx` 把原 `<SpecDocumentWorkbenchPanel .../>` 调用改为 `<SpecDocumentsPanel .../>`
  - 更新 `specs/panels/SpecDocumentsPanel.tsx` 的 re-export 目标为新 canonical 路径（同时保留 `SpecDocumentWorkbenchPanel` alias 指向原外部文件）
  - 在 `autopilot/right-rail/panels/index.ts` 导出 `SpecDocumentsPanel` 与 `SpecDocumentsPanelProps`
  - 在 `<AutopilotRightRail>` 的 `case "spec_documents"` 渲染 `<SpecDocumentsPanel jobId={jobId} specTree={specTree} locale={locale} />`
  - 严格约束：不得修改 `client/src/pages/specs/SpecDocumentWorkbenchPanel.tsx`（Requirement 9.2）
  - _需求：Requirement 1、2.3、3、5、6.1、7、8、9、10_

- [x] 4. 抽离 `EffectPreviewPanel`（对应 `effect_preview`）
  - 新增 `client/src/pages/autopilot/right-rail/panels/EffectPreviewPanel.tsx`
  - 从 `BlueprintProgressPanel.tsx::EffectPreviewWorkbenchPanel`（~行 2084–2502）完整搬运
  - 定义 `EffectPreviewPanelProps = Pick<AutopilotRightRailProps, "jobId" | "job" | "specTree" | "effectPreviews" | "agentCrew" | "capabilityEvidence" | "locale"> & { documents?: BlueprintSpecDocument[]; initialPreviews?: BlueprintEffectPreview[]; onPreviewsChange?: (p: BlueprintEffectPreview[]) => void }`
  - 在面板内部派生 `const documents = props.documents ?? props.specTree?.documents ?? [];` 保持原 local function 语义
  - 删除 `BlueprintProgressPanel.tsx` 中 `EffectPreviewWorkbenchPanel` 定义，把调用点改为 `<EffectPreviewPanel .../>`
  - 更新 `specs/panels/EffectPreviewPanel.tsx`：删除 `EFFECT_PREVIEW_PANEL_PLACEHOLDER`，写入 `export { EffectPreviewPanel } from "@/pages/autopilot/right-rail/panels/EffectPreviewPanel";`
  - 更新 `specs/panels/index.ts` barrel：移除 `EFFECT_PREVIEW_PANEL_PLACEHOLDER` 导出，新增 `export { EffectPreviewPanel } from "./EffectPreviewPanel";`
  - 在 `autopilot/right-rail/panels/index.ts` 导出 `EffectPreviewPanel` 与 `EffectPreviewPanelProps`
  - 在 `<AutopilotRightRail>` 的 `case "effect_preview"` 渲染 `<EffectPreviewPanel .../>`，`initialPreviews` / `onPreviewsChange` / `documents` 留空
  - _需求：Requirement 1、2.4、3、5、6.1、7、8、10_

- [x] 5. 抽离 `PromptPackagePanel`（对应 `prompt_package`）
  - 新增 `client/src/pages/autopilot/right-rail/panels/PromptPackagePanel.tsx`
  - 从 `BlueprintProgressPanel.tsx::PromptPackageWorkbenchPanel`（~行 2503–2972）完整搬运
  - 定义 `PromptPackagePanelProps = Pick<AutopilotRightRailProps, "jobId" | "specTree" | "effectPreviews" | "locale"> & { documents?: BlueprintSpecDocument[]; initialPackages?: BlueprintPromptPackage[]; onPackagesChange?: (p: BlueprintPromptPackage[]) => void }`
  - 在面板内部派生 `const documents = props.documents ?? props.specTree?.documents ?? [];`
  - 删除 `BlueprintProgressPanel.tsx` 中 `PromptPackageWorkbenchPanel` 定义，把调用点改为 `<PromptPackagePanel .../>`
  - 更新 `specs/panels/PromptPackagePanel.tsx`：从字符串占位改为单行 re-export
  - 更新 `specs/panels/index.ts` barrel
  - 在 `autopilot/right-rail/panels/index.ts` 导出 `PromptPackagePanel` 与 `PromptPackagePanelProps`
  - 在 `<AutopilotRightRail>` 的 `case "prompt_package"` 渲染 `<PromptPackagePanel jobId={jobId} specTree={specTree} effectPreviews={effectPreviews} locale={locale} />`
  - _需求：Requirement 1、2.5、3、5、6.1、7、8、10_

- [x] 6. 抽离 `RuntimeCapabilityPanel`（对应 `runtime_capability`）
  - 新增 `client/src/pages/autopilot/right-rail/panels/RuntimeCapabilityPanel.tsx`
  - 从 `BlueprintProgressPanel.tsx::RuntimeCapabilityBridgeWorkbenchPanel`（~行 2973–3660）完整搬运（保留函数体内所有 state / effect / callback）
  - 定义 `RuntimeCapabilityPanelProps = Pick<AutopilotRightRailProps, "jobId" | "specTree" | "capabilities" | "capabilityInvocations" | "capabilityEvidence" | "agentCrew" | "locale"> & { initialCapabilities?; initialAgentCrew?; initialInvocations?; initialEvidence?; onCapabilitiesChange?; onAgentCrewChange?; onInvocationsChange?; onEvidenceChange? }`
  - 删除 `BlueprintProgressPanel.tsx` 中 `RuntimeCapabilityBridgeWorkbenchPanel` 定义，把调用点改为 `<RuntimeCapabilityPanel .../>`
  - 更新 `specs/panels/RuntimeCapabilityPanel.tsx`：从字符串占位改为单行 re-export
  - 更新 `specs/panels/index.ts` barrel
  - 在 `autopilot/right-rail/panels/index.ts` 导出
  - 在 `<AutopilotRightRail>` 的 `case "runtime_capability"` 渲染 `<RuntimeCapabilityPanel jobId={jobId} specTree={specTree} capabilities={capabilities} capabilityInvocations={capabilityInvocations} capabilityEvidence={capabilityEvidence} agentCrew={agentCrew} locale={locale} />`
  - _需求：Requirement 1、2.6、3、5、6.1、7、8、10_

- [x] 7. 抽离 `EngineeringHandoffPanel`（对应 `engineering_handoff`）
  - 新增 `client/src/pages/autopilot/right-rail/panels/EngineeringHandoffPanel.tsx`
  - 从 `BlueprintProgressPanel.tsx::EngineeringLandingWorkbenchPanel`（~行 3661–4420）完整搬运，并改名为 `EngineeringHandoffPanel`
  - 定义 `EngineeringHandoffPanelProps = Pick<AutopilotRightRailProps, "jobId" | "locale"> & { promptPackages?: BlueprintPromptPackage[]; initialPlans?; initialRuns?; onLandingPlansChange?; onEngineeringRunsChange? }`
  - 删除 `BlueprintProgressPanel.tsx` 中 `EngineeringLandingWorkbenchPanel` 定义，把调用点改为 `<EngineeringHandoffPanel .../>`
  - 更新 `specs/panels/EngineeringLandingPanel.tsx`：从字符串占位改为单行 re-export，**同时导出两个名字** `EngineeringHandoffPanel`（canonical）与 `EngineeringLandingPanel`（alias 指向同一组件）以兼容历史 import
  - 更新 `specs/panels/index.ts` barrel
  - 在 `autopilot/right-rail/panels/index.ts` 导出 `EngineeringHandoffPanel` 与 `EngineeringHandoffPanelProps`
  - 在 `<AutopilotRightRail>` 的 `case "engineering_handoff"` 渲染 `<EngineeringHandoffPanel jobId={jobId} locale={locale} />`，`promptPackages` / `initialPlans` / `initialRuns` 留空（由 `BlueprintProgressPanel` 组合时才注入）
  - _需求：Requirement 1、2.7、3、5、6.1、7、8、10_

- [x] 8. 抽离 `ArtifactMemoryPanel`（对应 `artifact_memory`）
  - 新增 `client/src/pages/autopilot/right-rail/panels/ArtifactMemoryPanel.tsx`
  - 从 `BlueprintProgressPanel.tsx::ArtifactMemoryWorkbenchPanel`（~行 4421–5270）完整搬运
  - 定义 `ArtifactMemoryPanelProps = Pick<AutopilotRightRailProps, "jobId" | "locale"> & { initialEntries?: BlueprintArtifactLedgerEntry[]; initialReplays?: BlueprintArtifactReplay[]; initialFeedback?: BlueprintArtifactFeedback[] }`
  - 删除 `BlueprintProgressPanel.tsx` 中 `ArtifactMemoryWorkbenchPanel` 定义，把调用点改为 `<ArtifactMemoryPanel .../>`
  - 更新 `specs/panels/ArtifactMemoryPanel.tsx`：从字符串占位改为单行 re-export
  - 更新 `specs/panels/index.ts` barrel
  - 在 `autopilot/right-rail/panels/index.ts` 导出
  - 在 `<AutopilotRightRail>` 的 `case "artifact_memory"` 渲染 `<ArtifactMemoryPanel jobId={jobId} locale={locale} />`
  - _需求：Requirement 1、2.8、3、5、6.1、7、8、10_

- [ ] 9. **[PBT]** Props slice narrowing property 测试
  - 在 `client/src/pages/autopilot/right-rail/panels/__tests__/props-narrowing.property.test.ts` 中定义纯函数 `narrowPropsFor(panelKey, fullProps)`，该函数**只供测试使用**（不进入 `index.ts` barrel）
  - 使用 `fast-check` 生成任意合法 `AutopilotRightRailProps`（可使用 `fc.record` 与 `fc.constant(null)` 等组合 `job / routeSet / selection / specTree / agentCrew` 的 null 与对象值）
  - 对 8 个 `panelKey`，断言：
    - 返回对象的 keys 严格等于设计文档 `design.md` 面板抽离总表中的字段集
    - 每个字段值 `===` 原 `fullProps[key]`（引用相等）
    - 不含额外字段（如 `onSubStageChange`）
    - 原值为 `null` 的字段在 narrow 结果中仍为 `null`（而非 `undefined`）
  - 该测试在任务 1–8 全部完成前即可写入，先用 mock narrow 函数；每次面板抽离合入后同步扩充 8 个 case
  - _需求：Requirement 2.1–2.8、Requirement 8_

- [ ] 10. **[Edge-case]** Shim identity 测试 + Rendering parity 测试
  - 在 `client/src/pages/autopilot/right-rail/panels/__tests__/shim-identity.test.ts` 中，对 8 个面板分别断言：
    ```ts
    import * as shim from "@/pages/specs/panels/<Name>Panel";
    import * as canonical from "@/pages/autopilot/right-rail/panels/<Name>Panel";
    expect(shim.<PanelName>).toBe(canonical.<PanelName>);
    ```
    保证 shim re-export 与 canonical 组件**引用相等**
  - 在 `client/src/pages/autopilot/right-rail/panels/__tests__/rendering-parity.test.tsx` 中，准备一组固定 fixture（`job`, `routeSet`, `selection`, `specTree`, `agentCrew`, `capabilities`, `capabilityInvocations`, `capabilityEvidence`, `effectPreviews`），分别渲染：
    - `<BlueprintProgressPanel autoLoad={false} initialJob={job} initialSpecTree={specTree} initialRouteSet={routeSet} initialSelection={selection} initialEffectPreviews={effectPreviews} initialCapabilities={capabilities} initialAgentCrew={agentCrew} initialCapabilityInvocations={capabilityInvocations} initialCapabilityEvidence={capabilityEvidence} />`
    - 对 8 个 `sub ∈ RAIL_SUB_STAGE_ORDER`：`<AutopilotRightRail jobId={job.id} currentStage="fabric" currentSubStage={sub} job={job} routeSet={routeSet} selection={selection} specTree={specTree} agentCrew={agentCrew} capabilities={capabilities} capabilityInvocations={capabilityInvocations} capabilityEvidence={capabilityEvidence} effectPreviews={effectPreviews} locale={"zh-CN"} onSubStageChange={() => {}} />`
  - 收集两边 `[data-testid]` 节点的 testid 集合，断言 `AutopilotRightRail` 在 `sub === X` 下的 testid 集合 `⊆` 与 `⊇` `BlueprintProgressPanel` 相应段的 testid 集合（即集合相等）
  - 对应 testid 节点的 `className` 与 `textContent` 逐字符相等；对 `EngineeringHandoffPanel` / `ArtifactMemoryPanel` 可放宽为 `className` 相等（`textContent` 含 fetch 占位文本可能差异）
  - 标记为 edge-case 风险测试，不使用 fast-check；fixture 应与真实 job 数据贴近以触达分支
  - _需求：Requirement 3、Requirement 4.4、Requirement 6.5_

- [ ] 11. `<AutopilotRightRail>` fabric dispatch 收口 + 最终 parity 验证
  - 本任务在 8 个面板抽离 PR 全部合入后执行
  - 在 `AutopilotRightRail.tsx` 中把 fabric stage 内 `currentSubStage` 的 switch 收口为一个 `PANEL_MAP: Record<AutopilotRailSubStage, React.ComponentType<any>>` 常量（可选重构），确保 8 个 case 写法一致
  - 确认 `resolveRailSubStage(...)` 返回 `undefined` 的兜底路径（理论不触发）渲染 `<AgentCrewFabricPanel .../>`（Requirement 6.4）
  - 跑定向测试套件：
    - `node --run check`
    - `npm exec vitest run client/src/pages/specs`
    - `npm exec vitest run client/src/pages/autopilot/right-rail`
    - `npm exec vitest run client/src/pages/autopilot/AutopilotRoutePage.test.tsx`
  - 人工回归：打开 `/specs?jobId=<任意已有 job>`，依次检查 SpecTree / SpecDocument / EffectPreview / PromptPackage / RuntimeCapability / EngineeringHandoff / ArtifactMemory 界面，确认 DOM 与抽离前一致
  - 人工回归：打开 `/autopilot`，展开底部 `autopilot-advanced-workbenches` 折叠区，确认 `<BlueprintProgressPanel>` 仍完整渲染
  - 确认 `BlueprintProgressPanel.tsx` 行数显著下降（从 ~5700 行压缩到 ~1500–2000 行）
  - _需求：Requirement 5、Requirement 6、Requirement 7.5、Requirement 10_

- [ ] 12. 单向依赖与 import cycle 守卫校验
  - 跑 `grep -r "BlueprintProgressPanel" client/src/pages/autopilot/right-rail/panels/`，**必须** 0 匹配（Requirement 8.2）
  - 跑 `grep -r "useAppStore\|from \"@/lib/blueprint-api\"" client/src/pages/autopilot/right-rail/panels/`，**必须** 0 匹配（Requirement 2.9）
  - 跑 `grep -r "@/pages/autopilot/right-rail/panels" client/src/pages/specs/BlueprintProgressPanel.tsx`，确认只有一处（或集中的）import，且 import 方向**唯一**为「`BlueprintProgressPanel` → `autopilot/right-rail/panels`」
  - 在 PR 描述或一份简短的 `_shared/README.md`（如果创建了 `_shared/`）中列出本 spec **未变更** 的文件清单：`SpecTreeWorkbenchPanel.tsx`、`SpecDocumentWorkbenchPanel.tsx`、`AutopilotWorkflowRail.tsx`、`shared/blueprint/contracts.ts`、`@/lib/blueprint-api` 签名、所有后端路由
  - _需求：Requirement 2.9、Requirement 8、Requirement 9.1–9.2、Requirement 10_

## 任务执行边界

- 本 spec **不**负责删除 `<details data-testid="autopilot-advanced-workbenches">` 折叠区 — 由 Spec 3 `autopilot-advanced-workbench-inline` 承接。
- 本 spec **不**负责合并 `BlueprintProgressPanel.autoLoad` 的 fetch 到 `useAutopilotRightRailData` hook — 由 Spec 4 `autopilot-right-rail-data-hook` 承接。
- 本 spec **不**承担 `engineering_handoff` / `artifact_memory` 面板数据（`plans / runs / ledger / replays / feedback / promptPackages`）的上提；这些数据在本 spec 完成后仍由 `BlueprintProgressPanel` 持有，通过面板私有 prop 下传。
- 本 spec **不**负责步骤驱动动画 / 自动滚动 / URL `?sub=` 参数 / 键盘快捷键 — 由 Spec 5 `autopilot-step-driven-rail-navigation` 承接。
- 本 spec **不**修改 `client/src/pages/specs/SpecTreeWorkbenchPanel.tsx` 与 `client/src/pages/specs/SpecDocumentWorkbenchPanel.tsx`（Requirement 9.1–9.2）。
- 本 spec **不**修改 `AutopilotWorkflowRail` 的左栏渲染，也不触碰 `input / clarification / routeset / selection` 4 个非-fabric stage 的面板。
- 本 spec **不**引入任何新 `data-testid`、不删除任何现有 `data-testid`、不修改任何 className / 文案 key。
- 本 spec **不**修改后端 REST、Socket、DTO、`BlueprintGenerationJob` 字段。
