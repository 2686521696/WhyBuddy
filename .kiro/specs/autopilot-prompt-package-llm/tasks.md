# 实施任务：Autopilot Prompt Package LLM 驱动生成

## 概述

本任务清单把 design 文档 §10.1 的 4 个检查点（A 纯函数 helpers + schema + prompt + normalize + render + co-located 单测 → B service 工厂 + context 扩展 + service 单测 → C 外层 hook 接线 + contract 扩展 + fallback E2E guard → D E2E real + fallback + 最终全量回归）收敛为 20 个可验证的代码任务，覆盖：

- `server/routes/blueprint/prompt-package/` 目录下 6 个新模块（`policy` / `schema` / `prompt` / `normalize` / `render` / `service`）及其 co-located 单测
- `server/routes/blueprint/context.ts` 的 2 个可选依赖字段扩展（`promptPackageLlmPolicy?` + `promptPackageLlmService?`；**不改 `ctx.llm` 字段** — LLM 能力已在 wt1 默认装配）及默认装配
- `server/routes/blueprint.ts` 中 `buildImplementationPromptPackage()` 的 async 改造 + `generateImplementationPromptPackages()` 的 async + `Promise.all` 改造 + 所有调用点追加 `await` + ctx / `clarificationSession` / `domainContext` / `primaryRoute` 透传 + `mergeLlmSectionsWithScaffolds()` 纯函数新增
- `shared/blueprint/contracts.ts` 的 `BlueprintImplementationPromptPackage.provenance` 7 个可选字段扩展（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）
- `BlueprintEventName.PromptPackaged` event payload 追加可选 `promptPackageGenerationSources` / `promptId` / `model` 字段
- `server/tests/blueprint-routes.test.ts` 追加 2 条 E2E（Real LLM path / Fallback path）
- 最终全量回归（既有 47 E2E + 48 子域单测 + 9 SDK smoke 零回归）

每个任务都对应明确的落点文件、函数与验收标准；所有任务均为本 spec 的必做项，不引入 `*` 可选标记。

依赖顺序：**检查点 A**（tasks 1-11）→ **检查点 B**（tasks 12-14）→ **检查点 C**（tasks 15-17）→ **检查点 D**（tasks 18-20）。每个检查点结束都有一条显式"验证"任务作为质量门禁；任何一条验证失败都必须回到对应实现任务修复后再跑整套回归。

**Requirement 9.3 + design §6.1 lock**：本阶段测试策略为 **example-based only**，**禁止引入 PBT**；若后续 tasks 阶段出现任何被标注为 PBT 的任务，必须显式写出要验证的不变量，否则应改为 example-based。本 spec 未调用 `prework` 工具（与 routeset / spec-tree / spec-documents / effect-preview / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径）。

**关键语义区分**：本 spec 存在两个不同层面的 `id` 概念：
- **Meta `promptId`**（`"blueprint.prompt-package.v1"`）：LLM 生成器本身使用的 prompt 版本标识，写入 `BlueprintImplementationPromptPackage.provenance.promptId`
- **资产 `prompts[*].id`**：LLM 产出、供下游工程落地使用的可复用 prompt 资产 id，在 Package 内唯一；通过 render 规则渲染进 `content` 并可挂入 `sections[*].items`

这两个概念在实现与测试中**不得混用**。

## 任务列表

### 检查点 A：纯函数 helpers + schema + prompt + normalize + render + co-located 单测（低风险，先做）

- [ ] 1. 新建 `server/routes/blueprint/prompt-package/policy.ts`
  - [ ] 1.1 定义并导出 `PromptPackageLlmPolicy` 接口（字段按 design §4.3：`maxInvocationTimeoutMs`、`temperature`、`callJsonRetryAttempts`、`maxTitleLength`、`maxSummaryLength`、`minPrompts`、`maxPrompts`、`maxPromptIdLength`、`maxPromptTitleLength`、`maxSystemPromptLength`、`maxUserPromptLength`、`maxVariablesPerPrompt`、`maxVariableNameLength`、`maxVariableDescriptionLength`、`maxExamplesPerPrompt`、`maxExampleTitleLength`、`maxExampleInputLength`、`maxExampleOutputLength`、`minSections`、`maxSections`、`maxSectionHeadingLength`、`maxSectionBodyLength`、`redactionKeywords`、`redactedEmailPattern`、`redactedApiKeyPattern`、`redactedGithubPatPattern`、`maxErrorLength`）
  - [ ] 1.2 实现并导出 `createDefaultPromptPackageLlmPolicy()`：默认 `maxInvocationTimeoutMs = 30_000`；从 `process.env.BLUEPRINT_PROMPT_PACKAGE_LLM_TIMEOUT_MS` 读取覆盖值，仅当解析为正整数且 `<= 30_000` 时采用，否则回退到 30_000（design §4.3 + §1.3）
  - [ ] 1.3 实现并导出纯函数 `applyPromptPackageRedaction(value: string, policy: PromptPackageLlmPolicy): string`，覆盖 API key（`sk-...` / `clp_...`）、GitHub PAT（`gh[pousr]_...` / `github_pat_...`）、email、Authorization / Bearer / `token=` / `api_key=` / `x-github-token` / `openai-api-key` 等 key-value 对的脱敏
  - [ ] 1.4 **禁止** 在本文件 `import` 任何运行时 / 业务模块（保持纯函数）；仅 `import` TS 内置类型
  - _Requirements: 2.8, 4.1, 5.1_

- [ ] 2. 新建 `server/routes/blueprint/prompt-package/policy.test.ts`（~6 条 example-based 单测）
  - [ ] 2.1 断言 `createDefaultPromptPackageLlmPolicy().maxInvocationTimeoutMs === 30_000`（默认值）
  - [ ] 2.2 断言环境变量 `BLUEPRINT_PROMPT_PACKAGE_LLM_TIMEOUT_MS="5000"` 被读取后 `maxInvocationTimeoutMs === 5_000`；测试后清理 `process.env`
  - [ ] 2.3 断言非法环境变量值（`"abc"` / `"-1"` / `"99999"` / `"0"`）均回退到 `30_000`
  - [ ] 2.4 断言 `applyPromptPackageRedaction("sk-ABCDEFGHIJKLMNOP1234567890", policy)` 不含原 API key 子串；`applyPromptPackageRedaction("ghp_abcdefghijklmnopqrstuvwxyz0123456789", policy)` 不含原 GitHub PAT 子串
  - [ ] 2.5 断言 `applyPromptPackageRedaction("contact alice@example.com", policy)` 不含原邮箱子串；`applyPromptPackageRedaction("Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxx", policy)` 已脱敏
  - [ ] 2.6 ReDoS 哨兵：构造 5MB 字符串（`"a".repeat(5_000_000)`）调用 `applyPromptPackageRedaction` 耗时 `< 200ms`（`performance.now()` 对比）
  - _Requirements: 4.1, 9.8_

- [ ] 3. 新建 `server/routes/blueprint/prompt-package/schema.ts`
  - [ ] 3.1 按 design §4.4 定义 `VariableSchema`（`name: z.string().min(1).max(64)`、`description: z.string().min(1).max(500)`、`required: z.boolean()`）、`ExampleSchema`（`title?` / `input?` / `output?` 各为可选 `z.string().min(1).max(...)`）、`PromptSchema`（`id` 1..128、`title` 1..200、`systemPrompt` 1..4000、`userPrompt` 1..4000、`variables: z.array(VariableSchema).min(0).max(30)`、`examples: z.array(ExampleSchema).min(0).max(10).optional()`）、`SectionSchema`（`heading` 1..200、`body` 1..5000）
  - [ ] 3.2 定义并导出 `PromptPackageLlmResponseSchema`：`z.object({ title: z.string().min(1).max(200), summary: z.string().min(1).max(500), prompts: z.array(PromptSchema).min(1).max(12), sections: z.array(SectionSchema).min(1).max(20) }).superRefine((data, ctx) => { ... })`；`.superRefine` 按 design §4.4 + §D8 实现 6 条不变量：(1) `title` / `summary` trim 后非空；(2) `prompts[*].id` 在 Package 内唯一（trim + lowercase）且每个 prompt 的 `id` / `title` / `systemPrompt` / `userPrompt` trim 后非空；(3) 每个 prompt 的 `variables[*].name` 在该 prompt 内唯一（trim + lowercase）且 `name` / `description` trim 后非空；(4) `examples[*]` 至少一个 `title` / `input` / `output` 非空（避免 `{}` 空 object）；(5) `sections[*].heading` 在 Package 内唯一（trim + lowercase）且 `heading` / `body` trim 后非空；(6) 每条不变量违反时 `ctx.addIssue` 后 `return` 避免级联
  - [ ] 3.3 **不使用 `.strict()`**（zod 默认 strip 行为静默丢弃未知字段，design §D8）；**禁止** 任何 `.transform(...)` / `z.coerce.*` / `z.preprocess(...)` coerce 链（需求 3.3 严格 boolean）
  - [ ] 3.4 导出类型别名 `export type PromptPackageLlmResponse = z.infer<typeof PromptPackageLlmResponseSchema>` 与 `export type PromptPackageLlmPrompt = z.infer<typeof PromptSchema>` / `PromptPackageLlmSection = z.infer<typeof SectionSchema>` / `PromptPackageLlmVariable = z.infer<typeof VariableSchema>` / `PromptPackageLlmExample = z.infer<typeof ExampleSchema>`
  - [ ] 3.5 **禁止** 在本文件 `import` 任何运行时 / 业务模块；仅 `import { z } from "zod"`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. 新建 `server/routes/blueprint/prompt-package/schema.test.ts`（~18 条 example-based 单测）
  - [ ] 4.1 合法最小 payload（1 个 prompt + 1 个 section + 空 variables + 无 examples）→ `safeParse({ success: true })`
  - [ ] 4.2 合法最大 payload（12 个 prompts + 20 个 sections + 每个 prompt 30 个 variables + 10 个 examples）→ 通过
  - [ ] 4.3 合法 payload + `variables[*].required: true` 与 `required: false` 混合使用 → 通过
  - [ ] 4.4 缺 `title` / `summary` / `prompts` / `sections` 任一字段 → 失败
  - [ ] 4.5 `prompts.length === 0`（空数组）→ 失败；`prompts.length === 13` → 失败
  - [ ] 4.6 `sections.length === 0`（空数组）→ 失败；`sections.length === 21` → 失败
  - [ ] 4.7 单个 prompt 的 `variables.length === 31` → 失败；单个 prompt 的 `examples.length === 11` → 失败
  - [ ] 4.8 单个 prompt 缺 `id` / `title` / `systemPrompt` / `userPrompt` / `variables` 任一字段 → 失败
  - [ ] 4.9 `variables[*].required` 为 `"true"`（字符串）→ 失败；`required: 1` → 失败；`required: null` → 失败（严格 boolean）
  - [ ] 4.10 超长字符串：`title` 201 字符 / `summary` 501 / `systemPrompt` 4001 / `userPrompt` 4001 / `body` 5001 / `variable.name` 65 / `variable.description` 501 / `id` 129 / `heading` 201 → 失败
  - [ ] 4.11 各字段 trim 后全空格（`title: "   "` / `summary: "  "` / `prompts[0].systemPrompt: "\n\t"` / `sections[0].body: "   "`）→ `.superRefine` 触发失败，错误消息包含 `"must not be empty after trim"`
  - [ ] 4.12 `prompts[*].id` 重复（`[{id: "setup"}, {id: "Setup"}]` 大小写不敏感）→ `.superRefine` 触发失败，错误消息包含 `"duplicated prompt id"`
  - [ ] 4.13 同 prompt 内重复 `variables[*].name`（`[{name: "tenantId"}, {name: " tenantid "}]` trim + 大小写不敏感）→ 失败，错误消息包含 `"duplicated variable name"`
  - [ ] 4.14 不同 prompt 之间同名 `variables[*].name`（`prompts[0].variables` 有 `name: "id"`，`prompts[1].variables` 也有 `name: "id"`）→ **通过**（作用域限于单个 prompt）
  - [ ] 4.15 `sections[*].heading` 重复（`[{heading: "Overview"}, {heading: "overview"}]`）→ 失败，错误消息包含 `"duplicated section heading"`
  - [ ] 4.16 `examples[0]` 为 `{}` 空 object（所有字段 undefined）→ 失败，错误消息包含 `"must have at least one non-empty"`；`examples[0] = {title: "  "}` 只提供全空白字段 → 同样失败
  - [ ] 4.17 未知顶层字段（`author: "alice"`）、未知 prompt 字段（`prompts[0].extraField: "x"`）、未知 section 字段（`sections[0].tags: []`）→ zod strip 静默丢弃，不影响 `safeParse.success`
  - [ ] 4.18 ReDoS 哨兵：超长 `prompts[0].id`（1000 字符）→ 失败（因 `id` 上界 128）且 `safeParse` 返回时间 < 100ms；超长 `systemPrompt`（10000 字符）→ 失败（上界 4000）且 < 100ms
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.2_

- [ ] 5. 新建 `server/routes/blueprint/prompt-package/prompt.ts`
  - [ ] 5.1 导出常量 `PROMPT_PACKAGE_PROMPT_ID = "blueprint.prompt-package.v1"` 与类型 `PromptPackagePromptPayload`（字段：`promptId` / `systemMessage` / `userMessage` / `userPayload` / `promptFingerprint`）
  - [ ] 5.2 定义并导出 `BuildPromptPackagePromptInput` 类型（按 design §4.5：`job` / `specTree` / `targetPlatform` / `nodes` / `sourceDocuments` / `sourcePreviews` / `primaryRoute?` / `clarificationSession?` / `domainContext?` / `capabilityInvocations?` / `capabilityEvidence?` / `includeDrafts` / `includePreviewDrafts` / `locale`）
  - [ ] 5.3 实现 `buildPromptPackagePrompt(input)`：按 design §4.5 构造 `userPayload`，字段顺序通过内部常量 `USER_PAYLOAD_KEY_ORDER` 显式固定为 `{ promptId, targetPlatform, nodes, sourceDocuments, sourcePreviews, primaryRoute, intake, clarification, projectContext, upstreamEvidence, includeDrafts, includePreviewDrafts, outputSchema }`；`nodes` / `sourceDocuments` / `sourcePreviews` 按 `id` 字典序排序；`clarification.answers` 按 `questionId` 字典序排序；`capabilityInvocations` / `capabilityEvidence` 按 `id` 字典序排序（若提供）；`primaryRoute.steps` 保留原始顺序；`githubUrls` 保留输入顺序
  - [ ] 5.4 实现 locale-aware `systemMessage`：`locale === "zh-CN"` 时使用中文 Prompt Package 生成器文案（含 CJK），否则英文文案；两个版本都覆盖 design §4.5 列出的 11 条约束（合法 JSON 无围栏、根对象必含 4 字段、每个 prompt 4 字段、每个 variable 3 字段 required 严格 boolean、每个 example 至少 1 非空字段、每个 section 2 字段、id / name / heading 唯一、不得引用真实凭据 / 邮箱、prompt 围绕 targetPlatform + 目标节点 + SPEC 文档 + 效果预演推导）
  - [ ] 5.5 `userMessage = JSON.stringify(userPayload, null, 2)`；`promptFingerprint = "sha256:" + sha256Hex(systemMessage + "\n\n" + userMessage)`（复用 `server/core/ids.ts` 或等价 hash helper）
  - [ ] 5.6 **禁止** 在本文件 `import` `callLLMJson` / `getAIConfig` / 模块级 `fetch`；仅允许 `import type` shared blueprint 类型 + 一个 sha256 纯 helper
  - _Requirements: 2.3, 2.4, 2.5, 3.1, 3.2_

- [ ] 6. 新建 `server/routes/blueprint/prompt-package/prompt.test.ts`（~10 条 example-based 单测）
  - [ ] 6.1 断言确定性：同一组 `(job, specTree, targetPlatform, nodes, sourceDocuments, sourcePreviews, primaryRoute, clarificationSession, domainContext, capabilityInvocations, capabilityEvidence, includeDrafts, includePreviewDrafts, locale)` 两次调用 `buildPromptPackagePrompt` 产出**字节相同** `userMessage` 与字节相同 `promptFingerprint`
  - [ ] 6.2 断言输入变化敏感：改变任一个 node id / 任一个 clarification answer / 切换 `targetPlatform` 后 `userMessage` 与 `promptFingerprint` 均发生变化
  - [ ] 6.3 断言 `clarification.answers` 按 `questionId` 字典序排序（输入 `["q-c", "q-a", "q-b"]` → 输出 `["q-a", "q-b", "q-c"]`）
  - [ ] 6.4 断言 `nodes` / `sourceDocuments` / `sourcePreviews` 按 `id` 字典序排序
  - [ ] 6.5 断言 `capabilityInvocations` / `capabilityEvidence` 按 `id` 字典序排序（若提供）
  - [ ] 6.6 断言 `locale === "zh-CN"` 时 `systemMessage` 包含 CJK 字符（正则 `/[\u4e00-\u9fff]/`）；`locale === "en-US"` 时 `systemMessage` 不含 CJK 且以英文开头
  - [ ] 6.7 断言 `PROMPT_PACKAGE_PROMPT_ID === "blueprint.prompt-package.v1"` 与 prompt 输出的 `userPayload.promptId` 一致
  - [ ] 6.8 断言 `primaryRoute.steps` 在 `userPayload` 中保留原始顺序（不被字典序排序）；`githubUrls` 保留输入顺序
  - [ ] 6.9 断言缺少 `capabilityInvocations` / `capabilityEvidence` 时 `userPayload.upstreamEvidence` 为 undefined（而不是空 object）
  - [ ] 6.10 断言 `userPayload.outputSchema` 文本包含 `"prompts"` 长度 1..12、`"sections"` 长度 1..20、`"variables.required: boolean"` 与各字段长度上界的明确说明
  - _Requirements: 2.3, 2.4, 3.1, 3.2, 9.2_

- [ ] 7. 新建 `server/routes/blueprint/prompt-package/normalize.ts`
  - [ ] 7.1 导出类型 `NormalizedPromptPackage`（字段：`title: string`、`summary: string`、`prompts: RenderedPromptAsset[]`、`sections: Array<{ heading: string; body: string }>`）；`RenderedPromptAsset` 从 `./service.ts` 导出或在 shared 位置复用
  - [ ] 7.2 实现纯函数 `normalizePromptPackageResponse(validated, input, policy)`：按 design §4.6 执行 7 步规范化 — (1) trim 所有字符串字段首尾空白；(2) 对 `prompts[*].id` 做轻量 slug 化（`toLowerCase()` + `/\s+/` 替换为 `-` + 仅保留 `[a-z0-9-]`）；(3) prompts id 去重追加数字后缀（`-2`、`-3`…）保留原始顺序；(4) 每个 prompt 的 `variables[*].name` trim + lowercase 比较去重，保留原始大小写，追加数字后缀；(5) `sections[*].heading` trim + lowercase 比较去重，追加数字后缀；(6) 为 `examples` 缺省（`undefined`）补齐空数组 `[]`；(7) 防御性裁剪：单条 `systemPrompt` / `userPrompt` / `body` / `example.input` / `example.output` 超过 policy 上界时截断到上界（schema 已限长，此步为冗余防御）
  - [ ] 7.3 **禁止** 改变 LLM 返回的 `prompts` / `sections` 数组原始顺序（仅做去重后缀补数字，不重排）
  - [ ] 7.4 仅 `import type` policy + schema + service 的类型；不 `import` 任何运行时 / 业务模块
  - _Requirements: 3.6_

- [ ] 8. 新建 `server/routes/blueprint/prompt-package/normalize.test.ts`（~7 条 example-based 单测）
  - [ ] 8.1 合法 validated payload 经 normalize 后：所有字符串首尾空白被 trim、`prompts[*].id` slug 化、`variables[*].name` / `sections[*].heading` 已去重、`examples` 缺省补齐为空数组
  - [ ] 8.2 输入 `prompts[*].id` 全部相同（`["setup", "Setup", "setup"]`）→ 输出三者两两不同（`"setup"`、`"setup-2"`、`"setup-3"`）且保留原始顺序
  - [ ] 8.3 输入 `prompts[*].id` 含空白（`"Main Setup"` / `"deploy feed"`）→ slug 化为 `"main-setup"` / `"deploy-feed"`
  - [ ] 8.4 输入同 prompt 内 `variables[*].name` 全部相同（`["id", "ID", " id "]`）→ 输出两两不同（追加数字后缀，保留原始大小写）
  - [ ] 8.5 输入 `sections[*].heading` 全部相同（`["Overview", "overview"]`）→ 输出追加数字后缀
  - [ ] 8.6 输入某个 prompt 的 `examples` 为 undefined → 输出 `[]`；为空数组时保持为空数组
  - [ ] 8.7 防御性：schema 已限长仍注入越界字符串（例如 `systemPrompt` 5000 字符 + policy 上限降到 3500）→ 截断到 policy 上界
  - _Requirements: 3.6_

- [ ] 9. 新建 `server/routes/blueprint/prompt-package/render.ts`
  - [ ] 9.1 导出纯函数 `renderPromptPackageContent(input: { title, summary, prompts, sections, targetLabel }): string`
  - [ ] 9.2 实现稳定渲染规则（design §4.7）：先输出 `# ${title}` + 空行 + `${summary}` + 空行 + `**Target platform**: ${targetLabel}` + 空行；再输出 `## Reusable Prompts` 段，后接每个 prompt 的 `### Prompt: ${prompts[i].title} (id: ${prompts[i].id})` + 空行 + `**System prompt**` / systemPrompt body + `**User prompt**` / userPrompt body + `**Variables**` + variables 列表（`- \`${name}\` (required: ${required}): ${description}`）+ 可选 `**Examples** (optional)` + examples 列表（`- **${title ?? "Example N"}**` + `  - Input: ${input ?? "(n/a)"}` + `  - Output: ${output ?? "(n/a)"}`）；最后输出每个 `## ${sections[i].heading}` + 空行 + `${sections[i].body}`
  - [ ] 9.3 确定性保证：同输入字节 → 字节相同输出；行分隔符统一使用 `\n`；段落之间使用统一空行数量
  - [ ] 9.4 **不**导入 template 路径的 `renderImplementationPromptContent`；两套渲染 helper 并存、不交叉调用（design §4.7）
  - _Requirements: 2.4_

- [ ] 10. 新建 `server/routes/blueprint/prompt-package/render.test.ts`（~5 条 example-based 单测）
  - [ ] 10.1 确定性：同一组输入两次调用 `renderPromptPackageContent` 产出字节相同字符串
  - [ ] 10.2 含单 prompt + 无 examples（`examples: []`）→ 输出包含 `**Variables**` 块但**不含** `**Examples**` 块
  - [ ] 10.3 含 3 prompts + 每个各含 variables 与 examples → 输出按原始顺序渲染 `### Prompt: ...` 3 次，随后 `## ${sections[0].heading}` 与 `## ${sections[1].heading}` 按原始顺序输出
  - [ ] 10.4 `targetLabel` 字符串被包含在 `**Target platform**:` 行中（例如 `targetLabel: "Codex"` → 输出含 `"**Target platform**: Codex"`）
  - [ ] 10.5 `sections[*].heading` 作为 `## ${heading}` 输出，`body` 紧随其后（空行分隔）；断言输出以 `# ${title}` 开头
  - _Requirements: 2.4_

- [ ] 11. **Checkpoint A 验证** — 运行纯函数子域单测
  - [ ] 11.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 11.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/prompt-package/policy.test.ts server/routes/blueprint/prompt-package/schema.test.ts server/routes/blueprint/prompt-package/prompt.test.ts server/routes/blueprint/prompt-package/normalize.test.ts server/routes/blueprint/prompt-package/render.test.ts` → ~46 条新增单测全绿（policy ~6 + schema ~18 + prompt ~10 + normalize ~7 + render ~5）
  - [ ] 11.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 11.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（A 阶段尚未接线，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 B：Service 工厂 + Context 扩展 + 单测（依赖 A）

- [ ] 12. 新建 `server/routes/blueprint/prompt-package/service.ts`：`createPromptPackageLlmService(ctx)` 工厂 + 主算法
  - [ ] 12.1 按 design §4.2 定义并导出接口 `RenderedPromptAsset`（`id` / `title` / `systemPrompt` / `userPrompt` / `variables: Array<{name, description, required}>` / `examples?: Array<{title?, input?, output?}>`）、`PromptPackageLlmServiceInput`（字段：`jobId` / `job` / `specTree` / `targetPlatform` / `nodes: BlueprintSpecTreeNode[]` / `sourceDocuments: BlueprintSpecDocument[]` / `sourcePreviews: BlueprintEffectPreview[]` / `primaryRoute?` / `clarificationSession?` / `domainContext?` / `capabilityInvocations?` / `capabilityEvidence?` / `includeDrafts` / `includePreviewDrafts` / `createdAt`）、`PromptPackageLlmServiceOutput`（字段：`generationSource` / `renderedTitle?` / `renderedSummary?` / `renderedContent?` / `renderedSections?: Array<{heading, body}>` / `renderedPrompts?: RenderedPromptAsset[]` / `promptId?` / `model?` / `promptFingerprint?` / `responseDigest?` / `structuredPayloadDigest?` / `error?`）；导出类型别名 `PromptPackageLlmService = (input) => Promise<PromptPackageLlmServiceOutput>`
  - [ ] 12.2 导出工厂 `createPromptPackageLlmService(ctx: BlueprintServiceContext): PromptPackageLlmService`，工厂在闭包内解析 `policy = ctx.promptPackageLlmPolicy ?? createDefaultPromptPackageLlmPolicy()`
  - [ ] 12.3 按 design §4.6 + §5.1 伪代码实现 service 主算法的六档 fallback：
    - **档位 1（未启用）**：`process.env.BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED !== "true"` → 早退 `{ generationSource: "template" }`，`ctx.logger.debug` 记录"prompt-package llm: not enabled, using template"
    - **档位 2（apiKey 缺失）**：`ctx.llm.getConfig().apiKey` 为空串或 undefined → 早退 `{ generationSource: "template" }`（design §D2 + §6.3.4 锁定此口径与档位 1 合流），不填 `error` / `promptId` / `model`；`ctx.logger.debug` 记录；callJson spy 不得被调用
    - **档位 3（callJson 抛错 / 非 JSON）**：try/catch `ctx.llm.callJson`；若抛错或返回 undefined / null / non-object → `{ generationSource: "llm_fallback", promptId, model, promptFingerprint, error: "llm callJson threw: ..." 或 "non-json response" }`（≤ `policy.maxErrorLength` 字符，经 `applyPromptPackageRedaction` 脱敏）
    - **档位 4 / 5（schema + `.superRefine` 不变量失败）**：`PromptPackageLlmResponseSchema.safeParse(rawPayload)` 返回 `success: false` → `{ generationSource: "llm_fallback", error: "schema validation failed: ..." }`
    - **档位 6（超时）**：callJson 因 `timeoutMs: policy.maxInvocationTimeoutMs` 触发 AbortError → fallback，`error: "llm timeout"`（通过正则 `/abort|timeout/i` 识别错误文本）
  - [ ] 12.4 Happy path：`parsed.success === true` → 调用 `normalizePromptPackageResponse(parsed.data, input, policy)` → 调用 `renderPromptPackageContent({ title, summary, prompts, sections, targetLabel })` 生成 `renderedContent`；计算 `responseDigest = "sha256:" + sha256Hex(JSON.stringify(rawPayload))`、`structuredPayloadDigest = "sha256:" + sha256Hex(JSON.stringify(normalized))`；返回 `{ generationSource: "llm", renderedTitle, renderedSummary, renderedContent, renderedSections, renderedPrompts, promptId, model, promptFingerprint, responseDigest, structuredPayloadDigest }`
  - [ ] 12.5 LLM 调用参数固定为 `{ model: aiConfig.model, temperature: policy.temperature, timeoutMs: policy.maxInvocationTimeoutMs, retryAttempts: policy.callJsonRetryAttempts, sessionId: input.clarificationSession?.id ?? input.job.request.clarificationSessionId ?? undefined }`
  - [ ] 12.6 warn 级日志 meta 必须包含 `{ promptId, targetPlatform, error? }` 或 `{ promptId, targetPlatform, errorMsg }`（已脱敏）；便于混合 provenance 场景下定位具体失败的 Package
  - [ ] 12.7 **硬约束**（design §D1）：本文件 SHALL NOT `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；所有 LLM 能力来自 `ctx.llm.callJson` + `ctx.llm.getConfig`；不得 import 模块级 eventBus / jobStore 单例；不得出现裸字符串 `"prompt.packaged"` 等事件名
  - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.8, 3.5, 3.6, 4.1, 4.5, 4.6, 4.7, 5.1, 7.1, 7.2, 7.4, 7.5_

- [ ] 13. 扩展 `server/routes/blueprint/context.ts`：追加 2 个可选依赖字段 + 默认装配
  - [ ] 13.1 在 `BlueprintServiceContext` 与 `BlueprintServiceContextDeps` 上追加 2 个可选字段：`promptPackageLlmPolicy?: PromptPackageLlmPolicy`、`promptPackageLlmService?: PromptPackageLlmService`；类型仅 `import type`，不 import 工厂实现避免循环依赖
  - [ ] 13.2 **不改 `ctx.llm` 字段**：`ctx.llm.callJson` / `ctx.llm.getConfig` 已在 wt1 默认装配，本 spec 只消费不扩展（需求 7.1 + design §D2）
  - [ ] 13.3 在 `buildBlueprintServiceContext(deps)` 中：`deps.promptPackageLlmPolicy ?? createDefaultPromptPackageLlmPolicy()`；若 `deps.promptPackageLlmService` 未注入，使用 `createPromptPackageLlmService(ctx)` 构造默认实例挂载到 `ctx.promptPackageLlmService`
  - [ ] 13.4 保持向后兼容：`deps` 完全不传 policy / service 字段时，既有单测与 E2E 无感知（默认装配后 service 仍因档位 1 早退 → template 路径）
  - [ ] 13.5 `node --run check` 确认类型扩展未引入新 TS 错误
  - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [ ] 14. 新建 `server/routes/blueprint/prompt-package/service.test.ts`：R9.2 四条硬需求 + ~6 条补充
  - [ ] 14.1 **Happy path（R9.2 happy）**：注入 fake `callJson` 返回合法 payload（`title: "Release Dashboard Implementation Pack (Codex)"` / `summary` / 2 个 prompts / 3 个 sections）→ 断言 `result.generationSource === "llm"`、`result.renderedTitle` / `renderedSummary` / `renderedContent` / `renderedSections` / `renderedPrompts` 均来自 LLM、`result.promptId === "blueprint.prompt-package.v1"`、`result.structuredPayloadDigest` / `responseDigest` / `promptFingerprint` 均匹配 `/^sha256:[a-f0-9]{64}$/`、`result.error` 为 undefined；断言 `renderedContent` 字符串以 `"# ${renderedTitle}"` 开头且含 `"## Reusable Prompts"` 与各 prompt id
  - [ ] 14.2 **Malformed JSON（R9.2 malformed）**：fake `callJson: async () => undefined` → 断言 `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/non-json response/`、`result.renderedTitle` / `renderedSummary` / `renderedContent` / `renderedSections` / `renderedPrompts` 均为 undefined；再覆盖 `async () => "garbage string"` 与 `async () => 42` 两个子场景
  - [ ] 14.3 **Schema fails（R9.2 schema-fail，多子场景）**：分别注入 payload：(a) 缺 `prompts`；(b) `prompts` 为空；(c) `sections` 为空；(d) `prompts.length = 13`；(e) `sections.length = 21`；(f) 重复 `prompts[*].id`；(g) 同 prompt 内重复 `variables[*].name`；(h) `variables[*].required: "true"` 字符串；(i) `variables[*].required: 1`；(j) `systemPrompt` 超过 4000；(k) `userPrompt` 超过 4000；(l) `body` 超过 5000；(m) `title` trim 后全空格；(n) `prompts[0].id` trim 后为空；(o) `examples[0]` 为 `{}`；(p) `variables.length = 31`；(q) `examples.length = 11`；(r) 重复 `sections[*].heading`（大小写不敏感） → 每个子场景断言 `result.generationSource === "llm_fallback"`、`result.error` 包含 `"schema validation failed"` 或具体约束描述（`"duplicated prompt id"` / `"duplicated variable name"` / `"duplicated section heading"` / `"must not be empty after trim"` / `"must have at least one non-empty"`）
  - [ ] 14.4 **ApiKey missing（R9.2 apiKey-missing）**：fake `getConfig: () => ({ model: "gpt-4-turbo", apiKey: "" })` + callJson spy → 断言 `result.generationSource === "template"`（design §6.3.4 锁定与档位 1 合流的口径）、`callJson` spy 未被调用、`result.error` / `result.promptId` / `result.model` 均为 undefined、`renderedTitle` / `renderedSummary` / `renderedContent` / `renderedSections` / `renderedPrompts` 均为 undefined
  - [ ] 14.5 **补充：Not enabled**：未设环境变量 `BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED` → `result.generationSource === "template"` + callJson spy 未被调用 + `ctx.logger.debug` 被调用
  - [ ] 14.6 **补充：Timeout**：fake `callJson: async () => { throw new Error("Request aborted due to timeout") }` → `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/llm timeout/`（通过 `/abort|timeout/i` 路径识别）
  - [ ] 14.7 **补充：Redaction E2E**：fake `callJson` 抛错 message 包含 `"sk-ABCDEFGHIJKLMNOP1234567890"` 或 `"ghp_abcdefghijklmnopqrstuvwxyz0123456789"` → 断言 `result.error` 不含这些原文子串（已脱敏）
  - [ ] 14.8 **补充：Per-package isolation**：两次独立 service 调用（同一 job、不同 `targetPlatform`，例如 `codex` 与 `claude`），第一次 fake `callJson` 返回合法 payload、第二次 fake `callJson` 抛错 → 两次 result 的 `generationSource` / `error` / `promptId` / `model` 彼此独立，第一次仍为 `"llm"` 不被污染
  - [ ] 14.9 **补充：Examples optional**：LLM 返回 prompt 不含 `examples` 字段 → real path 的 `result.renderedPrompts![0].examples` 被 normalize 补齐为 `[]`（而非 undefined）
  - [ ] 14.10 **补充：Logger meta contains targetPlatform**：fallback 场景下（档位 3 / 4 / 6）断言 `ctx.logger.warn` 被调用且 meta 至少包含 `{ targetPlatform, promptId }` 字段；debug 场景下（档位 1 / 2）断言 meta 至少含 `{ targetPlatform }`
  - _Requirements: 5.3, 9.2_

- [ ] 15. **Checkpoint B 验证** — 运行完整子域测试
  - [ ] 15.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 15.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/prompt-package/` → ~56 条新增 co-located 单测全绿（policy ~6 + schema ~18 + prompt ~10 + normalize ~7 + render ~5 + service ~10）
  - [ ] 15.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 15.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（B 阶段 service 已装配但未接入 `buildImplementationPromptPackage`，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 C：外层 hook 接线 + contract 扩展 + fallback E2E guard（依赖 B）

- [ ] 16. 改造 `server/routes/blueprint.ts` 的 `buildImplementationPromptPackage()` + `generateImplementationPromptPackages()` + 新增 `mergeLlmSectionsWithScaffolds()` 纯函数
  - [ ] 16.1 把 `buildImplementationPromptPackage` 签名从 sync 改为 `async (ctx: BlueprintServiceContext, input: { job, specTree, targetPlatform, nodes, documents, previews, includeDrafts, includePreviewDrafts, createdAt, clarificationSession?, domainContext?, primaryRoute?, capabilityInvocations?, capabilityEvidence? }): Promise<BlueprintImplementationPromptPackage>`
  - [ ] 16.2 **保留** `buildImplementationPromptSections()` / `renderImplementationPromptContent()` / `buildImplementationPromptTarget()` / `resolvePromptDocumentSourceStatus()` / `resolvePromptPreviewSourceStatus()` 五个模板 helper 一行不改；fallback / template 路径下复用它们产出的 `title` / `summary` / `sections` / `content` 字节级等价今天（design §D3 + §8.3）
  - [ ] 16.3 在 `buildImplementationPromptPackage` 内部先计算 scaffold：`nodeIds = uniqueStrings(input.nodes.map(n => n.id))` / `sourceDocumentIds = input.documents.map(d => d.id)` / `sourcePreviewIds = input.previews.map(p => p.id)` / `target = buildImplementationPromptTarget(input.targetPlatform)` / `templatedTitle` / `templatedSummary` / `templatedSections = buildImplementationPromptSections({ ..., target, nodeIds, sourceDocumentIds, sourcePreviewIds })`
  - [ ] 16.4 调用 `await ctx.promptPackageLlmService?.({ jobId: input.job.id, job, specTree, targetPlatform, nodes, sourceDocuments: documents, sourcePreviews: previews, primaryRoute, clarificationSession, domainContext, capabilityInvocations, capabilityEvidence, includeDrafts, includePreviewDrafts, createdAt })`
  - [ ] 16.5 `llmOutput?.generationSource === "llm"` 分支：`title = llmOutput.renderedTitle!`、`summary = llmOutput.renderedSummary!`、`content = llmOutput.renderedContent!`、`sections = mergeLlmSectionsWithScaffolds({ renderedSections: llmOutput.renderedSections!, renderedPrompts: llmOutput.renderedPrompts ?? [], scaffoldSections: templatedSections })`；`provenanceExtras = { generationSource: "llm", promptId, model, responseDigest, structuredPayloadDigest, promptFingerprint }`
  - [ ] 16.6 否则（template / llm_fallback）分支：`title = templatedTitle`、`summary = templatedSummary`、`sections = templatedSections`、`content = renderImplementationPromptContent({ title, target, sections, sourceDocumentIds, sourcePreviewIds })`；`provenanceExtras = { generationSource: llmOutput?.generationSource ?? "template", promptId: llmOutput?.promptId, model: llmOutput?.model, promptFingerprint: llmOutput?.promptFingerprint, error: llmOutput?.error }`（全部可选展开）
  - [ ] 16.7 新增纯函数 `mergeLlmSectionsWithScaffolds({ renderedSections, renderedPrompts, scaffoldSections })`：(1) 优先用 `renderedSections[i].heading` / `body` 覆盖 `scaffoldSections[i].title` / `content`（数量按较小者对齐）；(2) 若 `renderedSections.length > scaffoldSections.length` → 为多余部分创建新 section scaffold，`kind = "implementation"`、`id = createId("blueprint-prompt-section")`、`items` / `nodeIds` / `sourceDocumentIds` / `sourcePreviewIds` 为空数组；(3) 若 `scaffoldSections.length > renderedSections.length` → 保留多余的 scaffold（不删除模板 `constraints` / `verification` / `handoff` 等 kind section），其 `title` / `content` 保持 fallback 模板值；(4) 若 `renderedPrompts` 非空 → 额外追加一个 `implementation` kind 的 "Reusable Prompts" section，`title = "Reusable Prompts"`、`content = ` prompts 的 Markdown 总览表（复用 render 规则的简化版）、`items` 逐项映射为 `BlueprintImplementationPromptItem[]`（`kind = "instruction"`、`title = prompts[i].title`、`content = ${systemPrompt}\n\n${userPrompt}`）
  - [ ] 16.8 合并 provenance：保留所有既有字段不变（`jobId` / `projectId` / `sourceId` / `targetText` / `githubUrls` / `treeVersion` / `nodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `targetPlatform` / `sourceDocumentStatus` / `sourcePreviewStatus` / `includeDrafts` / `includePreviewDrafts` / `sourceDocumentStatuses` / `sourcePreviewStatuses`），以 `...provenanceExtras` 对象 spread 方式追加 7 个新字段（全部可选，undefined 不落库）
  - [ ] 16.9 把 `generateImplementationPromptPackages()` 改为 `async(ctx, job, specTree, request, options)`；保持既有外层编排（`targetNodeIds` 过滤、`includeDrafts` / `includePreviewDrafts` 语义、`sourceDocuments` / `sourcePreviews` 过滤、409 早退 `"Blueprint SPEC documents not ready."` / `"Blueprint effect previews not ready."`、`generatedKeys` 计算、`packageArtifacts` 拼装、`preservedArtifacts` 合并、`options.store.save(updatedJob)`、响应体装配）一行不改
  - [ ] 16.10 把内部的 `targetPlatforms.map(targetPlatform => buildImplementationPromptPackage({...}))` 改为 `await Promise.all(targetPlatforms.map(async (targetPlatform) => buildImplementationPromptPackage(ctx, {...})))`；`Promise.all` 保留索引顺序，响应体 `promptPackages[*]` 数组顺序与今天完全一致（design §D3 + §5.6）
  - [ ] 16.11 透传 `clarificationSession` / `domainContext` / `primaryRoute` / `capabilityInvocations` / `capabilityEvidence`：从 `job.clarificationSession` / `job.projectContext` / `specTree.selectedRouteId → job.routeSet` 派生 `primaryRoute` / 可选 `job.capabilityInvocations` / `job.capabilityEvidence` 读取；若上述字段在当前 job 对象上不可读取，使用 undefined 而不抛错（不依赖新字段）
  - [ ] 16.12 修改 `BlueprintEventName.PromptPackaged` 事件 payload（~第 8989 行）：在既有 `{ specTreeId, nodeIds, promptPackageIds, sourceDocumentIds, sourcePreviewIds, targetPlatforms, includeDrafts, includePreviewDrafts, sourceIds }` 上**追加可选字段** `promptPackageGenerationSources: Array<{ promptPackageId, targetPlatform, generationSource }>`（从 `promptPackages` 聚合；每份 Package 独立携带）、`promptId?: string`（当任一 Package 走过 LLM 时填充 `"blueprint.prompt-package.v1"`）、`model?: string`（当任一 Package 走过 LLM 时填充）；**不新增事件名**（需求 6.2）；所有事件 `type` 仍走 `BlueprintEventName` 常量，不得出现裸字符串 `"prompt.packaged"`（需求 6.4）
  - [ ] 16.13 HTTP handler 调用点追加 `await`：`/api/blueprint/jobs/:jobId/prompt-packages` POST handler 需把 `generateImplementationPromptPackages(...)` 改为 `await generateImplementationPromptPackages(ctx, ...)` 并在调用前拿到 `ctx`（从 `deps` 或外部装配）；handler 本身不需要改 `try/catch` 结构（service 已吞下 LLM 层错误）；`Promise.all(...)` 在本 spec 实现中**不会 reject**，因为每个 `buildImplementationPromptPackage()` 都保证返回合法的 `BlueprintImplementationPromptPackage`
  - [ ] 16.14 用 grep 核对调用点：`grep -nE "buildImplementationPromptPackage\\(|generateImplementationPromptPackages\\(" server/ shared/ --include="*.ts"` → 所有调用方改为 `async` 并追加 `await` 与 `ctx` 透传；既有 409 早退分支保持不变
  - _Requirements: 2.5, 2.6, 2.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.2_

- [ ] 17. 扩展 `shared/blueprint/contracts.ts`：`BlueprintImplementationPromptPackage.provenance` 追加 7 个可选字段
  - [ ] 17.1 在 `BlueprintImplementationPromptPackage.provenance` 类型中追加 7 个可选字段：`generationSource?: "llm" | "llm_fallback" | "template"`、`promptId?: string`、`model?: string`、`responseDigest?: string`、`structuredPayloadDigest?: string`、`promptFingerprint?: string`、`error?: string`；全部可选（design §D6 + §4.1）；不删除、不重命名、不修改任何既有 provenance 字段（`jobId` / `projectId` / `sourceId` / `targetText` / `githubUrls` / `treeVersion` / `nodeIds` / `sourceDocumentIds` / `sourcePreviewIds` / `targetPlatform` / `sourceDocumentStatus` / `sourcePreviewStatus` / `includeDrafts` / `includePreviewDrafts` / `sourceDocumentStatuses` / `sourcePreviewStatuses`）
  - [ ] 17.2 **不得修改** `BlueprintImplementationPromptPackage` / `BlueprintImplementationPromptSection` / `BlueprintImplementationPromptItem` / `BlueprintImplementationPromptTarget` / `BlueprintImplementationPromptTargetPlatform` / `BlueprintImplementationPromptSectionKind` / `BlueprintImplementationPromptItemKind` / `BlueprintImplementationPromptSourceStatus` 任一既有类型定义（需求 8.2 + design §9.1）
  - [ ] 17.3 在仓库根运行 `node --run check`，确认新增字段不引入新增 TS 错误；grep 既有 `BlueprintImplementationPromptPackage.provenance` / `promptPackage.provenance` 消费点确认没有因字段追加而断言失败
  - [ ] 17.4 同步确认 `client/src/lib/blueprint-api/` 下 SDK normalizer：若使用 object spread 或透明透传，不需改动；若使用显式字段映射，追加 ~7 行可选字段透传（不修改任一既有字段映射行为；需求 8.4）
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.2, 8.4_

- [ ] 18. **Checkpoint C 验证** — 运行既有 47 E2E + 48 子域 + 9 SDK smoke 确认零回归
  - [ ] 18.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 18.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（未设 `BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED` → 档位 1 早退 → template 路径 → 字节级等价今天）
  - [ ] 18.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测 + ~56 条新增 co-located 单测全部通过
  - [ ] 18.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [ ] 18.5 本阶段断言点：`promptPackage.provenance.generationSource === "template"` 在默认装配下可断言；fallback 路径下 `BlueprintImplementationPromptPackage.title` 起始 `"Implementation prompt package:"`、`summary` 命中两种固定句式之一（`"Implementation prompt package for ${label} using SPEC documents and effect previews."` 或 `"Document-only implementation prompt package for ${label}."`）、`content` 起始 `# Implementation prompt package:`、`sections[*].kind ∈ {"context","implementation","constraints","verification","handoff"}` 与今天字节相同；`BlueprintImplementationPromptPackagesResponse.promptPackages[*]` 数组顺序、长度、`targetPlatform` 覆盖集合与今天一致
  - _Requirements: 5.3, 5.4, 5.5, 5.6, 8.1, 8.3, 8.5, 8.6, 9.6_

### 检查点 D：E2E real + fallback + 最终全量回归（依赖 C）

- [ ] 19. 在 `server/tests/blueprint-routes.test.ts` 追加 E2E 用例 1（Real LLM path，需求 9.1a）
  - [ ] 19.1 用例描述：`it("generateImplementationPromptPackages produces LLM-driven content when prompt-package llm is enabled", async () => {...})`
  - [ ] 19.2 测试前置：`mkdtemp` 创建临时 specsRoot 目录；`process.env.BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})` 按 prompt 内容路由到对应家族（RouteSet / SPEC Tree / SPEC Documents / Effect Preview / Prompt Package / role 桥 / aigc-node 桥）；仅当 `/Prompt Package|Prompt Package 生成器/i.test(joined)` 命中时返回 design §6.2.1 给出的合法 Prompt Package payload（`title: "Release Dashboard Implementation Pack (Codex)"` / `summary: "Codex-ready prompt package for shipping the tenant-scoped release dashboard."` / 2 个 prompts `dashboard-root-setup` + `deploy-feed-widget` / 3 个 sections `"Target platform overview"` / `"Source node mapping"` / `"Verification commands"`），其它家族 prompt 返回对应姊妹 spec 的 fixture 或 undefined（fixture 由姊妹 spec 的 E2E mock 继承）
  - [ ] 19.3 执行前先通过 `setupJobWithSpecDocumentsAndEffectPreviews(baseUrl)` 把 job 推进到 SPEC Documents + Effect Preview 完成状态（利用 SPEC Documents / Effect Preview LLM mock 或 fallback 路径；两种均可）；然后 `POST /api/blueprint/jobs/:jobId/prompt-packages` body `{ includeDrafts: true, includePreviewDrafts: true }`；断言 `response.status === 201`、`body.promptPackages.length >= 1`
  - [ ] 19.4 对每份 `pkg` 断言：`pkg.provenance.generationSource === "llm"`、`pkg.provenance.promptId === "blueprint.prompt-package.v1"`、`typeof pkg.provenance.model === "string"`、`pkg.provenance.responseDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`pkg.provenance.structuredPayloadDigest` 匹配同款、`pkg.provenance.promptFingerprint` 匹配同款、`pkg.provenance.error` 为 undefined
  - [ ] 19.5 断言 LLM 内容可见：`pkg.title === "Release Dashboard Implementation Pack (Codex)"`（**不**以 `"Implementation prompt package:"` 开头，明显区别于模板化）；`pkg.summary` 包含 `"Codex-ready prompt package"`（**不**匹配 `/^Implementation prompt package for|^Document-only implementation prompt package/`）；`pkg.content` 包含 `"Reusable Prompts"` 与 `"dashboard-root-setup"` / `"deploy-feed-widget"` 作为 prompt id
  - [ ] 19.6 断言 scaffold 字段保留：`pkg.id` / `pkg.jobId` / `pkg.treeId` / `pkg.nodeIds` / `pkg.sourceDocumentIds` / `pkg.sourcePreviewIds` / `pkg.targetPlatform` / `pkg.target` / `pkg.createdAt` / `pkg.updatedAt` 均存在且符合既有类型；`pkg.sections` 数组长度 ≥ 1，`sections[*].id` / `sections[*].kind` / `sections[*].items` 等结构字段由外层派生保留（可断言至少存在 1 个 `kind === "implementation"` 或新追加的 "Reusable Prompts" section）
  - [ ] 19.7 测试清理：`delete process.env.BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED`；`await rm(specsRoot, { recursive: true, force: true })`；`llmMocks.callLLMJson.mockReset()` 避免影响其它 E2E 用例
  - _Requirements: 9.1_

- [ ] 20. 在 `server/tests/blueprint-routes.test.ts` 追加 E2E 用例 2（Fallback path，需求 9.1b）+ 最终全量回归 + manual verification checklist
  - [ ] 20.1 用例描述：`it("generateImplementationPromptPackages falls back to template when prompt-package llm call throws", async () => {...})`
  - [ ] 20.2 测试前置：`process.env.BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})`；仅当 `/Prompt Package|Prompt Package 生成器/i.test(joined)` 命中时 `return Promise.reject(new Error("upstream 503"))`；其它家族 prompt 返回 undefined（对应姊妹 spec 均 fallback）
  - [ ] 20.3 执行 `setupJobWithSpecDocumentsAndEffectPreviews` 后 `POST /api/blueprint/jobs/:jobId/prompt-packages`；断言 `response.status === 201`、`body.promptPackages.length >= 1`
  - [ ] 20.4 对每份 `pkg` 断言：`pkg.provenance.generationSource === "llm_fallback"`、`pkg.provenance.error` 匹配 `/upstream 503|llm callJson threw/`、`pkg.provenance.promptId === "blueprint.prompt-package.v1"`、`typeof pkg.provenance.model === "string"`
  - [ ] 20.5 断言 nodes 回退到模板化产出：`pkg.title` 匹配 `/^Implementation prompt package: /`；`pkg.summary` 匹配 `/^(Implementation prompt package for|Document-only implementation prompt package)/`；`pkg.content` 起始 `# Implementation prompt package:`；`pkg.sections[*].kind` 均属于 `["context","implementation","constraints","verification","handoff"]`；`pkg.sections` 不含 LLM-only 的 "Reusable Prompts" section（因为 fallback 路径的 `sections` 完全来自 `buildImplementationPromptSections`）
  - [ ] 20.6 最终全量回归：`node --run check` → 0 个新增 TS 错误（若仓库已有历史类型债，不应扩大错误面；design §10.2 最终检查清单的硬约束）
  - [ ] 20.7 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 + 2 = 49 条 E2E 全绿（新增 real + fallback 两条）
  - [ ] 20.8 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/prompt-package/` → ~56 条新增 co-located 单测全绿
  - [ ] 20.9 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 20.10 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [ ] 20.11 `node --run test`（或项目级等价全量 test 命令）→ 所有 suite 绿（基线 + 新增全部通过）
  - [ ] 20.12 **最终验证 checklist — 对齐 design §10.2 manual verification checklist**：
    - 人工核对 `shared/blueprint/contracts.ts` 中 `BlueprintImplementationPromptPackage.provenance` 追加 7 个可选字段（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）；无任何字段被重命名或类型变更
    - 人工核对 `BlueprintImplementationPromptSection` / `BlueprintImplementationPromptItem` / `BlueprintImplementationPromptTarget` / `BlueprintImplementationPromptTargetPlatform` / `BlueprintImplementationPromptSectionKind` / `BlueprintImplementationPromptItemKind` / `BlueprintImplementationPromptSourceStatus` 类型完全未改动
    - 人工核对 `policy.ts` / `schema.ts` / `prompt.ts` / `normalize.ts` / `render.ts` / `service.ts` 六个文件均落地并通过各自 co-located 子域单测
    - 人工核对 `BlueprintServiceContext` 追加 2 个可选字段（`promptPackageLlmPolicy?` / `promptPackageLlmService?`）；`buildBlueprintServiceContext` 默认装配 `createPromptPackageLlmService(ctx)`；未装配时保留向后兼容（template 路径）
    - 人工核对 `buildImplementationPromptPackage()` 改为 `async(ctx, input)`；`generateImplementationPromptPackages()` 改为 `async(ctx, job, specTree, request, options)`；所有调用点已补 `await`；`targetPlatforms.map(...)` 改为 `Promise.all(...)`；响应体 `promptPackages[*]` 数组顺序与今天一致
    - 人工核对 `buildImplementationPromptSections()` / `renderImplementationPromptContent()` / `buildImplementationPromptTarget()` / `resolvePromptDocumentSourceStatus()` / `resolvePromptPreviewSourceStatus()` 五个模板 helper 一行未改；模板化路径字节级等价今天
    - 人工核对 `mergeLlmSectionsWithScaffolds()` 纯函数落地并被 real path 消费；`renderedPrompts` 非空时追加一个 "Reusable Prompts" `implementation` kind section，通过 `items[]` 持久化 prompt 资产清单；**未**对 `BlueprintImplementationPromptPackage` 顶层类型做破坏性扩展
    - 人工核对 `BlueprintEventName.PromptPackaged` event payload 追加可选 `promptPackageGenerationSources` / `promptId` / `model`；既有 payload 字段（`specTreeId` / `nodeIds` / `promptPackageIds` / `sourceDocumentIds` / `sourcePreviewIds` / `targetPlatforms` / `includeDrafts` / `includePreviewDrafts` / `sourceIds`）不变；既有订阅者断言不失效
    - 人工核对禁止清单：`service.ts` 及其它实现文件不出现 `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；不 `import` 模块级 eventBus / jobStore 单例；不出现裸事件字符串 `"prompt.packaged"` 等（所有事件 `type` 走 `BlueprintEventName` 常量）
    - 人工核对 adapter 命名：若在事件 / provenance 中携带 `adapter` 字段，real 路径 adapter 字符串不含 `.simulated` 子串（推荐 `"blueprint.prompt-package.llm"`）；fallback / template 路径保留今天既有命名不变
    - 人工核对 `BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED=true` 作为独立开关；不复用 RouteSet / SPEC Tree / SPEC Documents / Effect Preview / role 桥 / aigc-node 桥的环境变量；`BLUEPRINT_PROMPT_PACKAGE_LLM_TIMEOUT_MS` > 30000 或非法值时回退到 30000
    - 人工核对语义区分：`provenance.promptId === "blueprint.prompt-package.v1"`（meta-prompt 版本标识）与 LLM 产出的 `prompts[*].id`（供下游工程落地使用的资产 id）在实现中未被混用
    - 人工核对 fallback 路径下 `ctx.llm.callJson` 未被调用（档位 1 / 档位 2 场景；可通过 spy 断言）；既有 47 条 E2E + 48 条子域 + 9 SDK smoke 在默认 env 不开的装配下继续通过，未改写任何既有断言
    - Schema 版本锚点确认：`promptId === "blueprint.prompt-package.v1"` 作为 schema 版本锚点；后续任何 schema 变更都需判断是否 bump 到 `v2`（新增可选字段兼容、新增必填字段兼容、删除字段 / 修改类型 / 严格化约束必须 bump）
    - **Requirement 9.3 + design §6.1 lock**：本阶段测试策略为 example-based only；tasks.md 中无任何 PBT 任务
    - 手动场景 1：本地运行 `BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED=true` + 有效 LLM apiKey → 先 `POST /api/blueprint/jobs`（先走 SPEC Tree / SPEC Documents / Effect Preview 的 fallback 或 real 皆可），再 `POST /api/blueprint/jobs/:jobId/prompt-packages` → 响应 `promptPackages[*].provenance.generationSource === "llm"` + `title` 不以 `"Implementation prompt package:"` 开头 + `content` 含 `"Reusable Prompts"` 锚点
    - 手动场景 2：本地运行 `BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED=true` + 无 apiKey → 响应 `promptPackages[*].provenance.generationSource === "template"` + 内容回退到模板化（`title` 以 `"Implementation prompt package:"` 前缀开头、`summary` 命中两种固定句式）
    - 手动场景 3：本地运行 `BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED=true` + mock LLM 为 Prompt Package prompt 抛错 → 响应 `promptPackages[*].provenance.generationSource === "llm_fallback"` + `error` 被填充（已脱敏，不含 API key / GitHub PAT / email 原文）
    - 手动场景 4：本地不设 `BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED` → 响应 `promptPackages[*].provenance.generationSource === "template"` + 与今天字节相同（fallback E2E guard 已在 task 18 自动化覆盖，此步骤为手动复核）
    - 手动场景 5：一次请求中同时请求 M 个 targetPlatforms 的 Package（`includeDrafts: true` / `includePreviewDrafts: true`），mock 让其中 1 份 LLM 返回有效 payload、1 份 LLM 抛错、1 份 LLM 返回非 JSON → 响应 `promptPackages.length === M`，顺序与 `targetPlatforms` 一致，各自 `provenance.generationSource` 独立正确（分别为 `"llm"` / `"llm_fallback"` / `"llm_fallback"`），`prompt.packaged` event payload 的 `promptPackageGenerationSources` 摘要与响应体一致
    - 手动场景 6：本地运行 `BLUEPRINT_PROMPT_PACKAGE_LLM_TIMEOUT_MS=500` + mock LLM 故意延迟超过 500ms → 响应 `provenance.generationSource === "llm_fallback"` + `error === "llm timeout"`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2, 9.6_

## 说明

- 本任务清单所有任务均为必做项，不含 `*` 可选标记（spec 范围聚焦、体量可控，与 routeset / spec-tree / spec-documents / effect-preview / 四条桥 spec 风格一致）。
- 每个任务都在 footer 中引用至少 1 个 EARS requirement id，便于追溯。
- 任务 2 / 4 / 6 / 8 / 10 / 14 均为 example-based 单测（共 ~56 条 co-located），**不**包含 PBT（符合 Requirement 9.3 + design §6.1 lock）；若后续 tasks 阶段发现需要 PBT 覆盖，必须显式写出要验证的不变量，否则应改为 example-based。
- 任务 19 / 20 只向 `server/tests/blueprint-routes.test.ts` **追加** 2 条新用例，不修改原有 47 条（符合 Requirement 9.6）。
- 本 spec 未调用 `prework` 工具（与 routeset / spec-tree / spec-documents / effect-preview / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径；design §6.1 明确锁定 example-based only）。
- **D5（Meta Prompt ID 锁定 `blueprint.prompt-package.v1`）** 在任务 5.1 / 6.7 / 12.1 落地；与 LLM 产出的 `prompts[*].id`（资产层 id）语义区分清晰。
- **D6（Provenance 扩展策略，7 个可选字段）** 在任务 16.8 / 17.1 落地。
- **D7（事件复用既有 `BlueprintEventName.PromptPackaged`，不新增事件名；在 payload 上追加可选 `promptPackageGenerationSources` / `promptId` / `model`）** 在任务 16.12 落地；payload 追加字段全部可选，既有订阅者（含 `blueprint-routes.test.ts` 断言 `prompt.packaged` 的用例）不感知。
- **D8（Strict zod schema + `.superRefine()` 六条 Package 级不变量）** 在任务 3.2 / 4 落地：trim 非空 / prompt id 唯一 / variable name 单 prompt 内唯一 / section heading 唯一 / examples 至少 1 字段非空 / required 严格 boolean。
- **D10（测试默认装配 ≡ 生产行为）** 在任务 15 / 18 落地：既有 47 E2E + 48 子域单测 + 9 SDK smoke 在默认未设 `BLUEPRINT_PROMPT_PACKAGE_LLM_ENABLED` 的装配下继续通过，字节级等价今天。
- 任务 11 / 15 / 18 / 20 是强制的验证门禁，必须在所有对应实现任务完成后执行；任何一步失败都必须回到对应实现任务修复后再跑整套回归。
- 本 spec 完成后，工作流结束 — 不在此 spec 内覆盖 Engineering Handoff 的 LLM 驱动（独立 spec 推进）；不修改 `docker-analysis-sandbox` / `mcp-github-source` / `aigc-spec-node` / `role-system-architecture` 任一 capability adapter 的实际行为（独立 capability-bridge feature 推进）。用户可通过 `tasks.md` 中的 "Start task" 入口逐项执行。
