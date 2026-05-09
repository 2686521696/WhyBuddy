# 实施任务：Autopilot SPEC Tree LLM 驱动生成

## 概述

本任务清单把 design 文档 §10.1 的 4 个检查点（A 纯函数 helpers + schema + prompt + co-located 单测 → B service 工厂 + context 扩展 + service 单测 → C 外层 hook 接线 + contract 扩展 + fallback E2E guard → D E2E real + fallback + 最终全量回归）收敛为 20 个可验证的代码任务，覆盖：

- `server/routes/blueprint/spec-tree/` 目录下 5 个新模块（`policy` / `schema` / `prompt` / `flatten-and-remap` / `service`）及其 co-located 单测
- `server/routes/blueprint/context.ts` 的 2 个可选依赖字段扩展（`specTreeLlmPolicy?` + `specTreeLlmService?`；**不改 `ctx.llm` 字段** — LLM 能力已在 wt1 默认装配）及默认装配
- `server/routes/blueprint.ts` 中 `buildSpecTreeFromRouteSet()` 的 async 改造 + `buildTemplateSpecTreeNodes()` 纯 extract + 所有调用点追加 `await` + ctx / `clarificationSession` / `domainContext` 透传
- `shared/blueprint/contracts.ts` 的 `BlueprintSpecTree.provenance` 7 个可选字段扩展（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）
- `server/tests/blueprint-routes.test.ts` 追加 2 条 E2E（Real LLM path / Fallback path）
- 最终全量回归（既有 47 E2E + 48 子域单测 + 9 SDK smoke 零回归）

每个任务都对应明确的落点文件、函数与验收标准；所有任务均为本 spec 的必做项，不引入 `*` 可选标记。

依赖顺序：**检查点 A**（tasks 1-9）→ **检查点 B**（tasks 10-13）→ **检查点 C**（tasks 14-16）→ **检查点 D**（tasks 17-20）。每个检查点结束都有一条显式"验证"任务作为质量门禁；任何一条验证失败都必须回到对应实现任务修复后再跑整套回归。

**Requirement 9.3 + design §6.1 lock**：本阶段测试策略为 **example-based only**，**禁止引入 PBT**；若后续 tasks 阶段出现任何被标注为 PBT 的任务，必须显式写出要验证的不变量，否则应改为 example-based。本 spec 未调用 `prework` 工具（与 routeset / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径）。

## 任务列表

### 检查点 A：纯函数 helpers + schema + prompt + co-located 单测（低风险，先做）

- [ ] 1. 新建 `server/routes/blueprint/spec-tree/policy.ts`
  - [ ] 1.1 定义并导出 `SpecTreeLlmPolicy` 接口（字段按 design §4.3：`maxInvocationTimeoutMs`、`temperature`、`callJsonRetryAttempts`、`maxNodeCount`、`minNodeCount`、`maxDepth`、`maxTitleLength`、`maxSummaryLength`、`redactionKeywords`、`redactedEmailPattern`、`redactedApiKeyPattern`、`redactedGithubPatPattern`、`maxErrorLength`）
  - [ ] 1.2 实现并导出 `createDefaultSpecTreeLlmPolicy()`：默认 `maxInvocationTimeoutMs = 30_000`；从 `process.env.BLUEPRINT_SPEC_TREE_LLM_TIMEOUT_MS` 读取覆盖值，仅当解析为正整数且 `<= 30_000` 时采用，否则回退到 30_000（design §4.3 + §2.D4）
  - [ ] 1.3 实现并导出纯函数 `applySpecTreeRedaction(value: string, policy: SpecTreeLlmPolicy): string`，覆盖 API key（`sk-...` / `clp_...`）、GitHub PAT（`gh[pousr]_...` / `github_pat_...`）、email、Authorization / Bearer / `token=` / `api_key=` / `x-github-token` / `openai-api-key` 等 key-value 对的脱敏
  - [ ] 1.4 **禁止** 在本文件 `import` 任何运行时 / 业务模块（保持纯函数）；仅 `import` TS 内置类型
  - _Requirements: 2.7, 4.5, 5.1_

- [ ] 2. 新建 `server/routes/blueprint/spec-tree/policy.test.ts`（~6 条 example-based 单测）
  - [ ] 2.1 断言 `createDefaultSpecTreeLlmPolicy().maxInvocationTimeoutMs === 30_000`（默认值）
  - [ ] 2.2 断言环境变量 `BLUEPRINT_SPEC_TREE_LLM_TIMEOUT_MS="5000"` 被读取后 `maxInvocationTimeoutMs === 5_000`；测试后清理 `process.env`
  - [ ] 2.3 断言非法环境变量值（`"abc"` / `"-1"` / `"99999"` / `"0"`）均回退到 `30_000`
  - [ ] 2.4 断言 `applySpecTreeRedaction("sk-ABCDEFGHIJKLMNOP1234567890", policy)` 不含原 API key 子串
  - [ ] 2.5 断言 `applySpecTreeRedaction("contact alice@example.com", policy)` 不含原邮箱子串
  - [ ] 2.6 ReDoS 哨兵：构造 5MB 字符串（`"a".repeat(5_000_000)`）调用 `applySpecTreeRedaction` 耗时 `< 200ms`（`performance.now()` 对比）
  - _Requirements: 5.1, 9.8_

- [ ] 3. 新建 `server/routes/blueprint/spec-tree/schema.ts`
  - [ ] 3.1 按 design §4.4 定义 `NODE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/` 与 `SpecTreeLlmNodeSchema`：`id`（1..64 字符 + NODE_ID_PATTERN）、`parentId`（可选，同格式约束）、`title`（1..120 字符）、`summary`（1..400 字符）、`type` 枚举（`root` / `route_step` / `alternative_route` / `spec_document` / `effect_preview` / `prompt_package` / `engineering_plan`）、`status` 枚举（`seed` / `draft` / `ready` / `accepted`）、`priority`（int 0..999）、`routeId`（≤128 可选）、`routeStepId`（≤128 可选）、`dependencies`（数组，每项 ≤64，`.max(10).default([])`）、`outputs`（数组，每项 1..200，`.max(10).default([])`）、`children`（数组，每项 ≤64，`.max(50).default([])`）、`metadata`（`z.record(z.string(), z.unknown()).optional()`）
  - [ ] 3.2 定义并导出 `SpecTreeLlmResponseSchema`：`z.object({ nodes: z.array(SpecTreeLlmNodeSchema).min(3).max(50) }).superRefine((data, ctx) => { ... })`；`.superRefine` 按 design §4.4 实现 6 条不变量：unique id / exactly 1 root / 非 root 必须有 parentId 且 `nodeMap.has(parentId)` / 无自环 / BFS 深度 ≤ 4 / 所有节点从 root 可达（无断开子树）；每条不变量违反时 `ctx.addIssue` 后 `return` 避免级联
  - [ ] 3.3 **不使用 `.strict()`**（zod 默认 strip 行为静默丢弃未知字段，design §2.D8）；**禁止** 任何 `.transform(...)` / `z.coerce.*` / `z.preprocess(...)` coerce 链（需求 3.2）
  - [ ] 3.4 导出类型别名 `export type SpecTreeLlmResponse = z.infer<typeof SpecTreeLlmResponseSchema>` 与 `export type SpecTreeLlmNode = z.infer<typeof SpecTreeLlmNodeSchema>`
  - [ ] 3.5 **禁止** 在本文件 `import` 任何运行时 / 业务模块；仅 `import { z } from "zod"`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. 新建 `server/routes/blueprint/spec-tree/schema.test.ts`（~12 条 example-based 单测）
  - [ ] 4.1 合法 minimal payload（3 节点：root + 1 route_step + 1 spec_document）→ `safeParse({ success: true })`
  - [ ] 4.2 合法 full payload（25 节点，深度 3，涵盖所有 7 种 `type` 枚举值）→ 通过
  - [ ] 4.3 `nodes` 缺失或非数组 → 失败
  - [ ] 4.4 `nodes.length < 3`（2 节点）→ 失败；`nodes.length > 50`（51 节点）→ 失败
  - [ ] 4.5 `id` 非 kebab-case（`"ROOT"` / `"root_1"` / `"1root"` / `""` / 65 字符）→ 失败
  - [ ] 4.6 `id` 在数组内重复（两个 `id: "step-1"`）→ `.superRefine` 触发失败，错误消息包含 `"duplicated"`
  - [ ] 4.7 0 个 root（全是 `type: "route_step"`）→ 失败，错误消息包含 `"must have exactly 1 root"`；2 个 root → 同款失败
  - [ ] 4.8 非 root 节点缺 `parentId` → 失败，错误消息包含 `"non-root node must have parentId"`
  - [ ] 4.9 `parentId` 不可解析（指向不存在的 id）→ 失败，错误消息包含 `"does not resolve"`
  - [ ] 4.10 父子循环（`{id: "a", parentId: "b"}, {id: "b", parentId: "a"}`，无 root）或树内循环（`a -> b -> a`）→ 失败
  - [ ] 4.11 树深度 = 5（root → l1 → l2 → l3 → l4）→ 失败，错误消息包含 `"depth exceeds 4"`
  - [ ] 4.12 节点不连通于 root（孤立子树）→ 失败；未知顶层字段（`author: "alice"`）→ zod strip 静默丢弃，不影响 `safeParse.success`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.2_

- [ ] 5. 新建 `server/routes/blueprint/spec-tree/prompt.ts`
  - [ ] 5.1 导出常量 `SPEC_TREE_PROMPT_ID = "blueprint.spec-tree.v1"` 与类型 `SpecTreePromptPayload`（字段：`promptId` / `systemMessage` / `userMessage` / `userPayload` / `promptFingerprint`）
  - [ ] 5.2 定义并导出 `BuildSpecTreePromptInput` 类型（按 design §4.5：`request` / `routeSet` / `primaryRoute` / `alternativeRoutes` / `clarificationSession?` / `domainContext?` / `aigcSpecNodeEvidence?` / `locale`）
  - [ ] 5.3 实现 `buildSpecTreePrompt(input)`：按 design §4.5 构造 `userPayload`，字段顺序固定为 `{ promptId, primaryRoute, alternativeRoutes, intake, clarification, projectContext, aigcSpecNodeEvidence, outputSchema }`；`clarification.answers` 按 `questionId` 字典序排序；`primaryRoute.steps` 保留原始顺序；`alternativeRoutes` 按 routeSet 顺序；`githubUrls` 保留输入顺序
  - [ ] 5.4 实现 locale-aware `systemMessage`：`locale === "zh-CN"` 时使用中文 SPEC Tree 推理器文案（含 CJK），否则英文文案（以 `"You are the /autopilot SPEC Tree"` 之类开头）；两个版本都覆盖 design §4.5 列出的 9 条约束
  - [ ] 5.5 `userMessage = JSON.stringify(userPayload, null, 2)`；`promptFingerprint = "sha256:" + sha256Hex(systemMessage + "\n\n" + userMessage)`（复用 `server/core/ids.ts` 或等价 hash helper）
  - [ ] 5.6 **禁止** 在本文件 `import` `callLLMJson` / `getAIConfig` / `fetch`；仅允许 `import type` shared blueprint 类型 + 一个 sha256 纯 helper
  - _Requirements: 2.2, 2.4, 3.1, 3.2_

- [ ] 6. 新建 `server/routes/blueprint/spec-tree/prompt.test.ts`（~8 条 example-based 单测）
  - [ ] 6.1 断言确定性：同一组 `(request, routeSet, primaryRoute, clarificationSession, domainContext, locale)` 两次调用 `buildSpecTreePrompt` 产出**字节相同** `userMessage`
  - [ ] 6.2 断言输入变化敏感：追加一条新的 clarification answer 后 `userMessage` 发生变化（且 `promptFingerprint` 也变化）
  - [ ] 6.3 断言 `answers` 按 `questionId` 字典序排序（输入 `["q-c", "q-a", "q-b"]` → 输出顺序 `["q-a", "q-b", "q-c"]`）
  - [ ] 6.4 断言 `locale === "zh-CN"` 时 `systemMessage` 包含 CJK 字符（正则 `/[\u4e00-\u9fff]/`）
  - [ ] 6.5 断言 `locale === "en-US"` 时 `systemMessage` 不含 CJK 且以英文开头（例如 `/^You are the \/autopilot SPEC Tree/`）
  - [ ] 6.6 断言 `SPEC_TREE_PROMPT_ID === "blueprint.spec-tree.v1"` 与 prompt 输出的 `promptId` 一致
  - [ ] 6.7 断言 `primaryRoute.steps` 在 `userPayload` 中保留原始顺序（不被字典序排序）
  - [ ] 6.8 断言 `userPayload.outputSchema` 包含节点 `type` 枚举的 7 个值的文案提示
  - _Requirements: 2.2, 3.1, 3.2, 9.2_

- [ ] 7. 新建 `server/routes/blueprint/spec-tree/flatten-and-remap.ts`
  - [ ] 7.1 导出类型 `FlattenAndRemapInput`（字段：`rootNodeId: string`、`primaryRouteId: string`）与 `FlattenAndRemapOutput`（字段：`nodes: BlueprintSpecTreeNode[]`、`rootNodeId: string`）
  - [ ] 7.2 实现纯函数 `flattenAndRemapIds(response, input)`：第 1 步建立 `idMap: Map<llmId, stableId>`，`root` 节点映射到 `input.rootNodeId`，其它节点映射到 `createId("blueprint-spec-node")`；第 2 步按原数组顺序产出 `BlueprintSpecTreeNode[]`，`parentId` / `children` 通过 `idMap` 查表重映射；`children` 中找不到对应 id 的条目静默过滤（LLM 可能返回 children 与 parentId 不一致，schema 未强约束 children 数组，flatten 时以 parentId 为主）
  - [ ] 7.3 补齐 `dependencies` / `outputs` / `children` 为空数组（若 schema `.default([])` 已兜底，此步骤是防御性再确认）；`metadata` 原样透传
  - [ ] 7.4 仅 `import { createId } from "../../../core/ids.js"` 与 `import type { BlueprintSpecTreeNode }` + `import type { SpecTreeLlmResponse }`
  - _Requirements: 2.6, 3.6_

- [ ] 8. 新建 `server/routes/blueprint/spec-tree/flatten-and-remap.test.ts`（~5 条 example-based 单测）
  - [ ] 8.1 4 节点完整 payload（root + 2 route_step + 1 spec_document）→ flatten 后 `output.rootNodeId === input.rootNodeId`，且 `nodes[0].id === input.rootNodeId`
  - [ ] 8.2 非 root `id` 被重映射为 `createId("blueprint-spec-node")` 前缀（断言 `nodes[i].id.startsWith("blueprint-spec-node")`）
  - [ ] 8.3 `parentId` 链被正确重映射（断言子节点 `parentId === output.nodes[0].id`，即重映射后的 rootNodeId）
  - [ ] 8.4 `children` 数组被正确重映射为稳定 id（断言 `output.nodes[0].children` 中每一项都出现在 `output.nodes[i].id` 中）
  - [ ] 8.5 LLM 返回 `children: ["missing-id"]`（在 nodes 中不存在）→ flatten 时过滤掉，不崩溃，不进入 `output.nodes[*].children`
  - _Requirements: 2.6, 3.6_

- [ ] 9. **Checkpoint A 验证** — 运行纯函数子域单测
  - [ ] 9.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 9.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/spec-tree/policy.test.ts server/routes/blueprint/spec-tree/schema.test.ts server/routes/blueprint/spec-tree/prompt.test.ts server/routes/blueprint/spec-tree/flatten-and-remap.test.ts` → ~31 条新增单测全绿（policy ~6 + schema ~12 + prompt ~8 + flatten ~5）
  - [ ] 9.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 9.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（A 阶段尚未接线，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 B：Service 工厂 + Context 扩展 + 单测（依赖 A）

- [ ] 10. 新建 `server/routes/blueprint/spec-tree/service.ts`：`createSpecTreeLlmService(ctx)` 工厂 + 主算法
  - [ ] 10.1 按 design §4.2 定义并导出接口 `SpecTreeLlmServiceInput`（字段：`jobId` / `job` / `request` / `routeSet` / `primaryRoute` / `alternativeRoutes` / `clarificationSession?` / `domainContext?` / `aigcSpecNodeEvidence?` / `createdAt` / `rootNodeId`）与 `SpecTreeLlmServiceOutput`（字段：`generationSource` / `nodes?` / `rootNodeId?` / `promptId?` / `model?` / `promptFingerprint?` / `responseDigest?` / `structuredPayloadDigest?` / `error?`）；导出类型别名 `SpecTreeLlmService = (input) => Promise<SpecTreeLlmServiceOutput>`
  - [ ] 10.2 导出工厂 `createSpecTreeLlmService(ctx: BlueprintServiceContext): SpecTreeLlmService`，工厂在闭包内解析 `policy = ctx.specTreeLlmPolicy ?? createDefaultSpecTreeLlmPolicy()`
  - [ ] 10.3 按 design §4.6 伪代码实现 service 主算法的六档 fallback：
    - 档位 1（未启用）：`process.env.BLUEPRINT_SPEC_TREE_LLM_ENABLED !== "true"` → 早退 `{ generationSource: "template" }`，`ctx.logger.debug` 记录"not enabled, using template"
    - 档位 2（apiKey 缺失）：`ctx.llm.getConfig().apiKey` 为空 → 早退 `{ generationSource: "template" }`（design §4.6 + §5.1 锁定此口径与档位 1 合流），不填 `error` / `promptId` / `model`
    - 档位 3（callJson 抛错 / 非 JSON）：try/catch `ctx.llm.callJson`；若抛错或返回 undefined / null / non-object → `{ generationSource: "llm_fallback", promptId, model, promptFingerprint, error: "llm callJson threw: ..." 或 "non-json response"`（≤ `policy.maxErrorLength` 字符，经 `applySpecTreeRedaction` 脱敏）
    - 档位 4 / 5（schema + `.superRefine` 不变量失败）：`SpecTreeLlmResponseSchema.safeParse(rawPayload)` 返回 `success: false` → `{ generationSource: "llm_fallback", error: "schema validation failed: ..." }`
    - 档位 6（超时）：callJson 因 `timeoutMs: policy.maxInvocationTimeoutMs` 触发 AbortError → fallback，`error: "llm timeout"`（通过正则 `/abort|timeout/i` 识别错误文本）
  - [ ] 10.4 Happy path：`parsed.success === true` → 调用 `flattenAndRemapIds(parsed.data, { rootNodeId: input.rootNodeId, primaryRouteId: input.primaryRoute.id })`；计算 `responseDigest = "sha256:" + sha256Hex(JSON.stringify(rawPayload))`、`structuredPayloadDigest = "sha256:" + sha256Hex(JSON.stringify(parsed.data))`；返回 `{ generationSource: "llm", nodes: remapped.nodes, rootNodeId: remapped.rootNodeId, promptId, model, promptFingerprint, responseDigest, structuredPayloadDigest }`
  - [ ] 10.5 LLM 调用参数固定为 `{ model: aiConfig.model, temperature: policy.temperature, timeoutMs: policy.maxInvocationTimeoutMs, retryAttempts: policy.callJsonRetryAttempts, sessionId: input.clarificationSession?.id ?? input.request.clarificationSessionId }`
  - [ ] 10.6 **硬约束**（design §2.D1）：本文件 SHALL NOT `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；所有 LLM 能力来自 `ctx.llm.callJson` + `ctx.llm.getConfig`；不得 import 模块级 eventBus / jobStore 单例
  - _Requirements: 2.1, 2.5, 2.6, 2.7, 3.5, 3.6, 4.1, 4.5, 5.1, 7.1, 7.2, 7.4, 7.5_

- [ ] 11. 扩展 `server/routes/blueprint/context.ts`：追加 2 个可选依赖字段 + 默认装配
  - [ ] 11.1 在 `BlueprintServiceContext` 与 `BlueprintServiceContextDeps` 上追加 2 个可选字段：`specTreeLlmPolicy?: SpecTreeLlmPolicy`、`specTreeLlmService?: SpecTreeLlmService`；类型仅 `import type`，不 import 工厂实现避免循环依赖
  - [ ] 11.2 **不改 `ctx.llm` 字段**：`ctx.llm.callJson` / `ctx.llm.getConfig` 已在 wt1 默认装配，本 spec 只消费不扩展（需求 7.5 + design §2.D2）
  - [ ] 11.3 在 `buildBlueprintServiceContext(deps)` 中：`deps.specTreeLlmPolicy ?? createDefaultSpecTreeLlmPolicy()`；若 `deps.specTreeLlmService` 未注入，使用 `createSpecTreeLlmService(ctx)` 构造默认实例挂载到 `ctx.specTreeLlmService`
  - [ ] 11.4 保持向后兼容：`deps` 完全不传 policy / service 字段时，既有单测与 E2E 无感知（默认装配后 service 仍因档位 1 早退 → template 路径）
  - [ ] 11.5 `node --run check` 确认类型扩展未引入新 TS 错误
  - _Requirements: 7.1, 7.3, 7.5, 8.2_

- [ ] 12. 新建 `server/routes/blueprint/spec-tree/service.test.ts`：R9.2 四条硬需求 + ~3 条补充
  - [ ] 12.1 **Happy path（R9.2 happy）**：注入 fake `callJson` 返回 4 节点合法 payload（root + 2 route_step + 1 spec_document）→ 断言 `result.generationSource === "llm"`、`result.nodes.length === 4`、`result.rootNodeId === input.rootNodeId`（id 重映射）、`result.promptId === "blueprint.spec-tree.v1"`、`result.structuredPayloadDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`result.error` 为 undefined
  - [ ] 12.2 **Malformed JSON（R9.2 malformed）**：fake `callJson: async () => undefined` → 断言 `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/non-json response/`、`result.nodes` 为 undefined；再覆盖 `async () => "garbage string"` 与 `async () => 42` 两个子场景
  - [ ] 12.3 **Schema fails（R9.2 schema-fail）**：分别注入 payload：(a) 缺 root（全 route_step），(b) 多 root，(c) 重复 id，(d) `parentId` 不可解析，(e) 深度 = 5（5 层链条），(f) 父子循环，(g) 节点数 < 3，(h) 节点数 > 50（51 节点），(i) id 非 kebab（`"ROOT"` / `"root_1"` / `""`） → 每个子场景断言 `result.generationSource === "llm_fallback"`、`result.error` 包含 `"schema validation failed"` 或具体约束描述（`"depth"` / `"duplicated"` / `"cycle"` / `"root"`）
  - [ ] 12.4 **ApiKey missing（R9.2 apiKey-missing）**：fake `getConfig: () => ({ model: "gpt-4-turbo", apiKey: "" })` + callJson spy → 断言 `result.generationSource === "template"`（design §6.3.4 锁定与档位 1 合流的口径）、`callJson` spy 未被调用、`result.error` / `result.promptId` / `result.model` 均为 undefined
  - [ ] 12.5 **补充：Not enabled**：未设环境变量 `BLUEPRINT_SPEC_TREE_LLM_ENABLED` → `result.generationSource === "template"` + callJson spy 未被调用 + `ctx.logger.debug` 被调用
  - [ ] 12.6 **补充：Timeout**：fake `callJson: async () => { throw new Error("Request aborted due to timeout") }` → `result.generationSource === "llm_fallback"`、`result.error` 匹配 `/llm timeout/`（通过 `/abort|timeout/i` 路径识别）
  - [ ] 12.7 **补充：Redaction E2E**：fake `callJson` 抛错 message 包含 `"sk-ABCDEFGHIJKLMNOP1234567890"` → 断言 `result.error` 不含该原文子串（已脱敏）
  - _Requirements: 5.3, 9.2_

- [ ] 13. **Checkpoint B 验证** — 运行完整子域测试
  - [ ] 13.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 13.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/spec-tree/` → ~38 条新增 co-located 单测全绿（policy ~6 + schema ~12 + prompt ~8 + flatten ~5 + service ~7）
  - [ ] 13.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 13.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（B 阶段 service 已装配但未接入 `buildSpecTreeFromRouteSet`，E2E 行为零变化）
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 C：外层 hook 接线 + contract 扩展 + fallback E2E guard（依赖 B）

- [ ] 14. 改造 `server/routes/blueprint.ts` 的 `buildSpecTreeFromRouteSet()` + 提取 `buildTemplateSpecTreeNodes()`
  - [ ] 14.1 把 `buildSpecTreeFromRouteSet` 签名从 sync 改为 `async (ctx: BlueprintServiceContext, input: { ..., clarificationSession?, domainContext?, aigcSpecNodeEvidence? }): Promise<BlueprintSpecTree>`
  - [ ] 14.2 **纯 extract** `buildTemplateSpecTreeNodes(input: { rootNodeId, selectedRoute, routeSet, selection, previousRoleFindings }): BlueprintSpecTreeNode[]`：把今天 ~第 11994-12125 行的 `mainStepNodes + alternativeNodes + downstreamNodes + rootNode` 装配整体搬入该内部辅助函数，**实现字节不改**，仅重构文件位置（design §4.8）；`createDownstreamSpecTreeNodes()` 一行不改
  - [ ] 14.3 改造核心路径：先计算 `specTreeId` / `rootNodeId` / `alternativeRouteIds` scaffold；`await ctx.specTreeLlmService?.(...)` 传入 `jobId` / `job` / `request` / `routeSet` / `primaryRoute: selectedRoute` / `alternativeRoutes: routeSet.routes.filter(r => r.id !== selectedRoute.id)` / `clarificationSession` / `domainContext` / `aigcSpecNodeEvidence` / `createdAt` / `rootNodeId`
  - [ ] 14.4 `serviceResult?.generationSource === "llm" && serviceResult.nodes` 分支：用 LLM `nodes` 替换 template scaffold；`provenanceExtras = { generationSource: "llm", promptId, model, responseDigest, structuredPayloadDigest, promptFingerprint }`
  - [ ] 14.5 否则（template / llm_fallback）分支：调用 `buildTemplateSpecTreeNodes(...)`；`provenanceExtras = { generationSource: serviceResult?.generationSource ?? "template", promptId, model, promptFingerprint, error: serviceResult?.error }`
  - [ ] 14.6 合并 provenance：保留所有既有字段不变（`jobId` / `projectId` / `sourceId` / `routeSetId` / `routeId` / `selectionId` / `selectedPathId` / `specTreeId` / `targetText` / `githubUrls` / `artifactLinks` / `reusedRoleFindingIds` / `reusedRoleIds` / `reusedEvidenceIds`），以 `...provenanceExtras` 对象 spread 方式追加 7 个新字段
  - [ ] 14.7 调用点追加 `await`：`createGenerationJob()`（~第 7414 行）、`/routes/select` 派生入口、以及 `grep -nE "buildSpecTreeFromRouteSet\(" server/ shared/ --include="*.ts"` 发现的其它调用点；所有调用方改为 `async` 并透传 `ctx` + `clarificationSession` + `domainContext` + `aigcSpecNodeEvidence`（若上游 aigc-node 桥已落地则透传真实 evidence，否则 undefined）
  - _Requirements: 2.5, 2.6, 5.1, 5.2, 5.3, 5.4, 5.5, 8.1, 8.2_

- [ ] 15. 扩展 `shared/blueprint/contracts.ts`：`BlueprintSpecTree.provenance` 追加 7 个可选字段
  - [ ] 15.1 在 `BlueprintSpecTree.provenance` 类型中追加 7 个可选字段：`generationSource?: "llm" | "llm_fallback" | "template"`、`promptId?: string`、`model?: string`、`responseDigest?: string`、`structuredPayloadDigest?: string`、`promptFingerprint?: string`、`error?: string`；全部可选（design §4.9 + §2.D6）；不删除、不重命名、不修改任何既有 provenance 字段
  - [ ] 15.2 在仓库根运行 `node --run check`，确认新增字段不引入新增 TS 错误；grep 既有 `BlueprintSpecTree.provenance` / `specTree.provenance` 消费点确认没有因字段追加而断言失败
  - [ ] 15.3 同步确认 `client/src/lib/blueprint-api/` 下的 SDK normalizer：若使用 object spread 或透明透传，不需改动；若使用显式字段映射，追加 ~7 行可选字段透传（不修改任一既有字段映射行为）
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 8.2, 8.4_

- [ ] 16. **Checkpoint C 验证** — 运行既有 47 E2E + 48 子域 + 9 SDK smoke 确认零回归
  - [ ] 16.1 `node --run check` → 不扩大既有类型债错误面
  - [ ] 16.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 条既有 E2E 继续通过（未设 `BLUEPRINT_SPEC_TREE_LLM_ENABLED` → 档位 1 早退 → template 路径 → 字节级等价今天）
  - [ ] 16.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测 + ~38 条新增 co-located 单测全部通过
  - [ ] 16.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [ ] 16.5 本阶段断言点：`specTree.provenance.generationSource === "template"` 在默认装配下可断言；fallback 路径下 `BlueprintSpecTree.nodes` 顺序、固定下游菜单字符串（`"Specification document generation"` / `"Effect preview"` / `"Implementation prompt package"` / `"Engineering landing"`）、root `title` 格式（`"SPEC asset tree: ..."`）与今天字节相同
  - _Requirements: 5.3, 5.4, 5.5, 8.1, 8.3, 8.5, 8.6, 9.6_

### 检查点 D：E2E real + fallback + 最终全量回归（依赖 C）

- [ ] 17. 在 `server/tests/blueprint-routes.test.ts` 追加 E2E 用例 1（Real LLM path，需求 9.1a）
  - [ ] 17.1 用例描述：`it("buildSpecTreeFromRouteSet produces LLM-driven nodes when spec-tree llm is enabled", async () => {...})`
  - [ ] 17.2 测试前置：`mkdtemp` 创建临时 specsRoot 目录；`process.env.BLUEPRINT_SPEC_TREE_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})` 按 prompt 内容路由到对应家族（RouteSet / role / aigc-node / spec-tree）；仅当 `/SPEC Tree|SPEC 资产树/i.test(joined)` 命中时返回 design §6.2.1 给出的 4 节点合法 payload（root + 2 route_step + 1 spec_document），其它家族 prompt 返回对应姊妹 spec 的 fixture 或 undefined
  - [ ] 17.3 执行 `POST /api/blueprint/jobs` 创建 job；断言 `response.status === 201`、`specTree.provenance.generationSource === "llm"`、`specTree.provenance.promptId === "blueprint.spec-tree.v1"`、`typeof specTree.provenance.model === "string"`、`specTree.provenance.responseDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`specTree.provenance.structuredPayloadDigest` 匹配同款、`specTree.provenance.promptFingerprint` 匹配同款、`specTree.provenance.error` 为 undefined
  - [ ] 17.4 断言 LLM nodes 可见：`specTree.nodes.find(n => n.type === "root").title === "Release dashboard SPEC asset tree"`（LLM 派生的固定字符串，**不同于** 模板化 `"SPEC asset tree: ..."` 格式）；至少存在 1 个 `type === "spec_document"` 节点且 `title === "Dashboard requirements draft"`
  - [ ] 17.5 断言 rootNodeId 重映射正确：`specTree.rootNodeId === specTree.nodes.find(n => n.type === "root").id`，且该 id 以 `"blueprint-spec-node"` 前缀开头（`createId` 产出）
  - [ ] 17.6 测试清理：`delete process.env.BLUEPRINT_SPEC_TREE_LLM_ENABLED`；`await rm(specsRoot, { recursive: true, force: true })`
  - _Requirements: 9.1_

- [ ] 18. 在 `server/tests/blueprint-routes.test.ts` 追加 E2E 用例 2（Fallback path，需求 9.1b）
  - [ ] 18.1 用例描述：`it("buildSpecTreeFromRouteSet falls back to template when spec-tree llm call throws", async () => {...})`
  - [ ] 18.2 测试前置：`process.env.BLUEPRINT_SPEC_TREE_LLM_ENABLED = "true"`；`llmMocks.callLLMJson.mockImplementation((messages) => {...})`；仅当 `/SPEC Tree|SPEC 资产树/i.test(joined)` 命中时 `return Promise.reject(new Error("upstream 503"))`
  - [ ] 18.3 执行 `POST /api/blueprint/jobs`；断言 `response.status === 201`、`specTree.provenance.generationSource === "llm_fallback"`、`specTree.provenance.error` 匹配 `/upstream 503|llm callJson threw/`、`specTree.provenance.promptId === "blueprint.spec-tree.v1"`、`typeof specTree.provenance.model === "string"`
  - [ ] 18.4 断言 nodes 回退到模板化产出：`specTree.nodes.map(n => n.title)` 包含固定下游菜单字符串 `"Specification document generation"`、`"Effect preview"`、`"Implementation prompt package"`、`"Engineering landing"`
  - [ ] 18.5 断言 root 使用模板格式：`specTree.nodes.find(n => n.type === "root").title` 匹配 `/^SPEC asset tree: /`
  - [ ] 18.6 测试清理：同 task 17.6；确保 `llmMocks.callLLMJson.mockReset()` 不影响其它 E2E 用例
  - _Requirements: 9.1_

- [ ] 19. 最终全量回归：`node --run check` + `node --run test`
  - [ ] 19.1 `node --run check` → 0 个新增 TS 错误（若仓库已有历史类型债，不应扩大错误面；design §10.2 最终检查清单的硬约束）
  - [ ] 19.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 + 2 = 49 条 E2E 全绿（新增 real + fallback 两条）
  - [ ] 19.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/spec-tree/` → ~38 条新增 co-located 单测全绿
  - [ ] 19.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint` → 48 条既有子域单测继续通过
  - [ ] 19.5 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [ ] 19.6 `node --run test`（或项目级等价全量 test 命令）→ 所有 suite 绿（基线 + 新增全部通过）
  - _Requirements: 5.3, 5.4, 8.3, 8.4, 8.5, 9.6_

- [ ] 20. **最终验证 checklist** — 对齐 design §10.2 manual verification checklist
  - [ ] 20.1 人工核对 `shared/blueprint/contracts.ts` 中 `BlueprintSpecTree.provenance` 追加 7 个可选字段（`generationSource` / `promptId` / `model` / `responseDigest` / `structuredPayloadDigest` / `promptFingerprint` / `error`）；无任何字段被重命名或类型变更
  - [ ] 20.2 人工核对 `policy.ts` / `schema.ts` / `prompt.ts` / `flatten-and-remap.ts` / `service.ts` 五个文件均落地并通过各自 co-located 子域单测
  - [ ] 20.3 人工核对 `BlueprintServiceContext` 追加 2 个可选字段（`specTreeLlmPolicy?` / `specTreeLlmService?`）；`buildBlueprintServiceContext` 默认装配 `createSpecTreeLlmService(ctx)`；未装配时保留向后兼容（template 路径）
  - [ ] 20.4 人工核对 `buildSpecTreeFromRouteSet()` 改为 `async(ctx, input)`；所有调用点已补 `await`；`buildTemplateSpecTreeNodes()` 作为纯 extract 落地，模板化路径字节级等价今天
  - [ ] 20.5 人工核对禁止清单：`service.ts` 及其它实现文件不出现 `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch` / 硬编码 model 名 / temperature 默认值 / provider 名；不 `import` 模块级 eventBus / jobStore 单例；不出现裸事件字符串 `"spec.tree.updated"` 等（若在自然 emit 点追加可选字段，所有事件 `type` 走 `BlueprintEventName` 常量）
  - [ ] 20.6 人工核对 adapter 命名：若在事件 / provenance 中携带 `adapter` 字段，real 路径 adapter 字符串不含 `.simulated` 子串（推荐 `"blueprint.spec-tree.llm"`）；fallback 路径保留今天既有命名不变
  - [ ] 20.7 手动场景 1：本地运行 `BLUEPRINT_SPEC_TREE_LLM_ENABLED=true` + 有效 LLM apiKey → `POST /api/blueprint/jobs` → 响应 `specTree.provenance.generationSource === "llm"` + nodes titles 来自 LLM（与今天模板化产出**明显不同**）
  - [ ] 20.8 手动场景 2：本地运行 `BLUEPRINT_SPEC_TREE_LLM_ENABLED=true` + 无 apiKey → 响应 `specTree.provenance.generationSource === "template"` + nodes 使用固定下游菜单字符串
  - [ ] 20.9 手动场景 3：本地运行 `BLUEPRINT_SPEC_TREE_LLM_ENABLED=true` + mock LLM 抛错 → 响应 `specTree.provenance.generationSource === "llm_fallback"` + `error` 被填充（已脱敏）
  - [ ] 20.10 手动场景 4：本地不设 `BLUEPRINT_SPEC_TREE_LLM_ENABLED` → 响应 `specTree.provenance.generationSource === "template"` + 与今天字节相同（fallback E2E guard 已在 task 16 自动化覆盖，此步骤为手动复核）
  - [ ] 20.11 Schema 版本锚点确认：`promptId === "blueprint.spec-tree.v1"` 作为 schema 版本锚点；后续任何 schema 变更都需判断是否 bump 到 `v2`（新增可选字段兼容、删除字段 / 修改类型 / 严格化约束必须 bump）
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3, 5.4, 5.5, 7.1, 7.2, 7.5, 8.1, 8.2, 8.3, 8.5, 8.6, 9.6_

## 说明

- 本任务清单所有任务均为必做项，不含 `*` 可选标记（spec 范围聚焦、体量可控，与 routeset / 四条桥 spec 风格一致）。
- 每个任务都在 footer 中引用至少 1 个 EARS requirement id，便于追溯。
- 任务 2 / 4 / 6 / 8 / 12 均为 example-based 单测（共 ~38 条 co-located），**不**包含 PBT（符合 Requirement 9.3 + design §6.1 lock）；若后续 tasks 阶段发现需要 PBT 覆盖，必须显式写出要验证的不变量，否则应改为 example-based。
- 任务 17 / 18 只向 `server/tests/blueprint-routes.test.ts` **追加** 2 条新用例，不修改原有 47 条（符合 Requirement 9.6）。
- 本 spec 未调用 `prework` 工具（与 routeset / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径；design §6.1 明确锁定 example-based only）。
- **D5（Prompt ID 锁定 `blueprint.spec-tree.v1`）** 在任务 5.1 / 6.6 / 10.1 落地。
- **D6（Provenance 扩展策略，7 个可选字段）** 在任务 14.6 / 15.1 落地。
- **D7（事件复用既有 `BlueprintEventName`，不新增事件名）** 在任务 14 与 20.5 落地：本 spec 默认**不单独新增事件名**（需求 6.2 允许降级）；若 design / tasks 阶段发现 SPEC Tree 首次产出存在自然的 `SpecTreeUpdated` / `SpecTreeVersioned` emit 点，可在其 payload 上以可选字段方式追加 `generationSource` / `promptId` / `model` / `error`，否则 SPEC Tree 的 `generationSource` 仅通过 `BlueprintSpecTree.provenance` 暴露。
- **D8（Strict zod schema + `.superRefine()` 六条树级不变量）** 在任务 3.2 / 4 落地：unique id / exactly 1 root / 非 root parentId 可解析 / 无自环 / 深度 ≤ 4 / 所有节点从 root 可达。
- **D10（测试默认装配 ≡ 生产行为）** 在任务 13 / 16 落地：既有 47 E2E + 48 子域单测 + 9 SDK smoke 在默认未设 `BLUEPRINT_SPEC_TREE_LLM_ENABLED` 的装配下继续通过，字节级等价今天。
- 任务 9 / 13 / 16 / 19 是强制的验证门禁，必须在所有对应实现任务完成后执行；任何一步失败都必须回到对应实现任务修复后再跑整套回归。
- 本 spec 完成后，工作流结束 — 不在此 spec 内覆盖后续 SPEC Documents / Effect Preview / Prompt Package / Engineering Handoff 的 LLM 驱动（各自独立 spec 推进）。用户可通过 `tasks.md` 中的 "Start task" 入口逐项执行。
