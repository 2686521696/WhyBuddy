export type AutopilotPage = 1 | 2 | 3;

export type AutopilotBackendStage =
  | "input"
  | "clarification"
  | "route_generation"
  | "spec_tree"
  | "spec_docs"
  | "effect_preview"
  | "prompt_packaging"
  | "runtime_capability"
  | "engineering_handoff"
  | "engineering_landing";

export type AutopilotUiStageAlias =
  | "route"
  | "spec_documents"
  | "prompt_package"
  | "preview";

type AutopilotStageLike = AutopilotBackendStage | AutopilotUiStageAlias;

const STAGE_ALIAS_TO_BACKEND_STAGE: Record<
  AutopilotUiStageAlias,
  AutopilotBackendStage
> = {
  route: "route_generation",
  spec_documents: "spec_docs",
  prompt_package: "prompt_packaging",
  preview: "effect_preview",
};

const BACKEND_PAGE_BY_STAGE = {
  input: 1,
  clarification: 1,
  route_generation: 1,
  spec_tree: 2,
  spec_docs: 2,
  effect_preview: 3,
  prompt_packaging: 3,
  runtime_capability: 3,
  engineering_handoff: 3,
  engineering_landing: 3,
} as const satisfies Record<AutopilotBackendStage, AutopilotPage>;

const PAGE_BY_STAGE = {
  ...BACKEND_PAGE_BY_STAGE,
  route: 1,
  spec_documents: 2,
  prompt_package: 3,
  preview: 3,
} as const satisfies Record<AutopilotStageLike, AutopilotPage>;

export const STAGE_TO_PAGE = PAGE_BY_STAGE;

function normalizeStage(
  stage: string | null | undefined
): AutopilotStageLike | null {
  const value = (stage ?? "").trim().toLowerCase();
  if (!value) return null;

  if (Object.prototype.hasOwnProperty.call(BACKEND_PAGE_BY_STAGE, value)) {
    return value as AutopilotBackendStage;
  }

  if (
    Object.prototype.hasOwnProperty.call(STAGE_ALIAS_TO_BACKEND_STAGE, value)
  ) {
    return value as AutopilotUiStageAlias;
  }

  return null;
}

function toBackendStage(
  stage: string | null | undefined
): AutopilotBackendStage | null {
  const normalized = normalizeStage(stage);
  if (normalized === null) return null;

  if (Object.prototype.hasOwnProperty.call(BACKEND_PAGE_BY_STAGE, normalized)) {
    return normalized as AutopilotBackendStage;
  }

  return STAGE_ALIAS_TO_BACKEND_STAGE[normalized as AutopilotUiStageAlias];
}

export function getAutopilotPageForStage(
  stage: string | null | undefined
): AutopilotPage | null {
  const normalized = normalizeStage(stage);
  return normalized ? PAGE_BY_STAGE[normalized] : null;
}

export const getStagePage = getAutopilotPageForStage;

export function areStagesOnSamePage(
  leftStage: string | null | undefined,
  rightStage: string | null | undefined
): boolean {
  const leftPage = getAutopilotPageForStage(leftStage);
  const rightPage = getAutopilotPageForStage(rightStage);

  return leftPage !== null && leftPage === rightPage;
}

export const isSameAutopilotPage = areStagesOnSamePage;

export function normalizeAutopilotStage(
  stage: string | null | undefined
): AutopilotBackendStage | null {
  return toBackendStage(stage);
}
