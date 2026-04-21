export const AIGC_MONITORING_EXECUTION_STATUSES = [
  "EXECUTED",
  "EXECUTING",
  "EXCEPTION",
  "PENDING",
  "WAITING_INPUT",
  "FORCE_TERMINATED",
] as const;

export type AigcMonitoringExecutionStatus =
  (typeof AIGC_MONITORING_EXECUTION_STATUSES)[number];

export const AIGC_MONITORING_NODE_EXECUTION_STATUSES = [
  "EXECUTED",
  "EXECUTING",
  "EXCEPTION",
  "PENDING",
] as const;

export type AigcMonitoringNodeExecutionStatus =
  (typeof AIGC_MONITORING_NODE_EXECUTION_STATUSES)[number];

export interface AigcMonitoringInstanceListQuery {
  name?: string;
  code?: string;
  version?: number;
  executor?: string;
  instanceUuid?: string;
  category?: string;
  status?: AigcMonitoringExecutionStatus;
  startTimeFrom?: string;
  startTimeTo?: string;
  endTimeFrom?: string;
  endTimeTo?: string;
  page?: number;
  size?: number;
}

export interface AigcMonitoringInstanceListItem {
  id: number;
  instanceUuid: string;
  orchestrationCode: string;
  orchestrationName: string;
  orchestrationVersion: number;
  category: string | null;
  sourceApp: string | null;
  status: AigcMonitoringExecutionStatus;
  executor: string | null;
  lastExecutionTime: string | null;
  startTime: string;
  endTime: string | null;
}

export interface AigcMonitoringInstanceListResponse {
  content: AigcMonitoringInstanceListItem[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

export interface AigcMonitoringInstanceNodeDetail {
  id: number;
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  status: AigcMonitoringNodeExecutionStatus;
  startTime: string | null;
  endTime: string | null;
  inputData: Record<string, unknown> | null;
  outputData: Record<string, unknown> | null;
  errorMessage: string | null;
  position: { x: number; y: number };
}

export interface AigcMonitoringEdgeDetail {
  id: string;
  source: string;
  target: string;
}

export interface AigcMonitoringInstanceDetail {
  id: number;
  instanceUuid: string;
  orchestrationCode: string;
  orchestrationName: string;
  orchestrationVersion: number;
  category: string | null;
  sourceApp: string | null;
  status: AigcMonitoringExecutionStatus;
  executor: string | null;
  startTime: string;
  endTime: string | null;
  lastUpdateTime: string;
  inputVariables: Record<string, unknown>;
  outputVariables: Record<string, unknown>;
  nodes: AigcMonitoringInstanceNodeDetail[];
  edges: AigcMonitoringEdgeDetail[];
}

export interface AigcMonitoringSessionMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: string;
  thinking?: string;
  citations?: string[];
  toolCalls?: Array<{
    name: string;
    arguments: string;
    result?: string;
  }>;
}

export interface AigcMonitoringSessionDetail {
  sessionId: string;
  user: string;
  startTime: string;
  sourceApp: string | null;
  messages: AigcMonitoringSessionMessage[];
}

export interface AigcMonitoringTerminateResult {
  instanceId: number;
  previousStatus: AigcMonitoringExecutionStatus;
  currentStatus: "FORCE_TERMINATED";
  terminatedAt: string;
}

export interface AigcMonitoringApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}
