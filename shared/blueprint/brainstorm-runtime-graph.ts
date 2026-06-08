/**
 * Shared contract for autonomous brainstorm runtime graph events.
 *
 * The LLM may propose decisions, but the runtime owns edge evaluation and
 * transition records. The 3D wall can then render real topology instead of
 * inferring a graph from stage artifacts.
 */

export type BrainstormRuntimeGraphStage =
  | "route_generation"
  | "spec_tree"
  | "spec_documents"
  | "spec_docs"
  | "effect_preview"
  | string;

export type BrainstormDecisionMarker =
  | "BRANCH"
  | "CHALLENGE"
  | "SUPPORT"
  | "CONTINUE"
  | "STOP"
  | "SYNTHESIZE"
  | "TOOL";

export type BrainstormRuntimeGraphEventType =
  | "decision.marker.emitted"
  | "edge.condition.evaluated"
  | "edge.triggered"
  | "edge.suppressed"
  | "tool.action.selected"
  | "loop.continued"
  | "loop.stopped"
  | "synthesis.started"
  | "synthesis.completed";

export interface BrainstormRuntimeGraphBaseEvent {
  id: string;
  type: BrainstormRuntimeGraphEventType;
  jobId: string;
  sessionId: string;
  stage: BrainstormRuntimeGraphStage;
  occurredAt: string;
  roleId?: string;
  nodeId?: string;
  parentNodeId?: string | null;
  roundNumber?: number;
  summary?: string;
  confidence?: number;
}

export interface BrainstormDecisionMarkerEmittedEvent
  extends BrainstormRuntimeGraphBaseEvent {
  type: "decision.marker.emitted";
  marker: BrainstormDecisionMarker;
  rationale?: string;
  targetRoleId?: string;
  targetNodeId?: string;
}

export interface BrainstormEdgeConditionEvaluatedEvent
  extends BrainstormRuntimeGraphBaseEvent {
  type: "edge.condition.evaluated";
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition: string;
  matched: boolean;
  reason?: string;
}

export interface BrainstormEdgeTriggeredEvent
  extends BrainstormRuntimeGraphBaseEvent {
  type: "edge.triggered";
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  reason?: string;
}

export interface BrainstormEdgeSuppressedEvent
  extends BrainstormRuntimeGraphBaseEvent {
  type: "edge.suppressed";
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  reason: string;
}

export interface BrainstormToolActionSelectedEvent
  extends BrainstormRuntimeGraphBaseEvent {
  type: "tool.action.selected";
  toolId: string;
  actionInput?: unknown;
  rationale?: string;
}

export interface BrainstormLoopContinuedEvent
  extends BrainstormRuntimeGraphBaseEvent {
  type: "loop.continued";
  nextRoundNumber: number;
  reason?: string;
}

export interface BrainstormLoopStoppedEvent
  extends BrainstormRuntimeGraphBaseEvent {
  type: "loop.stopped";
  reason: string;
}

export interface BrainstormSynthesisStartedEvent
  extends BrainstormRuntimeGraphBaseEvent {
  type: "synthesis.started";
  sourceNodeIds: string[];
}

export interface BrainstormSynthesisCompletedEvent
  extends BrainstormRuntimeGraphBaseEvent {
  type: "synthesis.completed";
  sourceNodeIds: string[];
  synthesisNodeId: string;
  summary: string;
}

export type BrainstormRuntimeGraphEvent =
  | BrainstormDecisionMarkerEmittedEvent
  | BrainstormEdgeConditionEvaluatedEvent
  | BrainstormEdgeTriggeredEvent
  | BrainstormEdgeSuppressedEvent
  | BrainstormToolActionSelectedEvent
  | BrainstormLoopContinuedEvent
  | BrainstormLoopStoppedEvent
  | BrainstormSynthesisStartedEvent
  | BrainstormSynthesisCompletedEvent;

export function isBrainstormRuntimeGraphEvent(
  value: unknown
): value is BrainstormRuntimeGraphEvent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.type === "string" &&
    typeof record.jobId === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.stage === "string" &&
    typeof record.occurredAt === "string" &&
    [
      "decision.marker.emitted",
      "edge.condition.evaluated",
      "edge.triggered",
      "edge.suppressed",
      "tool.action.selected",
      "loop.continued",
      "loop.stopped",
      "synthesis.started",
      "synthesis.completed",
    ].includes(record.type)
  );
}
