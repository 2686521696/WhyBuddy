# 任务列表：Blueprint 内容质量校验 (Content Quality Check)

## 任务 1：类型定义

- [ ] 1.1 创建 `server/routes/blueprint/content-quality/types.ts`，定义 `ContentQualityService`、`ContentQualityCheckInput`、`ContentQualityBatchInput`、`ContentQualityCheckResult`、`ContentQualityBatchResult` 接口

## 任务 2：EARS 模式匹配

- [ ] 2.1 创建 `server/routes/blueprint/content-quality/ears-patterns.ts`，定义 `EARS_KEYWORDS` 常量和 `containsEarsKeyword(text)` 函数
- [ ] 2.2 实现 `extractAcceptanceCriteria(content)` 函数，从 Markdown 中提取验收标准列表

## 任务 3：核心校验逻辑

- [ ] 3.1 创建 `server/routes/blueprint/content-quality/validator.ts`
- [ ] 3.2 实现 `checkDocumentSubstance(content, documentType)` — 正文长度/标题/散文/checkbox/代码块校验
- [ ] 3.3 实现 `checkEarsCompliance(content)` — EARS 关键词匹配与合规比例判定

## 任务 4：服务层

- [ ] 4.1 创建 `server/routes/blueprint/content-quality/service.ts`，实现 `createContentQualityService(ctx)` factory
- [ ] 4.2 实现 `validateDocument(input)` — 对单份文档执行 Substance + EARS 校验并写入台账
- [ ] 4.3 实现 `validateDocuments(batchInput)` — 批量校验并计算 overallStatus
- [ ] 4.4 实现 env gate 逻辑（`BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED`）
- [ ] 4.5 实现非阻塞 try/catch 保护，异常时写入 warn 台账条目

## 任务 5：Context 扩展与集成

- [ ] 5.1 在 `BlueprintServiceContext` 接口新增可选字段 `contentQuality?: ContentQualityService`
- [ ] 5.2 在 `buildBlueprintServiceContext()` 中按 env gate 装配 contentQuality 实例
- [ ] 5.3 在 `generateSpecDocuments()` 完成后调用 `ctx.contentQuality?.validateDocuments()`

## 任务 6：单元测试

- [ ] 6.1 创建 `server/routes/blueprint/content-quality/service.test.ts`
  - [ ] 6.1.1 测试 checkDocumentSubstance：空文档 → fail
  - [ ] 6.1.2 测试 checkDocumentSubstance：无标题 → warn
  - [ ] 6.1.3 测试 checkDocumentSubstance：tasks 无 checkbox → fail
  - [ ] 6.1.4 测试 checkDocumentSubstance：正常文档 → pass
  - [ ] 6.1.5 测试 checkEarsCompliance：全部包含关键词 → pass
  - [ ] 6.1.6 测试 checkEarsCompliance：> 50% 不合规 → fail
  - [ ] 6.1.7 测试 checkEarsCompliance：无验收标准段落 → skip
  - [ ] 6.1.8 测试 validateDocuments 批量：含 fail → overallStatus fail
  - [ ] 6.1.9 测试 env gate disabled → overallStatus skip
  - [ ] 6.1.10 测试非阻塞：解析异常时 → warn 而非抛错
