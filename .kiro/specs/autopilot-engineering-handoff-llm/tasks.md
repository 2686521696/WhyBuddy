# 实施任务：Autopilot Engineering Handoff LLM 驱动生成

## 概述

本任务清单把 design 文档 §10.1 的 4 个检查点（A 纯函数 helpers + schema + prompt + normalize + render + co-located 单测 → B service 工厂 + context 扩展 + service 单测 → C 外层 hook 接线 + contract 扩展 + fallback E2E guard → D E2E real + fallback + 最终全量回归）收敛为 20 个可验证的代码任务，覆盖：

- `server/routes/blueprint/engineering-handoff/` 目录下 6 个新模块（`policy` / `schema` / `prompt` / `normalize` / `render` / `service`）及其 co-located 单测
- `server/routes/blueprint/context.ts` 的 2 个可选依赖字段扩展（`engineeringHandoffLlmPolicy?` + `engineeringHandoffLlmService?`；**不改 `ctx.llm` 字段** — LLM 能力已在 wt1 默认装配）及默认装配
- `server/routes/blueprint.ts` 中 `buildEngineeringLandingPlan()` 的 async 改造 + `generateEngineeringLandingPlans()` 的 async + `Promise.all` 改造 + 所有调用点追加 `await` + ctx / `clarificationSession` / `domainContext` / `selectedRoute` / `capabilityInvocations` / `capabilityEvidence` 透传 + 9 个模板 helper（`buildEngineeringLandingSteps` / `buildEngineeringPlatformHandoff` / `renderEngineeringPlatformHandoff` / `buildEngineeringLandingVerificationCommands` / `buildEngineeringLandingFileScopes` / `resolveEngineeringLandingPlanStatus` / `resolveEngineeringStepRiskLevel` / `buildEngineeringSourceDocumentStatuses` / `buildEngineeringSourcePreviewStatuses`）一行不改
- `shared/blueprint/contracts.ts` 的 `BlueprintEngineeringLandingPlan.provenance` 7 个可选字段扩展（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）
- `shared/blueprint/events.ts` 中 `BlueprintEventName.MissionHandoff` event payload 追加 3 个可选字段（`landingPlanGenerationSources` / `promptId` / `model`）；**不新增事件名**
- `server/tests/blueprint-routes.test.ts` 追加 2 条 E2E（Real LLM path / Fallback path）
- 最终全量回归（既有 47 E2E + 48 子域单测 + 9 SDK smoke 零回归）

每个任务都对应明确的落点文件、函数与验收标准；所有任务均为本 spec 的必做项，不引入 `*` 可选标记。

依赖顺序：**检查点 A**（tasks 1-11）→ **检查点 B**（tasks 12-14）→ **检查点 C**（tasks 15-17）→ **检查点 D**（tasks 18-20）。每个检查点结束都有一条显式“验证”任务作为质量门禁；任何一条验证失败都必须回到对应实现任务修复后再跑整套回归。

**Requirement 9.3 + design §6.1 lock**：本阶段测试策略为 **example-based only**，**禁止引入 PBT**；若后续 tasks 阶段出现任何被标注为 PBT 的任务，必须显式写出要验证的不变量，否则应改为 example-based。本 spec 未调用 `prework` 工具（与 routeset / spec-tree / spec-documents / effect-preview / prompt-package / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径）。

## 任务列表

### 检查点 A：纯函数 helpers + schema + prompt + normalize + render + co-located 单测（低风险，先做）

- [ ] 1. 新建 `server/routes/blueprint/engineering-handoff/policy.ts`
  - [ ] 1.1 定义并导出 `EngineeringHandoffLlmPolicy` 接口（字段按 design §4.3：`maxInvocationTimeoutMs` / `temperature` / `callJsonRetryAttempts` / `maxTitleLength` / `maxSummaryLength` / `maxMissionSummaryLength` / `minSteps` / `maxSteps` / `maxStepIdLength` / `maxStepTitleLength` / `maxStepSummaryLength` / `maxFileScopesPerStep` / `maxFileScopeLength` / `maxVerificationCommandsPerStep` / `maxVerificationCommandLength` / `maxSourceNodeIdsPerStep` / `maxSourceDocumentIdsPerStep` / `maxSourcePreviewIdsPerStep` / `maxPromptPackageIdsPerStep` / `minHandoffs` / `maxHandoffs` / `maxHandoffSummaryLength` / `minAcceptanceCriteria` / `maxAcceptanceCriteria` / `maxAcceptanceCriterionLength` / `maxRiskNotes` / `maxRiskNoteMessageLength` / `redactionKeywords` / `redactedEmailPattern` / `redactedApiKeyPattern` / `redactedGithubPatPattern` / `maxErrorLength`）
  - [ ] 1.2 实现并导出 `createDefaultEngineeringHandoffLlmPolicy()`：默认 `maxInvocationTimeoutMs = 30_000`；从 `process.env.BLUEPRINT_ENGINEERING_HANDOFF_LLM_TIMEOUT_MS` 读取覆盖值，仅当解析为正整数且 `<= 30_000` 时采用，否则回退到 30_000（design §4.3 + §2.D4）；其它字段按 design §4.3 默认值初始化
  - [ ] 1.3 实现并导出纯函数 `applyEngineeringHandoffRedaction(value: string, policy: EngineeringHandoffLlmPolicy): string`，覆盖 API key（`sk-...` / `clp_...`）、GitHub PAT（`gh[pousr]_...` / `github_pat_...`）、email、Authorization / Bearer / `token=` / `api_key=` / `x-github-token` / `openai-api-key` 等 key-value 对的脱敏
  - [ ] 1.4 **禁止** 在本文件 `import` 任何运行时 / 业务模块（保持纯函数）；仅 `import` TS 内置类型
  - _Requirements: 2.8, 4.5, 5.1_

- [ ] 2. 新建 `server/routes/blueprint/engineering-handoff/policy.test.ts`（~6 条 example-based 单测）
  - [ ] 2.1 断言 `createDefaultEngineeringHandoffLlmPolicy().maxInvocationTimeoutMs === 30_000`（默认值）
  - [ ] 2.2 断言环境变量 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_TIMEOUT_MS="5000"` 被读取后 `maxInvocationTimeoutMs === 5_000`；测试后清理 `process.env`
  - [ ] 2.3 断言非法环境变量值（`"abc"` / `"-1"` / `"99999"` / `"0"`）均回退到 `30_000`
  - [ ] 2.4 断言 `applyEngineeringHandoffRedaction("sk-ABCDEFGHIJKLMNOP1234567890", policy)` 不含原 API key 子串；断言 GitHub PAT (`ghp_` / `github_pat_`) 也被脱敏
  - [ ] 2.5 断言 `applyEngineeringHandoffRedaction("contact alice@example.com", policy)` 不含原邮箱子串；断言 `Authorization: Bearer xxx` / `token=xxx` / `api_key=xxx` 等 key-value 对被脱敏
  - [ ] 2.6 ReDoS 哨兵：构造 5MB 字符串（`"a".repeat(5_000_000)`）调用 `applyEngineeringHandoffRedaction` 耗时 `< 200ms`（`performance.now()` 对比）
  - _Requirements: 5.1, 9.8_

- [ ] 3. 新建 `server/routes/blueprint/engineering-handoff/schema.ts`
  - [ ] 3.1 按 design §4.4 定义所有 leaf enum schema：`StepModeSchema = z.enum(["automatic","manual","handoff"])`、`RiskLevelSchema = z.enum(["low","medium","high"])`、`RiskNoteLevelSchema = z.enum(["info","warning","critical"])`、`PlatformSchema = z.enum(["codex","claude","cursor","kiro","trae","windsurf"])`
  - [ ] 3.2 按 design §4.4 定义 leaf object schema：`StepSchema`（`id?` ≤128、`title` 1..200、`summary` 1..500、`mode`、可选 `fileScopes` 每项 ≤200 且数组 ≤50、可选 `verificationCommands` 每项 ≤500 且数组 ≤20、可选 `riskLevel`、可选 `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `promptPackageIds`）、`HandoffSchema`（`platform`、可选 `promptPackageId` ≤128、可选 `summary` 1..500）、`RiskNoteSchema`（`level` + `message` 1..500）、`MissionMetadataSchema`（可选 `targetPlatform` / `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `promptPackageIds`）
  - [ ] 3.3 定义并导出 `EngineeringHandoffSchemaInput` 接口（字段：`promptPackage` / `sourceNodes` / `sourceDocuments` / `sourcePreviews`）与工厂 `createEngineeringHandoffLlmResponseSchema(input: EngineeringHandoffSchemaInput)`；工厂内部先构造 `resolvableNodeIds` / `resolvableDocumentIds` / `resolvablePreviewIds` / `resolvablePromptPackageIds` / `expectedPlatform` 闭包，再返回 `z.object({...}).superRefine((data, ctx) => {...})`
  - [ ] 3.4 顶层 `z.object({...})`：`title` 1..200、`summary` 1..500、`missionSummary` 1..1000、`missionMetadata: MissionMetadataSchema.default({})`、`steps: z.array(StepSchema).min(1).max(30)`、`acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1).max(20)`、`riskNotes: z.array(RiskNoteSchema).min(0).max(20)`、`handoffs: z.array(HandoffSchema).min(1).max(10)`
  - [ ] 3.5 `.superRefine` 按 design §4.4 实现以下不变量：(1) 顶层 `title` / `summary` / `missionSummary` trim 后非空；(2) `steps[*].id` 在 Plan 内唯一（若提供，trim + lowercase 比较；冲突时 `ctx.addIssue` 指明哪两个 index）；(3) 所有字符串字段 trim 后非空（`steps[*].title` / `steps[*].summary` / `steps[*].fileScopes[*]` / `steps[*].verificationCommands[*]` / `acceptanceCriteria[*]` / `riskNotes[*].message` / `handoffs[*].summary?`）；(4) `steps[*].sourceNodeIds[i]` ∈ `resolvableNodeIds`（若提供，不可解析时 `ctx.addIssue` 指明具体 id）；(5) `steps[*].sourceDocumentIds[i]` ∈ `resolvableDocumentIds`；(6) `steps[*].sourcePreviewIds[i]` ∈ `resolvablePreviewIds`；(7) `steps[*].promptPackageIds[i]` ∈ `resolvablePromptPackageIds`；(8) `handoffs[*].platform === expectedPlatform`（不一致时 `ctx.addIssue` 指明 `expected` / `actual`）；(9) `handoffs[*].promptPackageId`（若提供）等于 `input.promptPackage.id`
  - [ ] 3.6 **不使用 `.strict()`**（zod 默认 strip 行为静默丢弃未知字段，design §2.D8）；**禁止** 任何 `.transform(...)` / `z.coerce.*` / `z.preprocess(...)` coerce 链（需求 3.3）
  - [ ] 3.7 导出类型别名 `export type EngineeringHandoffLlmResponse = z.infer<ReturnType<typeof createEngineeringHandoffLlmResponseSchema>>`、`export type EngineeringHandoffLlmStep = z.infer<typeof StepSchema>`、`export type EngineeringHandoffLlmHandoff = z.infer<typeof HandoffSchema>`、`export type EngineeringHandoffLlmRiskNote = z.infer<typeof RiskNoteSchema>`
  - [ ] 3.8 **禁止** 在本文件 `import` 任何运行时 / 业务模块；仅 `import { z } from "zod"` 与 `import type { BlueprintImplementationPromptPackage, BlueprintSpecDocument, BlueprintSpecTreeNode, BlueprintEffectPreview }` 从 `shared/blueprint/index.js`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. 新建 `server/routes/blueprint/engineering-handoff/schema.test.ts`（~18 条 example-based 单测）
  - [ ] 4.1 合法 minimal payload（1 step + 1 handoff + 1 acceptance + 0 riskNotes）→ `createEngineeringHandoffLlmResponseSchema(input).safeParse(...)` `{ success: true }`
  - [ ] 4.2 合法 full payload（15 steps、5 handoffs、10 acceptance、8 riskNotes、涵盖所有 `mode` / `riskLevel` / `platform` / `riskNote.level` 枚举值组合）→ 通过
  - [ ] 4.3 顶层字段缺失（`steps` / `handoffs` / `acceptanceCriteria` / `missionSummary` / `title` / `summary` 之一缺失）→ 各自失败
  - [ ] 4.4 `steps.length === 0` / `steps.length === 31` → 失败；`handoffs.length === 0` / `handoffs.length === 11` → 失败；`acceptanceCriteria.length === 0` / `.length === 21` → 失败；`riskNotes.length === 21` → 失败
  - [ ] 4.5 `steps[*].mode === "invalid"` → 失败（z.enum 触发）；`steps[*].riskLevel === "critical"` → 失败（`critical` 不是 riskLevel 枚举值）；`riskNotes[*].level === "low"` → 失败（`low` 不是 riskNote.level 枚举值）；`handoffs[*].platform === "openai"` → 失败
  - [ ] 4.6 `steps[*].id` 在数组内重复（两个 `id: "step-1"`）→ `.superRefine` 触发失败，错误消息包含 `"duplicate"` 或 `"unique"`
  - [ ] 4.7 `steps[*].id` 大小写变体仅 trim + lowercase 后冲突（如 `"STEP-1"` 与 `" step-1 "`）→ `.superRefine` 触发失败
  - [ ] 4.8 `steps[*].sourceNodeIds` 包含不在 `input.promptPackage.nodeIds ∪ input.sourceNodes` 中的 id → `.superRefine` 触发失败，错误消息包含该 id 与 `"does not resolve"` 或 `"unknown"`
  - [ ] 4.9 `steps[*].sourceDocumentIds` 引用不可解析 → 失败；`steps[*].sourcePreviewIds` 引用不可解析 → 失败
  - [ ] 4.10 `steps[*].promptPackageIds` 包含非 `input.promptPackage.id` 的值 → 失败
  - [ ] 4.11 `handoffs[*].platform` 与 `input.promptPackage.targetPlatform` 不一致（如 targetPlatform=`codex` 但 handoff.platform=`claude`）→ `.superRefine` 触发失败，错误消息包含 `expected` 与 `actual` platform
  - [ ] 4.12 `handoffs[*].promptPackageId` 提供但不等于 `input.promptPackage.id` → 失败
  - [ ] 4.13 `title` / `summary` / `missionSummary` trim 后全空格（`"   "`）→ `.superRefine` 触发失败
  - [ ] 4.14 `steps[*].title` / `steps[*].summary` / `acceptanceCriteria[*]` / `riskNotes[*].message` / `handoffs[*].summary` trim 后全空格 → 失败
  - [ ] 4.15 字符串越界：`title` 201 字符 / `summary` 501 字符 / `missionSummary` 1001 字符 / `steps[*].title` 201 字符 / `acceptanceCriteria[i]` 501 字符 → 失败
  - [ ] 4.16 数组元素越界：`steps[*].fileScopes.length > 50` / `steps[*].verificationCommands.length > 20` / `steps[*].sourceNodeIds.length > 50` / `steps[*].promptPackageIds.length > 10` → 失败
  - [ ] 4.17 `missionMetadata` 为空对象 `{}` → 通过（`.default({})` 兜底）；`missionMetadata` 缺失 → 通过（default 生效）
  - [ ] 4.18 未知顶层字段（`author: "alice"` / `extraData: {...}`）→ zod strip 静默丢弃，不影响 `safeParse.success`；未知 step / handoff / riskNote / missionMetadata 字段同样静默丢弃
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.2_

- [ ] 5. 新建 `server/routes/blueprint/engineering-handoff/prompt.ts`
  - [ ] 5.1 导出常量 `ENGINEERING_HANDOFF_PROMPT_ID = "blueprint.engineering-handoff.v1"` 与类型 `EngineeringHandoffPromptPayload`（字段：`promptId` / `systemMessage` / `userMessage` / `userPayload` / `promptFingerprint`）
  - [ ] 5.2 定义并导出 `BuildEngineeringHandoffPromptInput` 类型（按 design §4.5：`promptPackage` / `sourceNodes` / `sourceDocuments` / `sourcePreviews` / `selectedRoute?` / `specTreeSummary?` / `clarificationSession?` / `domainContext?` / `capabilityInvocations?` / `capabilityEvidence?` / `locale` / `status`）
  - [ ] 5.3 实现 `buildEngineeringHandoffPrompt(input)`：按 design §4.5 构造 `userPayload`，字段顺序固定为 `{ promptId, promptPackage, sourceNodes, sourceDocuments, sourcePreviews, primaryRoute?, specTreeSummary?, intake, clarification, projectContext, capabilityInvocations?, capabilityEvidence?, status, outputSchema, resolvableIds }`；`clarification.answers` 按 `questionId` 字典序排序；`primaryRoute.steps` 保留原始顺序；`sourceNodes` / `sourceDocuments` / `sourcePreviews` 按输入顺序；`githubUrls` 保留输入顺序；`resolvableIds` 包含 `nodeIds` / `documentIds` / `previewIds` / `promptPackageIds` 四个可解析集合
  - [ ] 5.4 实现 locale-aware `systemMessage`：`locale === "zh-CN"` 时使用中文 Engineering Handoff 推理器文案（含 CJK），否则英文文案（以 `"You are the /autopilot Engineering Handoff planner"` 之类开头）；两个版本都覆盖 design §4.5 列出的约束：必须产出 `title` / `summary` / `missionSummary` / `missionMetadata` / `steps` / `acceptanceCriteria` / `riskNotes` / `handoffs`；`handoffs[*].platform` 必须等于 `promptPackage.targetPlatform`；所有 `steps[*].sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `promptPackageIds` 必须在 resolvableIds 中；不要在产出中包含真实凭据 / token / apiKey 字面量
  - [ ] 5.5 `userMessage = JSON.stringify(userPayload, null, 2)`；`promptFingerprint = "sha256:" + sha256Hex(systemMessage + "\n\n" + userMessage)`（复用 `server/core/ids.ts` 或等价 hash helper）
  - [ ] 5.6 **禁止** 在本文件 `import` `callLLMJson` / `getAIConfig` / `fetch`；仅允许 `import type` shared blueprint 类型 + 一个 sha256 纯 helper
  - _Requirements: 2.2, 2.5, 3.1, 3.2_


- [ ] 6. 新建 `server/routes/blueprint/engineering-handoff/prompt.test.ts`（~10 条 example-based 单测）
  - [ ] 6.1 断言确定性：同一组 `(promptPackage, sourceNodes, sourceDocuments, sourcePreviews, selectedRoute, clarificationSession, domainContext, status, locale)` 两次调用 `buildEngineeringHandoffPrompt` 产出**字节相同** `userMessage` 与 `promptFingerprint`
  - [ ] 6.2 断言输入变化敏感：追加一条新的 clarification answer 后 `userMessage` 与 `promptFingerprint` 均变化
  - [ ] 6.3 断言 `clarification.answers` 按 `questionId` 字典序排序（输入 `["q-c","q-a","q-b"]` → 输出顺序 `["q-a","q-b","q-c"]`）
  - [ ] 6.4 断言 `locale === "zh-CN"` 时 `systemMessage` 包含 CJK 字符（正则 `/[\u4e00-\u9fff]/`）
  - [ ] 6.5 断言 `locale === "en-US"` 时 `systemMessage` 不含 CJK 且以英文开头（例如 `/^You are the \/autopilot Engineering Handoff/`）
  - [ ] 6.6 断言 `ENGINEERING_HANDOFF_PROMPT_ID === "blueprint.engineering-handoff.v1"` 与 prompt 输出的 `userPayload.promptId` / 返回的 `promptId` 一致
  - [ ] 6.7 断言 `primaryRoute.steps` 在 `userPayload` 中保留原始顺序（不被字典序排序）；`sourceNodes` / `sourceDocuments` / `sourcePreviews` 同样保留输入顺序
  - [ ] 6.8 断言 `userPayload.outputSchema` 包含 `steps[*].mode` 的 3 个枚举值、`riskLevel` 的 3 个枚举值、`riskNotes[*].level` 的 3 个枚举值、`handoffs[*].platform` 的 6 个枚举值的文案提示
  - [ ] 6.9 断言 `userPayload.resolvableIds` 准确反映 `promptPackage.nodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `[promptPackage.id]` 的并集；断言当 `sourceNodes` / `sourceDocuments` / `sourcePreviews` 外参给出 superset 时 resolvableIds 包含它们
  - [ ] 6.10 可选 capability 输入分支：当 `capabilityInvocations` / `capabilityEvidence` 为 undefined 时 `userPayload` 不包含对应块；当提供时包含摘要块，且 `capabilityInvocations[*].id` / `capabilityEvidence[*].id` 按输入顺序出现
  - _Requirements: 2.2, 3.1, 3.2, 9.2_

- [ ] 7. 新建 `server/routes/blueprint/engineering-handoff/normalize.ts`
  - [ ] 7.1 导出类型 `NormalizeEngineeringHandoffInput`（字段：`validated: EngineeringHandoffLlmResponse` + `resolverInput: EngineeringHandoffSchemaInput` + `policy: EngineeringHandoffLlmPolicy` + `status: BlueprintEngineeringLandingPlanStatus`）与 `NormalizeEngineeringHandoffOutput`（字段：`title` / `summary` / `missionSummary` / `missionMetadata` / `steps: NormalizedStep[]` / `handoffs: NormalizedHandoff[]` / `acceptanceCriteria` / `riskNotes`）
  - [ ] 7.2 实现纯函数 `normalizeEngineeringHandoffResponse(input)`：按 design §D8 / §4.4 规范化步骤：(1) trim 所有字符串字段首尾空白；(2) 对缺失的 `steps[*].id` 由 title slug 化生成并去重（`-2` / `-3` 后缀），已提供 id 的则直接 trim 保留；(3) 对 `steps[*].fileScopes` / `verificationCommands` / `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `promptPackageIds` 去重并保序；(4) 为缺失的 `riskLevel` 补齐默认值——沿用今天 `resolveEngineeringStepRiskLevel(status, mode)` 的派生规则（直接从 `server/routes/blueprint.ts` 中导出该 helper 或重新调用）；(5) 为缺失的 `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `promptPackageIds` 按 promptPackage 派生默认集合（对齐今天 `buildEngineeringLandingSteps()` 的 scaffold 语义）；(6) 防御性裁剪过长字符串至 schema 允许的上界（schema 已限长，此步为防护）；(7) `missionMetadata` 原样透传（只保留 schema 已声明的字段，未知字段已被 zod strip）
  - [ ] 7.3 仅 `import type` 已有类型 + `import { resolveEngineeringStepRiskLevel } from "../../blueprint.js"`（或把该 helper 暴露在 context 上由 service 传入）；不引入运行时业务依赖
  - _Requirements: 3.6_

- [ ] 8. 新建 `server/routes/blueprint/engineering-handoff/normalize.test.ts`（~7 条 example-based 单测）
  - [ ] 8.1 合法 validated payload + 缺失所有可选 step 字段（`id` / `fileScopes` / `verificationCommands` / `riskLevel` / `sourceNodeIds` / ...）→ 输出所有可选字段被补齐默认值：`id` 为 slug 化 title；`fileScopes` / `verificationCommands` 空数组；`riskLevel` 为 `resolveEngineeringStepRiskLevel(status, mode)` 返回值；`sourceNodeIds` 等为 promptPackage 派生默认
  - [ ] 8.2 `steps[*].id` 同 title 重复时去重为 `"refactor-dashboard"` / `"refactor-dashboard-2"` / `"refactor-dashboard-3"`
  - [ ] 8.3 `fileScopes` / `verificationCommands` 含重复项（`["src/a.ts","src/a.ts","src/b.ts"]`）→ 去重后保序为 `["src/a.ts","src/b.ts"]`
  - [ ] 8.4 所有字符串字段 trim 首尾空白（`" Title "` → `"Title"`）；trim 后 `steps[*].id` slug 化不受首尾空白影响
  - [ ] 8.5 `missionMetadata` 含未知字段时 schema 已 strip，normalize 阶段不重新引入；已声明的 `targetPlatform` / `sourceNodeIds` 等原样透传
  - [ ] 8.6 各 `steps[*].mode` ∈ `{automatic,manual,handoff}` 下 `resolveEngineeringStepRiskLevel(status, mode)` 派生 `riskLevel` 的映射与今天 `buildEngineeringLandingSteps()` 的期望一致（用 3 个 status × 3 个 mode 的笛卡尔组合断言）
  - [ ] 8.7 防御性裁剪：若传入字符串虽已过 schema 但长度接近上界，normalize 不再裁切（幂等）；若某字段因某种异常路径超过 policy 上界，normalize 裁切至 `.slice(0, maxXxx)` 且不破坏 UTF-8 字符
  - _Requirements: 3.6, 9.2_

- [ ] 9. 新建 `server/routes/blueprint/engineering-handoff/render.ts`
  - [ ] 9.1 导出纯函数 `renderEngineeringHandoffSummary(args: { llmSummary: string; missionSummary: string; policy: EngineeringHandoffLlmPolicy }): string`：按 §D11 将 `missionSummary` 作为前缀块注入 `summary` — 输出格式为 `` `${llmSummary}\n\n**Mission summary**\n${missionSummary}` ``；若合并后长度 `> policy.maxSummaryLength`，优先保留 `missionSummary` 完整 + `"**Mission summary**"` 标签，再把前段 `llmSummary` 截断到剩余空间并以 `"…"` 结尾；最终长度不超过 `policy.maxSummaryLength`
  - [ ] 9.2 导出纯函数 `renderEngineeringHandoffContent(args: { basePlatformContent: string; acceptanceCriteria: string[]; riskNotes: RenderedEngineeringRiskNote[]; policy: EngineeringHandoffLlmPolicy }): string`：按 §D11 将 `acceptanceCriteria` / `riskNotes` 作为追加段注入 `handoffs[0].content` — 在 `basePlatformContent` 末尾追加 `"\n\n## Acceptance criteria\n- item1\n- item2\n..."` 段（若数组非空）+ `"\n\n## Risk notes\n- **info**: msg1\n- **warning**: msg2\n..."` 段（若数组非空）；若 `acceptanceCriteria` 与 `riskNotes` 均为空，直接返回 `basePlatformContent` 不追加
  - [ ] 9.3 不 mutate 输入参数；不 `import` 运行时业务模块
  - _Requirements: 2.4, 2.6（D11 落点）_

- [ ] 10. 新建 `server/routes/blueprint/engineering-handoff/render.test.ts`（~5 条 example-based 单测）
  - [ ] 10.1 `renderEngineeringHandoffSummary`：`llmSummary="Deploy dashboard"` + `missionSummary="Rollback plan attached."` → 输出 `"Deploy dashboard\n\n**Mission summary**\nRollback plan attached."`
  - [ ] 10.2 `renderEngineeringHandoffSummary`：合并后超长（policy.maxSummaryLength=100，llmSummary=80 字符，missionSummary=50 字符）→ 输出完整 missionSummary + 标签 + 截断的 llmSummary + `"…"`，总长度 ≤100
  - [ ] 10.3 `renderEngineeringHandoffContent`：basePlatformContent 非空 + acceptanceCriteria=`["A","B"]` + riskNotes=`[{level:"warning",message:"X"}]` → 输出包含 `## Acceptance criteria\n- A\n- B` 与 `## Risk notes\n- **warning**: X` 两个段
  - [ ] 10.4 `renderEngineeringHandoffContent`：acceptanceCriteria=[] + riskNotes=[] → 输出与 basePlatformContent 完全相同
  - [ ] 10.5 确定性：相同输入两次调用产出相同字符串（`renderEngineeringHandoffSummary` / `renderEngineeringHandoffContent` 均纯函数）
  - _Requirements: 2.4, 9.2_

- [ ] 11. **Checkpoint A 验证** — 运行纯函数子域单测
  - [ ] 11.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 11.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/engineering-handoff/policy.test.ts server/routes/blueprint/engineering-handoff/schema.test.ts server/routes/blueprint/engineering-handoff/prompt.test.ts server/routes/blueprint/engineering-handoff/normalize.test.ts server/routes/blueprint/engineering-handoff/render.test.ts` → ~46 条新增单测全绿（policy ~6 + schema ~18 + prompt ~10 + normalize ~7 + render ~5）
  - [ ] 11.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 11.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（A 阶段尚未接线，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 B：Service 工厂 + Context 扩展 + 单测（依赖 A）

- [ ] 12. 新建 `server/routes/blueprint/engineering-handoff/service.ts`：`createEngineeringHandoffLlmService(ctx)` 工厂 + 主算法
  - [ ] 12.1 按 design §4.2 定义并导出接口 `EngineeringHandoffLlmServiceInput`（字段：`jobId` / `job` / `specTree` / `promptPackage` / `sourceNodes` / `sourceDocuments` / `sourcePreviews` / `selectedRoute?` / `clarificationSession?` / `domainContext?` / `capabilityInvocations?` / `capabilityEvidence?` / `status` / `createdAt`）与 `EngineeringHandoffLlmServiceOutput`（字段：`generationSource` / `renderedTitle?` / `renderedSummary?` / `renderedSummaryWithMissionPrefix?` / `renderedSteps?` / `renderedHandoffs?` / `missionSummary?` / `acceptanceCriteria?` / `riskNotes?` / `missionMetadata?` / `promptId?` / `model?` / `promptFingerprint?` / `responseDigest?` / `structuredPayloadDigest?` / `error?`）；导出类型别名 `EngineeringHandoffLlmService = (input) => Promise<EngineeringHandoffLlmServiceOutput>`；同时导出内部 render step / handoff / risk note 的类型 `RenderedEngineeringStep` / `RenderedEngineeringHandoff` / `RenderedEngineeringRiskNote`
  - [ ] 12.2 导出工厂 `createEngineeringHandoffLlmService(ctx: BlueprintServiceContext): EngineeringHandoffLlmService`，工厂在闭包内解析 `policy = ctx.engineeringHandoffLlmPolicy ?? createDefaultEngineeringHandoffLlmPolicy()`
  - [ ] 12.3 按 design §4.6 / §3.2-3.3 实现 service 主算法的六档 fallback：
    - 档位 1（未启用）：`process.env.BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED !== "true"` → 早退 `{ generationSource: "template" }`，`ctx.logger.debug("engineering-handoff llm: not enabled, using template")`
    - 档位 2（apiKey 缺失）：`ctx.llm.getConfig().apiKey` 为空 → 早退 `{ generationSource: "template" }`（design §4.6 + §5.1 锁定此口径与档位 1 合流），不填 `error` / `promptId` / `model`；`ctx.logger.debug("engineering-handoff llm: apiKey missing, using template")`
    - 档位 3（callJson 抛错 / 非 JSON）：try/catch `ctx.llm.callJson`；若抛错 → `{ generationSource: "llm_fallback", promptId, model, promptFingerprint, error: applyEngineeringHandoffRedaction("llm callJson threw: " + error.message, policy).slice(0, policy.maxErrorLength) }`；若返回 undefined / null / non-object → `{ ..., error: "non-json response" }`
    - 档位 4 / 5（schema + `.superRefine` 不变量失败）：`createEngineeringHandoffLlmResponseSchema(input).safeParse(rawPayload)` 返回 `success: false` → `{ generationSource: "llm_fallback", error: "schema validation failed: " + formatZodError(parsed.error) }`（经 redaction 脱敏 + 截断）
    - 档位 6（超时）：callJson 因 `timeoutMs: policy.maxInvocationTimeoutMs` 触发 AbortError → fallback，`error: "llm timeout"`（通过正则 `/abort|timeout/i` 识别错误文本）
  - [ ] 12.4 Happy path：`parsed.success === true` → 调用 `normalizeEngineeringHandoffResponse({ validated: parsed.data, resolverInput, policy, status: input.status })`；再用 `renderEngineeringHandoffSummary` 生成 `renderedSummaryWithMissionPrefix`；计算 `responseDigest = "sha256:" + sha256Hex(JSON.stringify(rawPayload))`、`structuredPayloadDigest = "sha256:" + sha256Hex(JSON.stringify(parsed.data))`；返回 `{ generationSource: "llm", renderedTitle: normalized.title, renderedSummary: normalized.summary, renderedSummaryWithMissionPrefix, renderedSteps: normalized.steps, renderedHandoffs: normalized.handoffs, missionSummary: normalized.missionSummary, acceptanceCriteria: normalized.acceptanceCriteria, riskNotes: normalized.riskNotes, missionMetadata: normalized.missionMetadata, promptId, model, promptFingerprint, responseDigest, structuredPayloadDigest }`
  - [ ] 12.5 LLM 调用参数固定为 `{ model: aiConfig.model, temperature: policy.temperature, timeoutMs: policy.maxInvocationTimeoutMs, retryAttempts: policy.callJsonRetryAttempts, sessionId: input.clarificationSession?.id ?? input.job.clarificationSessionId ?? undefined }`
  - [ ] 12.6 所有 logger.warn / logger.debug meta 字段（`promptId` / `promptPackageId: input.promptPackage.id` / `error`）经 `applyEngineeringHandoffRedaction` 脱敏后再传入 logger
  - [ ] 12.7 **硬约束**（design §2.D1）：本文件 SHALL NOT `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；所有 LLM 能力来自 `ctx.llm.callJson` + `ctx.llm.getConfig`；不得 import 模块级 eventBus / jobStore 单例
  - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7, 2.8, 3.5, 3.6, 4.1, 4.5, 5.1, 7.1, 7.2, 7.4, 7.5_

- [ ] 13. 扩展 `server/routes/blueprint/context.ts`：追加 2 个可选依赖字段 + 默认装配
  - [ ] 13.1 在 `BlueprintServiceContext` 与 `BlueprintServiceContextDeps` 上追加 2 个可选字段：`engineeringHandoffLlmPolicy?: EngineeringHandoffLlmPolicy`、`engineeringHandoffLlmService?: EngineeringHandoffLlmService`；类型仅 `import type`，不 import 工厂实现避免循环依赖
  - [ ] 13.2 **不改 `ctx.llm` 字段**：`ctx.llm.callJson` / `ctx.llm.getConfig` 已在 wt1 默认装配，本 spec 只消费不扩展（需求 7.1 + design §2.D2）
  - [ ] 13.3 在 `buildBlueprintServiceContext(deps)` 中：`deps.engineeringHandoffLlmPolicy ?? createDefaultEngineeringHandoffLlmPolicy()`；若 `deps.engineeringHandoffLlmService` 未注入，使用 `createEngineeringHandoffLlmService(ctx)` 构造默认实例挂载到 `ctx.engineeringHandoffLlmService`
  - [ ] 13.4 保持向后兼容：`deps` 完全不传 policy / service 字段时，既有单测与 E2E 无感知（默认装配后 service 仍因档位 1 早退 → template 路径）
  - [ ] 13.5 `node --run check` 确认类型扩展未引入新 TS 错误
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.2_


- [ ] 14. 新建 `server/routes/blueprint/engineering-handoff/service.test.ts`：R9.2 四条硬需求 + ~6 条补充
  - [ ] 14.1 **Happy path（R9.2 happy）**：注入 fake `callJson` 返回合法 payload（`title="Deploy dashboard"`、`summary="..."`、`missionSummary="..."`、`missionMetadata={}`、`steps=[{title:"Configure build",summary:"...",mode:"automatic"}]`、`acceptanceCriteria=["Smoke test passes"]`、`riskNotes=[]`、`handoffs=[{platform:"codex"}]`，其中 platform 与 input.promptPackage.targetPlatform 一致）→ 断言 `result.generationSource === "llm"`、`result.renderedTitle === "Deploy dashboard"`、`result.renderedSteps.length === 1`、`result.renderedSummaryWithMissionPrefix` 包含 `"**Mission summary**"`、`result.promptId === "blueprint.engineering-handoff.v1"`、`result.structuredPayloadDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`result.error` 为 undefined
  - [ ] 14.2 **Malformed JSON（R9.2 malformed）**：fake `callJson: async () => undefined` → 断言 `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/non-json response/`、`result.renderedSteps` 为 undefined；再覆盖 `async () => "garbage string"` 与 `async () => 42` 两个子场景
  - [ ] 14.3 **Schema fails（R9.2 schema-fail）**：分别注入 payload：(a) `steps=[]`（空数组），(b) `handoffs=[]`，(c) `acceptanceCriteria=[]`，(d) `steps[*].id` 重复，(e) `steps[*].mode="unknown"`，(f) `steps[*].sourceNodeIds` 指向不存在的节点，(g) `handoffs[0].platform` 与 `input.promptPackage.targetPlatform` 不一致，(h) `handoffs[0].promptPackageId` 不等于 `input.promptPackage.id`，(i) `title` 全空格 → 每个子场景断言 `result.generationSource === "llm_fallback"`、`result.error` 包含 `"schema validation failed"` 或具体约束描述（`"platform"` / `"duplicate"` / `"does not resolve"` / `"empty"` 等）
  - [ ] 14.4 **ApiKey missing（R9.2 apiKey-missing）**：fake `getConfig: () => ({ model: "gpt-4-turbo", apiKey: "" })` + callJson spy → 断言 `result.generationSource === "template"`（design §6.3.4 锁定与档位 1 合流的口径）、`callJson` spy 未被调用、`result.error` / `result.promptId` / `result.model` 均为 undefined
  - [ ] 14.5 **补充：Not enabled**：未设环境变量 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED` → `result.generationSource === "template"` + callJson spy 未被调用 + `ctx.logger.debug` 被调用
  - [ ] 14.6 **补充：Timeout**：fake `callJson: async () => { throw new Error("Request aborted due to timeout") }` → `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/llm timeout/`（通过 `/abort|timeout/i` 路径识别）
  - [ ] 14.7 **补充：Redaction E2E**：fake `callJson` 抛错 message 包含 `"sk-ABCDEFGHIJKLMNOP1234567890"` 与 `"alice@example.com"` → 断言 `result.error` 不含这两个原文子串（已脱敏）；断言 `ctx.logger.warn` 接收的 meta 中也不含原文
  - [ ] 14.8 **补充：Per-plan isolation**：在同一个测试夹具里构造两次不同 `promptPackage` 的 service 调用，一次 LLM 成功，一次 LLM 抛错 → 断言两次结果的 `generationSource` / `error` / `promptFingerprint` 独立；两次 `callJson` 调用接收的 messages 差异与 prompt 确定性一致
  - [ ] 14.9 **补充：Platform mismatch recovery**：fake `callJson` 首次返回 platform 不匹配的 payload → 断言进入 fallback；验证 error 消息包含 `"platform"` 字样
  - [ ] 14.10 **补充：Logger meta 含 promptPackageId**：任何 `logger.warn` / `logger.debug` 路径的 meta 对象包含 `promptPackageId` 字段（便于 per-plan 故障排查）
  - _Requirements: 5.3, 9.2_

- [ ] 15. **Checkpoint B 验证** — 运行完整子域测试
  - [ ] 15.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 15.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/engineering-handoff/` → ~56 条新增 co-located 单测全绿（policy ~6 + schema ~18 + prompt ~10 + normalize ~7 + render ~5 + service ~10）
  - [ ] 15.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 15.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（B 阶段 service 已装配但未接入 `buildEngineeringLandingPlan`，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 C：外层 hook 接线 + contract 扩展 + fallback E2E guard（依赖 B）

- [ ] 16. 改造 `server/routes/blueprint.ts` 的 `buildEngineeringLandingPlan()` 与 `generateEngineeringLandingPlans()`
  - [ ] 16.1 把 `buildEngineeringLandingPlan` 签名从 sync 改为 `async (ctx: BlueprintServiceContext, input: { job, specTree, promptPackage, sourceDocuments, sourcePreviews, createdAt, clarificationSession?, domainContext?, selectedRoute?, capabilityInvocations?, capabilityEvidence? }): Promise<BlueprintEngineeringLandingPlan>`
  - [ ] 16.2 **纯 extract** 内部辅助不动：`buildEngineeringLandingSteps` / `buildEngineeringPlatformHandoff` / `renderEngineeringPlatformHandoff` / `buildEngineeringLandingVerificationCommands` / `buildEngineeringLandingFileScopes` / `resolveEngineeringLandingPlanStatus` / `resolveEngineeringStepRiskLevel` / `buildEngineeringSourceDocumentStatuses` / `buildEngineeringSourcePreviewStatuses` 9 个 helper **一行不改**（design §4.1 最终清单锁定）；本 spec 仅在 `buildEngineeringLandingPlan` 内部新增 LLM 分支
  - [ ] 16.3 改造核心路径：先计算 `planId` / `status = resolveEngineeringLandingPlanStatus(...)` / `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `promptPackageIds` / `sourceNodes`（按 `promptPackage.nodeIds` 过滤 `specTree.nodes`）/ 过滤后的 `sourceDocuments` / `sourcePreviews` 等 scaffold；`await ctx.engineeringHandoffLlmService?.(...)` 传入 `jobId: job.id` / `job` / `specTree` / `promptPackage` / `sourceNodes` / `sourceDocuments` / `sourcePreviews` / `selectedRoute` / `clarificationSession` / `domainContext` / `capabilityInvocations` / `capabilityEvidence` / `status` / `createdAt`
  - [ ] 16.4 `serviceResult?.generationSource === "llm"` 分支：使用 LLM 产出替换内容字段 — `title = serviceResult.renderedTitle`、`summary = serviceResult.renderedSummaryWithMissionPrefix`（§D11 前缀注入）、`steps` 由 `renderedSteps` 与外层派生的结构字段合并（`steps[i].id` / `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `promptPackageIds`：LLM 提供优先，否则由 promptPackage 派生；`steps[i].title` / `summary` / `mode` / `fileScopes` / `verificationCommands` / `riskLevel` 来自 LLM）、`handoffs[0]` 的 `title` / `summary` / `content` 来自 LLM（`content` 经 `renderEngineeringHandoffContent` 注入 acceptance / risk 段 §D11），`platform` / `promptPackageId` / `sourceNodeIds` / `verificationCommands` 仍由外层派生不变；`provenanceExtras = { generationSource: "llm", promptId, model, responseDigest, structuredPayloadDigest, promptFingerprint }`
  - [ ] 16.5 否则（template / llm_fallback）分支：执行今天的模板化路径一行不改 — 调用 `buildEngineeringLandingSteps(input)` / `buildEngineeringPlatformHandoff(...)` / `renderEngineeringPlatformHandoff(...)` 产出 `steps` / `handoffs[0]`；`title` / `summary` 使用今天的固定字符串（`` `Engineering landing plan: ${targetLabel}` `` / `` `Land ${promptPackage.title} for ${targetLabel}...` ``）；`provenanceExtras = { generationSource: serviceResult?.generationSource ?? "template", promptId: serviceResult?.promptId, model: serviceResult?.model, promptFingerprint: serviceResult?.promptFingerprint, error: serviceResult?.error }`
  - [ ] 16.6 合并 provenance：保留所有既有字段不变（`jobId` / `projectId` / `sourceId` / `targetText` / `githubUrls` / `treeVersion` / `promptPackageIds` / `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `sourceDocumentStatus` / `sourcePreviewStatus` / `sourceDocumentStatuses` / `sourcePreviewStatuses` / `promptPackagePlatforms`），以 `...provenanceExtras` 对象 spread 方式追加 7 个新字段
  - [ ] 16.7 把 `generateEngineeringLandingPlans` 签名从 sync 改为 `async (ctx: BlueprintServiceContext, job, specTree, request, options): Promise<BlueprintEngineeringLandingPlansResponse>`；内部 `selectedPromptPackages.promptPackages.map(promptPackage => buildEngineeringLandingPlan({...}))` 同步调用改为 `await Promise.all(selectedPromptPackages.promptPackages.map(async promptPackage => buildEngineeringLandingPlan(ctx, {...})))`；`Promise.all` 保留索引顺序 → 响应体 `engineeringLandingPlans[*]` 顺序与今天 `.map(...)` 产出的顺序**字节相同**（需求 5.6）
  - [ ] 16.8 在 `generateEngineeringLandingPlans` emit `BlueprintEventName.MissionHandoff` 时，追加可选 payload 字段：`landingPlanGenerationSources: plans.map(p => ({ landingPlanId: p.id, promptPackageId: p.promptPackageIds[0], generationSource: p.provenance.generationSource }))`；`promptId = plans.find(p => p.provenance.promptId)?.provenance.promptId` / `model = plans.find(p => p.provenance.model)?.provenance.model`（任一 Plan 走过 LLM 时填充）；既有 payload 字段（`specTreeId` / `landingPlanIds` / `promptPackageIds` / `targetPlatforms` / `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `sourceIds`）一字段不改
  - [ ] 16.9 调用点追加 `await`：`generateEngineeringLandingPlans()` 的 HTTP handler、以及 `grep -nE "(generateEngineeringLandingPlans|buildEngineeringLandingPlan)\(" server/ shared/ --include="*.ts"` 发现的其它调用点；所有调用方改为 `async` 并透传 `ctx` + 可选上游字段（`clarificationSession` / `domainContext` / `selectedRoute` / `capabilityInvocations` / `capabilityEvidence`：若上游已存在则透传真实值，否则 undefined）
  - [ ] 16.10 所有事件 type 走 `BlueprintEventName.MissionHandoff` 常量（禁止裸字符串 `"mission.handoff"`）
  - _Requirements: 2.2, 2.4, 2.6, 2.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.2_

- [ ] 17. 扩展 `shared/blueprint/contracts.ts`：`BlueprintEngineeringLandingPlan.provenance` 追加 7 个可选字段
  - [ ] 17.1 在 `BlueprintEngineeringLandingPlan.provenance` 类型中追加 7 个可选字段：`generationSource?: "llm" | "llm_fallback" | "template"`、`promptId?: string`、`model?: string`、`responseDigest?: string`、`structuredPayloadDigest?: string`、`promptFingerprint?: string`、`error?: string`；全部可选（design §4.9 + §2.D6）；不删除、不重命名、不修改任何既有 provenance 字段；不改 `BlueprintEngineeringLandingPlan` 顶层字段；不改 `BlueprintEngineeringLandingStep` / `BlueprintPlatformHandoff` / `BlueprintEngineeringLandingStepMode` / `BlueprintEngineeringLandingRiskLevel` / `BlueprintEngineeringLandingPlanStatus`
  - [ ] 17.2 在仓库根运行 `node --run check`，确认新增字段不引入新 TS 错误；grep 既有 `BlueprintEngineeringLandingPlan.provenance` / `landingPlan.provenance` 消费点确认没有因字段追加而断言失败
  - [ ] 17.3 同步确认 `client/src/lib/blueprint-api/` 下的 SDK normalizer：若使用 object spread 或透明透传，不需改动；若使用显式字段映射，追加 ~7 行可选字段透传（不修改任一既有字段映射行为）
  - [ ] 17.4 同步确认 `shared/blueprint/events.ts` 的 `MissionHandoff` payload 类型：若当前使用 `Record<string, unknown>` 或宽松 payload 类型，不改动；若强类型则追加 3 个可选字段（`landingPlanGenerationSources?` / `promptId?` / `model?`）
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 6.1, 6.2, 6.5, 8.2, 8.4_

- [ ] 18. **Checkpoint C 验证** — 运行既有 47 E2E + 48 子域 + 9 SDK smoke 确认零回归
  - [ ] 18.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 18.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（未设 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED` → 档位 1 早退 → template 路径 → 字节级等价今天）
  - [ ] 18.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测 + ~56 条新增 co-located 单测全部通过
  - [ ] 18.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [ ] 18.5 本阶段断言点：`engineeringLandingPlans[*].provenance.generationSource === "template"` 在默认装配下可断言；fallback 路径下 `BlueprintEngineeringLandingPlan.title` 仍以 `"Engineering landing plan:"` 开头、`steps.length === 3` 且 `steps[0].title === "Bind landing sources"` / `steps[1].title === "Apply repository bridge"` / `steps[2].title === "Capture run evidence"`、`handoffs[0].title` 以 `"Platform handoff:"` 开头，与今天字节相同；响应体 `engineeringLandingPlans[*]` 数组顺序、长度与 `promptPackageIds` 覆盖集合与今天完全一致（R5.6 口径）
  - _Requirements: 5.3, 5.4, 5.5, 5.6, 8.1, 8.3, 8.5, 8.6, 9.6_


### 检查点 D：E2E real + fallback + 最终全量回归（依赖 C）

- [ ] 19. 在 `server/tests/blueprint-routes.test.ts` 追加 2 条新 E2E 用例
  - [ ] 19.1 **用例 1（Real LLM path，需求 9.1a）**：`it("buildEngineeringLandingPlan produces LLM-driven title/summary/steps/handoffs when engineering-handoff llm is enabled", async () => {...})`
  - [ ] 19.2 测试前置：`mkdtemp` 创建临时 specsRoot 目录；`process.env.BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})` 按 prompt 内容路由到对应家族（RouteSet / SPEC Tree / SPEC Documents / Effect Preview / Prompt Package / Engineering Handoff）；仅当 `/Engineering Handoff|工程落地|engineering-handoff/i.test(joined)` 命中时返回合法 payload（`title="Deploy release dashboard to production"` / `summary="Coordinate rollout across web and CDN surfaces."` / `missionSummary="Ensure monitoring, rollback, and approvals are in place before enabling traffic."` / `missionMetadata={targetPlatform:"codex",sourceNodeIds:[...]}` / `steps=[{title:"Configure build pipeline",summary:"...",mode:"automatic",fileScopes:["src/build.ts"],verificationCommands:["npm run build"],riskLevel:"low",sourceNodeIds:[nodeId]}, {title:"Coordinate manual QA",summary:"...",mode:"manual",riskLevel:"medium",sourceNodeIds:[nodeId]}]` / `acceptanceCriteria=["Smoke tests pass","Rollback documented"]` / `riskNotes=[{level:"warning",message:"Monitor 5xx rate"}]` / `handoffs=[{platform:"codex",promptPackageId:promptPackageIdFromInput,summary:"Execute via Codex CLI"}]`），其它家族 prompt 返回对应姊妹 spec 的 fixture 或 undefined
  - [ ] 19.3 执行 `POST /api/blueprint/jobs`（并通过既有测试辅助推进到 engineering landing plans 生成阶段，或直接构造 `POST /api/blueprint/jobs/:jobId/engineering-landing-plans` 调用，按既有 E2E 的 setup 路径）；断言 `response.status === 200` 或 `201`（与既有 E2E 基线对齐）、`engineeringLandingPlans.length >= 1`、首份 Plan：`provenance.generationSource === "llm"`、`provenance.promptId === "blueprint.engineering-handoff.v1"`、`typeof provenance.model === "string"`、`provenance.responseDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`provenance.structuredPayloadDigest` 匹配同款、`provenance.promptFingerprint` 匹配同款、`provenance.error` 为 undefined
  - [ ] 19.4 断言 LLM 内容字段可见：`plan.title === "Deploy release dashboard to production"`（LLM 派生的固定字符串，**不同于**模板化 `"Engineering landing plan: ..."` 前缀）；`plan.summary` 包含 `"**Mission summary**"`（§D11 前缀块注入）；`plan.steps.length === 2` 且 `plan.steps[0].title === "Configure build pipeline"` / `plan.steps[1].title === "Coordinate manual QA"`（**不同于**模板化 3 条 steps 的固定 title）；`plan.handoffs[0].content` 包含 `"## Acceptance criteria"` 段（内含 `"Smoke tests pass"` / `"Rollback documented"`）与 `"## Risk notes"` 段（内含 `"warning"` + `"Monitor 5xx rate"`）
  - [ ] 19.5 断言 `handoffs[0].platform` 与 `promptPackage.targetPlatform` 一致；`handoffs[0].promptPackageId === promptPackage.id`；`steps[*].sourceNodeIds` 解析到 promptPackage 可见节点集合；`provenance` 既有字段（`sourceDocumentStatuses` / `sourcePreviewStatuses` / `promptPackagePlatforms` 等）存在且与 fallback 路径字段形态相同
  - [ ] 19.6 断言 `mission.handoff` event payload 追加 `landingPlanGenerationSources` 数组且首项 `generationSource === "llm"`；`promptId === "blueprint.engineering-handoff.v1"`；`model` 为字符串；既有 payload 字段（`specTreeId` / `landingPlanIds` / `promptPackageIds` / `targetPlatforms` / `sourceNodeIds` 等）未被破坏
  - [ ] 19.7 测试清理：`delete process.env.BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED`；`await rm(specsRoot, { recursive: true, force: true })`；`llmMocks.callLLMJson.mockReset()` 不影响其它 E2E 用例
  - [ ] 19.8 **用例 2（Fallback path，需求 9.1b）**：`it("buildEngineeringLandingPlan falls back to template when engineering-handoff llm call throws", async () => {...})`
  - [ ] 19.9 测试前置：`process.env.BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})`；仅当 `/Engineering Handoff|工程落地|engineering-handoff/i.test(joined)` 命中时 `return Promise.reject(new Error("upstream 503"))`；其它家族 prompt 走既有 fixture 或 undefined
  - [ ] 19.10 执行 `POST /api/blueprint/jobs` 并推进到 engineering landing plans 生成；断言 `response.status` 与既有 E2E 基线相同、首份 Plan：`provenance.generationSource === "llm_fallback"`、`provenance.error` 匹配 `/upstream 503|llm callJson threw/`、`provenance.promptId === "blueprint.engineering-handoff.v1"`、`typeof provenance.model === "string"`
  - [ ] 19.11 断言 nodes 回退到模板化产出：`plan.title` 以 `"Engineering landing plan:"` 开头；`plan.summary` 命中今天固定句式（`/^Land .* for .* using .* SPEC document\(s\), and .* effect preview\(s\)\.$/`）；`plan.steps.length === 3` 且 `steps.map(s => s.title)` 严格等于 `["Bind landing sources","Apply repository bridge","Capture run evidence"]`；`handoffs[0].title` 以 `"Platform handoff:"` 开头；`handoffs[0].content` **不含** `"## Acceptance criteria"` / `"## Risk notes"` 段（fallback 路径不注入 §D11 追加段）
  - [ ] 19.12 断言 `mission.handoff` event payload 追加 `landingPlanGenerationSources` 数组且首项 `generationSource === "llm_fallback"`；既有 payload 字段未被破坏
  - [ ] 19.13 测试清理：同 19.7
  - _Requirements: 9.1_

- [ ] 20. **最终全量回归与验证 checklist** — 对齐 design §10.2 manual verification checklist
  - [ ] 20.1 `node --run check` → 0 个新增 TS 错误（若仓库已有历史类型债，不应扩大错误面；design §10.2 最终检查清单的硬约束）
  - [ ] 20.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 + 2 = 49 条 E2E 全绿（新增 real + fallback 两条）
  - [ ] 20.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/engineering-handoff/` → ~56 条新增 co-located 单测全绿（policy ~6 + schema ~18 + prompt ~10 + normalize ~7 + render ~5 + service ~10）
  - [ ] 20.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 20.5 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [ ] 20.6 `node --run test`（或项目级等价全量 test 命令）→ 所有 suite 绿（基线 + 新增全部通过）
  - [ ] 20.7 人工核对 `shared/blueprint/contracts.ts` 中 `BlueprintEngineeringLandingPlan.provenance` 追加 7 个可选字段（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）；无任何字段被重命名或类型变更；`BlueprintEngineeringLandingStep` / `BlueprintPlatformHandoff` / `BlueprintEngineeringLandingStepMode` / `BlueprintEngineeringLandingRiskLevel` / `BlueprintEngineeringLandingPlanStatus` 顶层类型完全未改动
  - [ ] 20.8 人工核对 `BlueprintEngineeringRun` 类型与 mission engineering 执行链路完全未改动（需求 1.8 / 9.9）
  - [ ] 20.9 人工核对 `policy.ts` / `schema.ts` / `prompt.ts` / `normalize.ts` / `render.ts` / `service.ts` 六个文件均落地并通过各自 co-located 子域单测
  - [ ] 20.10 人工核对 `BlueprintServiceContext` 追加 2 个可选字段（`engineeringHandoffLlmPolicy?` / `engineeringHandoffLlmService?`）；`buildBlueprintServiceContext` 默认装配 `createEngineeringHandoffLlmService(ctx)`；未装配时保留向后兼容（template 路径）
  - [ ] 20.11 人工核对 `buildEngineeringLandingPlan()` 改为 `async(ctx, input)`；`generateEngineeringLandingPlans()` 改为 `async(ctx, job, specTree, request, options)`；所有调用点已补 `await`；`Promise.all` 保留索引顺序，响应体 `engineeringLandingPlans[*]` 数组顺序与今天字节一致
  - [ ] 20.12 人工核对 9 个模板 helper（`buildEngineeringLandingSteps` / `buildEngineeringPlatformHandoff` / `renderEngineeringPlatformHandoff` / `buildEngineeringLandingVerificationCommands` / `buildEngineeringLandingFileScopes` / `resolveEngineeringLandingPlanStatus` / `resolveEngineeringStepRiskLevel` / `buildEngineeringSourceDocumentStatuses` / `buildEngineeringSourcePreviewStatuses`）一行未改；模板化路径字节级等价今天
  - [ ] 20.13 人工核对禁止清单：`service.ts` 及其它实现文件不出现 `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；不 `import` 模块级 eventBus / jobStore 单例；不出现裸事件字符串 `"mission.handoff"`（所有事件 `type` 走 `BlueprintEventName.MissionHandoff` 常量）
  - [ ] 20.14 人工核对 adapter 命名：若在事件 / provenance 中携带 `adapter` 字段，real 路径 adapter 字符串不含 `.simulated` 子串（推荐 `"blueprint.engineering-handoff.llm"`）；fallback 路径保留今天既有命名不变
  - [ ] 20.15 人工核对 `BlueprintEventName.MissionHandoff` event payload 追加可选 `landingPlanGenerationSources` / `promptId` / `model`；既有 payload 字段（`specTreeId` / `landingPlanIds` / `promptPackageIds` / `targetPlatforms` / `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `sourceIds`）未被破坏；既有订阅者断言不失效
  - [ ] 20.16 手动场景 1：本地运行 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED=true` + 有效 LLM apiKey → 先 `POST /api/blueprint/jobs`（先走上游 SPEC Tree / SPEC Documents / Effect Preview / Prompt Package fallback 或 real 皆可），再推进到 engineering landing plans 生成阶段 → 响应 `engineeringLandingPlans[*].provenance.generationSource === "llm"` + `title` 不以 `"Engineering landing plan:"` 开头 + `handoffs[0].content` 含 `"Acceptance criteria"` / `"Risk notes"` 锚点
  - [ ] 20.17 手动场景 2：本地运行 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED=true` + 无 apiKey → 响应 `provenance.generationSource === "template"` + 内容回退到模板化（`title` 以 `"Engineering landing plan:"` 开头 / `steps` 长度为 3 且 title 为固定模板值）
  - [ ] 20.18 手动场景 3：本地运行 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED=true` + mock LLM 为 Engineering Handoff prompt 抛错 → 响应 `provenance.generationSource === "llm_fallback"` + `error` 被填充（已脱敏）
  - [ ] 20.19 手动场景 4：本地不设 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED` → 响应 `provenance.generationSource === "template"` + 与今天字节相同（fallback E2E guard 已在 task 18 自动化覆盖，此步骤为手动复核）
  - [ ] 20.20 手动场景 5：一次请求中同时请求 M 份 promptPackages 对应的 Plan，其中 1 份 LLM 返回有效 payload、1 份 LLM 抛错、1 份 LLM 返回非 JSON → 响应 `engineeringLandingPlans.length === M`，顺序与 promptPackages 一致，各自 `provenance.generationSource` 独立正确（`llm` / `llm_fallback` / `llm_fallback`），`mission.handoff` event payload 的 `landingPlanGenerationSources` 摘要与响应体一致
  - [ ] 20.21 手动场景 6：本地运行 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_TIMEOUT_MS=500` + mock LLM 人为延迟 → 响应 `provenance.generationSource === "llm_fallback"` + `error === "llm timeout"`（或 `/llm timeout/`）
  - [ ] 20.22 手动场景 7：mock LLM 返回 `handoffs[0].platform === "claude"` 但 promptPackage 是 `"codex"` → 响应 `provenance.generationSource === "llm_fallback"` + `error` 描述 platform mismatch
  - [ ] 20.23 Schema 版本锚点确认：`promptId === "blueprint.engineering-handoff.v1"` 作为 schema 版本锚点；后续任何 schema 变更都需判断是否 bump 到 `v2`（新增可选字段兼容、删除字段 / 修改类型 / 严格化约束必须 bump）
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.6_

## 说明

- 本任务清单所有任务均为必做项，不含 `*` 可选标记（spec 范围聚焦、体量可控，与 routeset / spec-tree / spec-documents / effect-preview / prompt-package / 四条桥 spec 风格一致）。
- 每个任务都在 footer 中引用至少 1 个 EARS requirement id，便于追溯。
- 任务 2 / 4 / 6 / 8 / 10 / 14 均为 example-based 单测（共 ~56 条 co-located），**不**包含 PBT（符合 Requirement 9.3 + design §6.1 lock）；若后续 tasks 阶段发现需要 PBT 覆盖，必须显式写出要验证的不变量，否则应改为 example-based。
- 任务 19 只向 `server/tests/blueprint-routes.test.ts` **追加** 2 条新用例，不修改原有 47 条（符合 Requirement 9.6）。
- 本 spec 未调用 `prework` 工具（与 routeset / spec-tree / spec-documents / effect-preview / prompt-package / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径；design §6.1 明确锁定 example-based only）。
- **D5（Prompt ID 锁定 `blueprint.engineering-handoff.v1`）** 在任务 5.1 / 6.6 / 12.1 / 19.3 / 19.10 落地。
- **D6（Provenance 扩展策略，7 个可选字段）** 在任务 16.6 / 17.1 落地。
- **D7（事件复用既有 `BlueprintEventName.MissionHandoff`，payload 追加 3 个可选字段；不新增事件名）** 在任务 16.8 / 17.4 / 20.15 落地。
- **D8（Strict zod schema + `.superRefine()` 跨字段不变量）** 在任务 3.5 / 4 落地：`steps[*].id` 唯一、引用可解析（sourceNodeIds / sourceDocumentIds / sourcePreviewIds / promptPackageIds）、`handoffs[*].platform` 与 `promptPackage.targetPlatform` 一致、字符串 trim 后非空。
- **D9（脱敏走独立纯函数 `applyEngineeringHandoffRedaction`）** 在任务 1.3 / 2.4-2.6 / 12.6 / 14.7 落地。
- **D10（测试默认装配 ≡ 生产行为）** 在任务 15 / 18 落地：既有 47 E2E + 48 子域单测 + 9 SDK smoke 在默认未设 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED` 的装配下继续通过，字节级等价今天。
- **D11（`missionSummary` / `acceptanceCriteria` / `riskNotes` 落点：real 路径注入到 `summary` 前缀 / `handoffs[0].content` 追加段；fallback 路径不注入）** 在任务 9 / 10 / 16.4 / 16.5 / 19.4 / 19.11 落地。
- 任务 11 / 15 / 18 / 20 是强制的验证门禁，必须在所有对应实现任务完成后执行；任何一步失败都必须回到对应实现任务修复后再跑整套回归。
- 本 spec 完成后，`/autopilot` 的 11 节点叙事流水线从 Clarification → RouteSet → SPEC Tree → SPEC Documents → Effect Preview → Prompt Package → **Engineering Handoff** 全部进入 LLM 驱动模式；下一阶段如有需求，可独立 spec 推进 `BlueprintEngineeringRun` 执行链路的 LLM 驱动（超出本 spec 范围，见需求 1.8 / 9.9）。用户可通过 `tasks.md` 中的 "Start task" 入口逐项执行。
