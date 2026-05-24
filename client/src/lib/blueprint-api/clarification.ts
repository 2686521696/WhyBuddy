/**
 * Blueprint SDK 子域 2：Clarification（方案 B）。
 *
 * 对应需求 2.1 子域 2、2.3、6.4。
 */

import { fetchJsonSafe, type ApiRequestError } from "../api-client.js";
import {
  BLUEPRINT_CLARIFICATIONS_ENDPOINT,
  createBlueprintClarificationSession,
  fetchBlueprintClarificationSession,
} from "../blueprint-api.js";
import type {
  BlueprintClarificationAnswer,
  BlueprintClarificationSession,
  BlueprintIntake,
  BlueprintProjectDomainContext,
  BlueprintStaleEditResultSummary,
} from "@shared/blueprint/contracts";

export {
  BLUEPRINT_CLARIFICATIONS_ENDPOINT,
  createBlueprintClarificationSession,
  fetchBlueprintClarificationSession,
} from "../blueprint-api.js";

export type {
  BlueprintClarificationStrategyMetadata,
  BlueprintClarificationStrategyQuestion,
  BlueprintClarificationStrategyAnswer,
  BlueprintClarificationStrategyReadiness,
  BlueprintClarificationStrategySession,
  CreateBlueprintClarificationSessionResult,
  FetchBlueprintClarificationSessionResult,
} from "../blueprint-api.js";

export interface BlueprintClarificationAnswersRequest {
  answers: BlueprintClarificationAnswer[];
  answeredBy?: string;
}

export interface BlueprintClarificationSessionResponse {
  intake?: BlueprintIntake;
  session?: BlueprintClarificationSession;
  clarificationSession?: BlueprintClarificationSession;
  projectContext?: BlueprintProjectDomainContext;
  staleEdit?: BlueprintStaleEditResultSummary;
}

export type SaveBlueprintClarificationAnswersResult =
  | { ok: true; data: BlueprintClarificationSessionResponse }
  | { ok: false; error: ApiRequestError };

function normalizeClarificationAnswersResponse(
  value: BlueprintClarificationSessionResponse,
): BlueprintClarificationSessionResponse {
  const session = value.clarificationSession ?? value.session;
  return {
    intake: value.intake,
    session: value.session,
    clarificationSession: session,
    projectContext: value.projectContext,
    staleEdit: value.staleEdit,
  };
}

export async function saveBlueprintClarificationAnswers(
  clarificationId: string,
  request: BlueprintClarificationAnswersRequest,
  method: "POST" | "PATCH" = "POST",
): Promise<SaveBlueprintClarificationAnswersResult> {
  const result = await fetchJsonSafe<BlueprintClarificationSessionResponse>(
    `${BLUEPRINT_CLARIFICATIONS_ENDPOINT}/${encodeURIComponent(clarificationId)}/answers`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeClarificationAnswersResponse(result.data),
  };
}
