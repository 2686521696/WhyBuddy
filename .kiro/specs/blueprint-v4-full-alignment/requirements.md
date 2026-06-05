# Requirements Document

## Introduction

本文档定义 WhyBuddy Skill v4 闭环总图（改进版 v4）与 Web 实现之间**剩余模块**的需求规格。已实现的 `QA_LEDGER`（校验台账）和 `QA_CONTENT`（内容质量校验）不在本规格范围内。`QA_MERGE` 明确排除——它不属于 v4 架构图。

六个模块（含一个最小前置依赖）分别为：

- **Module A — CO 伴随式审查与接地层**：按需触发的 Critic / Grounding 双角色横切审查。Critic 具备对抗独立性（裁判≠选手）。
- **Module B — CO 留痕进台账**：伴随层每次行动写入 `checksLedger`，形成可追溯记录。warn/error 级发现须在交付/评审视图露出。
- **Module C — EP_MATRIX 可追溯矩阵**：需求↔设计↔任务↔证据↔用例的结构化五元对应，含 `gaps` 缺口字段。
- **Module D — S4 不变量守卫·业务语义**：SPEC 树新增两条业务不变量（需求覆盖成功标准、每节点挂证据）。均为**软检查**（warn/fail 进台账，不硬拦规格树）。
- **Module E — EP_VIS_AUDIT 出图审计**：揪兜底/假成功/复制充数，审计结果进台账并触发回炉。
- **Module F（最小前置）— EP_VIS_GEN Provenance 产出**：为 Module E 提供输入，仅含 provenance 元数据产出和"禁本地兜底"约束。完整 gate 逻辑推迟到出图端点 403 问题解决后。

## Glossary

- **Companion_Layer**: CO 子图，包含 Critic 和 Grounding 两个横切角色的运行时容器。
- **Critic**: 挑刺者角色，检测模糊度、弱证据与过度自信假设。
- **Grounding**: 接地者角色，读真实代码仓库、强制挂真实出处引用。
- **Companion_Log**: 伴随层行动产生的结构化日志条目。
- **Fuzziness_Score**: 当前阶段输入/输出的模糊度评分（0-1），由 LLM 或规则引擎产出。
- **Checks_Ledger**: 已实现的 `checksLedger` 服务，负责 append-only 校验记录。
- **Traceability_Matrix**: 需求↔设计↔任务↔证据↔用例 五元结构化映射。
- **Spec_Tree**: LLM 生成的规格树 JSON 结构（`SpecTreeLlmResponse`）。
- **Clarified_Brief**: 澄清简报，含 `successCriteria` 成功标准列表。
- **Evidence_Source**: 节点引用的外部证据来源标识符。
- **Preview_Image**: 效果预览阶段生成的 PNG/WebP 图片资源。
- **Provenance**: 图片来源元数据，包含 `source`（模型/模板/兜底）、`ok` 布尔和错误信息。
- **Blueprint_Service_Context**: 蓝图栈统一运行期依赖容器（闭包工厂模式）。
- **Env_Gate**: 环境变量开关，格式 `BLUEPRINT_{MODULE}_ENABLED`。

## Requirements

---

### Requirement 1: Companion 层工厂与生命周期

**User Story:** 作为蓝图管线开发者，我想拥有一个按需激活的伴随审查层，以便在检测到模糊度、真仓库风险或弱证据时自动触发审查而不阻塞主管线。

#### Acceptance Criteria

1. THE Companion_Layer SHALL expose a closure-based factory `createCompanionLayer(ctx: BlueprintServiceContext)` that returns a `CompanionLayerService` interface.
2. WHEN `BLUEPRINT_COMPANION_ENABLED` env gate is `"false"` or unset, THE Companion_Layer SHALL return a no-op implementation where all methods resolve immediately without side effects.
3. THE Companion_Layer SHALL provide two sub-services: `critic: CriticService` and `grounding: GroundingService`.
4. THE Companion_Layer SHALL NOT operate as a persistent background process; activation SHALL be on-demand per invocation.
5. THE Companion_Layer SHALL be registered on `BlueprintServiceContext` as an optional field `companionLayer?: CompanionLayerService`.

---

### Requirement 2: Critic 角色触发与行为

**User Story:** 作为蓝图管线开发者，我想让挑刺者在检测到模糊度或弱证据时自动发力，以便在澄清、路线对比和规格生成阶段暴露潜在漏洞。

#### Acceptance Criteria

1. WHEN the Fuzziness_Score of the current stage output exceeds a configurable threshold (default `0.6`), THE Critic SHALL activate and produce a `CompanionFinding`.
2. WHEN the Critic activates, THE Critic SHALL inspect the target artifact for ambiguous terms, unsupported claims, and overconfident assumptions.
3. THE Critic SHALL support cross-cutting activation at stages: `clarification` (CL_GAP), `route_generation` (RT_CMP), and `spec_tree` (SP_PROMPT).
4. THE Critic SHALL produce a structured `CompanionFinding` containing: `role: "critic"`, `stage`, `targetArtifactId`, `findings: string[]`, `severity: "info" | "warn" | "error"`, `suggestedActions: string[]`, and `citations: string[]`.
5. THE Critic SHALL be non-blocking: findings are advisory and SHALL NOT halt pipeline progression.
6. IF the Critic encounters an internal error during analysis, THEN THE Critic SHALL log the error, produce a finding with `severity: "info"` noting the failure, and continue without throwing.
7. THE Critic SHALL operate with **对抗独立性 (adversarial independence)**: it SHALL NOT receive or have access to the generation-side's intermediate reasoning, self-justification, or confidence explanations — the Critic evaluates only the produced artifact, never the producer's rationale for producing it. Each Critic invocation SHALL be a separate, isolated LLM call (or rule evaluation) that cannot read the generation prompt's chain-of-thought.
8. WHEN findings of severity `"warn"` or `"error"` are produced, THE Critic SHALL ensure these findings are surfaced in the handoff/delivery package review view — they SHALL NOT remain buried only in the checks ledger.

---

### Requirement 3: Grounding 角色触发与行为

**User Story:** 作为蓝图管线开发者，我想让接地者在检测到真仓库存在且有风险时读取真实代码并强制挂引用，以便所有声明都有可追溯的出处。

#### Acceptance Criteria

1. WHEN a real GitHub repository URL is present in the `BlueprintIntake` AND the current stage is `input` (IN_INGEST) or `clarification` (CL_BRIEF), THE Grounding SHALL activate.
2. WHEN the Grounding activates, THE Grounding SHALL read relevant repository files via `ctx.mcpToolAdapter` or `ctx.httpFetcher` to obtain concrete evidence.
3. THE Grounding SHALL verify that every claim in the target artifact has at least one concrete citation from the actual repository or external source.
4. THE Grounding SHALL produce a structured `CompanionFinding` containing: `role: "grounding"`, `stage`, `targetArtifactId`, `findings: string[]`, `severity`, `citations: string[]`, and `repoFilesRead: string[]`.
5. THE Grounding SHALL be non-blocking: findings are advisory and SHALL NOT halt pipeline progression.
6. IF the repository is unreachable or `ctx.mcpToolAdapter` is not injected, THEN THE Grounding SHALL produce a finding with `severity: "warn"` noting the degradation and continue without throwing.
7. THE Grounding SHALL respect the existing fallback pattern: when dependencies are unavailable, the service degrades gracefully.

---

### Requirement 4: Companion 留痕进台账

**User Story:** 作为蓝图管线运维者，我想让每次伴随层行动都写入校验台账，以便"没留痕=没发力"的问责机制成立。

#### Acceptance Criteria

1. WHEN the Critic produces a `CompanionFinding`, THE Companion_Layer SHALL invoke `checksLedgerService.recordCheck()` with `checkType: "companion_trace"` and `checkName` containing the Critic role identifier and target stage.
2. WHEN the Grounding produces a `CompanionFinding`, THE Companion_Layer SHALL invoke `checksLedgerService.recordCheck()` with `checkType: "companion_trace"` and `checkName` containing the Grounding role identifier and target stage.
3. THE companion trace ledger entry `output` field SHALL contain a JSON-serialized summary of findings and citations, truncated to 4096 bytes as per existing Checks_Ledger constraints.
4. THE companion trace ledger entry `metadata` field SHALL contain: `{ role, targetArtifactId, findingsCount, severity, repoFilesRead? }`.
5. THE companion trace ledger entry `status` SHALL be `"pass"` when no `"error"` severity findings are produced, `"warn"` when `"warn"` severity findings exist, and `"fail"` when `"error"` severity findings exist.
6. IF writing to Checks_Ledger fails, THEN THE Companion_Layer SHALL log the failure and continue without throwing, to preserve the non-blocking guarantee.

---

### Requirement 5: Companion 层类型定义

**User Story:** 作为蓝图模块开发者，我想拥有完整的 TypeScript 类型定义，以便在编译期获得类型安全保障。

#### Acceptance Criteria

1. THE Companion_Layer SHALL define shared types at `shared/blueprint/companion/types.ts` including: `CompanionFinding`, `CompanionTriggerContext`, `CriticService`, `GroundingService`, `CompanionLayerService`.
2. THE `CompanionFinding` type SHALL include fields: `id: string`, `role: "critic" | "grounding"`, `stage: BlueprintGenerationStage`, `targetArtifactId: string`, `findings: string[]`, `severity: "info" | "warn" | "error"`, `suggestedActions: string[]`, `citations: string[]`, `repoFilesRead?: string[]`, `timestamp: string`.
3. THE `CompanionTriggerContext` type SHALL include fields: `jobId: string`, `stage: BlueprintGenerationStage`, `fuzzinessScore?: number`, `hasRealRepo: boolean`, `riskLevel?: "low" | "medium" | "high"`.
4. THE `CriticService` interface SHALL define: `evaluate(ctx: CompanionTriggerContext, artifact: unknown): Promise<CompanionFinding | null>`.
5. THE `GroundingService` interface SHALL define: `evaluate(ctx: CompanionTriggerContext, artifact: unknown): Promise<CompanionFinding | null>`.
6. THE `CompanionLayerService` interface SHALL define: `critic: CriticService`, `grounding: GroundingService`, `evaluateAll(ctx: CompanionTriggerContext, artifact: unknown): Promise<CompanionFinding[]>`.

---

### Requirement 6: EP_MATRIX 可追溯矩阵数据模型

**User Story:** 作为项目交付负责人，我想拥有一张需求↔设计↔任务↔证据↔用例的结构化五元对应表，以便快速定位任何需求的完整覆盖链路。

#### Acceptance Criteria

1. THE Traceability_Matrix SHALL define a structured model `TraceabilityMatrixEntry` containing: `requirementId: string`, `requirementTitle: string`, `designSections: string[]`, `taskIds: string[]`, `evidenceSources: string[]`, `testCases: string[]`.
2. THE Traceability_Matrix SHALL define `TraceabilityMatrix` as: `{ jobId: string, generatedAt: string, entries: TraceabilityMatrixEntry[], coverage: TraceabilityCoverage }`.
3. THE `TraceabilityCoverage` type SHALL include: `totalRequirements: number`, `coveredByDesign: number`, `coveredByTasks: number`, `coveredByEvidence: number`, `coveredByTests: number`, `coveragePercent: number`, `gaps: TraceabilityGap[]`.
4. THE `TraceabilityGap` type SHALL include: `requirementId: string`, `requirementTitle: string`, `missingLinks: ("design" | "task" | "evidence" | "test")[]` — explicitly listing which dimensions are uncovered for each requirement, turning the matrix from "display" into "guard".
5. THE shared types SHALL reside at `shared/blueprint/traceability-matrix/types.ts`.

---

### Requirement 7: EP_MATRIX 矩阵生成服务

**User Story:** 作为蓝图管线开发者，我想从 SPEC 树节点自动派生可追溯矩阵，以便矩阵与规格保持实时同步。

#### Acceptance Criteria

1. THE Traceability_Matrix service SHALL expose a factory `createTraceabilityMatrixService(ctx: BlueprintServiceContext)` returning a `TraceabilityMatrixService` interface.
2. WHEN `BLUEPRINT_TRACEABILITY_MATRIX_ENABLED` env gate is `"false"` or unset, THE service SHALL return a no-op implementation that produces an empty matrix.
3. WHEN `generateMatrix(jobId)` is invoked, THE service SHALL derive entries from the Spec_Tree nodes by mapping: root children as requirements, `spec_document` nodes as design sections, `engineering_plan` nodes as tasks, node `outputs` as evidence, and acceptance criteria extracted from spec documents as test cases.
4. THE service SHALL compute coverage statistics in the `TraceabilityCoverage` object.
5. THE service SHALL be registered on `BlueprintServiceContext` as `traceabilityMatrixService?: TraceabilityMatrixService`.

---

### Requirement 8: EP_MATRIX 导出格式

**User Story:** 作为项目交付负责人，我想将追溯矩阵导出为 JSON 和 Markdown 表格，以便嵌入交付包供人工审阅。

#### Acceptance Criteria

1. THE Traceability_Matrix service SHALL provide `exportJson(jobId): TraceabilityMatrix` that returns the full structured matrix.
2. THE Traceability_Matrix service SHALL provide `exportMarkdown(jobId): string` that renders the matrix as a Markdown table with columns: 需求 | 设计章节 | 任务项 | 证据来源 | 测试用例.
3. THE JSON export SHALL be written to the handoff package as `traceability_matrix.json`.
4. THE Markdown export SHALL be appended to the handoff package alongside existing documents.
5. WHEN the Spec_Tree changes after matrix generation, THE service SHALL mark the existing matrix as stale via the existing staleness mechanism.

---

### Requirement 9: EP_MATRIX 查询 API

**User Story:** 作为前端开发者，我想通过 API 查询可追溯矩阵数据，以便在驾驶舱界面展示覆盖状态。

#### Acceptance Criteria

1. THE Blueprint router SHALL expose `GET /api/blueprint/jobs/:jobId/traceability-matrix` that returns the `TraceabilityMatrix` JSON payload.
2. WHEN the matrix has not been generated for the given job, THE endpoint SHALL return HTTP 404 with `{ error: "matrix_not_generated" }`.
3. THE endpoint SHALL support optional query parameter `format=markdown` to return plain text Markdown instead of JSON.
4. THE endpoint SHALL require no authentication beyond existing Blueprint API access patterns.

---

### Requirement 10: S4 不变量守卫 — 需求覆盖成功标准

**User Story:** 作为蓝图管线开发者，我想确保澄清简报中的每条成功标准都被至少一个规格树节点覆盖，以便防止需求遗漏。

#### Acceptance Criteria

1. WHEN the SPEC Tree invariant guard executes, THE Invariant_Guard SHALL verify that every `successCriterion` in the `ClarifiedBrief` is referenced by at least one node in the Spec_Tree.
2. IF any success criterion is not covered by any Spec_Tree node, THEN THE Invariant_Guard SHALL record the uncovered criteria as a `"warn"` entry in the Checks_Ledger (NOT call `ctx.addIssue()` — this is a **soft check**, not a hard structural failure) to avoid blocking legitimate spec trees due to imprecise text matching.
3. THE matching logic SHALL use a two-tier approach: (a) first check whether any node explicitly declares coverage via a `coversCriteria: string[]` metadata field; (b) if no explicit declaration exists, fall back to normalized substring/keyword matching against node `title`, `summary`, and `outputs` fields.
4. WHEN `BLUEPRINT_BUSINESS_INVARIANTS_ENABLED` env gate is `"false"` or unset, THE invariant check SHALL be skipped.
5. THE invariant check result SHALL be recorded in the Checks_Ledger with `checkType: "invariant"` and `checkName: "business_requirement_coverage"`.
6. THE coverage check SHALL list uncovered criteria IDs/text in the ledger entry `output` field, enabling downstream consumers (matrix, handoff) to identify specific gaps.

---

### Requirement 11: S4 不变量守卫 — 每节点挂证据

**User Story:** 作为蓝图管线开发者，我想确保每个非根节点都至少引用一个证据来源，以便杜绝无依据的规格声明。

#### Acceptance Criteria

1. WHEN the SPEC Tree invariant guard executes, THE Invariant_Guard SHALL verify that every non-root node has at least one entry in its `outputs` array OR in its `metadata.evidenceSources` field.
2. IF any non-root node lacks evidence references, THEN THE Invariant_Guard SHALL record the finding as a `"warn"` entry in the Checks_Ledger (soft check, non-blocking), listing the node IDs without evidence. IF more than 50% of non-root nodes lack evidence, THE status SHALL be `"fail"`.
3. WHEN `BLUEPRINT_BUSINESS_INVARIANTS_ENABLED` env gate is `"false"` or unset, THE invariant check SHALL be skipped.
4. THE invariant check result SHALL be recorded in the Checks_Ledger with `checkType: "invariant"` and `checkName: "business_node_evidence"`.
5. THE invariant check SHALL execute after the existing 6 structural invariants but SHALL NOT use `ctx.addIssue()` — it writes to the ledger only, consistent with the soft-check philosophy of R10 and R20.

---

### Requirement 12: EP_VIS_AUDIT 出图审计服务

**User Story:** 作为蓝图管线运维者，我想在效果预览图片生成后自动审计，以便揪出兜底占位冒充、假成功和复制充数三类造假。

#### Acceptance Criteria

1. THE Preview_Audit service SHALL expose a factory `createPreviewAuditService(ctx: BlueprintServiceContext)` returning a `PreviewAuditService` interface.
2. WHEN `BLUEPRINT_PREVIEW_AUDIT_ENABLED` env gate is `"false"` or unset, THE service SHALL return a no-op implementation that reports all images as `"pass"`.
3. THE Preview_Audit service SHALL provide `auditPreviews(jobId, previews: PreviewImageMeta[]): Promise<PreviewAuditResult>`.
4. THE service SHALL detect **兜底占位冒充**: images whose `provenance.source` is `"fallback"` or `"placeholder"` pretending to be real generations.
5. THE service SHALL detect **假成功**: images whose `provenance.ok` is `true` but whose `provenance.errorIndicators` array is non-empty or whose file size is below a configurable minimum threshold (default 1024 bytes).
6. THE service SHALL detect **复制充数**: two or more images with identical SHA-256 content hash within the same job.

---

### Requirement 13: EP_VIS_AUDIT 审计结果进台账

**User Story:** 作为蓝图管线运维者，我想让出图审计结果自动写入校验台账，以便建立完整的出图可信证据链。

#### Acceptance Criteria

1. WHEN the Preview_Audit completes, THE service SHALL invoke `checksLedgerService.recordCheck()` with `checkType: "preview_audit"` for each audited image batch.
2. THE ledger entry `status` SHALL be `"pass"` when all images pass audit, `"warn"` when suspicious but non-blocking issues exist, and `"fail"` when any of the three fraud types is detected.
3. THE ledger entry `output` SHALL contain a JSON summary: `{ totalImages, passCount, failCount, failedImages: [{ imageId, reason }] }`.
4. THE ledger entry `metadata` SHALL include: `{ duplicateHashGroups?, fallbackDetected?, fakeSuccessDetected? }`.
5. THE ledger entry `stage` SHALL be `"effect_preview"`.

---

### Requirement 14: EP_VIS_AUDIT 假图回炉

**User Story:** 作为蓝图管线开发者，我想在审计发现假图时自动触发对应图片的重新生成，以便交付包中不存在任何不可信图片。

#### Acceptance Criteria

1. WHEN the Preview_Audit detects one or more failed images, THE service SHALL emit a `preview_audit.regenerate_requested` event via `ctx.eventBus` containing the list of failed image IDs.
2. THE regeneration request SHALL include: `jobId`, `failedImageIds: string[]`, `auditReasons: string[]`, `retryCount: number`.
3. IF the retry count exceeds a configurable maximum (default `2`), THEN THE service SHALL mark the image as permanently failed and record this in the Checks_Ledger with `status: "fail"` and `output` explaining retry exhaustion.
4. THE regeneration mechanism SHALL reuse the existing `EffectPreviewLlmService` or `EffectPreviewImageService` via `ctx.effectPreviewLlmService` / `ctx.effectPreviewImageService`.
5. THE service SHALL NOT block the overall pipeline: if regeneration fails after max retries, the handoff package proceeds with the failed image marked and an audit warning.

---

### Requirement 15: EP_VIS_AUDIT 类型定义

**User Story:** 作为蓝图模块开发者，我想拥有出图审计的完整类型定义，以便在编译期获得类型安全。

#### Acceptance Criteria

1. THE Preview_Audit service SHALL define shared types at `shared/blueprint/preview-audit/types.ts` including: `PreviewImageMeta`, `PreviewAuditFinding`, `PreviewAuditResult`, `PreviewAuditService`.
2. THE `PreviewImageMeta` type SHALL include: `imageId: string`, `jobId: string`, `nodeId: string`, `filePath: string`, `contentHash: string`, `fileSizeBytes: number`, `provenance: { source: string, ok: boolean, errorIndicators?: string[], generatedAt: string }`.
3. THE `PreviewAuditFinding` type SHALL include: `imageId: string`, `reason: "fallback_pretending" | "fake_success" | "duplicate_content"`, `details: string`, `severity: "warn" | "error"`.
4. THE `PreviewAuditResult` type SHALL include: `jobId: string`, `auditedAt: string`, `totalImages: number`, `passCount: number`, `failCount: number`, `findings: PreviewAuditFinding[]`, `overallStatus: BlueprintCheckStatus`.
5. THE `PreviewAuditService` interface SHALL define: `auditPreviews(jobId: string, previews: PreviewImageMeta[]): Promise<PreviewAuditResult>`.

---

### Requirement 16: 模块间集成约束

**User Story:** 作为蓝图栈架构师，我想确保五个新模块遵循现有架构约定，以便不引入单例、不破坏现有测试、不引起类型回归。

#### Acceptance Criteria

1. THE five modules SHALL follow the existing closure-based factory pattern via `BlueprintServiceContext`, with no module-level singletons.
2. THE five modules SHALL each use an independent `BLUEPRINT_{MODULE}_ENABLED` env gate for activation.
3. THE five modules SHALL write results to the existing `checksLedgerService` via the already-implemented `recordCheck()` interface.
4. THE five modules SHALL place server-side implementations under `server/routes/blueprint/{module-name}/` following existing directory convention.
5. THE five modules SHALL place shared types under `shared/blueprint/{module-name}/types.ts`.
6. THE five modules SHALL NOT break the existing 85+ E2E test suite when their env gates are disabled.
7. THE five modules SHALL register their services on `BlueprintServiceContext` as optional fields, preserving backward compatibility with existing test fixtures.

---

### Requirement 17: Companion 层配置策略

**User Story:** 作为蓝图管线运维者，我想通过配置调整伴随层的触发阈值和行为，以便适应不同项目的风险容忍度。

#### Acceptance Criteria

1. THE Companion_Layer SHALL accept a `CompanionLayerPolicy` configuration object containing: `fuzzinessThreshold: number` (default 0.6), `maxFindingsPerInvocation: number` (default 10), `enableCritic: boolean` (default true), `enableGrounding: boolean` (default true).
2. THE policy SHALL be injectable via `BlueprintServiceContext` as `companionLayerPolicy?: CompanionLayerPolicy`.
3. WHEN the policy is not provided, THE Companion_Layer SHALL use default values.
4. THE policy SHALL be pure data (stateless, no methods), following the existing `*Policy` pattern in the codebase.

---

### Requirement 18: S4 业务不变量与 Clarified Brief 的集成

**User Story:** 作为蓝图管线开发者，我想让业务不变量能访问当前 job 的 Clarified Brief 数据，以便进行需求覆盖验证。

#### Acceptance Criteria

1. WHEN the business invariant `requirement_coverage` executes, THE Invariant_Guard SHALL retrieve the Clarified Brief from `ctx.blueprintStores.clarificationSessions` using the current `jobId`.
2. IF the Clarified Brief is not found or has no `successCriteria`, THEN THE Invariant_Guard SHALL skip the requirement coverage check and record a `"skip"` status in the Checks_Ledger.
3. THE success criteria extraction SHALL handle both the `successCriteria: string[]` field and any structured criteria embedded in the clarification session metadata.


---

### Requirement 19: EP_VIS_GEN Provenance 产出（E 的前置依赖）

**User Story:** 作为出图审计服务的消费方，我需要效果预览图片在生成时就携带结构化 provenance 元数据，以便审计服务能够判断每张图的真实来源。

#### Acceptance Criteria

1. WHEN the `EffectPreviewImageService` generates or attempts to generate an image, THE service SHALL produce a `PreviewProvenance` object for each image containing: `source: "model" | "template" | "fallback"`, `ok: boolean`, `errorIndicators: string[]`, `generatedAt: string`, `modelUsed?: string`, `promptHash?: string`, `retryCount: number`.
2. THE existing `EffectPreviewImageService` SHALL be extended (not replaced) to attach provenance metadata to each generated preview artifact in the job's `artifacts[]` array.
3. WHEN the image generation encounters a 503 response, THE service SHALL retry up to `maxRetries` (default 2) times before recording `ok: false` with `errorIndicators: ["503_exhausted"]`.
4. WHEN the image generation encounters a read timeout, THE service SHALL NOT retry and SHALL immediately record `ok: false` with `errorIndicators: ["read_timeout_no_retry"]`.
5. THE service SHALL NOT produce or persist any local fallback/placeholder image — if generation fails, the provenance records failure with `source: "fallback"` and no image file is written.
6. WHEN `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED` is `"false"` or the image API key is absent, THE provenance SHALL record `source: "template"` and `ok: true` (template path is legitimate, not a fraud).
7. THIS requirement is the **minimum EP_VIS_GEN scope** pulled into this spec to unblock Module E (EP_VIS_AUDIT). The full EP_VIS_GEN gate logic (only counting real successes, anti-duplicate, anti-copy) is deferred until the image endpoint 403 issue is resolved.

---

### Requirement 20: S4 每节点挂证据 — 软检查策略

**User Story:** 作为蓝图管线开发者，我想让"每节点挂证据"不变量与需求覆盖不变量保持相同的非阻塞策略，以便不会因为 LLM 产出的节点缺少 evidence 就硬拦整棵合法规格树。

#### Acceptance Criteria

1. THE `business_node_evidence` invariant SHALL operate as a **soft check**: it records `"warn"` (not `ctx.addIssue()`) in the Checks_Ledger when nodes lack evidence, unless the proportion of evidence-less nodes exceeds 50% of all non-root nodes — in which case it records `"fail"`.
2. THE invariant SHALL NOT invoke `ctx.addIssue()` or cause schema validation to reject the tree — it is advisory, consistent with the non-blocking philosophy of R10.
3. THE ledger entry `output` SHALL list the specific node IDs that lack evidence, enabling downstream consumers to identify and address gaps.

