/**
 * Blueprint wall brainstorm reasoning graph contracts.
 *
 * These shared types describe the LLM/runtime-authored reasoning graph
 * consumed by the 3D blueprint wall. They intentionally do not import client
 * or server runtime modules.
 */

export type BrainstormReasoningGraphStage =
  | "spec_tree"
  | "spec_documents"
  | "spec_docs"
  | "effect_preview"
  | string;

export type BrainstormReasoningGraphSource = "llm" | "runtime" | "fallback";

export type BrainstormReasoningNodeType =
  | "question"
  | "clarification"
  | "hypothesis"
  | "evidence"
  | "constraint"
  | "risk"
  | "gap"
  | "decision"
  | "synthesis"
  | "critique"   // reserved for debate-specific consumers (realtime brainstorm store + dedicated overlays / BrainstormWallGraph); Effect/Reasoning Flow projections (brainstorm_reasoning_graph) and walls must strip or not emit these
  | "rebuttal"; // reserved for debate-specific consumers (realtime brainstorm store + dedicated overlays / BrainstormWallGraph); Effect/Reasoning Flow projections (brainstorm_reasoning_graph) and walls must strip or not emit these

export type BrainstormReasoningNodeStatus =
  | "open"
  | "active"
  | "supported"
  | "challenged"
  | "resolved"
  | "failed";

export type BrainstormReasoningEdgeType =
  | "supports"
  | "refines"
  | "conflicts"
  | "cites"
  | "questions"
  | "depends_on"
  | "synthesizes";

export type BrainstormSourceRefKind =
  | "job"
  | "stage"
  | "role"
  | "reasoning_entry"
  | "spec_node"
  | "artifact"
  | "url"
  | "file"
  | "api"
  | "observation";

export interface BrainstormSourceRef {
  kind: BrainstormSourceRefKind;
  id?: string;
  label?: string;
  url?: string;
}

export interface BrainstormCentralQuestion {
  id: string;
  title: string;
  body?: string;
  sourceRefs?: BrainstormSourceRef[];
}

export interface BrainstormReasoningNode {
  id: string;
  type: BrainstormReasoningNodeType;
  title: string;
  body?: string;
  roleId?: string;
  roleLabel?: string;
  status: BrainstormReasoningNodeStatus;
  confidence?: number;
  sourceRefs?: BrainstormSourceRef[];
  order?: number;
}

export interface BrainstormReasoningEdge {
  id: string;
  source: string;
  target: string;
  type: BrainstormReasoningEdgeType;
  label?: string;
  confidence?: number;
  sourceKind?: BrainstormReasoningGraphSource;
}

export interface BrainstormGraphTelemetry {
  tokenBurn?: number | null;
  sourceCount?: number | null;
  elapsedMs?: number | null;
  remainingBudget?: number | null;
  activeRoleCount?: number | null;
}

export type BrainstormGraphConsoleLineKind =
  | "Ask"
  | "Thinking"
  | "Tool"
  | "Observation"
  | "Report"
  | "System";

export interface BrainstormGraphConsoleLine {
  id: string;
  kind: BrainstormGraphConsoleLineKind;
  text: string;
  roleId?: string;
  timestamp?: string;
}

export interface BrainstormReasoningGraph {
  id: string;
  jobId: string;
  stage: BrainstormReasoningGraphStage;
  subStage?: string;
  centralQuestion?: BrainstormCentralQuestion;
  nodes: BrainstormReasoningNode[];
  edges: BrainstormReasoningEdge[];
  telemetry?: BrainstormGraphTelemetry;
  consoleLines?: BrainstormGraphConsoleLine[];
  source: BrainstormReasoningGraphSource;
  createdAt?: string;
  updatedAt?: string;
}

export interface BrainstormReasoningGraphArtifactPayload {
  type: "brainstorm_reasoning_graph";
  stage: BrainstormReasoningGraphStage;
  subStage?: string;
  graph: BrainstormReasoningGraph;
}
