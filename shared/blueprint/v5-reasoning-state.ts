/**
 * V5 Reasoning State & Artifact contracts (能力池定型版).
 *
 * 这些类型将 "目标驱动的能力调用网络" 正式定型为可实现的运行时模型。
 * 核心修复：信任层（gate + provenance + ledger）进入运行时 schema；
 * 失效引擎升为一等公民（写进 orchestrateReasoningTurn 主循环）；
 * 调度单元明确为 (capability, role) 对。
 *
 * 详见 docs/WhyBuddyV5CapabilityPool.md 和 docs/WhyBuddyV5闭环总图_完整版.md
 */

import type { V5CapabilityId } from "./contracts.js";
import type { BrainstormReasoningGraph } from "./brainstorm-reasoning-graph.js";

export type { V5CapabilityId };

export interface Artifact {
  id: string;
  kind:
    | "clarification"
    | "route_options"
    | "spec_tree"
    | "doc"
    | "preview"
    | "evidence"
    | "risk"
    | "decision"
    | "synthesis"
    | "report"
    | "plan";
  /** 三级 provenance，与 v4/v5 护城河对齐 */
  provenance:
    | "ai_generated"
    | "rendered_chart_mcp"
    | "rendered_screenshot"
    | "llm"
    | "llm_fallback"
    | "template";
  /** 只有 gated_pass / audited 才能被报告引用为“已证明” */
  trustLevel: "untrusted" | "gated_pass" | "audited";
  producedBy: {
    capabilityRunId: string;
    capabilityId: V5CapabilityId;
    roleId?: string;
  };
  passedGates: string[];
  evidenceRefs?: string[];
  /** V5: 真实内容片段，用于 report/synthesis 聚合展示（从上游 artifact 抽取结论/证据/反证） */
  title?: string;
  summary?: string;
  content?: string;
}

export interface GateState {
  gateId:
    | "schema"
    | "invariant"
    | "confirm"
    | "decision"
    | "merge"
    | "previews_real"
    // Actual values written by commitArtifact / evaluateGates (Trust Layer)
    | "precondition"
    | "commit";
  kind: "precondition" | "commit"; // 运行前置闸 or 产物提交闸
  status: "open" | "passed" | "failed";
  evaluatedAt?: string;
}

export interface CapabilityRun {
  id: string;
  capabilityId: V5CapabilityId;
  roleId?: string; // (capability, role) 对
  inputs: string[]; // 依赖的 artifactId
  outputs: string[]; // 产出的 artifactId
  gateResults: { gateId: string; status: "passed" | "failed" }[];
  ledgerEntryId?: string; // 台账留痕
  turnId: string;
}

export interface DependencyEdge {
  fromArtifactId: string;
  toArtifactId: string;
  reason: string;
}

export interface V5SessionState {
  goal: {
    text: string;
    status: "clear" | "needs_refinement" | "not_recommended";
  };
  graph: BrainstormReasoningGraph; // capability invocation graph (strict)
  artifacts: Artifact[];
  conversation: Array<{ id: string; role: string; text: string; timestamp?: string }>;
  openQuestions: Array<{ id: string; text: string }>;
  evidence: any[];
  decisions: any[];
  risks: any[];
  capabilityRuns: CapabilityRun[];
  /** V5 新增：闸进入运行时状态 */
  gates: GateState[];
  /** V5 新增：失效级联用 */
  dependencyGraph: DependencyEdge[];
  /** V5 新增：被失效引擎标记 */
  staleArtifactIds: string[];
  currentFocus?: { nodeId?: string; artifactId?: string };
  userIntervention?: UserIntervention;

  /** V5 闭环修复（单门 INTAKE + AWAIT 歇脚点 + 按 sessionId 隔离） */
  sessionId?: string;
  runtimePhase?: "idle" | "orchestrating" | "awaiting" | "failed";
  lastTurnId?: string;

  /** V5.1 DLEDGER (P1/A): scheduling decision ledger, appended on every pickNextCapabilities (or special budget block entry). */
  decisionLedger?: SchedulingDecision[];
}

export interface UserIntervention {
  targetArtifactId?: string;
  targetNodeId?: string;
  targetReportSectionId?: string;
  intent:
    | "challenge"
    | "clarify"
    | "expand"
    | "synthesize"
    | "generate_plan"
    | "preview"
    | "compare"
    | "revise";
  text: string;
}

/**
 * orchestrateReasoningTurn 返回的计划（简化版，实际实现会更完整）。
 */
export interface PlannedCapability {
  capabilityId: V5CapabilityId;
  roleId?: string;
  inputArtifactIds: string[];
  expectedArtifactKind?: Artifact["kind"];
}

export interface TurnPlan {
  selected: PlannedCapability[];
  reason: string;
  expectedArtifacts: string[];
}

export interface OrchestrateContext {
  turnId: string;
  userText: string;
  intervention?: UserIntervention;
}

/** V5.1 DLEDGER (P1/A): auditable record of each pickNextCapabilities decision. */
export interface SchedulingDecision {
  id: string;
  turnId: string;
  saw: string[];
  chose: string[];
  skipped: Array<{ capabilityId: string; reason: string }>;
  addresses: string[];
  rationale: string;
  alternativesRejected: string[];
  createdAt: string;
}
