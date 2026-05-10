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

依赖顺序：**检查点 A**（tasks 1-11）→ **检查点 B**（tasks 12-14）→ **检查点 C**（tasks 15-17）→ **检查点 D**（tasks 18-20）。每个检查点结束都有一条显式"验证"任务作为质量门禁；任何一条验证失败都必须回到对应实现任务修复后再跑整套回归。

**Requirement 9.3 + design §6.1 lock**：本阶段测试策略为 **example-based only**，**禁止引入 PBT**；若后续 tasks 阶段出现任何被标注为 PBT 的任务，必须显式写出要验证的不变量，否则应改为 example-based。本 spec 未调用 `prework` 工具（与 routeset / spec-tree / spec-documents / effect-preview / prompt-package / 四条桥 spec 对齐：同一 LLM-driven 模式的下一阶段 spec，测试策略直接复用姊妹 spec 的锁定口径）。

## 任务列表

### 检查点 A：纯函数 helpers + schema + prompt + normalize + render + co-located 单测（低风险，先做）

- [x] 1. 新建 `server/routes/blueprint/engineering-handoff/policy.ts`
  - [x] 1.1 定义并导出 `EngineeringHandoffLlmPolicy` 接口（字段按 design §4.3）
  - [x] 1.2 实现并导出 `createDefaultEngineeringHandoffLlmPolicy()`（默认 30_000；env override 正整数且 ≤ 30_000 时采用，否则回退）
  - [x] 1.3 实现并导出纯函数 `applyEngineeringHandoffRedaction(value, policy)`（API key / GitHub PAT / email / Authorization / Bearer / token / api_key 脱敏）
  - [x] 1.4 禁止导入运行时/业务模块；仅导入 TS 内置类型
  - _Requirements: 2.8, 4.5, 5.1_

- [x] 2. 新建 `server/routes/blueprint/engineering-handoff/policy.test.ts`（6 条 example-based 单测）
  - [x] 2.1 默认 `maxInvocationTimeoutMs === 30_000`
  - [x] 2.2 `BLUEPRINT_ENGINEERING_HANDOFF_LLM_TIMEOUT_MS="5000"` → `5_000`
  - [x] 2.3 非法值（"abc"/"-1"/"99999"/"0"）回退到 30_000
  - [x] 2.4 API key / GitHub PAT 脱敏
  - [x] 2.5 email / key-value 对脱敏
  - [x] 2.6 ReDoS 哨兵：5MB 字符串耗时 < 200ms
  - _Requirements: 5.1, 9.8_

- [x] 3. 新建 `server/routes/blueprint/engineering-handoff/schema.ts`
  - [x] 3.1 定义所有 leaf enum schema（StepMode/RiskLevel/RiskNoteLevel/Platform）
  - [x] 3.2 定义 leaf object schema（StepSchema/HandoffSchema/RiskNoteSchema/MissionMetadataSchema）
  - [x] 3.3 导出 `EngineeringHandoffSchemaInput` 与工厂 `createEngineeringHandoffLlmResponseSchema(input)`
  - [x] 3.4 顶层 `z.object({...})`（title 1..200 / summary 1..500 / missionSummary 1..1000 / steps 1..30 / acceptanceCriteria 1..20 / riskNotes 0..20 / handoffs 1..10）
  - [x] 3.5 `.superRefine` 实现 9 条不变量（trim 非空 / id 唯一 / 可解析引用 / platform 匹配 / promptPackageId 匹配）
  - [x] 3.6 不使用 `.strict()`；禁止 `.transform` / `z.coerce` / `z.preprocess`
  - [x] 3.7 导出类型别名（EngineeringHandoffLlmResponse / Step / Handoff / RiskNote）
  - [x] 3.8 仅导入 zod 与 shared blueprint 类型
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. 新建 `server/routes/blueprint/engineering-handoff/schema.test.ts`（18 条 example-based 单测）
  - [x] 4.1 minimal valid payload 通过
  - [x] 4.2 full valid payload（15 steps、5 handoffs、10 acceptance、8 riskNotes）通过
  - [x] 4.3 顶层字段缺失 → 失败
  - [x] 4.4 数组长度越界（0/31/11/21）→ 失败
  - [x] 4.5 枚举值非法（mode/riskLevel/noteLevel/platform）→ 失败
  - [x] 4.6 steps[*].id 重复 → 失败
  - [x] 4.7 大小写变体 id 冲突 → 失败
  - [x] 4.8 sourceNodeIds 不可解析 → 失败
  - [x] 4.9 sourceDocumentIds / sourcePreviewIds 不可解析 → 失败
  - [x] 4.10 promptPackageIds 不匹配 → 失败
  - [x] 4.11 handoffs[*].platform 不匹配 targetPlatform → 失败
  - [x] 4.12 handoffs[*].promptPackageId 不匹配 → 失败
  - [x] 4.13 顶层 trim 后全空格 → 失败
  - [x] 4.14 嵌套字符串 trim 后全空格 → 失败
  - [x] 4.15 字符串越界 → 失败
  - [x] 4.16 嵌套数组越界 → 失败
  - [x] 4.17 missionMetadata 默认 `{}` / 缺失 → 通过
  - [x] 4.18 未知字段静默 strip
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.2_

- [x] 5. 新建 `server/routes/blueprint/engineering-handoff/prompt.ts`
  - [x] 5.1 导出常量 `ENGINEERING_HANDOFF_PROMPT_ID = "blueprint.engineering-handoff.v1"` + 类型 `EngineeringHandoffPromptPayload`
  - [x] 5.2 定义并导出 `BuildEngineeringHandoffPromptInput` 类型
  - [x] 5.3 实现 `buildEngineeringHandoffPrompt(input)`（字段顺序固定 / answers 字典序 / 保序）
  - [x] 5.4 locale-aware `systemMessage`（zh-CN 含 CJK / en-US 英文开头）
  - [x] 5.5 `userMessage` + `promptFingerprint = sha256(systemMessage + "\n\n" + userMessage)`
  - [x] 5.6 禁止 `callLLMJson` / `getAIConfig` / `fetch` 导入
  - _Requirements: 2.2, 2.5, 3.1, 3.2_

- [x] 6. 新建 `server/routes/blueprint/engineering-handoff/prompt.test.ts`（10 条 example-based 单测）
  - [x] 6.1 确定性：同一输入两次产出字节相同
  - [x] 6.2 输入变化敏感：追加 clarification answer 后变化
  - [x] 6.3 clarification.answers 按 questionId 字典序
  - [x] 6.4 locale "zh-CN" systemMessage 含 CJK
  - [x] 6.5 locale "en-US" systemMessage 英文开头
  - [x] 6.6 PROMPT_ID 常量与输出一致
  - [x] 6.7 primaryRoute.steps 保序 + sourceNodes/Docs/Previews 保序
  - [x] 6.8 outputSchema 含所有枚举值提示
  - [x] 6.9 resolvableIds 反映并集
  - [x] 6.10 可选 capability 分支（undefined 时不含块 / 提供时按顺序）
  - _Requirements: 2.2, 3.1, 3.2, 9.2_

- [x] 7. 新建 `server/routes/blueprint/engineering-handoff/normalize.ts`
  - [x] 7.1 导出 NormalizeEngineeringHandoffInput / Output 类型
  - [x] 7.2 纯函数 `normalizeEngineeringHandoffResponse(input)` 实现 7 步规范化
  - [x] 7.3 仅 `import type` 已有类型 + 纯 helper（无运行时业务依赖）
  - _Requirements: 3.6_

- [x] 8. 新建 `server/routes/blueprint/engineering-handoff/normalize.test.ts`（7 条 example-based 单测）
  - [x] 8.1 缺失可选 step 字段 → 补齐默认
  - [x] 8.2 重复 id title slug 去重（-2/-3）
  - [x] 8.3 fileScopes/verificationCommands 去重保序
  - [x] 8.4 trim 首尾空白
  - [x] 8.5 missionMetadata 原样透传
  - [x] 8.6 riskLevel 映射 3×3 status × mode
  - [x] 8.7 防御性裁剪幂等 + UTF-8 安全
  - _Requirements: 3.6, 9.2_

- [x] 9. 新建 `server/routes/blueprint/engineering-handoff/render.ts`
  - [x] 9.1 导出 `renderEngineeringHandoffSummary`（missionSummary 前缀块 + ellipsis 截断）
  - [x] 9.2 导出 `renderEngineeringHandoffContent`（acceptance + risk 追加段）
  - [x] 9.3 不 mutate 输入；不导入运行时业务模块
  - _Requirements: 2.4, 2.6_

- [x] 10. 新建 `server/routes/blueprint/engineering-handoff/render.test.ts`（5 条 example-based 单测）
  - [x] 10.1 summary 合并带标签
  - [x] 10.2 超长时截断带 "…"
  - [x] 10.3 content 追加 acceptance + risk 段
  - [x] 10.4 空数组时 content 与 base 相同
  - [x] 10.5 确定性
  - _Requirements: 2.4, 9.2_

- [x] 11. **Checkpoint A 验证** — 运行纯函数子域单测
  - [x] 11.1 `node --run check` → 不扩大既有类型债错误面
  - [x] 11.2 policy.test.ts / schema.test.ts / prompt.test.ts / normalize.test.ts / render.test.ts → 46 条单测全绿
  - [x] 11.3 server/routes/blueprint 48 条既有子域单测继续通过
  - [x] 11.4 server/tests/blueprint-routes.test.ts 47 条 E2E 继续通过
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 B：Service 工厂 + Context 扩展 + 单测（依赖 A）

- [x] 12. 新建 `server/routes/blueprint/engineering-handoff/service.ts`：`createEngineeringHandoffLlmService(ctx)` 工厂 + 主算法
  - [x] 12.1 定义 EngineeringHandoffLlmServiceInput / Output + service 类型别名 + render 类型别名
  - [x] 12.2 导出工厂 `createEngineeringHandoffLlmService(ctx)`，闭包解析 policy
  - [x] 12.3 六档 fallback（未启用 / apiKey 缺失 / callJson 抛错 / 非 JSON / schema 失败 / 超时）
  - [x] 12.4 Happy path：normalize + renderSummary + digests
  - [x] 12.5 LLM 调用参数固定
  - [x] 12.6 logger meta 字段经脱敏
  - [x] 12.7 硬约束：不导入 callLLMJson / getAIConfig / fetch / 硬编码 model 等
  - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7, 2.8, 3.5, 3.6, 4.1, 4.5, 5.1, 7.1, 7.2, 7.4, 7.5_

- [x] 13. 扩展 `server/routes/blueprint/context.ts`：追加 2 个可选依赖字段 + 默认装配
  - [x] 13.1 追加 engineeringHandoffLlmPolicy? / engineeringHandoffLlmService? 字段
  - [x] 13.2 不改 `ctx.llm` 字段
  - [x] 13.3 buildBlueprintServiceContext 默认装配
  - [x] 13.4 向后兼容（未传时 template 路径）
  - [x] 13.5 `node --run check` 通过
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.2_

- [x] 14. 新建 `server/routes/blueprint/engineering-handoff/service.test.ts`：R9.2 四条硬需求 + 6 条补充
  - [x] 14.1 Happy path
  - [x] 14.2 Malformed JSON（undefined / string / number）
  - [x] 14.3 Schema fails（9 个子场景）
  - [x] 14.4 ApiKey missing → template
  - [x] 14.5 Not enabled → template
  - [x] 14.6 Timeout → /llm timeout/
  - [x] 14.7 Redaction E2E
  - [x] 14.8 Per-plan isolation
  - [x] 14.9 Platform mismatch recovery
  - [x] 14.10 Logger meta 含 promptPackageId
  - _Requirements: 5.3, 9.2_

- [x] 15. **Checkpoint B 验证** — 运行完整子域测试
  - [x] 15.1 `node --run check` → 不扩大类型债错误面
  - [x] 15.2 engineering-handoff/ 56 条 co-located 单测全绿
  - [x] 15.3 server/routes/blueprint 48 条既有子域单测继续通过
  - [x] 15.4 server/tests/blueprint-routes.test.ts 47 条 E2E 继续通过
  - _Requirements: 5.3, 5.4, 8.3, 8.5, 9.6_

### 检查点 C：外层 hook 接线 + contract 扩展 + fallback E2E guard（依赖 B）

- [x] 16. 改造 `server/routes/blueprint.ts` 的 `buildEngineeringLandingPlan()` 与 `generateEngineeringLandingPlans()`
  - [x] 16.1 buildEngineeringLandingPlan 签名改为 async(ctx, input)
  - [x] 16.2 9 个模板 helper 一行不改
  - [x] 16.3 改造核心路径：scaffold + await service
  - [x] 16.4 llm 分支：替换内容字段 + provenanceExtras
  - [x] 16.5 template / llm_fallback 分支：模板化一行不改
  - [x] 16.6 合并 provenance 保留既有 + 追加 7 字段
  - [x] 16.7 generateEngineeringLandingPlans 改为 async + Promise.all
  - [x] 16.8 MissionHandoff event payload 追加 landingPlanGenerationSources / promptId / model
  - [x] 16.9 调用点追加 await + ctx 透传
  - [x] 16.10 事件 type 走常量 BlueprintEventName.MissionHandoff
  - _Requirements: 2.2, 2.4, 2.6, 2.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.2_

- [x] 17. 扩展 `shared/blueprint/contracts.ts`：`BlueprintEngineeringLandingPlan.provenance` 追加 7 个可选字段
  - [x] 17.1 追加 generationSource? / promptId? / model? / responseDigest? / structuredPayloadDigest? / promptFingerprint? / error?
  - [x] 17.2 `node --run check` 通过
  - [x] 17.3 SDK normalizer 不受影响（透明透传）
  - [x] 17.4 MissionHandoff payload 宽松类型不需强类型追加
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 6.1, 6.2, 6.5, 8.2, 8.4_

- [x] 18. **Checkpoint C 验证** — 运行既有 47 E2E + 48 子域 + 9 SDK smoke 确认零回归
  - [x] 18.1 `node --run check` → 不扩大类型债错误面
  - [x] 18.2 server/tests/blueprint-routes.test.ts 47 条 E2E 继续通过
  - [x] 18.3 server/routes/blueprint 48 + 56 = 104 条单测全部通过
  - [x] 18.4 client/src/lib/blueprint-api/ 9 条 SDK smoke 继续通过
  - [x] 18.5 断言点：默认装配下 generationSource === "template"，fallback 路径字节级等价今天
  - _Requirements: 5.3, 5.4, 5.5, 5.6, 8.1, 8.3, 8.5, 8.6, 9.6_

### 检查点 D：E2E real + fallback + 最终全量回归（依赖 C）

- [x] 19. 在 `server/tests/blueprint-routes.test.ts` 追加 2 条新 E2E 用例
  - [x] 19.1 用例 1：Real LLM path
  - [x] 19.2 mock callJson 路由并返回合法 payload
  - [x] 19.3 断言 status + provenance.generationSource === "llm" + promptId + model + digests
  - [x] 19.4 断言 LLM 内容字段可见（title / summary / steps / handoffs.content 含 acceptance + risk 段）
  - [x] 19.5 断言 handoffs platform / promptPackageId / sourceNodeIds / provenance 既有字段
  - [x] 19.6 断言 mission.handoff event payload 追加 landingPlanGenerationSources
  - [x] 19.7 测试清理
  - [x] 19.8 用例 2：Fallback path
  - [x] 19.9 mock callJson 抛错
  - [x] 19.10 断言 generationSource === "llm_fallback" + error + promptId
  - [x] 19.11 断言模板化产出（title / summary / steps / handoffs 字节等价）
  - [x] 19.12 断言 mission.handoff payload landingPlanGenerationSources === "llm_fallback"
  - [x] 19.13 测试清理
  - _Requirements: 9.1_

- [x] 20. **最终全量回归与验证 checklist** — 对齐 design §10.2 manual verification checklist
  - [x] 20.1 `node --run check` → 0 新增 TS 错误
  - [x] 20.2 server/tests/blueprint-routes.test.ts 49 条 E2E 全绿
  - [x] 20.3 engineering-handoff/ 56 条 co-located 单测全绿
  - [x] 20.4 server/routes/blueprint 48 条既有子域单测继续通过
  - [x] 20.5 client/src/lib/blueprint-api/ 9 条 SDK smoke 继续通过
  - [x] 20.6 `node --run test` 所有 suite 绿
  - [x] 20.7 人工核对 contracts.ts 追加 7 个可选字段
  - [x] 20.8 BlueprintEngineeringRun 与 mission engineering 执行链路未改动
  - [x] 20.9 6 个子模块文件落地并通过单测
  - [x] 20.10 BlueprintServiceContext 追加 2 个可选字段 + 默认装配
  - [x] 20.11 buildEngineeringLandingPlan async + Promise.all 保序
  - [x] 20.12 9 个模板 helper 一行未改
  - [x] 20.13 禁止清单（无 callLLMJson / getAIConfig / fetch / 硬编码 / 裸事件字符串）
  - [x] 20.14 adapter 命名（real 不含 .simulated）
  - [x] 20.15 MissionHandoff event payload 追加 3 个可选字段
  - [x] 20.16 手动场景 1：enabled + apiKey → generationSource === "llm"
  - [x] 20.17 手动场景 2：enabled + 无 apiKey → generationSource === "template"
  - [x] 20.18 手动场景 3：enabled + mock 抛错 → generationSource === "llm_fallback"
  - [x] 20.19 手动场景 4：未 enabled → generationSource === "template"
  - [x] 20.20 手动场景 5：混合 LLM 成功 / 抛错 / 非 JSON → 顺序与 generationSource 独立
  - [x] 20.21 手动场景 6：timeout=500 + 延迟 → error === "llm timeout"
  - [x] 20.22 手动场景 7：platform mismatch → llm_fallback + error
  - [x] 20.23 Schema 版本锚点 promptId === "blueprint.engineering-handoff.v1"
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.6_

## 说明

- 本任务清单所有任务均为必做项，不含 `*` 可选标记（spec 范围聚焦、体量可控，与 routeset / spec-tree / spec-documents / effect-preview / prompt-package / 四条桥 spec 风格一致）。
- 每个任务都在 footer 中引用至少 1 个 EARS requirement id，便于追溯。
- 任务 2 / 4 / 6 / 8 / 10 / 14 均为 example-based 单测（共 ~56 条 co-located），**不**包含 PBT（符合 Requirement 9.3 + design §6.1 lock）。
- 任务 19 只向 `server/tests/blueprint-routes.test.ts` **追加** 2 条新用例，不修改原有 47 条（符合 Requirement 9.6）。
- **D5（Prompt ID 锁定 `blueprint.engineering-handoff.v1`）** 在任务 5.1 / 6.6 / 12.1 / 19.3 / 19.10 落地。
- **D6（Provenance 扩展策略，7 个可选字段）** 在任务 16.6 / 17.1 落地。
- **D7（事件复用既有 `BlueprintEventName.MissionHandoff`，payload 追加 3 个可选字段；不新增事件名）** 在任务 16.8 / 17.4 / 20.15 落地。
- **D8（Strict zod schema + `.superRefine()` 跨字段不变量）** 在任务 3.5 / 4 落地。
- **D9（脱敏走独立纯函数 `applyEngineeringHandoffRedaction`）** 在任务 1.3 / 2.4-2.6 / 12.6 / 14.7 落地。
- **D10（测试默认装配 ≡ 生产行为）** 在任务 15 / 18 落地。
- **D11（`missionSummary` / `acceptanceCriteria` / `riskNotes` 落点）** 在任务 9 / 10 / 16.4 / 16.5 / 19.4 / 19.11 落地。
- 任务 11 / 15 / 18 / 20 是强制的验证门禁。
- 本 spec 完成后，`/autopilot` 的 11 节点叙事流水线从 Clarification → RouteSet → SPEC Tree → SPEC Documents → Effect Preview → Prompt Package → **Engineering Handoff** 全部进入 LLM 驱动模式。
