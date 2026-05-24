/**
 * Blueprint SDK 子域 1：Intake & Project Context（方案 B：re-export 视图）。
 *
 * 当前实现：从 `@/lib/blueprint-api` 单体 re-export 对应符号子集。
 * 后续物理迁移时把实物搬进本文件并保留同名导出，下游 `import` 无需改动。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 2.1 子域 1、2.3、6.4（SDK 按子域切分 + barrel）
 */

import { fetchJsonSafe, type ApiRequestError } from "../api-client.js";
import type {
  BlueprintIntake,
  BlueprintIntakePatchRequest,
  BlueprintProjectDomainContext,
  BlueprintStaleEditResultSummary,
} from "@shared/blueprint/contracts";

export {
  BLUEPRINT_SPECS_ENDPOINT,
  BLUEPRINT_CAPABILITIES_ENDPOINT,
  BLUEPRINT_INTAKE_ENDPOINT,
  BLUEPRINT_PROJECTS_ENDPOINT,
  normalizeBlueprintSpecsResponse,
  fetchBlueprintSpecsProgress,
  createBlueprintIntake,
  fetchBlueprintIntakes,
  fetchBlueprintIntake,
  fetchBlueprintProjectContext,
  fetchBlueprintCapabilities,
} from "../blueprint-api.js";

export type {
  BlueprintDocumentProgress,
  BlueprintTaskProgress,
  BlueprintSpecProgress,
  BlueprintSpecsProgress,
  FetchBlueprintSpecsResult,
  BlueprintIntakeResponse,
  BlueprintIntakesResponse,
  BlueprintProjectContextResponse,
  CreateBlueprintIntakeResult,
  FetchBlueprintIntakesResult,
  FetchBlueprintIntakeResult,
  FetchBlueprintProjectContextResult,
  FetchBlueprintCapabilitiesResult,
} from "../blueprint-api.js";

export interface PatchBlueprintIntakeResponse {
  intake: BlueprintIntake;
  projectContext?: BlueprintProjectDomainContext;
  staleEdit?: BlueprintStaleEditResultSummary;
}

export type BlueprintIntakePatchError = ApiRequestError;

export type PatchBlueprintIntakeResult =
  | { ok: true; data: PatchBlueprintIntakeResponse }
  | { ok: false; error: BlueprintIntakePatchError };

function jsonHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  merged.set("Content-Type", "application/json");
  return merged;
}

export async function patchBlueprintIntake(
  intakeId: string,
  body: BlueprintIntakePatchRequest,
  options?: RequestInit
): Promise<PatchBlueprintIntakeResult> {
  const result = await fetchJsonSafe<PatchBlueprintIntakeResponse>(
    `/api/blueprint/intake/${encodeURIComponent(intakeId)}`,
    {
      ...options,
      method: "PATCH",
      headers: jsonHeaders(options?.headers),
      body: JSON.stringify(body),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}
