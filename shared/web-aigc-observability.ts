export const WEB_AIGC_OBSERVABILITY_CATALOG_VERSION = "2026-04-22" as const;

export const WEB_AIGC_OBSERVABILITY_SINKS = [
  "replay",
  "audit",
  "lineage",
] as const;

export type WebAigcObservabilitySink =
  (typeof WEB_AIGC_OBSERVABILITY_SINKS)[number];

export interface WebAigcObservabilityEventDefinition {
  eventKey: string;
  stage: "node" | "edge" | "human" | "instance" | "external";
  description: string;
  sinks: WebAigcObservabilitySink[];
  requiredFields: string[];
  specRefs: string[];
}

export interface WebAigcRelationIndexDefinition {
  key: string;
  description: string;
  objectTypes: string[];
}

export interface WebAigcRelationIndexQuery {
  workflowId?: string;
  missionId?: string;
  instanceId?: string;
  sessionId?: string;
  replayId?: string;
  auditEntryId?: string;
  lineageId?: string;
  artifactId?: string;
  nodeId?: string;
  edgeId?: string;
  decisionId?: string;
}

export const WEB_AIGC_OBSERVABILITY_EVENT_CATALOG: WebAigcObservabilityEventDefinition[] = [
  {
    eventKey: "node.started",
    stage: "node",
    description: "A workflow node started execution.",
    sinks: ["replay"],
    requiredFields: ["workflowId", "instanceId", "nodeId", "startedAt", "status"],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-1",
    ],
  },
  {
    eventKey: "node.completed",
    stage: "node",
    description: "A workflow node completed and emitted output or telemetry.",
    sinks: ["replay"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "nodeId",
      "completedAt",
      "durationMs",
      "status",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-1",
    ],
  },
  {
    eventKey: "node.failed",
    stage: "node",
    description: "A workflow node failed with a recoverable or terminal error.",
    sinks: ["replay", "audit"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "nodeId",
      "completedAt",
      "error",
      "status",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-1",
      "web-aigc-platform-observability-audit#requirement-3",
    ],
  },
  {
    eventKey: "node.waiting_input",
    stage: "node",
    description: "A workflow node entered waiting state for human or operator input.",
    sinks: ["replay", "audit"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "nodeId",
      "waitingFor",
      "checkpointId",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-2",
      "web-aigc-platform-observability-audit#requirement-3",
    ],
  },
  {
    eventKey: "edge.transitioned",
    stage: "edge",
    description: "A control-flow edge was taken during graph execution.",
    sinks: ["replay"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "edgeId",
      "fromNodeId",
      "toNodeId",
      "kind",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-2",
    ],
  },
  {
    eventKey: "edge.loop_iterated",
    stage: "edge",
    description: "A loop edge advanced one iteration in the workflow graph.",
    sinks: ["replay"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "edgeId",
      "loopKey",
      "iterationIndex",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-2",
    ],
  },
  {
    eventKey: "human.decision_submitted",
    stage: "human",
    description: "A human or operator submitted a decision into a waiting node.",
    sinks: ["replay", "audit"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "missionId",
      "decisionId",
      "nodeId",
      "submittedBy",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-3",
    ],
  },
  {
    eventKey: "human.param_collection_submitted",
    stage: "human",
    description: "A structured param_collection submission was recorded with field summaries.",
    sinks: ["audit"],
    requiredFields: [
      "missionId",
      "decisionId",
      "nodeId",
      "submittedBy",
      "metadata.formFieldKeys",
    ],
    specRefs: [
      "web-aigc-node-param_collection#requirement-3",
      "web-aigc-platform-observability-audit#requirement-3",
    ],
  },
  {
    eventKey: "human.approved",
    stage: "human",
    description: "A manual approval unblocked a high-risk node or workflow action.",
    sinks: ["audit"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "missionId",
      "decisionId",
      "approvedBy",
      "resource",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-3",
      "web-aigc-platform-security-governance#requirement-4",
    ],
  },
  {
    eventKey: "human.rejected",
    stage: "human",
    description: "A manual rejection blocked a high-risk node or workflow action.",
    sinks: ["audit"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "missionId",
      "decisionId",
      "rejectedBy",
      "reason",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-3",
      "web-aigc-platform-security-governance#requirement-4",
    ],
  },
  {
    eventKey: "instance.terminated",
    stage: "instance",
    description: "A workflow instance was force terminated from an operator surface.",
    sinks: ["audit", "replay"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "missionId",
      "terminatedAt",
      "requestedBy",
      "reason",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-3",
      "web-aigc-platform-security-governance#requirement-4",
    ],
  },
  {
    eventKey: "instance.retry_requested",
    stage: "instance",
    description: "A failed workflow instance requested an explicit runtime retry.",
    sinks: ["audit", "replay"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "nodeId",
      "timestamp",
      "metadata.requestedBy",
    ],
    specRefs: [
      "web-aigc-platform-runtime-engine#requirement-2",
      "web-aigc-platform-observability-audit#requirement-3",
    ],
  },
  {
    eventKey: "instance.escalated",
    stage: "instance",
    description: "A workflow instance escalated into explicit human review.",
    sinks: ["audit", "replay"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "nodeId",
      "waitingFor",
      "metadata.requestedBy",
    ],
    specRefs: [
      "web-aigc-platform-runtime-engine#requirement-4",
      "web-aigc-platform-observability-audit#requirement-3",
    ],
  },
  {
    eventKey: "external.vector_insert",
    stage: "external",
    description: "A vector insert operation was attempted from a workflow node.",
    sinks: ["audit", "lineage"],
    requiredFields: [
      "workflowId",
      "instanceId",
      "nodeId",
      "namespace",
      "collection",
      "sourceId",
      "result",
    ],
    specRefs: [
      "web-aigc-platform-observability-audit#requirement-3",
      "web-aigc-platform-security-governance#requirement-3",
    ],
  },
  {
    eventKey: "external.knowledge_retrieval",
    stage: "external",
    description: "A knowledge query recorded retrieval quality metrics for audit and observability.",
    sinks: ["audit"],
    requiredFields: [
      "projectId",
      "queryMode",
      "latencyMs",
      "structuredEntityCount",
      "semanticHitCount",
    ],
    specRefs: [
      "web-aigc-node-knowledge_qa#requirement-3",
      "web-aigc-platform-observability-audit#requirement-3",
    ],
  },
];

export const WEB_AIGC_RELATION_INDEXES: WebAigcRelationIndexDefinition[] = [
  {
    key: "workflowId",
    description: "Primary workflow definition and runtime key.",
    objectTypes: ["workflow", "mission", "instance", "replay", "audit"],
  },
  {
    key: "missionId",
    description: "Mission projection key that links runtime, approval, and operator actions.",
    objectTypes: ["mission", "instance", "audit", "session"],
  },
  {
    key: "instanceId",
    description: "Execution instance key for node runs, edge transitions, and checkpoints.",
    objectTypes: ["instance", "replay", "audit"],
  },
  {
    key: "sessionId",
    description: "Conversation and HITL session key for messages and manual actions.",
    objectTypes: ["session", "audit", "replay"],
  },
  {
    key: "replayId",
    description: "Replay timeline key used by monitoring and playback surfaces.",
    objectTypes: ["replay", "instance", "workflow"],
  },
  {
    key: "auditEntryId",
    description: "Audit chain entry identifier for governance and operator actions.",
    objectTypes: ["audit", "instance", "mission"],
  },
  {
    key: "lineageId",
    description: "Data lineage key for external calls and knowledge evidence.",
    objectTypes: ["lineage", "audit", "artifact"],
  },
  {
    key: "artifactId",
    description: "Artifact key for exported reports, generated files, and replay snapshots.",
    objectTypes: ["artifact", "audit", "mission"],
  },
  {
    key: "nodeId",
    description: "Node execution key for telemetry, waiting states, and approvals.",
    objectTypes: ["instance", "replay", "audit", "lineage"],
  },
  {
    key: "edgeId",
    description: "Edge transition key for branch, loop, and blocked-path playback.",
    objectTypes: ["instance", "replay"],
  },
  {
    key: "decisionId",
    description: "Human decision key for approval, rejection, and resume chains.",
    objectTypes: ["mission", "audit", "replay"],
  },
];
