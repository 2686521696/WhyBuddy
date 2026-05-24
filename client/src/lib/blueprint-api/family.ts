import { fetchJsonSafe, type ApiRequestError } from "../api-client.js";
import type { BlueprintFamilyResponse } from "@shared/blueprint/contracts";

export type BlueprintFamilyError = ApiRequestError;

export type GetBlueprintFamilyResult =
  | { ok: true; data: BlueprintFamilyResponse }
  | { ok: false; error: BlueprintFamilyError };

export async function getBlueprintFamily(
  jobId: string,
  options?: RequestInit
): Promise<GetBlueprintFamilyResult> {
  const result = await fetchJsonSafe<BlueprintFamilyResponse>(
    `/api/blueprint/jobs/${encodeURIComponent(jobId)}/family`,
    options
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}
