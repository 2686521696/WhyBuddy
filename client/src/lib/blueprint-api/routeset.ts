/**
 * Blueprint SDK 子域 5：RouteSet & SPEC Tree（方案 B）。
 *
 * 对应需求 2.1 子域 5、2.3、4.1、4.3、4.4、6.4。
 */

import { selectBlueprintRoute as selectBlueprintRouteBase } from "../blueprint-api.js";
import type {
  BlueprintRouteSelectionRequest,
  BlueprintSelectRouteResponse,
  BlueprintStaleEditResultSummary,
} from "@shared/blueprint/contracts";
import type { ApiRequestError } from "../api-client.js";

export {
  resetBlueprintRouteSelection,
  updateBlueprintSpecTreeNode,
  saveBlueprintSpecTreeVersion,
  runBlueprintSpecTreeAction,
} from "../blueprint-api.js";

export type {
  ResetBlueprintRouteSelectionResult,
  UpdateBlueprintSpecTreeNodeResult,
  SaveBlueprintSpecTreeVersionResult,
  RunBlueprintSpecTreeActionResult,
} from "../blueprint-api.js";

export interface BlueprintSelectRouteWithStaleEditResponse
  extends BlueprintSelectRouteResponse {
  staleEdit?: BlueprintStaleEditResultSummary;
}

export type SelectBlueprintRouteResult =
  | { ok: true; data: BlueprintSelectRouteWithStaleEditResponse }
  | { ok: false; error: ApiRequestError };

export async function selectBlueprintRoute(
  jobId: string,
  request: BlueprintRouteSelectionRequest
): Promise<SelectBlueprintRouteResult> {
  const result = await selectBlueprintRouteBase(jobId, request);
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    data: result.data as BlueprintSelectRouteWithStaleEditResponse,
  };
}
