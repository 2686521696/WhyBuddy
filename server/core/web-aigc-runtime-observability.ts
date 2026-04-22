import { AuditEventType } from "../../shared/audit/contracts.js";
import type { AgentEvent } from "../../shared/workflow-runtime.js";
import type { ExecutionEvent, ReplayEventType } from "../../shared/replay/contracts.js";

export interface WebAigcRuntimeReplayCollectorLike {
  emit(event: Omit<ExecutionEvent, "eventId" | "timestamp">): void;
}

export interface WebAigcRuntimeAuditCollectorLike {
  record(input: {
    eventType: AuditEventType;
    actor: {
      type: "user" | "agent" | "system";
      id: string;
      name?: string;
    };
    action: string;
    resource: {
      type: string;
      id: string;
      name?: string;
    };
    result: "success" | "failure" | "denied" | "error";
    context?: {
      sessionId?: string;
      requestId?: string;
      sourceIp?: string;
      userAgent?: string;
      organizationId?: string;
    };
    metadata?: Record<string, unknown>;
    lineageId?: string;
  }): void;
}

interface WebAigcRuntimeObservabilityDeps {
  replayCollector?: WebAigcRuntimeReplayCollectorLike | null;
  auditCollector?: WebAigcRuntimeAuditCollectorLike | null;
}

let currentDeps: WebAigcRuntimeObservabilityDeps = {
  replayCollector: null,
  auditCollector: null,
};

export function setWebAigcRuntimeObservabilityDeps(
  deps: WebAigcRuntimeObservabilityDeps,
): void {
  currentDeps = deps;
}

type WebAigcRuntimeEvent = Extract<AgentEvent, { type: "web_aigc_runtime_event" }>;

function mapReplayEventType(eventKey: string): ReplayEventType | undefined {
  switch (eventKey) {
    case "node.started":
      return "AGENT_STARTED";
    case "node.completed":
      return "AGENT_STOPPED";
    case "node.waiting_input":
    case "edge.transitioned":
    case "instance.retry_requested":
    case "instance.escalated":
      return "MILESTONE_REACHED";
    case "node.failed":
    case "instance.terminated":
      return "ERROR_OCCURRED";
    default:
      return undefined;
  }
}

export function toReplayExecutionEvent(
  event: WebAigcRuntimeEvent,
): Omit<ExecutionEvent, "eventId" | "timestamp"> | undefined {
  const replayEventType = mapReplayEventType(event.eventKey);
  if (!replayEventType) {
    return undefined;
  }

  return {
    missionId: event.replayId || event.workflowId,
    eventType: replayEventType,
    sourceAgent: event.nodeId || "web-aigc-runtime",
    targetAgent: event.toNodeId,
    eventData: {
      eventKey: event.eventKey,
      workflowId: event.workflowId,
      instanceId: event.instanceId,
      nodeId: event.nodeId,
      edgeId: event.edgeId,
      fromNodeId: event.fromNodeId,
      toNodeId: event.toNodeId,
      status: event.status,
      waitingFor: event.waitingFor,
      error: event.error,
      checkpointId: event.checkpointId,
      startedAt: event.startedAt,
      completedAt: event.completedAt,
      durationMs: event.durationMs,
      metadata: event.metadata,
    },
    metadata: {
      phase: "web_aigc_runtime",
      stageKey: event.eventKey,
    },
  };
}

export function mirrorWebAigcRuntimeEvent(event: AgentEvent): void {
  if (event.type !== "web_aigc_runtime_event") {
    return;
  }

  const replayEvent = toReplayExecutionEvent(event);
  if (replayEvent && currentDeps.replayCollector) {
    try {
      currentDeps.replayCollector.emit(replayEvent);
    } catch {
      // Replay mirroring must never break runtime events.
    }
  }

  if (!currentDeps.auditCollector) {
    return;
  }

  try {
    if (event.eventKey === "node.failed" || event.eventKey === "instance.terminated") {
      currentDeps.auditCollector.record({
        eventType: AuditEventType.AGENT_FAILED,
        actor: { type: "system", id: "web-aigc-runtime" },
        action:
          event.eventKey === "instance.terminated"
            ? `Runtime instance terminated: ${event.instanceId}`
            : `Runtime node failed: ${event.nodeId || "unknown"}`,
        resource: {
          type: event.eventKey === "instance.terminated" ? "workflow-instance" : "workflow-node",
          id: event.nodeId || event.instanceId,
          name: event.eventKey,
        },
        result: "failure",
        context: {
          sessionId: event.sessionId || event.workflowId,
        },
        metadata: {
          eventKey: event.eventKey,
          workflowId: event.workflowId,
          instanceId: event.instanceId,
          replayId: event.replayId,
          missionId: event.missionId,
          nodeId: event.nodeId,
          error: event.error,
          checkpointId: event.checkpointId,
          durationMs: event.durationMs,
          ...event.metadata,
        },
      });
    } else if (
      event.eventKey === "node.waiting_input" ||
      event.eventKey === "instance.retry_requested" ||
      event.eventKey === "instance.escalated"
    ) {
      currentDeps.auditCollector.record({
        eventType: AuditEventType.DECISION_MADE,
        actor: { type: "system", id: "web-aigc-runtime" },
        action:
          event.eventKey === "instance.retry_requested"
            ? `Runtime retry requested: ${event.nodeId || "unknown"}`
            : event.eventKey === "instance.escalated"
              ? `Runtime escalated for review: ${event.nodeId || "unknown"}`
              : `Runtime node waiting for input: ${event.nodeId || "unknown"}`,
        resource: {
          type:
            event.eventKey === "instance.retry_requested"
              ? "workflow-retry"
              : "workflow-node",
          id: event.nodeId || event.instanceId,
          name: event.eventKey,
        },
        result: "success",
        context: {
          sessionId: event.sessionId || event.workflowId,
        },
        metadata: {
          eventKey: event.eventKey,
          workflowId: event.workflowId,
          instanceId: event.instanceId,
          replayId: event.replayId,
          missionId: event.missionId,
          nodeId: event.nodeId,
          waitingFor: event.waitingFor,
          checkpointId: event.checkpointId,
          ...event.metadata,
        },
      });
    }
  } catch {
    // Audit mirroring must never break runtime events.
  }
}
