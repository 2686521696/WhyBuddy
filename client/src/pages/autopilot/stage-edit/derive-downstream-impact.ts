export type AutopilotLocalStage =
  | "input"
  | "clarification"
  | "route_generation"
  | "spec_tree"
  | "agent_crew"
  | "spec_documents"
  | "effect_preview"
  | "prompt_packaging"
  | "runtime_capability"
  | "engineering_handoff"
  | "engineering_landing"
  | (string & {});

export interface DownstreamImpactSummary {
  fromStage: AutopilotLocalStage;
  downstreamStages: AutopilotLocalStage[];
  downstreamCount: number;
}

export const DEFAULT_STAGE_ORDER = [
  "input",
  "clarification",
  "route_generation",
  "spec_tree",
  "agent_crew",
  "spec_documents",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
] as const satisfies readonly AutopilotLocalStage[];

export interface DeriveDownstreamImpactInput {
  fromStage: AutopilotLocalStage;
  stageOrder?: readonly AutopilotLocalStage[];
}

export function deriveDownstreamImpact({
  fromStage,
  stageOrder = DEFAULT_STAGE_ORDER,
}: DeriveDownstreamImpactInput): DownstreamImpactSummary {
  const stageIndex = stageOrder.indexOf(fromStage);
  const downstreamStages = stageIndex < 0 ? [] : stageOrder.slice(stageIndex + 1);

  return {
    fromStage,
    downstreamStages,
    downstreamCount: downstreamStages.length,
  };
}
