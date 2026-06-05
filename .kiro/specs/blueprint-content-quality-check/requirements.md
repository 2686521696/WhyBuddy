# 需求文档：Blueprint 内容质量校验 (Content Quality Check)

## 简介

Blueprint 管线中的 Content Quality Check（内容质量校验）是 WhyBuddy Skill 闭环架构 v4
中 `QA_CONTENT` 节点的 Web 端实现。它对 SPEC 文档（requirements.md / design.md / tasks.md）
进行结构性和语义性质量校验，验证文档内容是否"成立"（非空壳/占位符），并检查需求文档中的
验收标准是否遵循 EARS 句式（WHEN/WHILE/IF/THEN/THE/SHALL）。

校验结果通过已实现的 `checksLedger` 服务写入台账（`checkType: "content_quality"`），
为后续合并门禁（QA_MERGE）提供质量信号。

## 术语表

- **Content_Quality_Service**：内容质量校验服务，接收 SPEC 文档执行校验并写入台账
- **Substance_Check**：实质性校验，验证文档内容是否有实质内容（非空/非占位符）
- **EARS_Check**：EARS 句式校验，验证验收标准是否符合 EARS 模式
- **EARS_Keywords**：EARS 句式关键词集合：WHEN、WHILE、IF、THEN、THE、SHALL、WHERE
- **Checks_Ledger**：校验台账（已实现），接收质量校验结果写入
- **Spec_Document**：Blueprint 规格文档对象（requirements / design / tasks）

## 需求

### 需求 1：文档实质性校验

**用户故事：** 作为管线质量守门人，我希望系统能检测出空壳或占位符文档，以便在交付前发现内容缺失。

#### 验收标准

1. WHEN 一份 Spec_Document 的正文（去除 Markdown 标题行后）少于 100 个字符时，THE Content_Quality_Service SHALL 报告该文档的 Substance_Check 状态为 `fail`，output 包含 "document body too short"
2. WHEN 一份 Spec_Document 不包含除标题之外的任何二级或三级标题时，THE Content_Quality_Service SHALL 报告 Substance_Check 状态为 `warn`，output 包含 "missing section headings"
3. WHEN 一份 Spec_Document 不包含至少一段连续散文（≥50 字符的非标题/非列表/非代码行）时，THE Content_Quality_Service SHALL 报告 Substance_Check 状态为 `warn`，output 包含 "no prose paragraphs found"
4. WHEN 一份 tasks.md 类型的 Spec_Document 不包含任何 Markdown checkbox 项（`- [ ]` 或 `- [x]`）时，THE Content_Quality_Service SHALL 报告 Substance_Check 状态为 `fail`，output 包含 "no task checkboxes found"
5. WHEN 一份 design.md 类型的 Spec_Document 不包含任何代码块（```）或 Mermaid 图时，THE Content_Quality_Service SHALL 报告 Substance_Check 状态为 `warn`，output 包含 "no code blocks or diagrams"
6. WHEN 一份 Spec_Document 通过所有 Substance_Check 时，THE Content_Quality_Service SHALL 报告状态为 `pass`

### 需求 2：EARS 句式校验

**用户故事：** 作为规格审查人员，我希望系统能检查验收标准是否符合 EARS 模式，以便确保需求具有可测试性。

#### 验收标准

1. THE Content_Quality_Service SHALL 仅对 `type === "requirements"` 的 Spec_Document 执行 EARS_Check
2. WHEN 验收标准列表中某条不包含任何 EARS_Keywords（不区分大小写匹配 WHEN/WHILE/IF/THEN/THE/SHALL/WHERE）时，THE Content_Quality_Service SHALL 报告该条目的 EARS_Check 状态为 `warn`，output 包含违规条目序号和内容前 80 字符
3. WHEN 验收标准列表中超过 50% 的条目不包含 EARS_Keywords 时，THE Content_Quality_Service SHALL 报告整体 EARS_Check 状态为 `fail`
4. WHEN 所有验收标准条目都包含至少一个 EARS_Keywords 时，THE Content_Quality_Service SHALL 报告 EARS_Check 状态为 `pass`
5. IF Spec_Document 中无法提取到验收标准列表（无 "Acceptance Criteria" / "验收标准" 段落），THEN THE Content_Quality_Service SHALL 报告 EARS_Check 状态为 `skip`

### 需求 3：台账集成

**用户故事：** 作为管线观测系统，我希望内容质量校验结果统一写入校验台账，以便在驾驶舱中展示质量状态。

#### 验收标准

1. WHEN Content_Quality_Service 完成对一份 Spec_Document 的校验后，THE service SHALL 调用 `checksLedger.recordCheck()` 写入一条 `checkType: "content_quality"` 的台账条目
2. THE 台账条目的 `stage` 字段 SHALL 为 `"spec_docs"`
3. THE 台账条目的 `checkName` 字段 SHALL 包含文档类型标识（如 "Content Quality: requirements" / "EARS Pattern: requirements"）
4. THE 台账条目的 `validator` 字段 SHALL 为 `"content-quality/validator.ts"`
5. WHEN Substance_Check 和 EARS_Check 都执行时，THE service SHALL 为同一文档写入两条独立的台账条目

### 需求 4：批量校验接口

**用户故事：** 作为管线编排器，我希望在 spec_docs 阶段完成后一次性触发所有文档的质量校验。

#### 验收标准

1. THE Content_Quality_Service SHALL 提供 `validateDocuments(jobId, documents[])` 方法，批量校验多份文档并返回汇总结果
2. WHEN 批量校验中任一文档的任一检查为 `fail` 时，THE 汇总结果 SHALL 标记 `overallStatus: "fail"`
3. WHEN 批量校验中所有文档所有检查均为 `pass` 或 `skip` 时，THE 汇总结果 SHALL 标记 `overallStatus: "pass"`
4. WHEN 批量校验中存在 `warn` 但无 `fail` 时，THE 汇总结果 SHALL 标记 `overallStatus: "warn"`

### 需求 5：环境门禁

**用户故事：** 作为运维工程师，我希望内容质量校验可通过环境变量关闭，以便在不需要时跳过。

#### 验收标准

1. WHILE 环境变量 `BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED` 值不为 `"true"` 时，THE Content_Quality_Service SHALL 跳过所有校验并返回 `overallStatus: "skip"`
2. WHILE 环境变量 `BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED` 值不为 `"true"` 时，THE Content_Quality_Service SHALL 不向 checksLedger 写入任何条目

### 需求 6：非阻塞策略

**用户故事：** 作为管线设计者，我希望内容质量校验默认为非阻塞（只记录不拦截），以便不中断 spec 生成流程。

#### 验收标准

1. THE Content_Quality_Service SHALL 在任何情况下不抛出异常中断管线流程
2. IF 内部执行出错（如 Markdown 解析异常），THEN THE Content_Quality_Service SHALL 记录一条 `status: "warn"` 的台账条目并继续执行后续文档
3. THE Content_Quality_Service 的校验结果 SHALL 仅作为质量信号供合并门禁（QA_MERGE）参考，不直接阻塞 spec_docs 阶段推进
