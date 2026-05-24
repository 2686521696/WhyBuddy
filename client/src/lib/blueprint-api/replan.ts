import { fetchJsonSafe, type ApiRequestError } from "../api-client.js";
import type {
  BlueprintFamilyResponse,
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintStaleEditResultSummary,
} from "@shared/blueprint/contracts";

export type BlueprintReplanMode = "in_place" | "branch";

export interface BlueprintReplanRequest {
  fromStage: BlueprintGenerationStage;
  mode: BlueprintReplanMode;
  reason?: string;
}

export interface BlueprintReplanResponse {
  mode: BlueprintReplanMode;
  job: BlueprintGenerationJob;
  staleEdit?: BlueprintStaleEditResultSummary;
  family?: BlueprintFamilyResponse;
}

export class BlueprintReplanError extends Error implements ApiRequestError {
  kind: ApiRequestError["kind"];
  source: ApiRequestError["source"];
  endpoint: string;
  detail: string;
  retryable: boolean;
  status?: number;

  constructor(error: ApiRequestError) {
    super(error.message);
    this.name = "BlueprintReplanError";
    this.kind = error.kind;
    this.source = error.source;
    this.endpoint = error.endpoint;
    this.detail = error.detail;
    this.retryable = error.retryable;
    this.status = error.status;
  }
}

export type PostBlueprintReplanResult =
  | { ok: true; data: BlueprintReplanResponse }
  | { ok: false; error: BlueprintReplanError };

function jsonHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  merged.set("Content-Type", "application/json");
  return merged;
}

export async function postBlueprintReplan(
  jobId: string,
  body: BlueprintReplanRequest,
  options?: RequestInit
): Promise<PostBlueprintReplanResult> {
  const result = await fetchJsonSafe<BlueprintReplanResponse>(
    `/api/blueprint/jobs/${encodeURIComponent(jobId)}/replan`,
    {
      ...options,
      method: "POST",
      headers: jsonHeaders(options?.headers),
      body: JSON.stringify(body),
    }
  );

  if (!result.ok) {
    return { ok: false, error: new BlueprintReplanError(result.error) };
  }

  return { ok: true, data: result.data };
}
