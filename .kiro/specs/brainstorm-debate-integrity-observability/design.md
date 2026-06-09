# Design Document

Brainstorm Debate Integrity & Observability — Close the "敢信" loop: make the real multi-agent debate engine not only run, but provably influence the product and be auditable at acceptable cost.

## Overview

### Problem Statement (grounded in current code + review)

前置实现已经交付了真实的结构化辩论引擎（Critique 必须引用 target 本轮主张、Rebuttal 分 concede/defend、主模型 adjudicator 给 convergenceScore、topology-manager never-throws + 安全回退、P5 属性测试）。

但 review 指出了 5 个“代码里是真的、实践中可能是假”的风险：

1. `BRAINSTORM_STAGE_INTAKE_ENABLED` 在 stage-config.ts 里声明、blueprint.ts intake handler 里也调用了 companion，但 intake 辩论**只走 side-channel**（`runSecondStageBrainstormCompanion`，输出被丢弃，只打 eventBus 墙）。没有 `wrapTypedBlueprintStage` 路径。Flag 处于“空挂”状态。
2. 虽然加了 `typed-stage-stats.ts` 记录 parsed/fallback，但目前只是进程内存 + diagnostics 接口。如果回退频繁，辩论就是昂贵的摆设；而且 side-channel 阶段没有对应影响指标；ledger 里还没有关联“这次 typed 输出是否受辩论影响”。
3. Decision Gate 的 `BLUEPRINT_BRAINSTORM_FORCE` 路径仍然是“永远全开”的最简单路径。测试期没问题，但长期如此就无法证明“开了辩论后规格质量/可信度有 delta”。
4. 虽然 evidence-trail 改动把 deliberationSummary 字段（critiqueCount 等）写进了 ledger，但早期未提交版本是硬编码 stage="spec_docs"，intake 未正确映射；而且 typed impact 还没进台账。
5. 切分（intake/clarification/spec_docs = side，route/spec_tree/... = typed）在代码注释里写得不错（尤其是 spec_docs 那段保守说明），但没有**显式原则声明 + 核对表**，属于“实现上正确”而非“原则上被守住”。

本 spec 的设计原则：**最小改动 + 最大可证性**。优先完善已启动的 stats/ledger 工作，把部分实现变成完整可审计闭环；对 flag 和 gate 做显式决策而非偷偷补线。

### Goals

- 消除空挂 flag（决策 + 一致性）。
- 让“辩论是否真改了产物”成为可查询的持久事实（rate + per-job 关联）。
- 让 Decision Gate 重新获得决策权，并开始产生可用于证明价值的 pilot 数据。
- 让辩论的结构化产出（质疑、表态、收敛、票差）完整成为 checks_ledger 上的 provenance。
- 把 typed vs side-channel 切分从“隐性知识”变成显式、可核验的原则。
- 严格保持保守约束（确定性永远是真相源、非阻塞、never-throws）。

### Non-Goals

- 不扩大辩论的“替换确定性生成”范围（spec_docs 永远 side-channel）。
- 不为 intake 强行发明 typed 路径（除非 review 后确认真有价值）。
- 不做完整的 A/B 实验平台（只做可测量 + pilot 数据收集基础设施）。
- 不改共享契约（除非极小 additive）。
- 不影响现有 3D 墙渲染路径。

## Architecture & Changes

### 1. Intake Flag Decision (Req 1)

**选项 A（推荐先评估）：** 保持 intake 为 side-channel，显式关闭或废弃 `BRAINSTORM_STAGE_INTAKE_ENABLED`（或至少在文档里标注“仅 side-channel，无 typed 影响”）。

**选项 B：** 如果决定 intake 辩论能为后续 clarification / route 提供可消费的 upstream context，则补一条轻量 typed 路径（例如把 deliberationSummary 作为可选的 `intake.debateNotes` 或单独 artifact 注入，后续阶段的 singleAgentFn 可以选择性消费）。但必须走 `wrapTyped...` + 安全 mapper。

当前设计：先做**显式决策任务**（代码注释 + stage-config 文档 + 本 spec 更新），默认走选项 A（清理空挂），除非有强证据支持 B。

调用点确认：
- `server/routes/blueprint.ts:696`：`runSecondStageBrainstormCompanion({ stageId: "intake", ... })`（fire-and-forget，无 onReasoningGraph）。
- 无 `wrapTypedBlueprintStage(..., "intake")`。

### 2. Debate Impact Metrics (Req 2)

现有 `typed-stage-stats.ts`（in-memory, record only when active, getTypedStageStats）已经很好。

**扩展设计**：
- 在 `wrapTypedBlueprintStage` 成功 parse 或 fallback 时，除了记录 stats，还把当次结果（"parsed" | "fallback"）写进当前 stage 的 ledger 记录（通过 `writeEvidenceToLedger` 或新增轻量 trace）。
- 把 `getTypedStageStats()` 的 snapshot 也暴露到 `getBrainstormDiagnostics()`（已部分在未提交改动中）。
- 考虑增加持久化（可选）：每次 typed stage 结束时，把当前累计 rate 作为 `brainstorm_deliberation` metadata 的一个字段；或单独一条 `checkType: "brainstorm_impact"`。
- 对于 side-channel 阶段：在 `runSecondStageBrainstormCompanion` 返回后，如果 `stageResult.type === "brainstorm"`，可以记录一个轻量的 "synthesisProduced" 标记进 ledger（复用现有 evidence 路径）。

文件改动：
- `blueprint.ts`（wrapTyped 里已加 record 调用）
- `pipeline-integration.ts`（diagnostics 暴露，已部分）
- `evidence-trail.ts`（把 impact 信息塞进 metadata）
- `typed-stage-stats.ts`（可能加 `recordImpactForLedger` 辅助或让调用方决定）

### 3. Decision Gate Liveness (Req 3)

**设计**：
- 在 `decision-gate.ts` 的 decide 函数里，FORCE 模式必须 emit 明确事件 `brainstorm.gate.forced`（已有），并在 diagnostics 里暴露 `forceMode: boolean`。
- 新增/扩展 diagnostics：`gateDecisions: { total, forced, realDecidedTrue, realDecidedFalse, degraded }` 或类似（通过简单计数器，类似 typed-stage-stats）。
- 提供一个轻量“pilot 收集开关”（例如 `BLUEPRINT_BRAINSTORM_PILOT=true`），在非 force 时允许 gate 真实跑，并把决策 + 最终是否真的跑了 brainstorm 记录到 ledger。
- 质量 delta 收集：不在这里实现完整评审框架，只保证能区分“本次 stage 用了 brainstorm 还是单 Agent”，并把标记写进 job 的 artifacts 或 ledger，供后续人工/脚本分析（spec_tree 节点可带 `brainstormUsed: true` + convergenceScore）。

### 4. Ledger Provenance Completion (Req 4)

`evidence-trail.ts` 的未提交改动已经做了很大一部分：
- `toLedgerStage` 映射（intake → input）
- 把 `deliberationSummary` 的 counts / consensus / unresolved 塞进 metadata
- 两处 write 函数都用真实 stage

**需要补齐**：
- 确保 side-channel 路径（intake、clarification、spec_docs 的 companion）也可靠走到 `writeEvidenceToLedger` 和 `writeSynthesisAuditToLedger`（目前 companion 内部可能只 emit 事件，ledger 写入在 orchestrator 或 synthesizer 之后？需核对调用链）。
- 把 typed impact（parsed/fallback）也作为 metadata 字段之一。
- 新增 `evidence-trail-ledger.test.ts` 已经覆盖映射和结构化字段（未提交中新增）。

### 5. Cut Principle Explicit (Req 5)

**设计决策**：把原则写死在两个地方：
1. `stage-config.ts` 或新增 `stage-wiring-policy.ts`（轻量）顶部的大注释块，列出当前 8 个 eligible stage 的分类 + 理由。
2. 本 spec 的 design.md 里维护一份表格。

分类（当前实现）：
- Side-channel（输出丢弃，确定性必赢）：
  - intake：太早、无 job、纯输入归一化 → companion
  - clarification：交互式、用户会直接回答问题 → companion
  - spec_docs：**核心保守约束**，确定性 generateSpecDocuments 永远是真相源 → companion（见 blueprint.ts 1770 附近长注释）
- Typed（辩论结论可安全喂产物）：
  - route_generation
  - spec_tree
  - effect_preview
  - prompt_packaging
  - engineering_handoff

未来任何新增 stage 必须先分类，再接线。

可核验方式：grep `wrapTypedBlueprintStage` vs `runSecondStageBrainstormCompanion` 的 stageId 调用 + 文档对照。

### 6. 保守约束与复用

- 所有新计数器、ledger 写入必须 never-throws（用 try/catch + best-effort）。
- 现有 `wrapStageWithBrainstorm` / `second-stage-companion` 的 degrade-to-single-agent 路径不变。
- `typed-stage-stats` 提供 `__reset...ForTest`，测试用。
- 不改 `DecisionGateOutput` 契约（additive 扩展 diagnostics 即可）。
- 优先扩展 `evidence-trail` 和 `pipeline-integration` 的 diagnostics，而不是新建大模块。

## File Change Map (High Level)

- New: `.kiro/specs/brainstorm-debate-integrity-observability/{requirements,design,tasks}.md`
- Modify:
  - `server/routes/blueprint/brainstorm/stage-config.ts`（文档 + 可能清理 intake）
  - `server/routes/blueprint/brainstorm/typed-stage-stats.ts`（可能扩展）
  - `server/routes/blueprint/brainstorm/evidence-trail.ts`（补 impact 字段 + 确认所有路径写入）
  - `server/routes/blueprint/brainstorm/pipeline-integration.ts`（diagnostics + gate 计数）
  - `server/routes/blueprint/brainstorm/decision-gate.ts`（force 标注 + 计数）
  - `server/routes/blueprint.ts`（intake/clarif 注释强化、ledger 关联调用如果缺失、wrapTyped 里 impact 落 ledger）
  - `server/routes/blueprint/brainstorm/second-stage-companion.ts`（可选：synthesis 质量轻量标记）
- Test:
  - 扩展或新增 `typed-stage-stats.test.ts`、`evidence-trail-ledger.test.ts`
  - 新增 gate decision 计数测试
  - 集成：diagnostics 能看到 rate + force 状态 + ledger 里有 impact/provenance
- 可能小改：`blueprint-checks-ledger` 相关类型如果需要（additive）

## Open Decisions (to be closed in tasks)

1. Intake flag：清理还是补轻量 typed 路径？（P0）
   **Decision recorded (Wave 1)**: Chose Option A (explicit side-channel documentation + no typed wiring for now).
   Implemented via comments in `stage-config.ts` (Cut Principle block) and `blueprint.ts` intake/clarification handlers.
   See tasks.md 1.1/1.2 for details. Revisit only if strong evidence emerges that intake debate can safely improve downstream typed artifacts.
2. 质量 delta pilot：用什么最小指标先跑起来？（人工评审 checklist？下游可执行性？convergenceScore 分布？）
3. Ledger 写入点：companion 路径是否已经完整走到 evidence-trail？需要 trace 调用链。
4. 是否引入轻量持久化 rate（跨进程重启可见）？还是先接受进程级 + ledger per-job 就够？

## References

- 代码中的保守注释（blueprint.ts spec_docs 段、second-stage-companion.ts）
- 未提交改动：typed-stage-stats + evidence-trail 结构化字段 + 正确 stage 映射
- 之前 spec 的保守约束章节
- Review 5 点冷水
