# Requirements Document

Brainstorm Debate Integrity & Observability — 把真实多智能体辩论从“代码里是真的”升级为“实践中可证是真的”，落实“敢信”纪律：不信开关只认接线、必须量影响、Decision Gate 真决策、关键事实进台账、切分有原则。

## Introduction

前置工作（`autopilot-brainstorm-real-collaboration` + `brainstorm-pipeline-hookup`）已把 deliberation 从正则启发式升级为结构化 Critique → Rebuttal（concede/defend）→ 主模型 Adjudicator + 多数投票，并通过 `wrapTypedBlueprintStage` / `runSecondStageBrainstormCompanion` 接线到 autopilot 管线。

但 review 指出：**工程实现漂亮，接线纪律与可观测性仍不足**，导致“代码里在跑辩论”和“辩论真在影响产物 / 值得这个成本”之间存在 gap。这直接违背产品论点（别人生成得漂亮，我敢信）。

本 spec 目标是**把“敢信”用在自己辩论系统上**：
- Flag 与真实接线必须一致（不留“空挂”开关谎报行为）。
- 必须持续测量辩论是否真的改变了 typed 产物（parse success rate / fallback rate）。
- Decision Gate 必须真去决策（而非长期 FORCE=true 全开）。
- 辩论的关键产出（high-severity 质疑、concede/defend、margin、convergence、counts）必须作为 provenance 落入 checks_ledger。
- 每个阶段的 typed-stage vs side-channel 切分必须是**有原则的**（确定性必须赢的走 side-channel；辩论能安全改进产物的走 typed），且被文档化 + 可核验。

保守约束不变：辩论绝不阻塞、绝不替换确定性 SPEC 生成（spec_docs 永远是真相源）、绝不抛错、env-gated、`BUILD_TARGET=test` 默认关闭。所有改动 additive 或严格后向兼容。

## Glossary

- **空挂 Flag**：config 里 `BRAINSTORM_STAGE_*_ENABLED=true`，但对应 stage 没有能让辩论结论影响 typed 产物的接线（仅 side-channel 打墙）。
- **Typed-Stage**：走 `wrapTypedBlueprintStage` 的阶段，辩论 synthesis 经 map + parse 后可成为该阶段的正式输出（失败则回退确定性单 Agent）。
- **Side-Channel / 伴随 companion**：走 `runSecondStageBrainstormCompanion` 的阶段，辩论只产出事件 + 墙投影 + ledger audit，输出被显式丢弃，确定性路径永远是唯一真相源。
- **Debate Impact**：`parseSuccessRate = parsed / (parsed + fallback)`，仅在 brainstorm 真正 enable 时计数，反映“辩论结论真的进入了产物”的比例。
- **Decision Gate Liveness**：非 FORCE 模式下，`decide()` 真正调用 LLM 并根据上下文返回 `brainstormNeeded` 的真实决策率。
- **Provenance Metadata**：写进 `checks_ledger` 的 `brainstorm_deliberation` / `companion_trace` 的结构化字段（critiqueCount、unresolvedChallengeCount、consensusAchieved、convergenceScore 等）。
- **Cut Principle**：确定性必须赢（交互式、太早、或替换风险极高）的阶段走 side-channel；辩论能安全且有价值地改进结构化产物的阶段走 typed-stage。

## Requirements

### Requirement 1: Intake（及早期阶段）Flag 现实一致性
**User Story:** 作为平台维护者，我不希望存在“config 说开了但实际上辩论只打墙不影响产物”的空挂 flag，那会让系统对自己说谎。

#### Acceptance Criteria
1. WHEN 检查 `BRAINSTORM_STAGE_INTAKE_ENABLED`，THE system SHALL 清晰记录该 flag 当前仅控制 side-channel（`runSecondStageBrainstormCompanion`），且 intake 阶段**没有** typed 路径让辩论输出喂入任何正式 intake 产物。
2. THE team SHALL 做出显式决策：要么为 intake 辩论补充有价值的 typed 影响路径（并更新接线），要么关闭/移除 `BRAINSTORM_STAGE_INTAKE_ENABLED` 相关配置与注释，使 config 与现实 1:1。
3. Clarification 阶段的 side-channel 决策 SHALL 被显式确认并记录原因（交互式、价值评估、性能考量等）。
4. 任何决定（接线或关闭）必须在 stage-config.ts、blueprint.ts 调用点、以及本 spec 的 design 中有对应文档。

### Requirement 2: Typed-Stage Debate Impact 可测量且可追溯
**User Story:** 作为平台，我必须能回答“开了辩论后，我们是不是真的在花 5 个 key 跑辩论，最后大多还是确定性输出？”否则辩论就是昂贵的摆设。

#### Acceptance Criteria
1. `typed-stage-stats.ts` 必须持续存在并只在 `isStageEnabled && brainstormContext` 时记录 `parsed` / `fallback`（已部分实现）。
2. `parseSuccessRate`（整体 + per-stage）必须暴露在 diagnostics 接口（已部分实现）。
3. 关键的 debate impact 结果（当次 stage 是 parsed 还是 fallback、当前累计 rate）**必须**作为 provenance 关联写进该 job/stage 的 `checks_ledger`（至少一条 `brainstorm_deliberation` 或 companion_trace）。
4. 当 parseSuccessRate 长期过低（例如连续 N 个 job < 阈值）时，系统应有可观测信号（日志 / 诊断 / 建议），便于调查 prompt、mapper 或模型问题。
5. Side-channel 阶段（intake、clarification、spec_docs）也应有“synthesis 是否产生可消费结论”的轻量指标或至少在 ledger 里体现合成质量。

### Requirement 3: Decision Gate 真正决策（非永久 FORCE）
**User Story:** 作为产品负责人，我需要在上线前看到“带辩论 vs 不带辩论”在规格质量/可信度上的可测 delta，而不是永远全量 5 辅 1 主。

#### Acceptance Criteria
1. `decision-gate.ts` 的 FORCE 路径（`BLUEPRINT_BRAINSTORM_FORCE=true`）必须被明确标注为**仅测试/数据收集期**使用。
2. 非 FORCE 模式下，Decision Gate 必须真实运行 LLM decide，并产生可收集的决策分布（brainstormNeeded true/false 比例、degraded 时的行为）。
3. 必须开始收集并可查询“带真实辩论的 stage 执行” vs “单 Agent”的质量/信任指标（至少在 spec_tree / route_generation / engineering_handoff 上有 pilot 数据或人工评审打分）。
4. 上线策略必须要求：生产环境默认不使用永久 FORCE，gate 必须有实际决策权（或受控采样率）。

### Requirement 4: 辩论关键产出完整进台账（Provenance）
**User Story:** 作为审计者，我希望能查询“这个 spec_tree 节点是扛过 high-severity 质疑、defend 后裁决收敛 0.82 留下来的”，而不是只看到过程跑完就蒸发。

#### Acceptance Criteria
1. `buildBrainstormEvidence` / `writeEvidenceToLedger` / `writeSynthesisAuditToLedger` 必须把 deliberationSummary 的结构化事实（consensusAchieved、totalChallenges、unresolvedChallengeCount、critiqueCount、rebuttalCount、adjudicationCount、finalConvergenceScore 等）完整写入 ledger metadata（部分已实现）。
2. Stage 必须正确映射（intake → input，其它 1:1 或安全 fallback），不再硬编码 "spec_docs"（已部分实现）。
3. 所有真正跑过 brainstorm 的路径（typed + side-channel companion）都必须走到证据写入逻辑。
4. 新增的 typed-stage impact（parsed/fallback）信息也应被关联进同一 ledger 记录。

### Requirement 5: Typed vs Side-Channel 切分原则化、可核验
**User Story:** 作为后续维护者，我需要明确知道每个阶段为什么走这一条路，而不是“碰巧这样接的”。

#### Acceptance Criteria
1. 必须在文档（本 spec design + stage-config.ts 或 pipeline-integration.ts 顶部）显式声明 Cut Principle：“确定性必须赢的地方走 side-channel；辩论能安全改进产物的地方走 typed-stage”。
2. 当前切分必须被核对并记录理由：
   - spec_docs：保守，永远 side-channel（确定性永远是真相源）。
   - intake / clarification：早期、无 job、交互式 → side-channel。
   - route_generation / spec_tree / effect_preview / prompt_packaging / engineering_handoff：结构化产物可被安全改进 → typed。
3. 如未来新增阶段或调整，必须遵循同一原则并更新文档 + 测试。
4. 原则的遵守情况应可通过代码审查或简单 grep/测试快速核验。

### Requirement 6: 工程基线与保守约束
所有改动必须满足：
- 绝不抛错（never-throws + 安全回退）。
- 辩论失败或解析失败时，确定性单 Agent 产物字节级为准。
- `BLUEPRINT_BRAINSTORM_ENABLED != "true"` 或 per-stage 关闭时，行为与无辩论版本一致（零变化回退）。
- `BUILD_TARGET=test` 默认不组装 brainstormContext。
- 不扩大 TypeScript 编译错误基线。
- 现有测试（包括 property tests）保持绿；新增能力用 `vi.stubEnv` 显式 opt-in。
- 优先复用既有 `typed-stage-stats`、`evidence-trail`、`decision-gate`、`stage-wrapper` 等模块。

## References
- `autopilot-brainstorm-real-collaboration` / `brainstorm-pipeline-hookup` / `autopilot-brainstorm-companion-runtime`
- `blueprint-checks-ledger`
- `blueprint-trust-enforcement-model`
- 当前代码：`server/routes/blueprint/brainstorm/{stage-config.ts,typed-stage-stats.ts,evidence-trail.ts,pipeline-integration.ts,decision-gate.ts,second-stage-companion.ts,stage-wrapper.ts}`
- `server/routes/blueprint.ts` 中的 intake/clarification/spec_docs/route... 接线点
- Review feedback on "敢信" 纪律（flag 接线分离、影响率打点、FORCE 决策、ledger provenance、切分原则）
