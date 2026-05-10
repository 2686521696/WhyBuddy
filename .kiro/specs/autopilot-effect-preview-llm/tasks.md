# 实施任务：Autopilot Effect Preview LLM 驱动生成

## 概述

本任务清单把 design 文档的 4 个检查点（A 纯函数 helpers + schema + prompt + normalize + co-located 单测 → B service 工厂 + context 扩展 + service 单测 → C 外层 hook 接线 + contract 扩展 + fallback E2E guard → D E2E real + fallback + 最终全量回归）收敛为 20 个可验证的代码任务，覆盖：

- `server/routes/blueprint/effect-preview/` 目录下 5 个新模块（`policy` / `schema` / `prompt` / `normalize` / `service`）及其 co-located 单测
- `server/routes/blueprint/context.ts` 的 2 个可选依赖字段扩展（`effectPreviewLlmPolicy?` + `effectPreviewLlmService?`；**不改 `ctx.llm` 字段** — LLM 能力已在 wt1 默认装配）及默认装配
- `server/routes/blueprint.ts` 中 `buildEffectPreview()` 的 async 改造 + `generateEffectPreviews()` 并发改造（`Promise.all`）+ 所有调用点追加 `await` + ctx / `clarificationSession` / `primaryRoute` / `domainContext` 透传
- `shared/blueprint/contracts.ts` 的 `BlueprintEffectPreview.provenance` 7 个可选字段扩展（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）
- `shared/blueprint/events.ts` 与 `BlueprintEventName.PreviewGenerated` 事件 payload 的 4 个可选字段扩展（`previewGenerationSources` / `promptId` / `model` 聚合摘要）
- `server/tests/blueprint-routes.test.ts` 追加 2 条 E2E（Real LLM path / Fallback path）
- 最终全量回归（既有 47 E2E + 48 子域单测 + 9 SDK smoke 零回归）

每个任务都对应明确的落点文件、函数与验收标准；所有任务均为本 spec 的必做项，不引入 `*` 可选标记。

依赖顺序：**检查点 A**（tasks 1-9）→ **检查点 B**（tasks 10-13）→ **检查点 C**（tasks 14-16）→ **检查点 D**（tasks 17-20）。每个检查点结束都有一条显式“验证”任务作为质量门禁；任何一条验证失败都必须回到对应实现任务修复后再跑整套回归。

**Requirement 9.3 + design §6.1 lock**：本阶段测试策略为 **example-based only**，**禁止引入 PBT**；若后续 tasks 阶段出现任何被标注为 PBT 的任务，必须显式写出要验证的不变量，否则应改为 example-based。本 spec 未调用 `prework` 工具（与 routeset / spec-tree / spec-documents / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径）。

## 任务列表

### 检查点 A：纯函数 helpers + schema + prompt + normalize + co-located 单测（低风险，先做）

- [ ] 1. 新建 `server/routes/blueprint/effect-preview/policy.ts`
  - [x] 1.1 定义并导出 `EffectPreviewLlmPolicy` 接口（字段按 design §4.3：`maxInvocationTimeoutMs` / `temperature` / `callJsonRetryAttempts` / 顶层上界 `maxSummaryLength` / `minArchitectureNotes` / `maxArchitectureNotes` / `maxArchitectureNoteLength` / `minPrototypeNotes` / `maxPrototypeNotes` / `maxPrototypeNoteLength` / `minProgressPlan` / `maxProgressPlan` / Milestone 级 `maxMilestoneTitle` / `maxMilestoneSummary` / `maxMilestoneTarget` / Runtime projection 级 `maxHudStateTitle` / `maxHudStateSummary` / `maxHudStateBadges` / `maxHudStateBadgeLength` / `minConsoleLines` / `maxConsoleLines` / `maxConsoleLineLength` / `minLogTimeline` / `maxLogTimeline` / `maxLogMessageLength` / `maxLogIdLength` / `maxBrowserPreviewTitle` / `maxBrowserPreviewSummary` / `maxBrowserPreviewUrlLength` / 脱敏 `redactionKeywords` / `redactedEmailPattern` / `redactedApiKeyPattern` / `redactedGithubPatPattern` / `maxErrorLength`）
  - [x] 1.2 实现并导出 `createDefaultEffectPreviewLlmPolicy()`：默认 `maxInvocationTimeoutMs = 30_000`；从 `process.env.BLUEPRINT_EFFECT_PREVIEW_LLM_TIMEOUT_MS` 读取覆盖值，仅当解析为正整数且 `<= 30_000` 时采用，否则回退到 30_000（design §4.3 + §2.D4）；其它默认：`temperature = 0.2` / `callJsonRetryAttempts = 1` / `maxSummaryLength = 500` / `maxArchitectureNotes = 8` / `maxPrototypeNotes = 12` / `maxProgressPlan = 20` / `maxConsoleLines = 40` / `maxLogTimeline = 40` / `maxHudStateBadges = 8`
  - [x] 1.3 实现并导出纯函数 `applyEffectPreviewRedaction(value: string, policy: EffectPreviewLlmPolicy): string`，覆盖 API key（`sk-...` / `clp_...`）、GitHub PAT（`gh[pousr]_...` / `github_pat_...`）、email、Authorization / Bearer / `token=` / `api_key=` / `x-github-token` / `openai-api-key` 等 key-value 对的脱敏
  - [x] 1.4 **禁止** 在本文件 `import` 任何运行时 / 业务模块（保持纯函数）；仅 `import` TS 内置类型
  - _Requirements: 2.8, 4.1, 4.5, 5.1_

- [x] 2. 新建 `server/routes/blueprint/effect-preview/policy.test.ts`（~6 条 example-based 单测）
  - [x] 2.1 断言 `createDefaultEffectPreviewLlmPolicy().maxInvocationTimeoutMs === 30_000`（默认值）
  - [x] 2.2 断言环境变量 `BLUEPRINT_EFFECT_PREVIEW_LLM_TIMEOUT_MS="5000"` 被读取后 `maxInvocationTimeoutMs === 5_000`；测试后清理 `process.env`
  - [x] 2.3 断言非法环境变量值（`"abc"` / `"-1"` / `"99999"` / `"0"`）均回退到 `30_000`
  - [x] 2.4 断言 `applyEffectPreviewRedaction("sk-ABCDEFGHIJKLMNOP1234567890", policy)` 不含原 API key 子串
  - [x] 2.5 断言 `applyEffectPreviewRedaction("contact alice@example.com", policy)` 不含原邮箱子串
  - [x] 2.6 ReDoS 哨兵：构造 5MB 字符串（`"a".repeat(5_000_000)`）调用 `applyEffectPreviewRedaction` 耗时 `< 200ms`（`performance.now()` 对比）
  - _Requirements: 2.8, 4.1, 5.1, 9.8_

- [x] 3. 新建 `server/routes/blueprint/effect-preview/schema.ts`
  - [x] 3.1 按 design §4.4 定义 `MilestoneSchema`：`title`（1..200）、`summary`（1..500）、`target`（1..200）
  - [x] 3.2 定义 `LogEntrySchema`：`id`（可选，1..64）、`level: z.enum(["info","warning","success"])`、`message`（1..500）、`timestamp`（可选，1..64）
  - [x] 3.3 定义 `HudStateSchema`：`title`（1..200）、`summary`（1..500）、`status` 可选 `z.enum(["preview","completed"])`、`stage` 可选 `z.enum(["intake","routeset","spec_tree","spec_document","effect_preview","prompt_package","engineering_handoff"])`、`progressPercent: z.number().min(0).max(100)`、`activeNodeId` 可选 ≤128、`badges` 可选 `z.array(z.string().min(1).max(64)).max(8)`
  - [x] 3.4 定义 `BrowserPreviewSchema`：`title`（1..200）、`summary`（1..500）、`url` 可选 `z.string().max(1024)`
  - [x] 3.5 定义 `RuntimeProjectionSchema`：`hudState: HudStateSchema`（必填）、`consoleLines: z.array(z.string().min(1).max(500)).min(1).max(40)`、`logTimeline: z.array(LogEntrySchema).min(1).max(40)`、`browserPreview: BrowserPreviewSchema.optional()`
  - [x] 3.6 定义并导出 `EffectPreviewLlmResponseSchema`：`z.object({ summary: z.string().min(1).max(500), architectureNotes: z.array(z.string().min(1).max(400)).min(1).max(8), prototypeNotes: z.array(z.string().min(1).max(400)).min(1).max(12), progressPlan: z.array(MilestoneSchema).min(1).max(20), runtimeProjection: RuntimeProjectionSchema }).superRefine((data, ctx) => { ... })`
  - [x] 3.7 `.superRefine` 按 design §4.4 实现 7 组不变量：(1) `summary` trim 后非空；(2) `architectureNotes[*]` / `prototypeNotes[*]` trim 后非空；(3) `progressPlan[*].title/summary/target` trim 后非空 + `title` 大小写不敏感唯一；(4) `hudState.title` / `hudState.summary` trim 后非空；(5) `consoleLines[*]` trim 后非空；(6) `logTimeline[*].message` trim 后非空 + `logTimeline[*].id`（若提供）大小写不敏感唯一；(7) 若 `browserPreview` 提供则 `title` / `summary` trim 后非空；每条不变量违反时 `ctx.addIssue` 后 `return` 避免级联
  - [x] 3.8 **不使用 `.strict()`**（zod 默认 strip 行为静默丢弃未知字段，design §2.D8）；**禁止** 任何 `.transform(...)` / `z.coerce.*` / `z.preprocess(...)` coerce 链（需求 3.2）
  - [x] 3.9 导出类型别名 `export type EffectPreviewLlmResponse = z.infer<typeof EffectPreviewLlmResponseSchema>`
  - [x] 3.10 **禁止** 在本文件 `import` 任何运行时 / 业务模块；仅 `import { z } from "zod"`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. 新建 `server/routes/blueprint/effect-preview/schema.test.ts`（~14 条 example-based 单测）
  - [x] 4.1 合法 minimal payload（`summary` + 1 条 `architectureNotes` + 1 条 `prototypeNotes` + 1 条 `progressPlan` + `runtimeProjection` 含 `hudState.title` + 1 条 `consoleLines` + 1 条 `logTimeline`）→ `safeParse({ success: true })`
  - [x] 4.2 合法 full payload（`architectureNotes × 8` + `prototypeNotes × 12` + `progressPlan × 20` + `consoleLines × 40` + `logTimeline × 40` + 所有可选字段）→ 通过
  - [x] 4.3 `summary` 缺失或为空字符串或全空格 → 失败
  - [x] 4.4 `architectureNotes.length === 0` → 失败；`architectureNotes.length > 8` → 失败；`prototypeNotes.length === 0` / `> 12` → 失败；`progressPlan.length === 0` / `> 20` → 失败
  - [x] 4.5 `progressPlan[*].title` 缺失 → 失败；`progressPlan` 中两个 title 大小写不敏感重复（`"Ship"` + `"ship"`）→ `.superRefine` 触发失败，错误消息包含 `"duplicated"`
  - [x] 4.6 `runtimeProjection` 缺失 → 失败；`runtimeProjection.hudState` 缺失 → 失败；`hudState.title` 缺失或空字符串或全空格 → 失败
  - [x] 4.7 `hudState.progressPercent = -1` / `= 101` → 失败（`.min(0).max(100)` 边界）
  - [x] 4.8 `hudState.status = "unknown"` → 失败（`z.enum` 约束）；合法值 `"preview"` / `"completed"` → 通过
  - [x] 4.9 `hudState.stage = "invalid_stage"` → 失败；合法 7 个枚举值均通过
  - [x] 4.10 `consoleLines.length === 0` → 失败；`consoleLines.length > 40` → 失败；`consoleLines[*]` 全空格 → 失败（`.superRefine`）
  - [x] 4.11 `logTimeline.length === 0` → 失败；`logTimeline.length > 40` → 失败；`logTimeline[*].level = "debug"` → 失败；`logTimeline[*].message` 空字符串 → 失败
  - [x] 4.12 `logTimeline[*].id` 重复（大小写不敏感）→ `.superRefine` 触发失败，错误消息包含 `"duplicated logTimeline id"`
  - [x] 4.13 `browserPreview` 缺失 → 通过（可选）；`browserPreview.title` 空字符串 → 失败；`browserPreview.url` 长度 1025 → 失败
  - [x] 4.14 字符串越界（`summary.length = 501` / `architectureNotes[0].length = 401`）→ 失败；未知顶层字段（`author: "alice"`）→ zod strip 静默丢弃，不影响 `safeParse.success`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.2_

- [x] 5. 新建 `server/routes/blueprint/effect-preview/prompt.ts`
  - [x] 5.1 导出常量 `EFFECT_PREVIEW_PROMPT_ID = "blueprint.effect-preview.v1"` 与类型 `EffectPreviewPromptPayload`（字段：`promptId` / `systemMessage` / `userMessage` / `userPayload` / `promptFingerprint`）
  - [x] 5.2 定义并导出 `BuildEffectPreviewPromptInput` 类型（按 design §4.5：`job` / `specTreeNode` / `sourceDocuments` / `primaryRoute?` / `clarificationSession?` / `domainContext?` / `capabilityInvocations?` / `capabilityEvidence?` / `includeDrafts` / `locale`）
  - [x] 5.3 实现 `buildEffectPreviewPrompt(input)`：按 design §4.5 构造 `userPayload`，字段顺序固定为 `{ promptId, specTreeNode, sourceDocuments, primaryRoute, intake, clarification, projectContext, upstreamEvidence, includeDrafts, outputSchema }`；`clarification.answers` 按 `questionId` 字典序；`primaryRoute.steps` 保留原始顺序；`sourceDocuments` 按 `id` 字典序；`capabilityInvocations` / `capabilityEvidence` 按 `id` 字典序；`githubUrls` 保留输入顺序；`sourceDocuments[*].contentSnippet` 截断到 policy 上界（约 4000 字符）
  - [x] 5.4 实现 locale-aware `systemMessage`：`locale === "zh-CN"` 时使用中文 Effect Preview 生成器文案（含 CJK），否则英文文案（以 `"You are the /autopilot Effect Preview"` 之类开头）；两个版本都覆盖 design §4.5 列出的 9 条约束（含 `summary` / `architectureNotes` / `prototypeNotes` / `progressPlan` / `runtimeProjection.hudState` / `consoleLines` / `logTimeline` / 可选 `browserPreview` / `progressPlan[*].title` 唯一）
  - [x] 5.5 `userMessage = JSON.stringify(userPayload, null, 2)`；`promptFingerprint = "sha256:" + sha256Hex(systemMessage + "\n\n" + userMessage)`（复用 `server/core/ids.ts` 或等价 hash helper）
  - [x] 5.6 **禁止** 在本文件 `import` `callLLMJson` / `getAIConfig` / `fetch`；仅允许 `import type` shared blueprint 类型 + 一个 sha256 纯 helper
  - _Requirements: 2.5, 3.1, 3.2_

- [x] 6. 新建 `server/routes/blueprint/effect-preview/prompt.test.ts`（~9 条 example-based 单测）
  - [x] 6.1 断言确定性：同一组 `(job, specTreeNode, sourceDocuments, primaryRoute, clarificationSession, locale)` 两次调用 `buildEffectPreviewPrompt` 产出**字节相同** `userMessage`
  - [x] 6.2 断言输入变化敏感：追加一条新的 clarification answer 后 `userMessage` 发生变化（且 `promptFingerprint` 也变化）
  - [x] 6.3 断言 `answers` 按 `questionId` 字典序排序（输入 `["q-c", "q-a", "q-b"]` → 输出顺序 `["q-a", "q-b", "q-c"]`）
  - [x] 6.4 断言 `sourceDocuments` 在 `userPayload` 中按 `id` 字典序排序
  - [x] 6.5 断言 `locale === "zh-CN"` 时 `systemMessage` 包含 CJK 字符（正则 `/[\u4e00-\u9fff]/`）
  - [x] 6.6 断言 `locale === "en-US"` 时 `systemMessage` 不含 CJK 且以英文开头（例如 `/^You are the \/autopilot Effect Preview/`）
  - [x] 6.7 断言 `EFFECT_PREVIEW_PROMPT_ID === "blueprint.effect-preview.v1"` 与 prompt 输出的 `promptId` 一致
  - [x] 6.8 断言可选分支：`capabilityInvocations` / `capabilityEvidence` 为 undefined 时 `userPayload.upstreamEvidence === undefined`；非空时按 `id` 字典序出现在 `userPayload.upstreamEvidence` 中
  - [x] 6.9 断言 `userPayload.outputSchema` 包含 `runtimeProjection.hudState` / `consoleLines` / `logTimeline` / `browserPreview` 的文案提示，并提示 `logTimeline[*].level` ∈ `{info, warning, success}`
  - _Requirements: 2.5, 3.1, 3.2, 9.2_

- [x] 7. 新建 `server/routes/blueprint/effect-preview/normalize.ts`
  - [x] 7.1 导出类型 `NormalizeEffectPreviewInput`（字段：`createdAt: string`、`activeNodeId: string`、`policy: EffectPreviewLlmPolicy`）与 `NormalizeEffectPreviewOutput`（字段：`summary` / `architectureNotes` / `prototypeNotes` / `progressPlan` / `renderedHudState` / `renderedConsoleLines` / `renderedLogTimeline` / `renderedBrowserPreview?`，内容字段形状与 design §4.2 `EffectPreviewLlmServiceOutput` 的 `rendered*` 字段对齐）
  - [x] 7.2 实现纯函数 `normalizeEffectPreviewResponse(validated, input)`：按 design §2.D8 规范化要求执行（zod 校验通过后的防御性规范化）：(a) trim 所有字符串字段首尾空白；(b) 裁剪过长字符串至 policy 上界（防御性）；(c) 为缺失的 `logTimeline[*].id` 补齐 `createId("blueprint-effect-preview-log")` 前缀 id；(d) 为缺失的 `logTimeline[*].timestamp` 补齐 `input.createdAt`；(e) 为 `hudState.activeNodeId` 缺失时补齐 `input.activeNodeId`；(f) progressPlan 为每项构造稳定 `id = createId("blueprint-effect-preview-milestone")`（若 LLM 未提供）
  - [x] 7.3 `renderedBrowserPreview` 仅在 `validated.runtimeProjection.browserPreview` 存在时填充；否则 `undefined`（由外层走模板或 default 装配）
  - [x] 7.4 仅 `import { createId } from "../../../core/ids.js"` 与 `import type { BlueprintEffectPreview* }` + `import type { EffectPreviewLlmResponse }` + `import type { EffectPreviewLlmPolicy }`
  - _Requirements: 2.4, 2.6, 3.6_

- [x] 8. 新建 `server/routes/blueprint/effect-preview/normalize.test.ts`（~6 条 example-based 单测）
  - [x] 8.1 完整 payload（含所有可选字段，所有字符串已 trim）→ normalize 输出字节等价输入；`renderedLogTimeline[*].id` 使用 LLM 提供值
  - [x] 8.2 LLM 未提供 `logTimeline[*].id` → normalize 补齐 `createId("blueprint-effect-preview-log")` 前缀 id；所有 id 本预演内唯一
  - [x] 8.3 LLM 未提供 `logTimeline[*].timestamp` → normalize 补齐 `input.createdAt`
  - [x] 8.4 LLM 未提供 `hudState.activeNodeId` → normalize 补齐 `input.activeNodeId`
  - [x] 8.5 LLM 字符串带前后空格（`summary: "  hello  "`）→ normalize 后 trim 为 `"hello"`；`architectureNotes[*]` / `prototypeNotes[*]` / `progressPlan[*].title` 等同款处理
  - [x] 8.6 LLM 未提供 `browserPreview` → `output.renderedBrowserPreview === undefined`（由外层装配决定是否走模板 default）
  - _Requirements: 2.4, 2.6, 3.6_

- [x] 9. **Checkpoint A 验证** — 运行纯函数子域单测
  - [x] 9.1 `node --run check` → 不扩大既有类型债错误面
  - [x] 9.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/effect-preview/policy.test.ts server/routes/blueprint/effect-preview/schema.test.ts server/routes/blueprint/effect-preview/prompt.test.ts server/routes/blueprint/effect-preview/normalize.test.ts` → ~35 条新增单测全绿（policy ~6 + schema ~14 + prompt ~9 + normalize ~6）
  - [x] 9.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [x] 9.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（A 阶段尚未接线，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 B：Service 工厂 + Context 扩展 + 单测（依赖 A）

- [x] 10. 新建 `server/routes/blueprint/effect-preview/service.ts`：`createEffectPreviewLlmService(ctx)` 工厂 + 主算法
  - [x] 10.1 按 design §4.2 定义并导出接口 `EffectPreviewLlmServiceInput`（字段：`jobId` / `job` / `specTreeNode` / `sourceDocuments` / `primaryRoute?` / `clarificationSession?` / `domainContext?` / `capabilityInvocations?` / `capabilityEvidence?` / `includeDrafts` / `createdAt`）与 `EffectPreviewLlmServiceOutput`（字段：`generationSource` / `summary?` / `architectureNotes?` / `prototypeNotes?` / `progressPlan?` / `renderedHudState?` / `renderedConsoleLines?` / `renderedLogTimeline?` / `renderedBrowserPreview?` / `promptId?` / `model?` / `promptFingerprint?` / `responseDigest?` / `structuredPayloadDigest?` / `error?`）；导出类型别名 `EffectPreviewLlmService = (input) => Promise<EffectPreviewLlmServiceOutput>`
  - [x] 10.2 导出工厂 `createEffectPreviewLlmService(ctx: BlueprintServiceContext): EffectPreviewLlmService`，工厂在闭包内解析 `policy = ctx.effectPreviewLlmPolicy ?? createDefaultEffectPreviewLlmPolicy()`
  - [x] 10.3 按 design §4.6 伪代码实现 service 主算法的六档 fallback：
    - 档位 1（未启用）：`process.env.BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED !== "true"` → 早退 `{ generationSource: "template" }`，`ctx.logger.debug` 记录 “not enabled, using template”
    - 档位 2（apiKey 缺失）：`ctx.llm.getConfig().apiKey` 为空 → 早退 `{ generationSource: "template" }`（design §2.D2 + §4.6 + §9.2 锁定此口径与档位 1 合流），不填 `error` / `promptId` / `model`
    - 档位 3（callJson 抛错 / 非 JSON）：try/catch `ctx.llm.callJson`；若抛错或返回 undefined / null / non-object → `{ generationSource: "llm_fallback", promptId, model, promptFingerprint, error: "llm callJson threw: ..." 或 "non-json response" }`（≤ `policy.maxErrorLength` 字符，经 `applyEffectPreviewRedaction` 脱敏）
    - 档位 4 / 5（schema + `.superRefine` 不变量失败）：`EffectPreviewLlmResponseSchema.safeParse(rawPayload)` 返回 `success: false` → `{ generationSource: "llm_fallback", error: "schema validation failed: ..." }`
    - 档位 6（超时）：callJson 因 `timeoutMs: policy.maxInvocationTimeoutMs` 触发 AbortError → fallback，`error: "llm timeout"`（通过正则 `/abort|timeout/i` 识别错误文本）
  - [x] 10.4 Happy path：`parsed.success === true` → 调用 `normalizeEffectPreviewResponse(parsed.data, { createdAt: input.createdAt, activeNodeId: input.specTreeNode.id, policy })`；计算 `responseDigest = "sha256:" + sha256Hex(JSON.stringify(rawPayload))`、`structuredPayloadDigest = "sha256:" + sha256Hex(JSON.stringify(parsed.data))`；返回 `{ generationSource: "llm", summary, architectureNotes, prototypeNotes, progressPlan, renderedHudState, renderedConsoleLines, renderedLogTimeline, renderedBrowserPreview, promptId, model, promptFingerprint, responseDigest, structuredPayloadDigest }`
  - [x] 10.5 LLM 调用参数固定为 `{ model: aiConfig.model, temperature: policy.temperature, timeoutMs: policy.maxInvocationTimeoutMs, retryAttempts: policy.callJsonRetryAttempts, sessionId: input.clarificationSession?.id ?? input.job.request.clarificationSessionId }`
  - [x] 10.6 **硬约束**（design §2.D1）：本文件 SHALL NOT `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；所有 LLM 能力来自 `ctx.llm.callJson` + `ctx.llm.getConfig`；不得 import 模块级 eventBus / jobStore 单例
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.5, 3.6, 4.1, 4.5, 4.6, 5.1, 7.1, 7.2, 7.4, 7.5_

- [x] 11. 扩展 `server/routes/blueprint/context.ts`：追加 2 个可选依赖字段 + 默认装配
  - [x] 11.1 在 `BlueprintServiceContext` 与 `BlueprintServiceContextDeps` 上追加 2 个可选字段：`effectPreviewLlmPolicy?: EffectPreviewLlmPolicy`、`effectPreviewLlmService?: EffectPreviewLlmService`；类型仅 `import type`，不 import 工厂实现避免循环依赖
  - [x] 11.2 **不改 `ctx.llm` 字段**：`ctx.llm.callJson` / `ctx.llm.getConfig` 已在 wt1 默认装配，本 spec 只消费不扩展（需求 7.5 + design §2.D2）
  - [x] 11.3 在 `buildBlueprintServiceContext(deps)` 中：`deps.effectPreviewLlmPolicy ?? createDefaultEffectPreviewLlmPolicy()`；若 `deps.effectPreviewLlmService` 未注入，使用 `createEffectPreviewLlmService(ctx)` 构造默认实例挂载到 `ctx.effectPreviewLlmService`
  - [x] 11.4 保持向后兼容：`deps` 完全不传 policy / service 字段时，既有单测与 E2E 无感知（默认装配后 service 仍因档位 1 早退 → template 路径）
  - [x] 11.5 `node --run check` 确认类型扩展未引入新 TS 错误
  - _Requirements: 7.1, 7.3, 7.5, 8.2_

- [x] 12. 新建 `server/routes/blueprint/effect-preview/service.test.ts`：R9.2 四条硬需求 + ~4 条补充
  - [x] 12.1 **Happy path（R9.2 happy）**：注入 fake `callJson` 返回符合 schema 的合法 payload（`summary` + `architectureNotes × 3` + `prototypeNotes × 4` + `progressPlan × 3` + `runtimeProjection` 含 `hudState.title / summary / progressPercent` + `consoleLines × 3` + `logTimeline × 3`，每个 `logTimeline[*].level` 分别为 `info / warning / success`）→ 断言 `result.generationSource === "llm"`、`result.summary` 非空、`result.architectureNotes.length === 3`、`result.progressPlan.length === 3`、`result.renderedHudState.title` 非空、`result.renderedLogTimeline.length === 3`、`result.promptId === "blueprint.effect-preview.v1"`、`result.structuredPayloadDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`result.error` 为 undefined
  - [x] 12.2 **Malformed JSON（R9.2 malformed）**：fake `callJson: async () => undefined` → 断言 `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/non-json response/`、内容字段全 undefined；再覆盖 `async () => "garbage string"` 与 `async () => 42` 两个子场景
  - [x] 12.3 **Schema fails（R9.2 schema-fail）**：分别注入 payload：(a) `progressPlan` 为空数组，(b) `logTimeline` 为空数组，(c) `hudState.title` 缺失，(d) `logTimeline[0].level = "debug"`，(e) 字符串越界（`summary.length = 501`），(f) `progressPlan[*].title` 重复（大小写不敏感），(g) `logTimeline[*].id` 重复，(h) `hudState.status = "unknown"`，(i) `hudState.stage = "invalid"`，(j) `hudState.progressPercent = 150` → 每个子场景断言 `result.generationSource === "llm_fallback"`、`result.error` 包含 `"schema validation failed"` 或具体约束描述（`"duplicated"` / `"level"` / `"progressPlan"` / `"hudState"`）
  - [x] 12.4 **ApiKey missing（R9.2 apiKey-missing）**：fake `getConfig: () => ({ model: "gpt-4-turbo", apiKey: "" })` + callJson spy → 断言 `result.generationSource === "template"`（design §6.3.4 锁定与档位 1 合流的口径）、`callJson` spy 未被调用、`result.error` / `result.promptId` / `result.model` 均为 undefined
  - [x] 12.5 **补充：Not enabled**：未设环境变量 `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED` → `result.generationSource === "template"` + callJson spy 未被调用 + `ctx.logger.debug` 被调用
  - [x] 12.6 **补充：Timeout**：fake `callJson: async () => { throw new Error("Request aborted due to timeout") }` → `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/llm timeout/`（通过 `/abort|timeout/i` 路径识别）
  - [x] 12.7 **补充：Redaction E2E**：fake `callJson` 抛错 message 包含 `"sk-ABCDEFGHIJKLMNOP1234567890"` → 断言 `result.error` 不含该原文子串（已脱敏）
  - [x] 12.8 **补充：Per-preview isolation**：连续两次调用同一 service 实例，第一次 happy path、第二次 fake `callJson` 抛错 → 两次 `result` 的 `generationSource` / `error` / `promptFingerprint` / `responseDigest` 字段彼此独立，不存在闭包状态串线（验证需求 4.7 per-preview 隔离）
  - _Requirements: 5.3, 9.2_

- [x] 13. **Checkpoint B 验证** — 运行完整子域测试
  - [x] 13.1 `node --run check` → 不扩大既有类型债错误面
  - [x] 13.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/effect-preview/` → ~43 条新增 co-located 单测全绿（policy ~6 + schema ~14 + prompt ~9 + normalize ~6 + service ~8）
  - [x] 13.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [x] 13.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（B 阶段 service 已装配但未接入 `buildEffectPreview`，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 C：外层 hook 接线 + contract 扩展 + fallback E2E guard（依赖 B）

- [x] 14. 改造 `server/routes/blueprint.ts` 的 `buildEffectPreview()` 与 `generateEffectPreviews()`
  - [x] 14.1 把 `buildEffectPreview` 签名从 sync 改为 `async (ctx: BlueprintServiceContext, input: { job, specTree, node, documents, existingPreviews, includeDrafts, createdAt, clarificationSession?, domainContext?, primaryRoute?, capabilityInvocations?, capabilityEvidence? }): Promise<BlueprintEffectPreview>`
  - [x] 14.2 先计算不变 scaffold：`id` / `version` / `versionStatus` / `supersedesPreviewId?` / `previousPreviewIds` / `preservedPreviewIds` / `refreshedFromSpecTreeVersion` / `refreshedAt` / `sourceSnapshotHash` / `sourceDocumentIds` / `status` / `nodeProgress?` / `dependencyOrder?` / `versionSync?`；以及 `runtimeProjection` 的结构字段 `id` / `jobId` / `projectId?` / `routeSetId` / `routeId?` / `specTreeId` / `nodeId` / `effectPreviewId` / `sceneSnapshotId` / `browserPreviewId` / `sourceIds`（外层派生不变，需求 2.4 / 2.7）
  - [x] 14.3 `await ctx.effectPreviewLlmService?.(...)` 传入 `jobId` / `job` / `specTreeNode: node` / `sourceDocuments: documents` / `primaryRoute` / `clarificationSession` / `domainContext` / `capabilityInvocations` / `capabilityEvidence` / `includeDrafts` / `createdAt`
  - [x] 14.4 `serviceResult?.generationSource === "llm"` 分支：用 LLM 内容字段替换模板化字段 — `summary` / `architectureNotes` / `prototypeNotes` / `progressPlan` / `nodes[0].summary / steps / milestones / prototypeCues` / `runtimeProjection.hudState`（合并 LLM `renderedHudState` + 外层 `activeNodeId` / `stage` / `status` 兜底）/ `runtimeProjection.consoleLines` / `runtimeProjection.logTimeline`（合并 LLM `renderedLogTimeline` + 外层 `createdAt` 兜底）/ `runtimeProjection.browserPreview`（LLM 未提供则保留外层 default）；`provenanceExtras = { generationSource: "llm", promptId, model, responseDigest, structuredPayloadDigest, promptFingerprint }`
  - [x] 14.5 否则（template / llm_fallback）分支：调用今天的模板化路径（`buildEffectPreviewPrototypeCues()` + `buildEffectPreviewMilestones()` + `buildEffectPreviewRuntimeProjection()` + `summarizeEffectPreviewDocument()`）**一行不改**，确保字节级等价今天（design §2.D3 + §5.2）；`provenanceExtras = { generationSource: serviceResult?.generationSource ?? "template", promptId, model, promptFingerprint, error: serviceResult?.error }`
  - [x] 14.6 合并 provenance：保留所有既有字段不变（`jobId` / `projectId` / `sourceId` / `targetText` / `githubUrls` / `treeVersion` / `nodeType` / `nodeTitle` / `nodeSummary` / `sourceStatus` / `includeDrafts` / `sourceDocumentStatuses`），以 `...provenanceExtras` 对象 spread 方式追加 7 个新字段（需求 4.2 + 4.5 + 4.6）
  - [x] 14.7 改造 `generateEffectPreviews()` 签名为 `async`：把 `targetNodes.map(node => buildEffectPreview({...}))` 改为 `await Promise.all(targetNodes.map(node => buildEffectPreview(ctx, {...})))`，再对结果 `.filter(...)`；保持 `effectPreviews[*]` 数组顺序与今天完全一致（需求 5.6 + design §2.D3）
  - [x] 14.8 调用点追加 `await`：`POST /api/blueprint/jobs/:jobId/effect-previews` handler、`POST /api/blueprint/generations` 内部调用链、以及 `grep -nE "generateEffectPreviews\(" server/ shared/ --include="*.ts"` 发现的其它调用点；所有调用方改为 `async` 并透传 `ctx` + `clarificationSession` + `domainContext` + `primaryRoute`（若上游可解析）
  - [x] 14.9 事件 payload 扩展：在既有 `BlueprintEventName.JobCompleted` + `BlueprintEventName.PreviewGenerated` emit 点，追加可选字段：`previewGenerationSources: Array<{ nodeId, generationSource }>` 聚合每份预演的 provenance、`promptId?: string`（任一预演走过 LLM 时填充 `"blueprint.effect-preview.v1"`）、`model?: string`（任一预演走过 LLM 时填充）；**不新增事件名**；事件 `type` 仍通过 `BlueprintEventName` 常量构造，不出现裸字符串 `"preview.generated"`（需求 6.1 / 6.2 / 6.4）
  - _Requirements: 2.2, 2.4, 2.6, 2.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.4, 6.5, 8.1, 8.2_

- [x] 15. 扩展 `shared/blueprint/contracts.ts` 与 `shared/blueprint/events.ts`：provenance 7 个 + event payload 3 个可选字段
  - [x] 15.1 在 `BlueprintEffectPreview.provenance` 类型中追加 7 个可选字段：`generationSource?: "llm" | "llm_fallback" | "template"`、`promptId?: string`、`model?: string`、`responseDigest?: string`、`structuredPayloadDigest?: string`、`promptFingerprint?: string`、`error?: string`；全部可选（design §4.9 + §2.D6）；不删除、不重命名、不修改任何既有 provenance 字段
  - [x] 15.2 在 `shared/blueprint/events.ts` 的 `BlueprintPreviewGeneratedEventPayload` 类型（或等价事件 payload 类型定义位置）上追加 3 个可选字段：`previewGenerationSources?: Array<{ nodeId: string; generationSource: "llm" | "llm_fallback" | "template" }>`、`promptId?: string`、`model?: string`；全部可选（需求 6.5）
  - [x] 15.3 在仓库根运行 `node --run check`，确认新增字段不引入新增 TS 错误；grep 既有 `BlueprintEffectPreview.provenance` / `preview.generated` 消费点确认没有因字段追加而断言失败
  - [x] 15.4 同步确认 `client/src/lib/blueprint-api/` 下的 SDK normalizer：若使用 object spread 或透明透传，不需改动；若使用显式字段映射，追加 ~7 行可选字段透传（不修改任一既有字段映射行为）
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 8.2, 8.4_

- [x] 16. **Checkpoint C 验证** — 运行既有 47 E2E + 48 子域 + 9 SDK smoke 确认零回归
  - [x] 16.1 `node --run check` → 不扩大既有类型债错误面
  - [x] 16.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（未设 `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED` → 档位 1 早退 → template 路径 → 字节级等价今天）
  - [x] 16.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测 + ~43 条新增 co-located 单测全部通过
  - [x] 16.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [x] 16.5 本阶段断言点：`effectPreviews[*].provenance.generationSource === "template"` 在默认装配下可断言；fallback 路径下 `effectPreviews[*]` 数组顺序与今天字节相同；`summary` 起始匹配 `/^Preview the expected effect of /`、`architectureNotes[0]` 起始匹配 `/^Anchor implementation around /`、`progressPlan[*].title` 与 `buildEffectPreviewMilestones()` 模板产出一致、`runtimeProjection.hudState.title` 与 `buildEffectPreviewRuntimeProjection()` 模板产出一致
  - [x] 16.6 事件回归：既有断言 `BlueprintEventName.PreviewGenerated` 的用例通过字段追加不应失败（可选字段默认 undefined，不影响既有字段）
  - _Requirements: 5.3, 5.4, 5.5, 5.6, 6.5, 8.1, 8.3, 8.5, 8.6, 9.6_

### 检查点 D：E2E real + fallback + 最终全量回归（依赖 C）

- [x] 17. 在 `server/tests/blueprint-routes.test.ts` 追加 E2E 用例 1（Real LLM path，需求 9.1a）
  - [x] 17.1 用例描述：`it("generateEffectPreviews produces LLM-driven previews when effect-preview llm is enabled", async () => {...})`
  - [x] 17.2 测试前置：`mkdtemp` 创建临时 specsRoot 目录；`process.env.BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})` 按 prompt 内容路由到对应家族（RouteSet / spec-tree / spec-documents / role / aigc-node / effect-preview）；仅当 `/Effect Preview|效果预演/i.test(joined)` 命中时返回合法 payload（`summary: "Dashboard will ship ..."` + `architectureNotes × 3` + `prototypeNotes × 4` + `progressPlan × 3` + `runtimeProjection` 含 `hudState.title: "Release Dashboard HUD"` + `consoleLines × 3` + `logTimeline × 3`），其它家族 prompt 返回对应姊妹 spec 的 fixture 或 undefined
  - [x] 17.3 执行 `POST /api/blueprint/jobs` 创建 job 并推进到 Effect Preview 阶段（或直接 `POST /api/blueprint/jobs/:jobId/effect-previews`）；断言 `response.status === 201`、`effectPreviews[*].provenance.generationSource === "llm"`、`effectPreviews[*].provenance.promptId === "blueprint.effect-preview.v1"`、`typeof effectPreviews[*].provenance.model === "string"`、`effectPreviews[*].provenance.responseDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`effectPreviews[*].provenance.structuredPayloadDigest` 匹配同款、`effectPreviews[*].provenance.promptFingerprint` 匹配同款、`effectPreviews[*].provenance.error` 为 undefined
  - [x] 17.4 断言 LLM 内容可见：`effectPreviews[0].summary === "Dashboard will ship ..."`（LLM 派生的固定字符串，**不同于** 模板化 `"Preview the expected effect of ..."` 格式）；`effectPreviews[0].architectureNotes[0]` 不以 `"Anchor implementation around"` 开头；`effectPreviews[0].runtimeProjection.hudState.title === "Release Dashboard HUD"`；`effectPreviews[0].runtimeProjection.logTimeline.length === 3` 且每条 `level` 分别为 `info / warning / success`
  - [x] 17.5 断言结构字段保留：`effectPreviews[0].id` / `jobId` / `treeId` / `nodeId` / `version` / `versionStatus` / `status` / `sourceDocumentIds` / `runtimeProjection.sceneSnapshotId` / `runtimeProjection.sourceIds` 与外层派生一致（非 LLM 覆盖字段）
  - [x] 17.6 断言事件 payload：`BlueprintEventName.PreviewGenerated` emit 的 payload 含 `previewGenerationSources: [{ nodeId, generationSource: "llm" }, ...]`、`promptId === "blueprint.effect-preview.v1"`、`typeof model === "string"`
  - [x] 17.7 测试清理：`delete process.env.BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED`；`await rm(specsRoot, { recursive: true, force: true })`
  - _Requirements: 6.1, 6.5, 9.1_

- [x] 18. 在 `server/tests/blueprint-routes.test.ts` 追加 E2E 用例 2（Fallback path，需求 9.1b）
  - [x] 18.1 用例描述：`it("generateEffectPreviews falls back to template when effect-preview llm call throws", async () => {...})`
  - [x] 18.2 测试前置：`process.env.BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})`；仅当 `/Effect Preview|效果预演/i.test(joined)` 命中时 `return Promise.reject(new Error("upstream 503"))`
  - [x] 18.3 执行 `POST /api/blueprint/jobs` 推进到 Effect Preview 阶段；断言 `response.status === 201`、`effectPreviews[*].provenance.generationSource === "llm_fallback"`、`effectPreviews[*].provenance.error` 匹配 `/upstream 503|llm callJson threw/`、`effectPreviews[*].provenance.promptId === "blueprint.effect-preview.v1"`、`typeof effectPreviews[*].provenance.model === "string"`
  - [x] 18.4 断言内容回退到模板化产出：`effectPreviews[0].summary` 匹配 `/^Preview the expected effect of /`、`effectPreviews[0].architectureNotes[0]` 匹配 `/^Anchor implementation around /`、`progressPlan[*].title` 与 `buildEffectPreviewMilestones()` 模板产出一致、`runtimeProjection.hudState.title` 与 `buildEffectPreviewRuntimeProjection()` 模板产出一致
  - [x] 18.5 断言数组顺序稳定：`effectPreviews.map(p => p.nodeId)` 与今天历史行为一致（需求 5.6）
  - [x] 18.6 断言事件 payload：`BlueprintEventName.PreviewGenerated` emit 的 payload 含 `previewGenerationSources: [{ nodeId, generationSource: "llm_fallback" }, ...]`
  - [x] 18.7 测试清理：同 task 17.7；确保 `llmMocks.callLLMJson.mockReset()` 不影响其它 E2E 用例
  - _Requirements: 5.6, 6.5, 9.1_

- [x] 19. 最终全量回归：`node --run check` + `node --run test`
  - [x] 19.1 `node --run check` → 0 个新增 TS 错误（若仓库已有历史类型债，不应扩大错误面；design §10.2 最终检查清单的硬约束）
  - [x] 19.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 + 2 = 49 条 E2E 全绿（新增 real + fallback 两条）
  - [x] 19.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/effect-preview/` → ~43 条新增 co-located 单测全绿
  - [x] 19.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [x] 19.5 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [x] 19.6 `node --run test`（或项目级等价全量 test 命令）→ 所有 suite 绿（基线 + 新增全部通过）
  - _Requirements: 5.3, 5.4, 8.3, 8.4, 8.5, 9.6_

- [x] 20. **最终验证 checklist** — 对齐 design §10.2 manual verification checklist
  - [x] 20.1 人工核对 `shared/blueprint/contracts.ts` 中 `BlueprintEffectPreview.provenance` 追加 7 个可选字段（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）；`shared/blueprint/events.ts` 中 `BlueprintPreviewGeneratedEventPayload` 追加 3 个可选字段（`previewGenerationSources` / `promptId` / `model`）；无任何字段被重命名或类型变更
  - [x] 20.2 人工核对 `policy.ts` / `schema.ts` / `prompt.ts` / `normalize.ts` / `service.ts` 五个文件均落地并通过各自 co-located 子域单测
  - [x] 20.3 人工核对 `BlueprintServiceContext` 追加 2 个可选字段（`effectPreviewLlmPolicy?` / `effectPreviewLlmService?`）；`buildBlueprintServiceContext` 默认装配 `createEffectPreviewLlmService(ctx)`；未装配时保留向后兼容（template 路径）
  - [x] 20.4 人工核对 `buildEffectPreview()` 改为 `async(ctx, input)`；`generateEffectPreviews()` 改为 `async` 并使用 `Promise.all` 并发；所有调用点已补 `await`；模板化路径（`buildEffectPreviewPrototypeCues` / `buildEffectPreviewMilestones` / `buildEffectPreviewRuntimeProjection` / `summarizeEffectPreviewDocument`）字节级等价今天
  - [x] 20.5 人工核对禁止清单：`service.ts` 及其它实现文件不出现 `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；不 `import` 模块级 eventBus / jobStore 单例；不出现裸事件字符串 `"preview.generated"` / `"preview.refreshed"`（所有事件 `type` 走 `BlueprintEventName` 常量）
  - [x] 20.6 人工核对 adapter 命名：若在事件 / provenance 中携带 `adapter` 字段，real 路径 adapter 字符串不含 `.simulated` 子串（推荐 `"blueprint.effect-preview.llm"`）；fallback 路径保留今天既有命名不变
  - [x] 20.7 人工核对混合 provenance 独立性：同一次 `generateEffectPreviews()` 请求中，N 份预演的 `provenance.generationSource` / `promptId` / `model` / `error` 字段彼此独立；部分走 LLM 成功、部分走 fallback 不会互相污染（需求 4.7）
  - [x] 20.8 手动场景 1：本地运行 `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED=true` + 有效 LLM apiKey → `POST /api/blueprint/jobs/:id/effect-previews` → 响应 `effectPreviews[*].provenance.generationSource === "llm"` + `summary` / `architectureNotes` / `progressPlan` / `runtimeProjection.hudState` 来自 LLM（与今天模板化产出**明显不同**）
  - [x] 20.9 手动场景 2：本地运行 `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED=true` + 无 apiKey → 响应 `effectPreviews[*].provenance.generationSource === "template"` + 内容字段使用模板化产出
  - [x] 20.10 手动场景 3：本地运行 `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED=true` + mock LLM 抛错 → 响应 `effectPreviews[*].provenance.generationSource === "llm_fallback"` + `error` 被填充（已脱敏）+ 内容字段回退模板
  - [x] 20.11 手动场景 4：本地不设 `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED` → 响应 `effectPreviews[*].provenance.generationSource === "template"` + 与今天字节相同（fallback E2E guard 已在 task 16 自动化覆盖，此步骤为手动复核）
  - [x] 20.12 手动场景 5：一次请求 N = 3 份预演，mock LLM 使第 1 份成功、第 2 份抛错、第 3 份返回非法 schema → 响应 `effectPreviews[0].provenance.generationSource === "llm"`、`effectPreviews[1].provenance.generationSource === "llm_fallback"`、`effectPreviews[2].provenance.generationSource === "llm_fallback"`；数组顺序 / 长度 / `nodeId` 覆盖集合与今天一致（需求 4.7 + 5.6）
  - [x] 20.13 Schema 版本锚点确认：`promptId === "blueprint.effect-preview.v1"` 作为 schema 版本锚点；后续任何 schema 变更都需判断是否 bump 到 `v2`（新增可选字段兼容、删除字段 / 修改类型 / 严格化约束必须 bump）
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.5, 8.1, 8.2, 8.3, 8.5, 8.6, 9.6_

## 说明

- 本任务清单所有任务均为必做项，不含 `*` 可选标记（spec 范围聚焦、体量可控，与 routeset / spec-tree / spec-documents / 四条桥 spec 风格一致）。
- 每个任务都在 footer 中引用至少 1 个 EARS requirement id，便于追溯。
- 任务 2 / 4 / 6 / 8 / 12 均为 example-based 单测（共 ~43 条 co-located），**不**包含 PBT（符合 Requirement 9.3 + design §6.1 lock）；若后续 tasks 阶段发现需要 PBT 覆盖，必须显式写出要验证的不变量，否则应改为 example-based。
- 任务 17 / 18 只向 `server/tests/blueprint-routes.test.ts` **追加** 2 条新用例，不修改原有 47 条（符合 Requirement 9.6）。
- 本 spec 未调用 `prework` 工具（与 routeset / spec-tree / spec-documents / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径；design §6.1 明确锁定 example-based only）。
- **D5（Prompt ID 锁定 `blueprint.effect-preview.v1`）** 在任务 5.1 / 6.7 / 10.1 落地。
- **D6（Provenance 扩展策略，7 个可选字段）** 在任务 14.6 / 15.1 落地。
- **D7（事件复用既有 `BlueprintEventName.PreviewGenerated`，不新增事件名，仅 payload 追加可选字段）** 在任务 14.9 / 15.2 / 17.6 / 18.6 / 20.5 落地：本 spec 默认**不单独新增事件名**（需求 6.2）；只在既有 `PreviewGenerated` emit 点的 payload 上追加 `previewGenerationSources` / `promptId` / `model` 可选字段；每份预演独立汇总，用于前端驾驶舱 / 监控聚合展示；事件 `type` 仍通过 `BlueprintEventName` 常量构造，不出现裸字符串。
- **D8（Strict zod schema + `.superRefine()` 7 组预演不变量）** 在任务 3.7 / 4 落地：summary trim / architectureNotes 与 prototypeNotes trim / progressPlan trim + title 唯一 / hudState trim / consoleLines trim / logTimeline message trim + id 唯一 / browserPreview trim。
- **D9（脱敏走 `applyEffectPreviewRedaction` 纯函数）** 在任务 1.3 / 2.4-2.6 / 10.3 / 12.7 落地：`provenance.error` / logger meta 进入前过脱敏；`summary` / `architectureNotes[*]` / `progressPlan[*]` / `runtimeProjection.*.message` 等内容字段**不**强制脱敏原文（下游 Prompt Package / Engineering Handoff / Artifact Replay 需要完整字段），由 prompt 约束 LLM 抽象化敏感标识。
- **D10（测试默认装配 ≡ 生产行为）** 在任务 13 / 16 落地：既有 47 E2E + 48 子域单测 + 9 SDK smoke 在默认未设 `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED` 的装配下继续通过，字节级等价今天。
- **per-preview 隔离（需求 4.7）** 在任务 12.8 / 14.7 / 20.7 / 20.12 落地：一次 `generateEffectPreviews()` 请求中 N 份预演的 LLM 调用彼此独立，任何一份失败不污染其他成功预演的 provenance；`effectPreviews[*]` 数组顺序 / 长度 / `nodeId` 覆盖集合保持今天口径（需求 5.6）。
- 任务 9 / 13 / 16 / 19 是强制的验证门禁，必须在所有对应实现任务完成后执行；任何一步失败都必须回到对应实现任务修复后再跑整套回归。
- 本 spec 完成后，工作流结束 — 不在此 spec 内覆盖后续 Prompt Package / Engineering Handoff 的 LLM 驱动（各自独立 spec 推进）。用户可通过 `tasks.md` 中的 "Start task" 入口逐项执行。
