import { AuditEventType } from "../../shared/audit/contracts.js";
import type { AgentEvent } from "../../shared/workflow-runtime.js";
import type { ExecutionEvent, ReplayEventType } from "../../shared/replay/contracts.js";
import type {
  WebAigcRealProviderReadinessMatrix,
  WebAigcRealProviderReadinessStatus,
} from "../../shared/telemetry/contracts.js";
import { summarizeWebAigcProviderReadiness } from "../../shared/telemetry/contracts.js";

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

type WebAigcRelationLinkKey =
  | "workflowId"
  | "missionId"
  | "instanceId"
  | "sessionId"
  | "replayId"
  | "traceId"
  | "requestId"
  | "lineageId"
  | "artifactId"
  | "nodeId"
  | "edgeId"
  | "decisionId";

const WEB_AIGC_RELATION_LINK_KEYS: WebAigcRelationLinkKey[] = [
  "workflowId",
  "missionId",
  "instanceId",
  "sessionId",
  "replayId",
  "traceId",
  "requestId",
  "lineageId",
  "artifactId",
  "nodeId",
  "edgeId",
  "decisionId",
];

function readLinkValue(
  source: unknown,
  key: WebAigcRelationLinkKey,
): string | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const record = source as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const links = record.links;
  if (links && typeof links === "object") {
    const linked = (links as Record<string, unknown>)[key];
    if (typeof linked === "string" && linked.trim()) {
      return linked.trim();
    }
  }

  return undefined;
}

function buildRelationLinks(
  event: WebAigcRuntimeEvent,
): Record<string, string> {
  const links: Record<string, string> = {};

  const setLink = (key: WebAigcRelationLinkKey, value: unknown): void => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    links[key] = normalized;
  };

  setLink("workflowId", event.workflowId);
  setLink("missionId", event.missionId);
  setLink("instanceId", event.instanceId);
  setLink("sessionId", event.sessionId);
  setLink("replayId", event.replayId || event.workflowId || event.instanceId);
  setLink("nodeId", event.nodeId);
  setLink("edgeId", event.edgeId);

  for (const key of WEB_AIGC_RELATION_LINK_KEYS) {
    const candidate = readLinkValue(event.metadata, key);
    if (candidate) {
      setLink(key, candidate);
    }
  }

  return links;
}

function mergeMetadataWithLinks(
  metadata: Record<string, unknown> | undefined,
  links: Record<string, string>,
): Record<string, unknown> | undefined {
  if (!metadata && Object.keys(links).length === 0) {
    return undefined;
  }

  const baseMetadata = metadata ? { ...metadata } : {};
  const baseLinks =
    baseMetadata.links && typeof baseMetadata.links === "object"
      ? { ...(baseMetadata.links as Record<string, unknown>) }
      : {};

  return {
    ...baseMetadata,
    ...(Object.keys(links).length > 0
      ? {
          links: {
            ...links,
            ...baseLinks,
          },
        }
      : {}),
  };
}

function buildVariableAssignmentMirrorMetadata(
  event: WebAigcRuntimeEvent,
): Record<string, unknown> | undefined {
  if (event.eventKey !== "variable.assigned") {
    return undefined;
  }

  const target = String(event.metadata?.target || event.nodeId || event.instanceId);
  const scope =
    typeof event.metadata?.scope === "string" && event.metadata.scope.length > 0
      ? event.metadata.scope
      : "unknown";

  return {
    actionId: "variable.assign",
    resourceType: "workflow-variable",
    resourceId: target,
    assignmentTarget: target,
    assignmentScope: scope,
    assignmentChanged: !Object.is(
      event.metadata?.previousValue,
      event.metadata?.nextValue,
    ),
  };
}

function buildReplayEventMetadata(
  event: WebAigcRuntimeEvent,
): Record<string, unknown> | undefined {
  const variableMirrorMetadata = buildVariableAssignmentMirrorMetadata(event);
  const relationLinks = buildRelationLinks(event);
  if (!event.metadata && !variableMirrorMetadata && Object.keys(relationLinks).length === 0) {
    return undefined;
  }

  return mergeMetadataWithLinks(
    {
      ...(event.metadata ?? {}),
      ...(variableMirrorMetadata ?? {}),
    },
    relationLinks,
  );
}

function mapReplayEventType(eventKey: string): ReplayEventType | undefined {
  switch (eventKey) {
    case "node.started":
      return "AGENT_STARTED";
    case "node.completed":
      return "AGENT_STOPPED";
    case "variable.assigned":
    case "node.waiting_input":
    case "edge.transitioned":
    case "edge.loop_iterated":
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
      metadata: buildReplayEventMetadata(event),
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

  const relationLinks = buildRelationLinks(event);

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
    const variableMirrorMetadata = buildVariableAssignmentMirrorMetadata(event);

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
        metadata: mergeMetadataWithLinks(
          {
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
          relationLinks,
        ),
      });
    } else if (event.eventKey === "node.completed") {
      currentDeps.auditCollector.record({
        eventType: AuditEventType.AGENT_EXECUTED,
        actor: { type: "system", id: "web-aigc-runtime" },
        action: `Runtime node completed: ${event.nodeId || "unknown"}`,
        resource: {
          type: "workflow-node",
          id: event.nodeId || event.instanceId,
          name: event.eventKey,
        },
        result: "success",
        context: {
          sessionId: event.sessionId || event.workflowId,
        },
        metadata: mergeMetadataWithLinks(
          {
            eventKey: event.eventKey,
            workflowId: event.workflowId,
            instanceId: event.instanceId,
            replayId: event.replayId,
            missionId: event.missionId,
            nodeId: event.nodeId,
            status: event.status,
            checkpointId: event.checkpointId,
            startedAt: event.startedAt,
            completedAt: event.completedAt,
            durationMs: event.durationMs,
            ...event.metadata,
          },
          relationLinks,
        ),
      });
    } else if (event.eventKey === "variable.assigned") {
      currentDeps.auditCollector.record({
        eventType: AuditEventType.DECISION_MADE,
        actor: { type: "system", id: "web-aigc-runtime" },
        action: `Runtime variable assigned: ${String(event.metadata?.target || event.nodeId || "unknown")}`,
        resource: {
          type: "workflow-variable",
          id: String(event.metadata?.target || event.nodeId || event.instanceId),
          name: event.eventKey,
        },
        result: "success",
        context: {
          sessionId: event.sessionId || event.workflowId,
        },
        metadata: mergeMetadataWithLinks(
          {
            eventKey: event.eventKey,
            workflowId: event.workflowId,
            instanceId: event.instanceId,
            replayId: event.replayId,
            missionId: event.missionId,
            nodeId: event.nodeId,
            checkpointId: event.checkpointId,
            ...(variableMirrorMetadata ?? {}),
            ...event.metadata,
          },
          relationLinks,
        ),
      });
    } else if (
      event.eventKey === "edge.transitioned" &&
      event.metadata?.kind === "jump"
    ) {
      currentDeps.auditCollector.record({
        eventType: AuditEventType.DECISION_MADE,
        actor: { type: "system", id: "web-aigc-runtime" },
        action: `Runtime flow jump executed: ${event.fromNodeId || "unknown"} -> ${event.toNodeId || "unknown"}`,
        resource: {
          type: "workflow-edge",
          id: event.edgeId || `${event.fromNodeId || "unknown"}->${event.toNodeId || "unknown"}`,
          name: event.eventKey,
        },
        result: "success",
        context: {
          sessionId: event.sessionId || event.workflowId,
        },
        metadata: mergeMetadataWithLinks(
          {
            eventKey: event.eventKey,
            workflowId: event.workflowId,
            instanceId: event.instanceId,
            replayId: event.replayId,
            missionId: event.missionId,
            nodeId: event.nodeId,
            edgeId: event.edgeId,
            fromNodeId: event.fromNodeId,
            toNodeId: event.toNodeId,
            ...event.metadata,
          },
          relationLinks,
        ),
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
        metadata: mergeMetadataWithLinks(
          {
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
          relationLinks,
        ),
      });
    }
  } catch {
    // Audit mirroring must never break runtime events.
  }
}

// Web AIGC real provider readiness 101 integration
// Records provider matrix into observability context. skipped-live entries are
// explicitly separated and never promoted as real provider takeover.
export function recordWebAigcProviderReadiness(
  matrix: Partial<WebAigcRealProviderReadinessMatrix> | undefined,
): {
  ready: number;
  skippedLive: number;
  blocked: number;
  degraded: number;
  unsupported: number;
  canClaimRealExternal: boolean;
} {
  if (!matrix || !matrix.providers) {
    return { ready: 0, skippedLive: 0, blocked: 0, degraded: 0, unsupported: 0, canClaimRealExternal: false };
  }
  const providers = matrix.providers as Record<string, { status: WebAigcRealProviderReadinessStatus }>;
  return summarizeWebAigcProviderReadiness(providers);
}
