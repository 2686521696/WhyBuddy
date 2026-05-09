# 实施任务：Autopilot SPEC Documents LLM 驱动生成

## 概述

本任务清单把 design 文档 §10.1 的 4 个检查点（A 纯函数 helpers + schema + prompt + render + co-located 单测 → B service 工厂 + context 扩展 + service 单测 → C 外层 hook 接线 + contract 扩展 + fallback E2E guard → D E2E real + fallback + 最终全量回归）收敛为 20 个可验证的代码任务，覆盖：

- `server/routes/blueprint/spec-documents/` 目录下 5 个新模块（`policy` / `schema` / `prompt` / `render` / `service`）及其 co-located 单测
- `server/routes/blueprint/context.ts` 的 2 个可选依赖字段扩展（`specDocumentsLlmPolicy?` + `specDocumentsLlmService?`；**不改 `ctx.llm` 字段** — LLM 能力已在上游 spec 默认装配）及默认装配
- `server/routes/blueprint.ts` 中 `buildSpecDocument()` / `generateSpecDocuments()` 的 async 改造 + 所有调用点追加 `await` + `Promise.all` 并发 + ctx / `clarificationSession` / `domainContext` / `primaryRoute` 透传
- `shared/blueprint/contracts.ts` 的 `BlueprintSpecDocument.provenance` 7 个可选字段扩展（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）
- `server/tests/blueprint-routes.test.ts` 追加 2 条 E2E（Real LLM path / Fallback path）
- 最终全量回归（既有 47 E2E + 48 子域单测 + 9 SDK smoke 零回归）

每个任务都对应明确的落点文件、函数与验收标准；所有任务均为本 spec 的必做项，不引入 `*` 可选标记。

依赖顺序：**检查点 A**（tasks 1-9）→ **检查点 B**（tasks 10-13）→ **检查点 C**（tasks 14-16）→ **检查点 D**（tasks 17-20）。每个检查点结束都有一条显式"验证"任务作为质量门禁；任何一条验证失败都必须回到对应实现任务修复后再跑整套回归。

**Requirement 9.3 + design §6.1 lock**：本阶段测试策略为 **example-based only**，**禁止引入 PBT**；若后续 tasks 阶段出现任何被标注为 PBT 的任务，必须显式写出要验证的不变量，否则应改为 example-based。本 spec 未调用 `prework` 工具（与 routeset / spec-tree / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径）。

## 任务列表

### 检查点 A：纯函数 helpers + schema + prompt + render + co-located 单测（低风险，先做）

- [ ] 1. 新建 `server/routes/blueprint/spec-documents/policy.ts`
  - [ ] 1.1 定义并导出 `SpecDocumentsLlmPolicy` 接口（字段按 design §4.3：`maxInvocationTimeoutMs`、`temperature`、`callJsonRetryAttempts`、`minSectionCount`、`maxSectionCount`、`maxSectionBodyLength`、`maxTitleLength`、`maxSummaryLength`、`maxSectionIdLength`、`maxSectionTitleLength`、`maxSectionSummaryLength`、`redactionKeywords`、`redactedEmailPattern`、`redactedApiKeyPattern`、`redactedGithubPatPattern`、`maxErrorLength`）
  - [ ] 1.2 实现并导出 `createDefaultSpecDocumentsLlmPolicy()`：默认 `maxInvocationTimeoutMs = 30_000`；从 `process.env.BLUEPRINT_SPEC_DOCUMENTS_LLM_TIMEOUT_MS` 读取覆盖值，仅当解析为正整数且 `<= 30_000` 时采用，否则回退到 30_000（design §4.3 + §2.D4）
  - [ ] 1.3 实现并导出纯函数 `applySpecDocumentsRedaction(value: string, policy: SpecDocumentsLlmPolicy): string`，覆盖 API key（`sk-...` / `clp_...`）、GitHub PAT（`gh[pousr]_...` / `github_pat_...`）、email、Authorization / Bearer / `token=` / `api_key=` / `x-github-token` / `openai-api-key` 等 key-value 对的脱敏
  - [ ] 1.4 **禁止** 在本文件 `import` 任何运行时 / 业务模块（保持纯函数）；仅 `import` TS 内置类型
  - _Requirements: 2.7, 4.5, 5.1_

- [ ] 2. 新建 `server/routes/blueprint/spec-documents/policy.test.ts`（~6 条 example-based 单测）
  - [ ] 2.1 断言 `createDefaultSpecDocumentsLlmPolicy().maxInvocationTimeoutMs === 30_000`（默认值）
  - [ ] 2.2 断言环境变量 `BLUEPRINT_SPEC_DOCUMENTS_LLM_TIMEOUT_MS="5000"` 被读取后 `maxInvocationTimeoutMs === 5_000`；测试后清理 `process.env`
  - [ ] 2.3 断言非法环境变量值（`"abc"` / `"-1"` / `"99999"` / `"0"`）均回退到 `30_000`
  - [ ] 2.4 断言 `applySpecDocumentsRedaction("sk-ABCDEFGHIJKLMNOP1234567890", policy)` 不含原 API key 子串
  - [ ] 2.5 断言 `applySpecDocumentsRedaction("contact alice@example.com", policy)` 不含原邮箱子串
  - [ ] 2.6 ReDoS 哨兵：构造 5MB 字符串（`"a".repeat(5_000_000)`）调用 `applySpecDocumentsRedaction` 耗时 `< 200ms`（`performance.now()` 对比）
  - _Requirements: 5.1, 9.8_

- [ ] 3. 新建 `server/routes/blueprint/spec-documents/schema.ts`
  - [ ] 3.1 按 design §4.4 定义 `SECTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/`、`SUPPORTED_STATUSES = ["draft", "reviewing", "accepted", "rejected"] as const` 与 `SpecDocumentsLlmSectionSchema`：`id`（1..64 字符 + `SECTION_ID_PATTERN`）、`title`（1..200 字符）、`summary`（1..500 字符）、`body`（1..8000 字符）
  - [ ] 3.2 定义并导出 `SpecDocumentsLlmResponseSchema`：`z.object({ title, summary, sections: z.array(SpecDocumentsLlmSectionSchema).min(2).max(20), status: z.enum(SUPPORTED_STATUSES).optional() }).superRefine((data, ctx) => { ... })`；`.superRefine` 按 design §4.4 实现 3 组文档级不变量：(a) `title` / `summary` trim 后非空；(b) 每个 `section.title` / `section.summary` / `section.body` trim 后非空；(c) `sections[*].id` 在同一文档内唯一（`trim + toLowerCase` 比较）；每条不变量违反时 `ctx.addIssue` 后 `return` 避免级联
  - [ ] 3.3 **不使用 `.strict()`**（zod 默认 strip 行为静默丢弃未知字段，design §2.D8）；**禁止** 任何 `.transform(...)` / `z.coerce.*` / `z.preprocess(...)` coerce 链（需求 3.2）
  - [ ] 3.4 导出类型别名 `export type SpecDocumentsLlmResponse = z.infer<typeof SpecDocumentsLlmResponseSchema>` 与 `export type SpecDocumentsLlmSection = z.infer<typeof SpecDocumentsLlmSectionSchema>`
  - [ ] 3.5 **禁止** 在本文件 `import` 任何运行时 / 业务模块；仅 `import { z } from "zod"` 与 `import type { BlueprintSpecDocumentStatus }` 类型
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. 新建 `server/routes/blueprint/spec-documents/schema.test.ts`（~16 条 example-based 单测）
  - [ ] 4.1 合法 minimal payload（`title` + `summary` + 2 个 sections）→ `safeParse({ success: true })`
  - [ ] 4.2 合法 full payload（`sections.length === 20`、含 `status: "accepted"`、每个 section 含完整字段）→ 通过
  - [ ] 4.3 `title` 缺失 → 失败；`summary` 缺失 → 失败；`sections` 缺失或非数组 → 失败
  - [ ] 4.4 `sections.length < 2`（1 个 section）→ 失败；`sections.length > 20`（21 个 section）→ 失败
  - [ ] 4.5 `section.id` 非 kebab-case（`"SECTION-1"` / `"section_1"` / `"1section"` / `""` / 65 字符）→ 失败
  - [ ] 4.6 `section.id` 在数组内重复（两个 `id: "overview"`，大小写不敏感如 `"OVERVIEW"` / `"overview"`）→ `.superRefine` 触发失败，错误消息包含 `"duplicated"`
  - [ ] 4.7 `title` trim 后为空（`"   "` / `"\t\n"`）→ `.superRefine` 触发失败，错误消息包含 `"must not be empty after trim"`
  - [ ] 4.8 `summary` trim 后为空 → `.superRefine` 触发失败
  - [ ] 4.9 `section.title` trim 后为空 → 失败；`section.summary` trim 后为空 → 失败；`section.body` trim 后为空 → 失败
  - [ ] 4.10 `title.length > 200` → 失败；`summary.length > 500` → 失败
  - [ ] 4.11 `section.body.length > 8000` → 失败；`section.title.length > 200` → 失败；`section.summary.length > 500` → 失败
  - [ ] 4.12 `status` 非受支持值（`"in_review"` / `"archived"` / `""`）→ 失败；`status` 省略 → 通过
  - [ ] 4.13 未知顶层字段（`author: "alice"`）→ zod strip 静默丢弃，不影响 `safeParse.success`
  - [ ] 4.14 未知 section 字段（`section.meta: "foo"`）→ 同样被 strip，不影响成功
  - [ ] 4.15 ReDoS 哨兵：构造 `section.id` 为 1000 字符字符串 → 被 `max(64)` 快速拒绝，耗时 `< 50ms`
  - [ ] 4.16 类型错误（`sections: "not-an-array"` / `section.body: 123`）→ 失败
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.2_

- [ ] 5. 新建 `server/routes/blueprint/spec-documents/prompt.ts`
  - [ ] 5.1 导出常量 `SPEC_DOCUMENTS_PROMPT_ID = "blueprint.spec-documents.v1"` 与类型 `SpecDocumentsPromptPayload`（字段：`promptId` / `systemMessage` / `userMessage` / `userPayload` / `promptFingerprint`）
  - [ ] 5.2 定义并导出 `BuildSpecDocumentsPromptInput` 类型（按 design §4.5：`request` / `specTreeNode` / `targetDocumentType` / `primaryRoute?` / `clarificationSession?` / `domainContext?` / `upstreamEvidence?` / `locale`）
  - [ ] 5.3 实现 `buildSpecDocumentsPrompt(input)`：按 design §4.5 构造 `userPayload`，字段顺序固定为 `{ promptId, targetDocumentType, specTreeNode, primaryRoute, intake, clarification, projectContext, upstreamEvidence, outputSchema }`；`clarification.answers` 按 `questionId` 字典序排序；`primaryRoute.steps` 保留原始顺序；`intake.githubUrls` 按请求输入顺序；`upstreamEvidence.reusableRoleFindings` 按 `id` 字典序
  - [ ] 5.4 实现 locale-aware + `targetDocumentType`-aware `systemMessage`：`locale === "zh-CN"` 使用中文 SPEC Document 生成器文案（含 CJK），否则英文文案；按 `targetDocumentType` 分支（`"requirements"` / `"design"` / `"tasks"`）注入对应约束文本（design §4.5 节选），两个版本都覆盖 schema 约束、section 组织建议与敏感信息抽象化要求
  - [ ] 5.5 `userMessage = JSON.stringify(userPayload, null, 2)`；`promptFingerprint = "sha256:" + sha256Hex(systemMessage + "\n\n" + userMessage)`（复用 `server/core/ids.ts` 或等价 hash helper）
  - [ ] 5.6 **禁止** 在本文件 `import` `callLLMJson` / `getAIConfig` / `fetch`；仅允许 `import type` shared blueprint 类型 + 一个 sha256 纯 helper
  - _Requirements: 2.2, 2.4, 2.5, 3.1, 3.2_

- [ ] 6. 新建 `server/routes/blueprint/spec-documents/prompt.test.ts`（~10 条 example-based 单测）
  - [ ] 6.1 断言确定性：同一组 `(request, specTreeNode, targetDocumentType, primaryRoute, clarificationSession, domainContext, upstreamEvidence, locale)` 两次调用 `buildSpecDocumentsPrompt` 产出**字节相同** `userMessage`
  - [ ] 6.2 断言输入变化敏感：追加一条新的 clarification answer 后 `userMessage` 发生变化（且 `promptFingerprint` 也变化）
  - [ ] 6.3 断言 `answers` 按 `questionId` 字典序排序（输入 `["q-c", "q-a", "q-b"]` → 输出顺序 `["q-a", "q-b", "q-c"]`）
  - [ ] 6.4 断言 `locale === "zh-CN"` 时 `systemMessage` 包含 CJK 字符（正则 `/[\u4e00-\u9fff]/`）
  - [ ] 6.5 断言 `locale === "en-US"` 时 `systemMessage` 不含 CJK 且以英文开头（例如 `/^You are the \/autopilot SPEC Document/`）
  - [ ] 6.6 断言 `SPEC_DOCUMENTS_PROMPT_ID === "blueprint.spec-documents.v1"` 与 prompt 输出的 `promptId` 一致
  - [ ] 6.7 断言 `targetDocumentType === "requirements"` / `"design"` / `"tasks"` 三个分支的 `systemMessage` 文本互不相同（至少在约束段落有差异）
  - [ ] 6.8 断言 `primaryRoute.steps` 在 `userPayload` 中保留原始顺序（不被字典序排序）
  - [ ] 6.9 断言 `userPayload.outputSchema` 包含 `title` / `summary` / `sections` / `sections[].id` / `sections[].title` / `sections[].summary` / `sections[].body` / `status` 的约束描述
  - [ ] 6.10 断言 `upstreamEvidence` 为 undefined 时 `userPayload.upstreamEvidence` 也为 undefined（不注入空数组污染）
  - _Requirements: 2.2, 2.5, 3.1, 3.2, 9.2_

- [ ] 7. 新建 `server/routes/blueprint/spec-documents/render.ts`
  - [ ] 7.1 导出类型 `RenderSectionsInput`（字段：`title: string`、`summary: string`、`sections: Array<{ id: string; title: string; summary: string; body: string }>`）
  - [ ] 7.2 实现纯函数 `renderSectionsToMarkdown(input: RenderSectionsInput): string`：按 design §4.7 规则拼装——(1) 顶层 `# {title}` + 空行 + `{summary}` + 空行；(2) 每个 section `## {section.title}` + 空行 + `{section.body}` + 空行；(3) 不输出 `section.id` 与 `section.summary`（只用于校验 / 预览，不入 content）；(4) 最终产出以单个换行结束（`.replace(/\n+$/, "\n")`）
  - [ ] 7.3 在实现中对 `title` / `summary` / `section.title` / `section.body` 做 `.trim()`（防御性；schema `.superRefine` 已保证 trim 后非空）
  - [ ] 7.4 **禁止** 在本文件 `import` 任何运行时 / 业务模块；纯字符串拼接
  - _Requirements: 2.4, 2.6_

- [ ] 8. 新建 `server/routes/blueprint/spec-documents/render.test.ts`（~5 条 example-based 单测）
  - [ ] 8.1 最小合法输入（`title` + `summary` + 2 个 sections，body 短小）→ 输出 Markdown 精确匹配预期字节（`# {title}\n\n{summary}\n\n## {title1}\n\n{body1}\n\n## {title2}\n\n{body2}\n`）
  - [ ] 8.2 断言 `section.id` 与 `section.summary` **不**出现在 content 中
  - [ ] 8.3 多个 sections（5 个）→ 每个 section 之间用空行分隔，不产生多余连续换行
  - [ ] 8.4 `section.body` 内部含 `##` 二级标题（`"## Sub header"`）→ 不被二次 escape（等价于今天模板化 body 行为），原样保留
  - [ ] 8.5 输入含首尾空白（`title: "  Draft  "`）→ 输出 content 中 trim 后的 `# Draft`；结尾 `\n+$` 被规范化为单个 `\n`
  - _Requirements: 2.4, 2.6_

- [ ] 9. **Checkpoint A 验证** — 运行纯函数子域单测
  - [ ] 9.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 9.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/spec-documents/policy.test.ts server/routes/blueprint/spec-documents/schema.test.ts server/routes/blueprint/spec-documents/prompt.test.ts server/routes/blueprint/spec-documents/render.test.ts` → ~37 条新增单测全绿（policy ~6 + schema ~16 + prompt ~10 + render ~5）
  - [ ] 9.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 9.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（A 阶段尚未接线，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 B：Service 工厂 + Context 扩展 + 单测（依赖 A）

- [ ] 10. 新建 `server/routes/blueprint/spec-documents/service.ts`：`createSpecDocumentsLlmService(ctx)` 工厂 + 主算法
  - [ ] 10.1 按 design §4.2 定义并导出接口 `SpecDocumentsLlmServiceInput`（字段：`jobId` / `job` / `request` / `specTreeNode` / `targetDocumentType` / `primaryRoute?` / `clarificationSession?` / `domainContext?` / `upstreamEvidence?` / `createdAt`）与 `SpecDocumentsLlmServiceOutput`（字段：`generationSource` / `title?` / `summary?` / `content?` / `status?` / `promptId?` / `model?` / `promptFingerprint?` / `responseDigest?` / `structuredPayloadDigest?` / `error?`）；导出类型别名 `SpecDocumentsLlmService = (input) => Promise<SpecDocumentsLlmServiceOutput>`
  - [ ] 10.2 导出工厂 `createSpecDocumentsLlmService(ctx: BlueprintServiceContext): SpecDocumentsLlmService`，工厂在闭包内解析 `policy = ctx.specDocumentsLlmPolicy ?? createDefaultSpecDocumentsLlmPolicy()`
  - [ ] 10.3 按 design §4.6 伪代码实现 service 主算法的六档 fallback：
    - 档位 1（未启用）：`process.env.BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED !== "true"` → 早退 `{ generationSource: "template" }`，`ctx.logger.debug` 记录"not enabled, using template"
    - 档位 2（apiKey 缺失）：`ctx.llm.getConfig().apiKey` 为空 → 早退 `{ generationSource: "template" }`（design §4.6 + §5.1 锁定此口径与档位 1 合流），不填 `error` / `promptId` / `model`
    - 档位 3（callJson 抛错 / 非 JSON）：try/catch `ctx.llm.callJson`；若抛错或返回 undefined / null / non-object → `{ generationSource: "llm_fallback", promptId, model, promptFingerprint, error: "llm callJson threw: ..." 或 "non-json response"`（≤ `policy.maxErrorLength` 字符，经 `applySpecDocumentsRedaction` 脱敏）
    - 档位 4 / 5（schema + `.superRefine` 不变量失败）：`SpecDocumentsLlmResponseSchema.safeParse(rawPayload)` 返回 `success: false` → `{ generationSource: "llm_fallback", error: "schema validation failed: ..." }`
    - 档位 6（超时）：callJson 因 `timeoutMs: policy.maxInvocationTimeoutMs` 触发 AbortError → fallback，`error: "llm timeout"`（通过正则 `/abort|timeout/i` 识别错误文本）
  - [ ] 10.4 Happy path：`parsed.success === true` → 调用 `normalizeSpecDocumentsResponse(parsed.data, policy)`（内部 trim `title` / `summary` / `section.title` / `section.summary` / `section.body`、`section.id` 做 `trim().toLowerCase()`）→ 调用 `renderSectionsToMarkdown(normalized)` 产出 `content`；计算 `responseDigest = "sha256:" + sha256Hex(JSON.stringify(rawPayload))`、`structuredPayloadDigest = "sha256:" + sha256Hex(JSON.stringify(normalized))`；返回 `{ generationSource: "llm", title, summary, content, status, promptId, model, promptFingerprint, responseDigest, structuredPayloadDigest }`
  - [ ] 10.5 LLM 调用参数固定为 `{ model: aiConfig.model, temperature: policy.temperature, timeoutMs: policy.maxInvocationTimeoutMs, retryAttempts: policy.callJsonRetryAttempts, sessionId: input.clarificationSession?.id ?? input.request.clarificationSessionId }`
  - [ ] 10.6 **硬约束**（design §2.D1）：本文件 SHALL NOT `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；所有 LLM 能力来自 `ctx.llm.callJson` + `ctx.llm.getConfig`；不得 import 模块级 eventBus / jobStore 单例
  - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 3.5, 3.6, 4.1, 4.5, 5.1, 7.1, 7.2, 7.4, 7.5_

- [ ] 11. 扩展 `server/routes/blueprint/context.ts`：追加 2 个可选依赖字段 + 默认装配
  - [ ] 11.1 在 `BlueprintServiceContext` 与 `BlueprintServiceContextDeps` 上追加 2 个可选字段：`specDocumentsLlmPolicy?: SpecDocumentsLlmPolicy`、`specDocumentsLlmService?: SpecDocumentsLlmService`；类型仅 `import type`，不 import 工厂实现避免循环依赖
  - [ ] 11.2 **不改 `ctx.llm` 字段**：`ctx.llm.callJson` / `ctx.llm.getConfig` 已在上游 spec 默认装配，本 spec 只消费不扩展（需求 7.5 + design §2.D2）
  - [ ] 11.3 在 `buildBlueprintServiceContext(deps)` 中：`deps.specDocumentsLlmPolicy ?? createDefaultSpecDocumentsLlmPolicy()`；若 `deps.specDocumentsLlmService` 未注入，使用 `createSpecDocumentsLlmService(ctx)` 构造默认实例挂载到 `ctx.specDocumentsLlmService`
  - [ ] 11.4 保持向后兼容：`deps` 完全不传 policy / service 字段时，既有单测与 E2E 无感知（默认装配后 service 仍因档位 1 早退 → template 路径）
  - [ ] 11.5 `node --run check` 确认类型扩展未引入新 TS 错误
  - _Requirements: 7.1, 7.3, 7.5, 8.2_

- [ ] 12. 新建 `server/routes/blueprint/spec-documents/service.test.ts`：R9.2 四条硬需求 + ~6 条补充
  - [ ] 12.1 **Happy path（R9.2 happy）**：注入 fake `callJson` 返回合法 payload（`title` + `summary` + 3 个 sections）+ `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED = "true"` → 断言 `result.generationSource === "llm"`、`result.title` / `result.summary` / `result.content` 均来自 LLM（`content` 以 `# {title}` 开头，包含 `## {sectionTitle}`）、`result.promptId === "blueprint.spec-documents.v1"`、`result.responseDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`result.structuredPayloadDigest` 匹配同款、`result.error` 为 undefined
  - [ ] 12.2 **Malformed JSON（R9.2 malformed）**：fake `callJson: async () => undefined` → 断言 `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/non-json response/`、`result.title` / `result.content` 为 undefined；再覆盖 `async () => "garbage string"` 与 `async () => 42` 两个子场景
  - [ ] 12.3 **Schema fails（R9.2 schema-fail）**：分别注入 payload：(a) `sections: []`（空），(b) `sections.length === 1`（不足 2），(c) `sections.length === 21`（超过 20），(d) `section.body: ""`（空 body），(e) `section.body` trim 后为空（`"   "`），(f) `title` trim 后为空，(g) 重复 `section.id`（大小写不敏感），(h) `section.id` 非 kebab-case（`"ROOT"` / `""`），(i) `section.body.length > 8000`，(j) `status: "archived"`（非支持值），(k) `title.length > 200` → 每个子场景断言 `result.generationSource === "llm_fallback"`、`result.error` 包含 `"schema validation failed"` 或具体约束描述
  - [ ] 12.4 **ApiKey missing（R9.2 apiKey-missing）**：fake `getConfig: () => ({ model: "gpt-4-turbo", apiKey: "" })` + callJson spy → 断言 `result.generationSource === "template"`（design §5.1 锁定与档位 1 合流的口径）、`callJson` spy 未被调用、`result.error` / `result.promptId` / `result.model` 均为 undefined
  - [ ] 12.5 **补充：Not enabled**：未设环境变量 `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` → `result.generationSource === "template"` + callJson spy 未被调用 + `ctx.logger.debug` 被调用
  - [ ] 12.6 **补充：Timeout**：fake `callJson: async () => { throw new Error("Request aborted due to timeout") }` → `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/llm timeout/`（通过 `/abort|timeout/i` 路径识别）
  - [ ] 12.7 **补充：Redaction**：fake `callJson` 抛错 message 包含 `"sk-ABCDEFGHIJKLMNOP1234567890"` 与 `"alice@example.com"` → 断言 `result.error` 不含原 API key 与邮箱子串（已脱敏）
  - [ ] 12.8 **补充：Per-document isolation**：用同一个 service 实例连续调用两次，第一次 LLM 返回合法 payload（成功 real），第二次 LLM 抛错（fallback）→ 断言第一次 `generationSource === "llm"`，第二次 `generationSource === "llm_fallback"`，且两次调用的 `promptFingerprint` 独立计算（不共享）
  - [ ] 12.9 **补充：Status normalization**：fake `callJson` 返回 `status: "accepted"` → 断言 `result.status === "accepted"`；返回无 `status` 字段 → `result.status === undefined`
  - [ ] 12.10 **补充：Logger meta**：fake `callJson` 抛错 → 断言 `ctx.logger.warn` 被调用且 meta 包含 `{ promptId, error }`（可补充 `nodeId` / `type` 维度，如 service 层已有入参传入）
  - _Requirements: 5.3, 9.2_

- [ ] 13. **Checkpoint B 验证** — 运行完整子域测试
  - [ ] 13.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 13.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/spec-documents/` → ~47 条新增 co-located 单测全绿（policy ~6 + schema ~16 + prompt ~10 + render ~5 + service ~10）
  - [ ] 13.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 13.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（B 阶段 service 已装配但未接入 `buildSpecDocument`，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 C：外层 hook 接线 + contract 扩展 + fallback E2E guard（依赖 B）

- [ ] 14. 改造 `server/routes/blueprint.ts` 的 `buildSpecDocument()` + `generateSpecDocuments()`
  - [ ] 14.1 把 `buildSpecDocument` 签名从 sync 改为 `async (ctx: BlueprintServiceContext, input: { ..., clarificationSession?, domainContext?, primaryRoute? }): Promise<BlueprintSpecDocument>`
  - [ ] 14.2 改造核心路径：先不变地计算 `id = createId("blueprint-spec-document")` / `createdAt` scaffold；`await ctx.specDocumentsLlmService?.(...)` 传入 `jobId` / `job` / `request` / `specTreeNode: input.node` / `targetDocumentType: input.type` / `primaryRoute` / `clarificationSession` / `domainContext` / `upstreamEvidence`（从 `previousRoleFindings` 派生为 `{ reusableRoleFindings: [{ id, label, summary }, ...] }`，空数组时传 undefined）/ `createdAt`
  - [ ] 14.3 `serviceResult?.generationSource === "llm" && serviceResult.title && serviceResult.summary && serviceResult.content` 分支：用 LLM `title` / `summary` / `content` 替换模板化产出；`provenanceExtras = { generationSource: "llm", promptId, model, responseDigest, structuredPayloadDigest, promptFingerprint }`
  - [ ] 14.4 否则（template / llm_fallback）分支：执行今天的 `buildSpecDocumentHeading(input.type, input.node.title)` + `buildSpecDocumentBody({ node, type, previousRoleFindings })` **一行不改**；`title = heading`、`summary = input.node.summary`、`content = body`；`provenanceExtras = { generationSource: serviceResult?.generationSource ?? "template", promptId, model, promptFingerprint, error: serviceResult?.error }`
  - [ ] 14.5 合并 provenance：保留所有既有字段不变（`jobId` / `projectId` / `sourceId` / `targetText` / `githubUrls` / `treeVersion` / `nodeType` / `nodeTitle` / `nodeSummary` / `dependencies` / `outputs` / `reusedRoleFindingIds` / `reusedRoleIds` / `reusedEvidenceIds`），以 `...provenanceExtras` 对象 spread 方式追加 7 个新字段；`BlueprintSpecDocument` 外层字段（`id` / `jobId` / `treeId` / `nodeId` / `type` / `status: "draft"` / `version: 1` / `sourceDocumentId: id` / `format: "markdown"` / `createdAt` / `updatedAt: createdAt`）完全不变
  - [ ] 14.6 把 `generateSpecDocuments()` 签名从 sync 改为 `async (ctx: BlueprintServiceContext, job, specTree, request, options): Promise<BlueprintSpecDocumentsResponse>`；内部 `.flatMap(...)` 改为 `Promise.all(specTree.nodes.filter(...).flatMap(node => { ... return targetTypes.map(type => buildSpecDocument(ctx, { ...primaryRoute 从 routeById lookup ... })); }))`，保留索引顺序（需求 5.6）
  - [ ] 14.7 HTTP handler 调用点追加 `await`；`grep -nE "(buildSpecDocument|generateSpecDocuments)\(" server/ shared/ --include="*.ts"` 发现的其它调用点同步改为 `async` 并透传 `ctx` / `clarificationSession` / `domainContext` / `primaryRoute`
  - [ ] 14.8 确保 `job.clarificationSession` / `job.projectContext` / `job.routeSet` 能从 job 对象上读到（若不可读取，使用 undefined 而不抛错；不依赖新字段）
  - _Requirements: 2.5, 2.6, 2.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.1, 8.2_

- [ ] 15. 扩展 `shared/blueprint/contracts.ts`：`BlueprintSpecDocument.provenance` 追加 7 个可选字段
  - [ ] 15.1 在 `BlueprintSpecDocument.provenance` 类型中追加 7 个可选字段：`generationSource?: "llm" | "llm_fallback" | "template"`、`promptId?: string`、`model?: string`、`responseDigest?: string`、`structuredPayloadDigest?: string`、`promptFingerprint?: string`、`error?: string`；全部可选（design §4.9 + §2.D6）；不删除、不重命名、不修改任何既有 provenance 字段
  - [ ] 15.2 **不扩展** `BlueprintSpecDocumentVersionSnapshot.provenance`（版本化接口不在本 spec 范围，design §4.9 明确锁定）
  - [ ] 15.3 在仓库根运行 `node --run check`，确认新增字段不引入新增 TS 错误；grep 既有 `BlueprintSpecDocument.provenance` / `document.provenance` 消费点确认没有因字段追加而断言失败
  - [ ] 15.4 同步确认 `client/src/lib/blueprint-api/` 下的 SDK normalizer：若使用 object spread 或透明透传，不需改动；若使用显式字段映射，追加 ~7 行可选字段透传（不修改任一既有字段映射行为）
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 8.2, 8.4_

- [ ] 16. **Checkpoint C 验证** — 运行既有 47 E2E + 48 子域 + 9 SDK smoke 确认零回归
  - [ ] 16.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 16.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（未设 `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` → 档位 1 早退 → template 路径 → 字节级等价今天）
  - [ ] 16.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测 + ~47 条新增 co-located 单测全部通过
  - [ ] 16.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [ ] 16.5 本阶段断言点：`document.provenance.generationSource === "template"` 在默认装配下可断言；fallback 路径下 `BlueprintSpecDocumentsResponse.documents[*]` 数组顺序、固定模板段落（`## Summary` / `## Inputs` / `## Derived Content` / `## Reused Role Findings`）、title 格式（`"Requirements: ${nodeTitle}"` / `"Design: ${nodeTitle}"` / `"Tasks: ${nodeTitle}"`）与今天字节相同
  - _Requirements: 5.3, 5.4, 5.5, 5.6, 8.1, 8.3, 8.5, 8.6, 9.6_

### 检查点 D：E2E real + fallback + 最终全量回归（依赖 C）

- [ ] 17. 在 `server/tests/blueprint-routes.test.ts` 追加 E2E 用例 1（Real LLM path，需求 9.1a）
  - [ ] 17.1 用例描述：`it("generateSpecDocuments produces LLM-driven content when spec-documents llm is enabled", async () => {...})`
  - [ ] 17.2 测试前置：`mkdtemp` 创建临时 specsRoot 目录；`process.env.BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})` 按 prompt 内容路由到对应家族（RouteSet / SPEC Tree / role / aigc-node / spec-documents）；仅当 `/SPEC Document|SPEC 文档/i.test(joined)` 命中时返回 design §4.4 给出的合法 payload（`title` + `summary` + 3 个 sections，区别于模板化 `## Summary` / `## Inputs` / `## Derived Content` 骨架），其它家族 prompt 返回对应姊妹 spec 的 fixture 或 undefined
  - [ ] 17.3 执行 `POST /api/blueprint/jobs` 创建 job → `POST /api/blueprint/jobs/:jobId/spec-documents`；断言 `response.status === 201`、`documents[*].provenance.generationSource === "llm"`（所有文档 real）、`documents[*].provenance.promptId === "blueprint.spec-documents.v1"`、`typeof documents[*].provenance.model === "string"`、`documents[*].provenance.responseDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`documents[*].provenance.structuredPayloadDigest` 匹配同款、`documents[*].provenance.promptFingerprint` 匹配同款、`documents[*].provenance.error` 为 undefined
  - [ ] 17.4 断言 LLM content 可见：`documents[0].title` 不等于 `"Requirements: ${nodeTitle}"`（LLM 派生的自定义标题）；`documents[0].content` 以 `# ` 开头，包含 LLM 产出的 `## {sectionTitle}`，**不包含**模板化固定段落 `## Summary` / `## Inputs` / `## Derived Content` / `## Reused Role Findings`
  - [ ] 17.5 断言 documents 顺序：`documents[*]` 顺序符合 `specTree.nodes` × `SPEC_DOCUMENT_TYPES`（`["requirements", "design", "tasks"]`）笛卡尔积（需求 5.6）
  - [ ] 17.6 断言既有 provenance 字段不变：`documents[0].provenance.jobId` / `projectId` / `sourceId` / `targetText` / `githubUrls` / `treeVersion` / `nodeType` / `nodeTitle` / `nodeSummary` / `dependencies` / `outputs` 与 job / specTree / node 一致
  - [ ] 17.7 测试清理：`delete process.env.BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED`；`await rm(specsRoot, { recursive: true, force: true })`
  - _Requirements: 9.1_

- [ ] 18. 在 `server/tests/blueprint-routes.test.ts` 追加 E2E 用例 2（Fallback path，需求 9.1b）
  - [ ] 18.1 用例描述：`it("generateSpecDocuments falls back to template when spec-documents llm call throws", async () => {...})`
  - [ ] 18.2 测试前置：`process.env.BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})`；仅当 `/SPEC Document|SPEC 文档/i.test(joined)` 命中时 `return Promise.reject(new Error("upstream 503"))`；其它家族 prompt 返回对应姊妹 spec 的 fixture 或 undefined（确保 SPEC Tree 能成功生成节点，为 SPEC Documents 提供输入）
  - [ ] 18.3 执行 `POST /api/blueprint/jobs` + `POST /api/blueprint/jobs/:jobId/spec-documents`；断言 `response.status === 201`、`documents[*].provenance.generationSource === "llm_fallback"`（所有文档 fallback）、`documents[*].provenance.error` 匹配 `/upstream 503|llm callJson threw/`、`documents[*].provenance.promptId === "blueprint.spec-documents.v1"`、`typeof documents[*].provenance.model === "string"`
  - [ ] 18.4 断言 content 回退到模板化产出：`documents[0].content` 包含固定段落 `## Summary`、`## Inputs`、`## Derived Content`、`## Reused Role Findings`（模板化 `buildSpecDocumentBody()` 产出）；`documents[0].title` 匹配 `/^(Requirements|Design|Tasks): /`（模板化 `buildSpecDocumentHeading()` 产出）
  - [ ] 18.5 断言 documents 顺序与长度：`documents.length === specTree.nodes.length * 3`（默认 3 个类型），顺序符合笛卡尔积；既有 provenance 字段与今天字节相同（需求 5.4 / 5.6）
  - [ ] 18.6 测试清理：同 task 17.7；确保 `llmMocks.callLLMJson.mockReset()` 不影响其它 E2E 用例
  - _Requirements: 9.1_

- [ ] 19. 最终全量回归：`node --run check` + `node --run test`
  - [ ] 19.1 `node --run check` → 0 个新增 TS 错误（若仓库已有历史类型债，不应扩大错误面；design §10.2 最终检查清单的硬约束）
  - [ ] 19.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 + 2 = 49 条 E2E 全绿（新增 real + fallback 两条）
  - [ ] 19.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/spec-documents/` → ~47 条新增 co-located 单测全绿
  - [ ] 19.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 19.5 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [ ] 19.6 `node --run test`（或项目级等价全量 test 命令）→ 所有 suite 绿（基线 + 新增全部通过）
  - _Requirements: 5.3, 5.4, 8.3, 8.4, 8.5, 9.6_

- [ ] 20. **最终验证 checklist** — 对齐 design §10.2 manual verification checklist
  - [ ] 20.1 人工核对 `shared/blueprint/contracts.ts` 中 `BlueprintSpecDocument.provenance` 追加 7 个可选字段（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）；无任何字段被重命名或类型变更；`BlueprintSpecDocumentVersionSnapshot` 完全未改动
  - [ ] 20.2 人工核对 `policy.ts` / `schema.ts` / `prompt.ts` / `render.ts` / `service.ts` 五个文件均落地并通过各自 co-located 子域单测
  - [ ] 20.3 人工核对 `BlueprintServiceContext` 追加 2 个可选字段（`specDocumentsLlmPolicy?` / `specDocumentsLlmService?`）；`buildBlueprintServiceContext` 默认装配 `createSpecDocumentsLlmService(ctx)`；未装配时保留向后兼容（template 路径）
  - [ ] 20.4 人工核对 `buildSpecDocument()` 改为 `async(ctx, input)`；`generateSpecDocuments()` 改为 `async(ctx, job, specTree, request, options)`；`.flatMap(...)` 改为 `Promise.all(...)`；所有调用点已补 `await`；模板化 helper（`buildSpecDocumentHeading` / `buildSpecDocumentBody` / `buildSpecDocumentSectionLines` / `buildReusableRoleFindingLines`）一行未改
  - [ ] 20.5 人工核对禁止清单：`service.ts` 及其它实现文件不出现 `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；不 `import` 模块级 eventBus / jobStore 单例；不出现裸事件字符串 `"spec.document.versioned"` / `"spec.document.reviewed"`（若未来在自然 emit 点追加可选字段，所有事件 `type` 走 `BlueprintEventName` 常量）
  - [ ] 20.6 人工核对 adapter 命名：若在事件 / provenance 中携带 `adapter` 字段，real 路径 adapter 字符串不含 `.simulated` 子串（推荐 `"blueprint.spec-documents.llm"`）；fallback 路径保留今天既有命名不变
  - [ ] 20.7 手动场景 1：本地运行 `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED=true` + 有效 LLM apiKey → 先 `POST /api/blueprint/jobs`（RouteSet / SPEC Tree 走 real 或 fallback 皆可），再 `POST /api/blueprint/jobs/:jobId/spec-documents` → 响应 `documents[*].provenance.generationSource === "llm"` + content 来自 LLM（与今天模板化产出**明显不同**）
  - [ ] 20.8 手动场景 2：本地运行 `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED=true` + 无 apiKey → 响应 `documents[*].provenance.generationSource === "template"` + content 使用固定 `## Summary` / `## Inputs` / `## Derived Content` / `## Reused Role Findings` 骨架
  - [ ] 20.9 手动场景 3：本地运行 `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED=true` + mock LLM 为 SPEC Documents prompt 抛错 → 响应 `documents[*].provenance.generationSource === "llm_fallback"` + `error` 被填充（已脱敏）
  - [ ] 20.10 手动场景 4：本地不设 `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` → 响应 `documents[*].provenance.generationSource === "template"` + 与今天字节相同（fallback E2E guard 已在 task 16 自动化覆盖，此步骤为手动复核）
  - [ ] 20.11 手动场景 5（Per-document isolation）：构造 3 个 node × 3 个 type = 9 份文档，其中 3 份 LLM 返回有效 payload、3 份 LLM 抛错、3 份 LLM 返回非 JSON → 响应 `documents.length === 9`，顺序与 `specTree.nodes` × `SPEC_DOCUMENT_TYPES` 笛卡尔积一致，各自 `provenance.generationSource` 独立正确（不互相污染；需求 4.7）
  - [ ] 20.12 Schema 版本锚点确认：`promptId === "blueprint.spec-documents.v1"` 作为 schema 版本锚点；后续任何 schema 变更都需判断是否 bump 到 `v2`（新增可选字段兼容、删除字段 / 修改类型 / 严格化约束必须 bump）
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.3, 5.4, 5.5, 5.6, 7.1, 7.2, 7.5, 8.1, 8.2, 8.3, 8.5, 8.6, 9.6_

## 说明

- 本任务清单所有任务均为必做项，不含 `*` 可选标记（spec 范围聚焦、体量可控，与 routeset / spec-tree / 四条桥 spec 风格一致）。
- 每个任务都在 footer 中引用至少 1 个 EARS requirement id，便于追溯。
- 任务 2 / 4 / 6 / 8 / 12 均为 example-based 单测（共 ~47 条 co-located），**不**包含 PBT（符合 Requirement 9.3 + design §6.1 lock）；若后续 tasks 阶段发现需要 PBT 覆盖，必须显式写出要验证的不变量，否则应改为 example-based。
- 任务 17 / 18 只向 `server/tests/blueprint-routes.test.ts` **追加** 2 条新用例，不修改原有 47 条（符合 Requirement 9.6）。
- 本 spec 未调用 `prework` 工具（与 routeset / spec-tree / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径；design §6.1 明确锁定 example-based only）。
- **D5（Prompt ID 锁定 `blueprint.spec-documents.v1`）** 在任务 5.1 / 6.6 / 10.1 落地。
- **D6（Provenance 扩展策略，7 个可选字段）** 在任务 14.5 / 15.1 落地。
- **D7（事件复用既有 `BlueprintEventName`，不新增事件名）** 在任务 14 与 20.5 落地：本 spec 默认**不单独新增事件名**（需求 6.2 允许降级）；SPEC Documents 生成主路径当前仅 emit `JobCompleted`，未 emit `spec.document.*`；本 spec 只通过 `BlueprintSpecDocument.provenance` 暴露 `generationSource`，不在本 spec 引入新的 emit 点。
- **D8（Strict zod schema + `.superRefine()` 文档内不变量）** 在任务 3.2 / 4 落地：`sections[*].id` 文档内唯一（大小写不敏感）、`title` / `summary` / 每个 `section.title` / `section.summary` / `section.body` trim 后非空、`status`（若提供）落入受支持集合；`sections.length ∈ [2..20]`、`body.length ∈ [1..8000]` 由顶层 `.min` / `.max` 保证。
- **D10（测试默认装配 ≡ 生产行为）** 在任务 13 / 16 落地：既有 47 E2E + 48 子域单测 + 9 SDK smoke 在默认未设 `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` 的装配下继续通过，字节级等价今天。
- **每份文档的 LLM 调用独立性**（需求 2.2 / 4.7 / 5.6）在任务 12.8 / 14.6 / 17.5 / 18.5 / 20.11 落地：一次 `generateSpecDocuments()` 请求中 N × M 份文档各自独立走 LLM 路径或 fallback；响应体 `documents[*]` 顺序由 `Promise.all` 保留索引不变。
- 任务 9 / 13 / 16 / 19 是强制的验证门禁，必须在所有对应实现任务完成后执行；任何一步失败都必须回到对应实现任务修复后再跑整套回归。
- 本 spec 完成后，工作流结束 — 不在此 spec 内覆盖后续 Effect Preview / Prompt Package / Engineering Handoff 的 LLM 驱动（各自独立 spec 推进）。用户可通过 `tasks.md` 中的 "Start task" 入口逐项执行。
