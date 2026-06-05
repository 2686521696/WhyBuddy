# 设计文档：Blueprint V4 完整对齐

## 概述

本设计覆盖 6 个模块（A–F），将 Web 端 Blueprint 管线对齐 WhyBuddy Skill v4 闭环架构。
所有模块遵循相同的工程约定：closure-based factory、env gate、可选 ctx 字段、非阻塞降级、
结果写入 checksLedger。

---

## Module A — CO 伴随式审查与接地层

### §A.1 模块结构

```
server/routes/blueprint/companion/
├── types.ts              # CompanionLayerService / CriticService / GroundingService 接口
├── policy.ts             # CompanionLayerPolicy 默认值
├── critic.ts             # createCriticService(ctx, policy) 工厂
├── grounding.ts          # createGroundingService(ctx, policy) 工厂
├── service.ts            # createCompanionLayer(ctx) 总工厂
├── fuzziness.ts          # 模糊度评分器（规则 + 可选 LLM）
└── service.test.ts

shared/blueprint/companion/
├── types.ts              # CompanionFinding / CompanionTriggerContext / ...
└── index.ts
```

### §A.2 核心设计决策

| ID | 决策 | 理由 |
|----|------|------|
| A-D1 | Critic 独立 invocation，不传入生成方推理 | R2.7 对抗独立性 |
| A-D2 | 两级触发：规则引擎(fuzzinessScore > threshold) + 可选 LLM 补充 | 无 LLM 时仍可工作 |
| A-D3 | 评估只读 artifact（最终产物），不读中间状态 | 避免偏见渗入 |
| A-D4 | warn/error 级发现同时写入 `job.companionFindings[]` 供交付视图消费 | R2.8/R3.8 露出 |

### §A.3 Critic 调用流程

```
Stage output ready (CL_GAP / RT_CMP / SP_PROMPT)
  → computeFuzzinessScore(artifact)
  → score > policy.fuzzinessThreshold?
    → YES: ctx.llm.callJson(critic prompt, artifact-only, NO generator reasoning)
           → parse CompanionFinding
           → checksLedger.recordCheck(companion_trace)
           → push to job.companionFindings[]
    → NO: skip
```

### §A.4 Grounding 调用流程

```
Stage: input (IN_INGEST) or clarification (CL_BRIEF)
  → hasRealRepo in intake?
    → YES: read repo files via ctx.mcpToolAdapter / ctx.httpFetcher
           → verify citations in artifact
           → produce CompanionFinding
           → checksLedger.recordCheck(companion_trace)
           → push to job.companionFindings[]
    → NO (or dependencies unavailable): skip with warn
```

### §A.5 BlueprintServiceContext 扩展

```typescript
companionLayer?: CompanionLayerService;
companionLayerPolicy?: CompanionLayerPolicy;
```

---

## Module B — CO 留痕进台账

### §B.1 设计

留痕逻辑已内嵌在 Module A 的 Critic/Grounding 执行流中（§A.3/§A.4 的 `checksLedger.recordCheck`）。
本模块不是独立服务，而是 A 的行为保证：

- 每次 Critic/Grounding 产出 finding → 必调 `checksLedger.recordCheck()`
- `checkType: "companion_trace"`
- `status` 由 finding severity 映射：info→pass, warn→warn, error→fail
- `output` 为 finding JSON 摘要（截断 4096）
- `metadata` 含 `{ role, targetArtifactId, findingsCount, severity }`

### §B.2 交付包露出

在 engineering handoff 导出时，除 checks_ledger.json 外，新增 `companion_log.json`：

```typescript
interface CompanionLogExport {
  jobId: string;
  exportedAt: string;
  findings: CompanionFinding[];  // 全量，不截断
}
```

warn/error 级 findings 在 handoff 的 Markdown 摘要中以醒目区块呈现。

---

## Module C — EP_MATRIX 可追溯矩阵

### §C.1 模块结构

```
server/routes/blueprint/traceability-matrix/
├── types.ts              # 服务接口
├── service.ts            # createTraceabilityMatrixService(ctx)
├── derive.ts             # 从 spec_tree 派生矩阵的纯函数
├── export.ts             # JSON + Markdown 导出
├── route.ts              # GET /api/blueprint/jobs/:jobId/traceability-matrix
└── service.test.ts

shared/blueprint/traceability-matrix/
├── types.ts              # TraceabilityMatrixEntry / TraceabilityCoverage / TraceabilityGap
└── index.ts
```

### §C.2 派生逻辑（纯函数）

```typescript
function deriveMatrix(specTree: SpecTree, specDocs: SpecDocument[]): TraceabilityMatrix {
  // 1. requirements: 从 spec_tree 中提取 type === "route_step" 的节点（代表需求）
  // 2. design: 从 spec_documents 中提取 type === "design" 的文档 → 按 nodeId 关联
  // 3. tasks: 从 spec_tree 中提取 type === "engineering_plan" 的节点 → 按 parentId 关联
  // 4. evidence: 从每个节点的 outputs[] / metadata.evidenceSources 提取
  // 5. tests: 从 spec_documents type === "tasks" 中提取 acceptance criteria
  // 6. gaps: 对每条 requirement，检查 design/task/evidence/test 四维是否有对应
}
```

### §C.3 覆盖率与缺口

```typescript
interface TraceabilityCoverage {
  totalRequirements: number;
  coveredByDesign: number;
  coveredByTasks: number;
  coveredByEvidence: number;
  coveredByTests: number;
  coveragePercent: number;
  gaps: TraceabilityGap[];
}

interface TraceabilityGap {
  requirementId: string;
  requirementTitle: string;
  missingLinks: ("design" | "task" | "evidence" | "test")[];
}
```

---

## Module D — S4 不变量守卫·业务语义

### §D.1 设计策略：软检查

两条业务不变量（需求覆盖 + 节点证据）均为**软检查**：
- 不调用 `ctx.addIssue()`（不拦规格树）
- 写入 checksLedger（warn 或 fail）
- 在现有 6 条结构不变量 `superRefine` **之后**执行
- 通过单独函数调用，不影响 zod schema 本身的 pass/fail

### §D.2 需求覆盖匹配

```typescript
function checkRequirementCoverage(
  successCriteria: string[],
  nodes: SpecTreeNode[],
): { status: "pass" | "warn" | "fail"; uncovered: string[] } {
  // 两级匹配:
  // 1. 显式声明: node.metadata?.coversCriteria?.includes(criterionId)
  // 2. 归一化关键词: normalize(criterion) ∩ normalize(node.title + summary + outputs) 非空
  // 结果: 未覆盖条目 → warn; 超过 50% 未覆盖 → fail
}
```

### §D.3 节点证据检查

```typescript
function checkNodeEvidence(
  nodes: SpecTreeNode[],
): { status: "pass" | "warn" | "fail"; nodesWithout: string[] } {
  const nonRoot = nodes.filter(n => n.type !== "root");
  const lacking = nonRoot.filter(n =>
    (!n.outputs || n.outputs.length === 0) &&
    (!n.metadata?.evidenceSources || n.metadata.evidenceSources.length === 0)
  );
  // lacking.length === 0 → pass
  // lacking.length / nonRoot.length > 0.5 → fail
  // else → warn
}
```

### §D.4 执行位置

在 `spec-tree/service.ts` 的 happy path 中，schema 校验通过 + flattenAndRemap 成功后：

```typescript
// 结构不变量已通过（schema superRefine）
// → 执行业务软检查（不影响 generationSource 返回值）
if (process.env.BLUEPRINT_BUSINESS_INVARIANTS_ENABLED === "true") {
  const coverageResult = checkRequirementCoverage(successCriteria, remapped.nodes);
  ctx.checksLedger?.recordCheck({ ...coverageResult, checkType: "invariant", checkName: "business_requirement_coverage" });
  const evidenceResult = checkNodeEvidence(remapped.nodes);
  ctx.checksLedger?.recordCheck({ ...evidenceResult, checkType: "invariant", checkName: "business_node_evidence" });
}
```

---

## Module E — EP_VIS_AUDIT 出图审计

### §E.1 模块结构

```
server/routes/blueprint/preview-audit/
├── types.ts              # PreviewAuditService 接口
├── service.ts            # createPreviewAuditService(ctx)
├── detectors.ts          # 三类造假检测纯函数
└── service.test.ts

shared/blueprint/preview-audit/
├── types.ts              # BlueprintPreviewProvenance / PreviewImageMeta / PreviewAuditFinding / PreviewAuditResult
└── index.ts
```

### §E.2 三类造假检测

```typescript
// 1. 兜底冒充: source === "fallback" AND ok === true
function detectFallbackFraud(meta: PreviewImageMeta): boolean;

// 2. 假成功: ok === true AND (errorIndicators.length > 0 OR fileSizeBytes < MIN_SIZE)
function detectFakeSuccess(meta: PreviewImageMeta): boolean;

// 3. 复制充数: 同 job 内两张以上图 contentHash 相同
function detectDuplicates(metas: PreviewImageMeta[]): Map<string, string[]>;
```

### §E.3 审计 → 台账 → 回炉 流程

```
auditPreviews(jobId, previews[])
  → 对每张图跑三个 detector
  → 汇总 findings[]
  → checksLedger.recordCheck(preview_audit, pass/fail)
  → if (failCount > 0 && retryCount < maxRetries):
      emit("preview_audit.regenerate_requested", { jobId, failedImageIds })
  → if (retryCount >= maxRetries):
      mark permanently failed, record in ledger
  → return PreviewAuditResult
```

### §E.4 回炉不会死循环的保证

1. R19.5: 失败不写兜底文件 → 回炉后要么出真图(source:"model", ok:true)，要么诚实失败(source:"fallback", ok:false, 无文件)
2. 诚实失败(ok:false) 不是造假 → 不触发 R12.4 → 不再回炉
3. maxRetries=2 → 最多 3 次尝试（1 原始 + 2 重试），之后标记永久失败

---

## Module F — EP_VIS_GEN Provenance 产出

### §F.1 设计：扩展现有 ImageService

不新建模块，在 `server/routes/blueprint/effect-preview/image-service.ts` 中扩展：

```typescript
interface BlueprintPreviewProvenance {
  source: "model" | "template" | "fallback";
  ok: boolean;
  errorIndicators: string[];
  generatedAt: string;
  modelUsed?: string;
  promptHash?: string;
  retryCount: number;
}
```

### §F.2 扩展点

在 `runRasterPipeline` / image generation 流程的每个出口处：
- 成功 → `{ source: "model", ok: true, errorIndicators: [], retryCount }`
- 503 重试后成功 → 同上，retryCount 递增
- 503 重试耗尽 → `{ source: "fallback", ok: false, errorIndicators: ["503_exhausted"], retryCount }`
- 读超时 → `{ source: "fallback", ok: false, errorIndicators: ["read_timeout_no_retry"], retryCount: 0 }`
- env-off / no key → `{ source: "template", ok: true, errorIndicators: [], retryCount: 0 }`

### §F.3 关键约束

- **不写本地兜底文件**：失败时 provenance 记录 ok:false，但不产出任何 .png
- Provenance 附着在 job artifact 上（`artifact.metadata.provenance`）
- 使用统一的 `BlueprintPreviewProvenance` 类型（R20）

---

## 测试策略

| 模块 | 单元测试 | 集成测试 | 属性测试 |
|------|---------|---------|---------|
| A (CO) | Critic/Grounding 触发阈值、独立性（不传推理）、降级 | 全流程：输入→触发→finding→台账 | fuzzinessScore 边界 |
| B (留痕) | 在 A 的测试中覆盖 | 验证台账条目完整性 | — |
| C (矩阵) | deriveMatrix 各分支、gaps 计算、Markdown 渲染 | REST 端点 200/404/format | 覆盖率百分比边界 |
| D (S4) | 两级匹配、阈值判定、env gate | 与 spec-tree service 集成 | 模糊匹配误判率 |
| E (审计) | 三类 detector 各自边界、回炉计数 | 审计→台账→回炉事件 | 哈希碰撞 |
| F (Provenance) | 各出口 provenance 产出正确、不写文件 | 与 ImageService 集成 | — |

---

## 依赖顺序

```
F (provenance) ← 无前置，扩展现有服务
D (S4 不变量) ← 无前置，扩展现有 schema
A (CO) ← 依赖已有 checksLedger
B (留痕) ← 包含在 A 中
C (矩阵) ← 依赖 spec_tree 存在
E (审计) ← 依赖 F 产出 provenance
```

建议实现顺序：**F → D → A(含B) → C → E**
