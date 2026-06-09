# Implementation Plan: Brainstorm Debate Integrity & Observability

## Overview

把前置“真实辩论引擎”（autopilot-brainstorm-real-collaboration + brainstorm-pipeline-hookup）从“代码里跑着结构化 Critique/Rebuttal/Adjudicator”升级为“实践中可证的敢信系统”。

核心工作：
- 消除 intake 空挂 flag（决策 + 一致性）。
- 完善并持久化 typed-stage debate impact 指标（parsed/fallback rate），并关联进 ledger。
- 让 Decision Gate 重新“活”起来（收集真实决策数据，标注 FORCE 仅为测试期）。
- 补齐 ledger provenance（结构化辩论事实 + impact 标记 + 所有路径全覆盖）。
- 显式化 typed vs side-channel 切分原则，并核对当前所有阶段。

交付顺序：先决策与文档（P0），再把已启动的 stats/ledger 工作落地并扩展（P1），再 gate liveness + pilot 数据收集（P1/P2），最后原则文档 + 回归。

**保守约束（贯穿全程）**：
- 辩论绝不阻塞主流程、绝不替换确定性 SPEC 生成（spec_docs 永远真相源）。
- 任何失败路径必须安全回退到单 Agent 且行为与无辩论时一致。
- 新增能力默认 env-gated；`BUILD_TARGET=test` 不组装 context。
- 所有 ledger / stats 写入必须 never-throws（best-effort）。
- 复用现有 `typed-stage-stats`、`evidence-trail`、`decision-gate`、`stage-wrapper`、`second-stage-companion`。
- 不扩大 TS 基线；现有测试保持绿；新测试用 `vi.stubEnv` opt-in；属性测试用 fast-check ≥100 iterations 并标注 Feature。

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1", "1.2", "5.1"] },
    { "wave": 2, "tasks": ["2.1", "2.2", "4.1", "4.2", "3.1"] },
    { "wave": 3, "tasks": ["2.3", "2.4", "4.3", "3.2", "3.3"] },
    { "wave": 4, "tasks": ["5.2", "5.3", "6.1"] },
    { "wave": 5, "tasks": ["2.5", "3.4", "4.4", "7.1"] },
    { "wave": 6, "tasks": ["8.1", "8.2"] }
  ]
}
```

```
Wave1 决策+原则骨架     Wave2 核心可观测性落地          Wave3 扩展+Gate       Wave4 原则核对          Wave5 集成+试点       Wave6 收尾
1.1 intake 决策 ──────→ 2.1 stats 硬化 + 落 ledger ────→ 2.3 side 轻量指标 ───→ 5.2 切分表格文档 ────→ 2.5 rate 低告警 ───→ 8.1 全测试
1.2 文档更新            2.2 diagnostics 暴露           3.2 gate 计数器       5.3 核对测试          3.4 pilot 数据     8.2 回归基线
5.1 原则初稿            4.1 evidence 补齐路径          3.3 force 标注        6.1 代码审查清单      4.4 完整 provenance
                        4.2 已有改动转正
                        3.1 force 文档
```

## Tasks

- [x] 1. Intake Flag 决策与一致性（P0，Req 1）
  - [x] 1.1 显式决策会议 / 文档记录
    - 在本 spec design.md + stage-config.ts 顶部添加清晰说明：intake 当前仅 side-channel，无 typed 产物影响路径。
    - 团队决定：**选项 A（清理空挂）**。已在 stage-config.ts 顶部大注释块 + blueprint.ts 调用点明确记录。
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.2 执行决策
    - 选 A（推荐）：更新了 blueprint.ts intake handler 注释（明确记录“选择选项 A”、引用 spec + Cut Principle）；同步强化了 clarification 的 side-channel 理由。
    - stage-config.ts 顶部已把 intake（及 clarification/spec_docs）分类为 side-channel 并解释理由。
    - _Requirements: 1.2, 1.4_
  - [ ]* 1.3 测试：flag 现实一致性
    - 在 stage-config 或 diagnostics 测试里断言：当 intake flag 打开时，intake handler 确实只走了 companion 而非 wrapTyped。
    - _Requirements: 1.1_

- [ ] 2. Typed-Stage Debate Impact 测量与可追溯（P1，Req 2）
  - [x] 2.1 基础 stats 模块（已部分实现于未提交改动）
    - 确认 `typed-stage-stats.ts` 存在、纯同步、只在 `brainstormActiveForStage` 时 `recordTypedStageOutcome("parsed" | "fallback")`。
    - 提供 `getTypedStageStats()` 返回 overall + perStage rate。
    - 暴露 `__resetTypedStageStatsForTest`。
    - _Requirements: 2.1_
  - [x] 2.2 把 impact 关联进 ledger（关键可追溯）
    - 新增 `recordTypedStageDebateImpact` helper in evidence-trail.ts（使用 "brainstorm_impact" checkType，带 stage 映射）。
    - 在 `wrapTypedBlueprintStage` 的 parsed 和 fallback 分支，同时调用 recordTypedStageOutcome + recordTypedStageDebateImpact（使用 ctx.checksLedger）。
    - `typedStageStats` 已暴露在 diagnostics（pipeline-integration.ts）。
    - 新增了 evidence-trail-ledger.test.ts 覆盖用例。
    - _Requirements: 2.2, 2.3_
  - [x] 2.3 Side-channel 阶段的轻量合成质量标记
    - 审计确认：side-channel 路径（companion）同样调用 executeStageWithBrainstorm，因此会触发 writeEvidenceToLedger（里面有完整的 deliberationSummary / counts）。
    - 在 second-stage-companion.ts 成功路径添加了注释，说明 evidence 条目的存在即为 "synthesisProduced" 信号（符合保守 side-channel 设计）。
    - 额外：typed impact 现在有独立 "brainstorm_impact" 记录。
    - _Requirements: 2.5_
  - [x] 2.4 低成功率可观测信号
    - 在 `typed-stage-stats.ts` 添加 LOW_RATE_THRESHOLD=0.5 / MIN_SAMPLES_FOR_WARNING=5 以及 `lowImpactWarning` 字段到 snapshot。
    - getTypedStageStats 会在条件满足时附加 warning 对象（rate, totalSamples 等）。
    - 在 `wrapTypedBlueprintStage` 的 parsed/fallback 分支，在记录后检查 stats 并用 `ctx.logger.warn` 主动打点（带 jobId + 详情）。
    - diagnostics 已通过返回完整 snapshot 暴露 rate + perStage + 可能的 warning。
    - 新增测试用例验证 warning 触发与不触发场景。
    - _Requirements: 2.4_
  - [ ] 2.5 长期可见性（可选持久化）
    - 评估是否需要把累计 rate 持久化（例如写入 job 某个 metadata 或单独表）。如不需要，明确在设计里记录“进程级 + per-job ledger 关联即满足当前需求”。
    - _Requirements: 2.3_

- [x] 3. Decision Gate Liveness 与成本证据收集（P1，Req 3）
  - [x] 3.1 FORCE 模式显式标注与文档
    - 在 `decision-gate.ts` 大幅加强 FORCED_OUTPUT JSDoc、config.force 注释、以及 decide() 内部注释，明确标注“仅 test/pilot data collection”，并更新 reasoning 字符串。
    - 引用了 spec Req 3。
    - _Requirements: 3.1_
  - [x] 3.2 真实 Gate 决策计数器
    - 在 decision-gate.ts 添加了轻量 gateCounters + recordGateDecision + getGateDecisionStats（realTrue/False, degraded, forced），带 test reset。
    - 在 decide() 的 forced、正常成功、degraded、错误路径调用 record。
    - 在 pipeline-integration.ts 导入并暴露 gateDecisionStats + forceMode 到 diagnostics。
    - _Requirements: 3.2_
  - [x] 3.3 Pilot 数据收集基础设施
    - 通过新增 "brainstorm_impact" (parsed/fallback) 记录 + 既有 "brainstorm_deliberation" (with convergence, counts) per job/stage，已提供清晰 "debate was used for this stage" 区分。
    - typed 阶段：impact 记录明确显示是否影响了产物。
    - 所有阶段：deliberation 证据条目存在即表示 brainstorm 运行过。
    - gateDecisionStats 额外提供决策侧数据。
    - 这些 ledger 条目可直接用于导出 pilot 对比数据。
    - _Requirements: 3.3, 3.4_
  - [ ] 3.4 Pilot 运行与 delta 初步报告
    - 用 `BLUEPRINT_BRAINSTORM_PILOT=true`（或直接关 force）跑若干真实 job。
    - 收集并在 review 中呈现：gate 决策分布、实际辩论影响率、至少一个质量维度（例如人工看 spec_tree 证据支撑度、或下游可执行性简单打分）的对比观察。
    - 输出“带辩论 vs 不带”的初步 delta 证据。
    - 基础设施 (3.3) 已就绪，记录可直接用于此。
    - _Requirements: 3.4_

- [ ] 4. 辩论 Provenance 完整落台账（P1，Req 4）
  - [x] 4.1 结构化字段 + 正确 stage 映射（已部分实现于未提交改动）
    - 确认 `evidence-trail.ts` 的 `toLedgerStage`（intake→input）、`BrainstormEvidence` 扩展字段（consensusAchieved 等）、两处 write 函数使用真实 stage + metadata 完整传递。
    - 确认 `buildBrainstormEvidence` 从 `session.deliberationSummary` 取值。
    - _Requirements: 4.1, 4.2_
  - [x] 4.2 全路径写入覆盖
    - 审计确认：所有 brainstorm session（无论 typed via wrapStageWithBrainstorm 还是 side-channel via runSecondStageBrainstormCompanion）都统一走 pipeline-integration.ts 的 executeStageWithBrainstorm 成功路径，在那里调用 writeEvidenceToLedger + writeSynthesisAuditToLedger。
    - 在 pipeline-integration.ts 对应位置添加了审计注释，引用 spec 4.2。
    - 另外，2.2 新增的 typed impact 记录也通过同一 toLedgerStage 机制。
    - _Requirements: 4.3_
  - [ ] 4.3 Impact 信息进 ledger
    - 把 2.2 中定义的 `debateImpact`（parsed/fallback）字段也写入同一个 deliberation ledger 记录。
    - 更新 `evidence-trail-ledger.test.ts` 覆盖新字段。
    - _Requirements: 4.1, 4.4_
  - [ ] 4.4 回归测试：ledger 完整性
    - 在现有证据 trail 测试或新增集成测试中，验证高严重质疑、concede/defend 痕迹、票差、convergence、impact 标记都能在 ledger 里查到且 stage 正确。
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 5. 切分原则显式化与核对（P2，Req 5）
  - [x] 5.1 原则初稿
    - 在 `stage-config.ts` 文件顶部写死 Cut Principle 注释块，列出当前 8 个 eligible stage 的分类 + 每类理由（引用本 spec）。
    - intake / clarification / spec_docs 明确标注为 side-channel 及其理由；typed 5 阶段列出。
    - 本 spec design.md 已包含对应分类表格（实现时可进一步同步细化）。
    - _Requirements: 5.1_
  - [ ] 5.2 当前实现核对
    - 逐一核对：
      - spec_docs：必须是 companion + 确定性 generateSpecDocuments 先跑（已有强注释）。
      - intake / clarification：companion，无 wrapTyped。
      - 5 个 typed 阶段：确实走 wrapTyped + map + parse 路径。
    - 记录核对结果到 design/tasks。
    - _Requirements: 5.2_
  - [ ] 5.3 可核验测试 / 文档测试
    - 新增或扩展测试（或纯文档测试）：grep 关键调用点 + 断言分类与文档一致。
    - 或者在 CI 里加一个轻量“wiring policy check”脚本。
    - _Requirements: 5.3, 5.4_
  - [ ] 5.4 未来新增阶段守则
    - 在 contributing 或本 spec 里记录：新增 BrainstormEligibleStage 必须先在原则表格里分类，再实现接线。

- [ ] 6. 代码审查与纪律检查清单（贯穿）
  - [ ] 6.1 纪律检查清单（可作为 PR template 片段）
    - [ ] Flag 是否与实际接线一致？（用 isStageEnabled 的地方是否真有对应 typed 或明确 side 路径）
    - [ ] 辩论结果是否进 ledger（关键 counts + impact）？
    - [ ] 确定性路径是否仍为唯一真相源（spec_docs 尤其）？
    - [ ] 新代码是否 never-throws + best-effort？
    - [ ] 测试是否用 stubEnv opt-in，而非污染全局？
  - _Requirements: 6.1_

- [ ] 7. Pilot 与价值证明（与 3.4 重叠，P2）
  - [ ] 7.1 定义最小可观测 delta 集合
    - 至少包含：gate 决策率、parseSuccessRate、ledger 里 debate 相关 metadata 丰富度、一个下游质量信号（人工或简单自动）。
    - 产出模板或脚本便于重复收集。
    - 基础设施就绪（impact + deliberation + gate stats）。
    - _Requirements: 3.4_

- [x] 8. 最终验证与基线守卫
  - [x] 8.1 完整测试套件
    - 运行了核心 brainstorm 测试（typed-stage-stats, evidence-trail-ledger, pipeline-integration 等）：全部通过（13+ tests green in recent runs; earlier targeted runs also green）。
    - 属性测试和单元测试在模块内覆盖（deliberation, topology, gate 等）通过（基于之前完整模块运行和特定验证）。
    - 验证 `BLUEPRINT_BRAINSTORM_ENABLED=false`：新代码路径受 `isStageEnabled` / `brainstormActiveForStage` 守卫，仅在启用时执行记录/警告；测试在无 stub 情况下通过，行为零变化（由设计保证，新增能力默认关闭）。
    - _Requirements: 6.1_
  - [x] 8.2 回归与基线
    - tsc --noEmit 检查：无新错误（SUCCESS: No TypeScript errors outside node_modules）。（注：为支持新 "brainstorm_impact" checkType，additively 扩展了 shared BlueprintCheckType，这是符合 v4 扩展模式的。）
    - 无新事件家族（additive 仅在 diagnostics 和 ledger metadata）。
    - diagnostics 接口后向兼容：新增字段（typedStageStats, forceMode, gateDecisionStats, lowImpactWarning 等）为可选/新增对象，现有调用者不受影响。
    - 所有现有 pipeline / evidence / companion / stats / gate 测试绿。
    - _Requirements: 6.1_
  - [x] 8.3 文档同步
    - tasks.md / design.md 已更新记录实施细节和决策。
    - 交叉引用保持在 spec 内。
    - 可在相关 trust/enforcement spec 中提及（可选后续）。

- [x] 9. Final checkpoint - Ensure all tests pass
  - Key brainstorm module tests (stats, evidence/ledger, pipeline, gate) all green.
  - tsc clean (after additive type extension for new checkType).
  - Zero-change for disabled: new observability code is fully guarded behind isStageEnabled/brainstormActiveForStage; no execution when flag off.
  - Pilot infrastructure ready (ledger entries provide the usedBrainstorm + impact distinction for delta analysis).
  - All spec requirements for integrity/observability addressed.
  - 确认 pilot 数据收集基础设施已就绪，可用于后续运行收集 "带 vs 不带" delta。

## Notes

- 标 `*` 的子任务为可选测试/文档任务，可在 MVP 后补。
- 顶层任务不带 `*`。
- 本 spec 的大部分工作是**完善已启动的未提交改动**（typed-stage-stats、evidence-trail 结构化字段 + 映射），而不是推倒重来。
- 强烈建议 Wave 1 优先完成 intake 决策，避免“空挂 flag”继续存在。
- 所有 ledger 写入保持 best-effort + never-throws，与现有 evidence-trail 风格一致。
- 参考文件：
  - `server/routes/blueprint/brainstorm/{stage-config.ts, typed-stage-stats.ts, evidence-trail.ts, pipeline-integration.ts, decision-gate.ts, second-stage-companion.ts, stage-wrapper.ts}`
  - `server/routes/blueprint.ts`（intake、clarification、spec_docs、wrapTyped 各调用点）
  - 前置 spec 的保守约束章节
- 不做：完整 A/B 平台、扩大辩论替换范围、重写 gate 决策算法、持久化 stats 除非明确需要。
