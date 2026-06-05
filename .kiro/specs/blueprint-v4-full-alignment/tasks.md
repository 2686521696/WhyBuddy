# 任务列表：Blueprint V4 完整对齐

实现顺序：F → D → A(含B) → C → E

---

## Phase 1: Module F — EP_VIS_GEN Provenance 产出

- [x] F.1 在 `shared/blueprint/preview-audit/types.ts` 定义 `BlueprintPreviewProvenance` 统一类型（R19.1/R20）
- [x] F.2 在 `effect-preview/image-service.ts` 的每个出口（成功/503 耗尽/读超时/env-off）产出 `BlueprintPreviewProvenance` 对象
- [x] F.3 实现 503 重试逻辑（最多 `maxRetries` 次，默认 2）和读超时不重试逻辑
- [x] F.4 实现"失败不写本地兜底文件"约束——ok:false 时不产出 .png
- [x] F.5 将 provenance 附着到 job artifact 的 `metadata.provenance` 字段
- [x] F.6 单元测试：各出口 provenance 正确、失败不写文件、503 重试计数

## Phase 2: Module D — S4 不变量守卫·业务语义

- [ ] D.1 创建 `server/routes/blueprint/spec-tree/business-invariants.ts`，实现 `checkRequirementCoverage` 纯函数
  - [~] D.1.1 两级匹配：显式 `coversCriteria` 优先 → 归一化关键词兜底
  - [~] D.1.2 结果：未覆盖条目列表 + status 判定（0=pass，≤50%=warn，>50%=fail）
- [~] D.2 实现 `checkNodeEvidence` 纯函数（检查 outputs 或 metadata.evidenceSources）
- [ ] D.3 在 `spec-tree/service.ts` happy path 中接入业务软检查（env gate `BLUEPRINT_BUSINESS_INVARIANTS_ENABLED`）
  - [~] D.3.1 从 clarification session 取 successCriteria（兼容 R18.1/R18.3）
  - [~] D.3.2 无 criteria 时记录 skip
- [~] D.4 写入 checksLedger（checkType: invariant，checkName: business_requirement_coverage / business_node_evidence）
- [~] D.5 单元测试：匹配各分支、阈值边界、env gate 跳过、无 criteria skip

## Phase 3: Module A — CO 伴随式审查与接地层 (含 Module B 留痕)

- [~] A.1 创建 `shared/blueprint/companion/types.ts`：CompanionFinding、CompanionTriggerContext、CriticService、GroundingService、CompanionLayerService
- [~] A.2 创建 `shared/blueprint/companion/index.ts` barrel export
- [~] A.3 在 `shared/blueprint/index.ts` 新增 companion re-export
- [~] A.4 创建 `server/routes/blueprint/companion/policy.ts`：CompanionLayerPolicy 默认值
- [~] A.5 创建 `server/routes/blueprint/companion/fuzziness.ts`：规则引擎计算模糊度评分
- [ ] A.6 创建 `server/routes/blueprint/companion/critic.ts`：createCriticService(ctx, policy)
  - [~] A.6.1 对抗独立性：只传 artifact，不传生成方推理/chain-of-thought
  - [~] A.6.2 LLM 调用产出 CompanionFinding
  - [~] A.6.3 降级：LLM 不可用时返回 info 级 finding
- [ ] A.7 创建 `server/routes/blueprint/companion/grounding.ts`：createGroundingService(ctx, policy)
  - [~] A.7.1 通过 ctx.mcpToolAdapter / ctx.httpFetcher 读取仓库
  - [~] A.7.2 验证 artifact 中的声明是否有真实引用
  - [~] A.7.3 降级：依赖不可用时返回 warn 级 finding
- [ ] A.8 创建 `server/routes/blueprint/companion/service.ts`：createCompanionLayer(ctx) 总工厂
  - [~] A.8.1 evaluateAll() 顺序调用 critic + grounding
  - [~] A.8.2 每个 finding → checksLedger.recordCheck(companion_trace)
  - [~] A.8.3 warn/error 级 finding → push 到 job.companionFindings[]
- [~] A.9 在 `BlueprintServiceContext` 新增 `companionLayer?` 和 `companionLayerPolicy?`
- [~] A.10 在 `buildBlueprintServiceContext()` 按 env gate 装配
- [ ] A.11 在管线调用点接入：
  - [~] A.11.1 Critic 接入 clarification、route_generation、spec_tree 三阶段（R2.3）
  - [~] A.11.2 Grounding 接入 input(IN_INGEST) 和 clarification(CL_BRIEF) 两阶段（R3.1）— input 阶段是 Grounding 独有、最该读真仓库的入料点
- [~] A.12 实现交付包 `companion_log.json` 导出（全量 findings + warn/error 醒目区块）
- [~] A.13 单元测试：触发阈值、独立性（不传推理验证）、降级、台账写入、findings 露出

## Phase 4: Module C — EP_MATRIX 可追溯矩阵

- [~] C.1 创建 `shared/blueprint/traceability-matrix/types.ts`：TraceabilityMatrixEntry、TraceabilityCoverage、TraceabilityGap、TraceabilityMatrix
- [~] C.2 创建 `shared/blueprint/traceability-matrix/index.ts` barrel
- [~] C.3 在 `shared/blueprint/index.ts` 新增 re-export
- [ ] C.4 创建 `server/routes/blueprint/traceability-matrix/derive.ts`：deriveMatrix 纯函数
  - [~] C.4.1 需求节点 = type === "route_step"（已确认真实 schema）
  - [~] C.4.2 设计 = type === "spec_document"
  - [~] C.4.3 任务 = type === "engineering_plan"
  - [~] C.4.4 证据 = outputs[] + metadata.evidenceSources
  - [~] C.4.5 测试 = spec documents 中的 acceptance criteria
  - [~] C.4.6 gaps 计算：逐需求检查四维是否有对应
- [~] C.5 创建 `server/routes/blueprint/traceability-matrix/service.ts`：createTraceabilityMatrixService(ctx)
- [~] C.6 创建 `server/routes/blueprint/traceability-matrix/export.ts`：JSON + Markdown 导出
- [~] C.7 创建 `server/routes/blueprint/traceability-matrix/route.ts`：GET /api/blueprint/jobs/:jobId/traceability-matrix
- [~] C.8 在 `BlueprintServiceContext` 新增 `traceabilityMatrixService?`
- [~] C.9 在 `buildBlueprintServiceContext()` 按 env gate 装配
- [~] C.10 在 engineering handoff 导出路径挂载矩阵（JSON + Markdown）
- [ ] C.10b 矩阵失效联动（R8.5）：在 spec_tree 失效时，复用 S8 现有 staleness 链路把对应 job 的矩阵标记为 stale
  - [~] C.10b.1 在 staleness 依赖图中将 traceability_matrix 挂为 spec_tree 的下游
  - [~] C.10b.2 矩阵查询端点在返回 stale 矩阵时附带 `stale: true` 标记
- [~] C.11 单元测试：deriveMatrix 各分支、gaps 计算、Markdown 渲染、REST 端点、失效标记

## Phase 5: Module E — EP_VIS_AUDIT 出图审计

- [~] E.1 在 `shared/blueprint/preview-audit/types.ts` 补充 PreviewImageMeta、PreviewAuditFinding、PreviewAuditResult、PreviewAuditService（复用 F.1 的 BlueprintPreviewProvenance）
- [~] E.2 创建 `shared/blueprint/preview-audit/index.ts` barrel
- [~] E.3 在 `shared/blueprint/index.ts` 新增 re-export
- [ ] E.4 创建 `server/routes/blueprint/preview-audit/detectors.ts`：三类造假检测纯函数
  - [~] E.4.1 detectFallbackFraud：source === "fallback" AND ok === true
  - [~] E.4.2 detectFakeSuccess：ok === true AND (errorIndicators 非空 OR fileSize < 1024)
  - [~] E.4.3 detectDuplicates：同 job 内 contentHash 相同的图
- [ ] E.5 创建 `server/routes/blueprint/preview-audit/service.ts`：createPreviewAuditService(ctx)
  - [~] E.5.1 auditPreviews() 跑三个 detector
  - [~] E.5.2 checksLedger.recordCheck(preview_audit)
  - [~] E.5.3 fail 时 emit preview_audit.regenerate_requested 事件
  - [~] E.5.4 retryCount >= maxRetries 时标记永久失败
- [ ] E.5b 创建回炉消费方 `server/routes/blueprint/preview-audit/regeneration-handler.ts`（R14.4 闭环落地）
  - [~] E.5b.1 订阅 `preview_audit.regenerate_requested` 事件
  - [~] E.5b.2 对每个 failedImageId 调用 `ctx.effectPreviewImageService`（走 F 的真生成路径）重新生成
  - [~] E.5b.3 重生成后重新调用 auditPreviews() 复审，retryCount 递增
  - [~] E.5b.4 复审仍 fail 且 retryCount >= maxRetries → 标永久失败、记台账、不再 emit（防死循环）
  - [~] E.5b.5 在 buildBlueprintServiceContext 中接线该订阅者（env gate 关闭时不订阅）
- [~] E.6 在 `BlueprintServiceContext` 新增 `previewAuditService?`
- [~] E.7 在 `buildBlueprintServiceContext()` 按 env gate 装配
- [~] E.8 在 effect_preview 阶段完成后调用 auditPreviews()
- [~] E.9 单元测试：三类 detector 边界、回炉计数、maxRetries 永久失败、台账写入

## Phase 6: 兼容性验证

- [~] V.1 运行现有 blueprint-routes.test.ts 全部用例（所有新 env gate 关闭时）
- [~] V.2 验证旧 job JSON 无新必填字段回归
- [~] V.3 验证 spec-tree schema 校验行为不变（业务不变量是独立软检查，不影响 superRefine）
