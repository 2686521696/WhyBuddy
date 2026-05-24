import { useMemo } from "react";

import { generateBlueprintEffectPreview } from "../../../lib/blueprint-api/downstream";
import { selectBlueprintRoute } from "../../../lib/blueprint-api/routeset";
import { generateBlueprintSpecDocuments } from "../../../lib/blueprint-api/spec-documents";

export type PerStageRegenerateStage =
  | "route_generation"
  | "spec_documents"
  | "effect_preview";

export type PerStageRegenerateSkippedReason = "disabled" | "in_flight";

export interface PerStageRegenerateInput {
  jobId: string;
  stage: PerStageRegenerateStage;
  routeId?: string;
  nodeId?: string;
  reason?: string;
  disabled?: boolean;
}

export type PerStageRegenerateResult =
  | Awaited<ReturnType<typeof selectBlueprintRoute>>
  | Awaited<ReturnType<typeof generateBlueprintSpecDocuments>>
  | Awaited<ReturnType<typeof generateBlueprintEffectPreview>>;

export interface PerStageRegenerateSkippedResult {
  skipped: true;
  reason: PerStageRegenerateSkippedReason;
}

export async function runPerStageRegenerate(
  input: PerStageRegenerateInput,
): Promise<PerStageRegenerateResult> {
  switch (input.stage) {
    case "route_generation": {
      if (!input.routeId) {
        throw new Error("routeId is required to regenerate route selection.");
      }
      return selectBlueprintRoute(input.jobId, {
        routeId: input.routeId,
        reason: input.reason,
      });
    }
    case "spec_documents":
      return generateBlueprintSpecDocuments(input.jobId, {
        nodeId: input.nodeId,
      });
    case "effect_preview":
      return generateBlueprintEffectPreview(input.jobId, {
        nodeId: input.nodeId,
      });
  }
}

export function createPerStageRegenerateController() {
  let inFlight = false;

  return {
    get isInFlight() {
      return inFlight;
    },
    async trigger(
      input: PerStageRegenerateInput,
    ): Promise<PerStageRegenerateResult | PerStageRegenerateSkippedResult> {
      if (input.disabled) {
        return { skipped: true, reason: "disabled" };
      }
      if (inFlight) {
        return { skipped: true, reason: "in_flight" };
      }

      inFlight = true;
      try {
        return await runPerStageRegenerate(input);
      } finally {
        inFlight = false;
      }
    },
  };
}

export function usePerStageRegenerate() {
  return useMemo(() => createPerStageRegenerateController(), []);
}
