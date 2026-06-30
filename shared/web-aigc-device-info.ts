export const WEB_AIGC_DEVICE_INFO_API = {
  EXECUTE: "POST /api/get-device-info/nodes/execute",
} as const;

export const WEB_AIGC_DEVICE_INFO_NODE_TYPES = [
  "get_device_info",
] as const;

export type GetDeviceInfoNodeType =
  (typeof WEB_AIGC_DEVICE_INFO_NODE_TYPES)[number];

export interface WebAigcDeviceClientHints {
  userAgent?: string;
  platform?: string;
  locale?: string;
  timezone?: string;
  appVersion?: string;
  screenCategory?: "desktop" | "tablet" | "mobile" | "unknown";
}

export interface WebAigcDevicePrivacyInput {
  allowRuntimeDetails?: boolean;
  allowClientHints?: boolean;
  redactUserAgent?: boolean;
  retention?: "ephemeral" | "session" | "workflow";
}

export interface GetDeviceInfoNodeInput {
  clientHints?: WebAigcDeviceClientHints;
  privacy?: WebAigcDevicePrivacyInput;
  context?: Record<string, unknown>;
}

export interface GetDeviceInfoNodeExecutionRequest {
  nodeType: GetDeviceInfoNodeType;
  input?: GetDeviceInfoNodeInput;
}

export interface WebAigcDeviceRuntimeSummary {
  runtime: "node" | "python" | "python-failed";
  platform?: string;
  arch?: string;
  nodeVersion?: string;
}

export interface WebAigcDeviceClientSummary {
  platform?: string;
  browserFamily?: string;
  osFamily?: string;
  locale?: string;
  timezone?: string;
  appVersion?: string;
  screenCategory?: "desktop" | "tablet" | "mobile" | "unknown";
}

export interface WebAigcDevicePrivacySummary {
  collectionMode: "summary_only";
  rawUserAgentStored: boolean;
  redactedFields: string[];
  retention: "ephemeral" | "session" | "workflow";
  notes: string[];
}

export interface WebAigcDeviceCompatibilitySummary {
  hostRuntime: "server";
  hasClientHints: boolean;
  fallbackMode: boolean;
}

export interface GetDeviceInfoNodeExecutionResult {
  ok: boolean;
  nodeType: GetDeviceInfoNodeType;
  output: {
    status: "completed" | "degraded" | "error";
    runtime: WebAigcDeviceRuntimeSummary;
    client?: WebAigcDeviceClientSummary;
    privacy: WebAigcDevicePrivacySummary;
    compatibility?: WebAigcDeviceCompatibilitySummary;
    context: Record<string, unknown>;
    warnings: string[];
    error?: {
      code?: string;
      message?: string;
      retryable?: boolean;
    };
    metadata?: Record<string, unknown>;
  };
}
