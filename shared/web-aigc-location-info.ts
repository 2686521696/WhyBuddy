export const WEB_AIGC_LOCATION_INFO_API = {
  EXECUTE: "POST /api/get-location-info/nodes/execute",
} as const;

export const WEB_AIGC_LOCATION_INFO_NODE_TYPES = [
  "get_location_info",
] as const;

export type GetLocationInfoNodeType =
  (typeof WEB_AIGC_LOCATION_INFO_NODE_TYPES)[number];

export const WEB_AIGC_LOCATION_AUTHORIZATION_STATUSES = [
  "granted",
  "denied",
  "not_requested",
  "unsupported",
] as const;

export type WebAigcLocationAuthorizationStatus =
  (typeof WEB_AIGC_LOCATION_AUTHORIZATION_STATUSES)[number];

export const WEB_AIGC_LOCATION_PRECISION_LEVELS = [
  "none",
  "coarse",
  "precise_blocked",
] as const;

export type WebAigcLocationPrecisionLevel =
  (typeof WEB_AIGC_LOCATION_PRECISION_LEVELS)[number];

export interface WebAigcCoarseLocationInput {
  countryCode?: string;
  region?: string;
  city?: string;
  district?: string;
  source?: "user_profile" | "browser_hint" | "manual_override" | "system_default";
}

export interface GetLocationInfoNodeInput {
  coarseLocation?: WebAigcCoarseLocationInput;
  timezone?: string;
  locale?: string;
  authorization?: {
    status?: WebAigcLocationAuthorizationStatus;
    grantedBy?: "user" | "workspace_admin" | "system";
    disclosureText?: string;
  };
  privacy?: {
    allowCoarseLocation?: boolean;
    allowTimezone?: boolean;
    allowLocale?: boolean;
    retention?: "ephemeral" | "session" | "workflow";
  };
  requestedPrecision?: "coarse" | "precise";
  context?: Record<string, unknown>;
}

export interface GetLocationInfoNodeExecutionRequest {
  nodeType: GetLocationInfoNodeType;
  input?: GetLocationInfoNodeInput;
}

export interface WebAigcLocationAuthorizationSummary {
  status: WebAigcLocationAuthorizationStatus;
  granted: boolean;
  grantedBy?: "user" | "workspace_admin" | "system";
  disclosureText?: string;
}

export interface WebAigcLocationPrivacySummary {
  precisionLevel: WebAigcLocationPrecisionLevel;
  dataMinimization: "coarse_only";
  exactCoordinatesStored: false;
  exactCoordinatesAllowed: false;
  deniedFields: string[];
  retention: "ephemeral" | "session" | "workflow";
  notes: string[];
}

export interface WebAigcLocationInfoPayload {
  status?: string;
  source?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: string | number;
  coarseLocation?: {
    countryCode?: string;
    region?: string;
    city?: string;
    district?: string;
    label?: string;
    source?: "user_profile" | "browser_hint" | "manual_override" | "system_default";
  };
  timezone?: string;
  locale?: string;
}

export interface GetLocationInfoNodeExecutionResult {
  ok: true;
  nodeType: GetLocationInfoNodeType;
  output: {
    status: "completed" | "degraded";
    location: WebAigcLocationInfoPayload;
    authorization: WebAigcLocationAuthorizationSummary;
    privacy: WebAigcLocationPrivacySummary;
    context: Record<string, unknown>;
    warnings: string[];
    metadata?: Record<string, unknown>;
  };
}
