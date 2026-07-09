import { useCallback } from "react";

import {
  areStagesOnSamePage,
  getAutopilotPageForStage,
  normalizeAutopilotStage,
} from "./page-mapping.js";

export interface ThreeLayerConsistencySnapshot {
  urlPin: string | null;
  workflowStageOverride: string | null;
  activeJobStage: string;
}

export interface ThreeLayerConsistencyActions {
  resetPin?: () => void;
  fallbackWorkflowStageOverride?: (stage: string) => void;
  now?: () => number;
}

export interface ThreeLayerConsistencyResult {
  ok: boolean;
  warned: boolean;
  reviewOverride: boolean;
  mismatchReason: string | null;
  correctedTo: string | null;
  elapsedMs: number;
}

export interface UseThreeLayerConsistencyCheckerOptions {
  readSnapshot: () => ThreeLayerConsistencySnapshot;
  actions?: ThreeLayerConsistencyActions;
}

function normalizeStageValue(stage: string | null | undefined): string | null {
  const normalized = normalizeAutopilotStage(stage);
  return normalized ?? (stage ? stage.trim().toLowerCase() : null);
}

function isLegalReviewOverride(
  activeStage: string | null,
  candidateStage: string | null
): boolean {
  if (!activeStage || !candidateStage) return false;

  const activePage = getAutopilotPageForStage(activeStage);
  const candidatePage = getAutopilotPageForStage(candidateStage);

  if (activePage === null || candidatePage === null) return false;
  return candidatePage <= activePage;
}

function isLegalPinOrOverride(
  activeStage: string | null,
  stage: string | null
): boolean {
  if (!activeStage || !stage) return false;
  if (areStagesOnSamePage(activeStage, stage)) return true;
  return isLegalReviewOverride(activeStage, stage);
}

export function checkThreeLayerConsistency(
  snapshot: ThreeLayerConsistencySnapshot,
  actions: ThreeLayerConsistencyActions = {}
): ThreeLayerConsistencyResult {
  const now =
    actions.now ??
    (() =>
      typeof performance === "undefined" ? Date.now() : performance.now());
  const start = now();
  const activeJobStage = normalizeAutopilotStage(snapshot.activeJobStage);
  const urlPin = normalizeStageValue(snapshot.urlPin);
  const workflowStageOverride = normalizeStageValue(
    snapshot.workflowStageOverride
  );

  if (!activeJobStage) {
    return {
      ok: true,
      warned: false,
      reviewOverride: false,
      mismatchReason: null,
      correctedTo: null,
      elapsedMs: now() - start,
    };
  }

  const urlPinLegal =
    urlPin === null || isLegalPinOrOverride(activeJobStage, urlPin);
  const overrideLegal =
    workflowStageOverride === null ||
    isLegalPinOrOverride(activeJobStage, workflowStageOverride);

  const reviewOverride =
    (urlPin !== null && urlPin !== activeJobStage && urlPinLegal) ||
    (workflowStageOverride !== null &&
      workflowStageOverride !== activeJobStage &&
      overrideLegal);

  if (urlPinLegal && overrideLegal) {
    return {
      ok: true,
      warned: false,
      reviewOverride,
      mismatchReason: null,
      correctedTo: null,
      elapsedMs: now() - start,
    };
  }

  const illegalUrlPin = !urlPinLegal;
  const illegalOverride = !overrideLegal;
  const mismatchReason =
    illegalUrlPin && illegalOverride
      ? "illegal_url_pin_and_workflow_stage_override"
      : illegalUrlPin
        ? "illegal_url_pin"
        : "illegal_workflow_stage_override";

  console.warn("coordination.three_layer_mismatch", {
    event: "coordination.three_layer_mismatch",
    urlPin: snapshot.urlPin,
    workflowStageOverride: snapshot.workflowStageOverride,
    activeJobStage,
    mismatchReason,
    correctedTo: activeJobStage,
  });

  if (illegalUrlPin) {
    actions.resetPin?.();
  }

  if (illegalOverride) {
    actions.fallbackWorkflowStageOverride?.(activeJobStage);
  }

  const elapsedMs = now() - start;

  return {
    ok: elapsedMs <= 100,
    warned: true,
    reviewOverride,
    mismatchReason,
    correctedTo: activeJobStage,
    elapsedMs,
  };
}

export function useThreeLayerConsistencyChecker(
  options: UseThreeLayerConsistencyCheckerOptions
) {
  const checkAndCorrect = useCallback(
    () => checkThreeLayerConsistency(options.readSnapshot(), options.actions),
    [options]
  );

  return { checkAndCorrect };
}
