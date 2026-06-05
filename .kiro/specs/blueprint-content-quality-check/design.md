# 设计文档：Blueprint 内容质量校验 (Content Quality Check)

## 概述

内容质量校验模块对 SPEC 文档执行纯结构性/模式匹配校验（无 LLM 调用），验证文档内容
的实质性和验收标准的 EARS 合规性。结果写入已实现的 checksLedger 服务。

## §1 模块结构

```
server/routes/blueprint/content-quality/
├── types.ts              # 服务接口与类型定义
├── validator.ts          # 核心校验逻辑（纯函数）
├── service.ts            # createContentQualityService(ctx) factory
├── service.test.ts       # 单元测试
└── ears-patterns.ts      # EARS 关键词与匹配逻辑
```

## §2 数据模型

### §2.1 校验输入

```typescript
export interface ContentQualityCheckInput {
  jobId: string;
  document: BlueprintSpecDocument;
}

export interface ContentQualityBatchInput {
  jobId: string;
  documents: BlueprintSpecDocument[];
}
```

### §2.2 校验输出

```typescript
export type ContentQualityOverallStatus = "pass" | "fail" | "warn" | "skip";

export interface ContentQualityCheckResult {
  documentId: string;
  documentType: string;
  substanceStatus: BlueprintCheckStatus;
  substanceOutput: string;
  earsStatus?: BlueprintCheckStatus;  // 仅 requirements 类型
  earsOutput?: string;
}

export interface ContentQualityBatchResult {
  overallStatus: ContentQualityOverallStatus;
  results: ContentQualityCheckResult[];
}
```

## §3 校验逻辑（纯函数）

### §3.1 Substance Check (`checkDocumentSubstance`)

```typescript
function checkDocumentSubstance(
  content: string,
  documentType: string,
): { status: BlueprintCheckStatus; output: string }
```

校验流程：
1. 去除 Markdown 标题行（`^#+\s`），计算剩余正文字符数
2. 若 < 100 字符 → `fail` + "document body too short"
3. 检查是否有 ≥1 个二级/三级标题（`^##` 或 `^###`）→ 无则 `warn`
4. 检查是否有 ≥1 段散文（连续 ≥50 字符的非标题/非列表/非代码行）→ 无则 `warn`
5. 若 `documentType === "tasks"`：检查是否有 `- [ ]` 或 `- [x]` → 无则 `fail`
6. 若 `documentType === "design"`：检查是否有 ` ``` ` 代码块或 `mermaid` → 无则 `warn`
7. 若所有检查通过 → `pass`

多个 warn 条件时，取最高严重度：fail > warn > pass。

### §3.2 EARS Pattern Check (`checkEarsCompliance`)

```typescript
function checkEarsCompliance(
  content: string,
): { status: BlueprintCheckStatus; output: string }
```

校验流程：
1. 提取验收标准段落：匹配 `#### Acceptance Criteria` 或 `#### 验收标准` 下方的编号列表
2. 若无法提取 → `skip` + "no acceptance criteria section found"
3. 对每条标准检查是否包含 EARS_Keywords（大小写不敏感）
4. 统计不合规条目占比：
   - 所有合规 → `pass`
   - ≤ 50% 不合规 → `warn` + 列出违规条目
   - > 50% 不合规 → `fail` + 列出违规条目

### §3.3 EARS 关键词集

```typescript
export const EARS_KEYWORDS = [
  "when", "while", "if", "then", "the", "shall", "where",
] as const;

export function containsEarsKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return EARS_KEYWORDS.some(kw => {
    // 匹配单词边界
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    return regex.test(lower);
  });
}
```

## §4 服务层

### §4.1 Factory

```typescript
export function createContentQualityService(
  ctx: BlueprintServiceContext,
): ContentQualityService {
  const enabled = process.env.BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED === "true";

  return {
    validateDocument(input) { /* ... */ },
    validateDocuments(batchInput) { /* ... */ },
  };
}
```

### §4.2 服务接口

```typescript
export interface ContentQualityService {
  validateDocument(input: ContentQualityCheckInput): ContentQualityCheckResult;
  validateDocuments(input: ContentQualityBatchInput): ContentQualityBatchResult;
}
```

### §4.3 与 checksLedger 集成

每份文档最多写入 2 条台账记录：
- `checkName: "Content Quality: {documentType}"` — Substance Check 结果
- `checkName: "EARS Pattern: {documentType}"` — 仅 requirements 类型

```typescript
ctx.checksLedger?.recordCheck({
  jobId: input.jobId,
  stage: "spec_docs",
  checkType: "content_quality",
  checkName: `Content Quality: ${document.type}`,
  status: substanceResult.status,
  validator: "content-quality/validator.ts",
  output: substanceResult.output,
});
```

## §5 环境门禁

| `BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED` | 行为 |
|------------------------------------------|------|
| 未设置 / 非 "true" | 所有方法返回 `overallStatus: "skip"`，不写台账 |
| "true" | 执行校验并写入台账 |

## §6 集成点

调用时机：在 `generateSpecDocuments()` 完成后、effect_preview 阶段之前。

```typescript
// 在 blueprint.ts 的 generateSpecDocuments 函数末尾：
if (ctx.contentQuality) {
  const documents = extractSpecDocuments(job);
  ctx.contentQuality.validateDocuments({ jobId: job.id, documents });
}
```

## §7 非阻塞保证

- 所有校验逻辑包裹在 try/catch 中
- 任何异常 → 记录 `status: "warn"` + 错误信息，继续下一份文档
- 不抛出 → 不中断管线

## §8 测试策略

| 测试类型 | 覆盖项 |
|---------|--------|
| 单元测试 | checkDocumentSubstance 各分支、checkEarsCompliance 各分支 |
| 集成测试 | validateDocuments 批量校验 + 台账写入 |
| 边界测试 | 空文档、纯标题文档、无验收标准文档、UTF-8 多字节字符 |
