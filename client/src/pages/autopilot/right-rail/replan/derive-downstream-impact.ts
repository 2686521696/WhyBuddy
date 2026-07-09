import type { ReplanArtifact, ReplanImpact, ReplanStage } from "./types";

export interface DeriveDownstreamImpactInput {
  fromStage: ReplanStage;
  artifacts?: ReadonlyArray<ReplanArtifact> | null;
}

export const REPLAN_STAGE_ORDER: readonly ReplanStage[] = [
  "input",
  "clarification",
  "route_generation",
  "agent_crew_fabric",
  "spec_tree",
  "spec_docs",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
  "artifact_memory",
] as const;

const STAGE_INDEX = new Map<ReplanStage, number>(
  REPLAN_STAGE_ORDER.map((stage, index) => [stage, index])
);

function normalizeStage(raw: string | undefined): ReplanStage | undefined {
  switch (raw) {
    case "input":
    case "clarification":
    case "route_generation":
    case "agent_crew_fabric":
    case "spec_tree":
    case "spec_docs":
    case "effect_preview":
    case "prompt_packaging":
    case "runtime_capability":
    case "engineering_handoff":
    case "engineering_landing":
    case "artifact_memory":
      return raw;
    case "preview":
      return "effect_preview";
    case "prompt_package":
      return "prompt_packaging";
    default:
      return undefined;
  }
}

function stageFromArtifactType(type: string): ReplanStage | undefined {
  switch (type) {
    case "intake":
    case "github_source":
    case "project_context":
      return "input";
    case "clarification_session":
      return "clarification";
    case "route_set":
    case "route_selection":
      return "route_generation";
    case "agent_crew":
    case "role_timeline":
      return "agent_crew_fabric";
    case "spec_tree":
    case "spec_tree_version":
      return "spec_tree";
    case "requirements":
    case "design":
    case "tasks":
    case "spec_document_version":
      return "spec_docs";
    case "preview":
    case "effect_preview":
      return "effect_preview";
    case "prompt_pack":
    case "prompt_package":
      return "prompt_packaging";
    case "capability_registry":
    case "capability_invocation":
    case "capability_evidence":
      return "runtime_capability";
    case "engineering_plan":
    case "engineering_run":
      return "engineering_handoff";
    case "engineering_landing":
      return "engineering_landing";
    case "replay":
    case "feedback":
    case "artifact_memory":
      return "artifact_memory";
    default:
      return undefined;
  }
}

export function getReplanArtifactStage(
  artifact: ReplanArtifact
): ReplanStage | undefined {
  return normalizeStage(artifact.stage) ?? stageFromArtifactType(artifact.type);
}

export function deriveDownstreamImpact({
  fromStage,
  artifacts,
}: DeriveDownstreamImpactInput): ReplanImpact {
  const fromIndex = STAGE_INDEX.get(fromStage);
  if (fromIndex === undefined || !Array.isArray(artifacts)) {
    return { artifactIds: [], artifactCount: 0, stages: [] };
  }

  const downstreamArtifactIds: string[] = [];
  const downstreamStages = new Set<ReplanStage>();

  for (const artifact of artifacts) {
    const artifactStage = getReplanArtifactStage(artifact);
    if (!artifactStage) continue;

    const artifactIndex = STAGE_INDEX.get(artifactStage);
    if (artifactIndex === undefined || artifactIndex <= fromIndex) continue;

    downstreamArtifactIds.push(artifact.id);
    downstreamStages.add(artifactStage);
  }

  const stages = Array.from(downstreamStages).sort(
    (a, b) => STAGE_INDEX.get(a)! - STAGE_INDEX.get(b)!
  );

  return {
    artifactIds: downstreamArtifactIds,
    artifactCount: downstreamArtifactIds.length,
    stages,
  };
}
