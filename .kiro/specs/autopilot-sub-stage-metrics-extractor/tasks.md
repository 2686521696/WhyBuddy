# 任务：autopilot 子阶段摘要派生器

- [x] 1. 新建文件与类型
  - 创建 `client/src/pages/autopilot/right-rail/sub-stage-summary.ts`
  - 导出 `SubStageMetric` / `SubStageSummary` / `deriveSubStageSummary` 接口

- [x] 2. 实现 `deriveAgentCrewFabric` 派生函数
  - 读取 `agentCrew.roleTimelines / presence`
  - 计算 timelines / events / active / watching / reviewing 数量
  - 中英双语 title / summary / metrics label / hint
  - dataReady = timelines.length > 0

- [x] 3. 实现 `deriveSpecTree` 派生函数
  - 读取 `specTree.nodes`
  - 计算 nodes.length / leaves（无子节点的） / versions（占位 -）
  - dataReady = specTree != null

- [x] 4. 实现 `deriveSpecDocuments` 派生函数
  - 读取 `specTree.documents`
  - 计算 documents.length / 已提交 / 待更新
  - dataReady = specTree?.documents.length > 0

- [x] 5. 实现 `deriveEffectPreview` 派生函数
  - 读取 `effectPreviews`
  - 计算 previews.length / 最新 version / 当前 job.stage
  - dataReady = effectPreviews.length > 0

- [x] 6. 实现 `derivePromptPackage` 派生函数
  - 占位：metrics 全 `-`，dataReady = specTree != null

- [x] 7. 实现 `deriveRuntimeCapability` 派生函数
  - 读取 `capabilities` / `capabilityInvocations` / `capabilityEvidence`
  - 计算三个数组长度作为三个 metric
  - dataReady = 任一数组 length > 0

- [x] 8. 实现 `deriveEngineeringHandoff` 派生函数
  - 占位：metrics 全 `-`，dataReady = selection != null

- [x] 9. 实现 `deriveArtifactMemory` 派生函数
  - 占位：metrics 全 `-`，dataReady = selection != null

- [x] 10. 实现 `deriveSubStageSummary` 主 switch
  - 按 design.md 的 switch 派发到 8 个子函数
  - default 分支使用 `satisfies never`

- [x] 11. 测试：8 个 case 覆盖空 props 场景
  - 每个子阶段用 EMPTY_PROPS 测试，断言 metrics 长度 = 3 / title/apiPath/summary 是字符串 / dataReady 是 boolean

- [x] 12. 测试：8 个 case 覆盖数据就绪场景
  - 每个子阶段构造典型的就绪 props，断言 metrics 值正确且 dataReady = true

- [x] 13. 执行验证
  - `npx vitest run client/src/pages/autopilot/right-rail/__tests__/sub-stage-summary.test.ts` 16+ case 全过
  - `node --run check` TS error 数 = 107

- [x] 14. 提交
  - commit message: `feat(autopilot): add sub-stage summary derivation for rail cards`
  - stage 内容：`client/src/pages/autopilot/right-rail/sub-stage-summary.ts` + `__tests__/sub-stage-summary.test.ts`
  - 禁止 stage `.kiro/blueprint-assets/jobs.json`
