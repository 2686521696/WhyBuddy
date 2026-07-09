import type { AnyStageSub } from "./types";

/**
 * Maps each sub-stage to the server-side reasoning `stageId`(s) used to
 * filter the execution lane's reasoning/fallback entries.
 *
 * Critical mismatch: the fabric sub-stage `prompt_package` maps to the
 * server stageId `"prompt_packaging"` (not `"prompt_package"`). If this
 * mapping is wrong, the execution lane will silently fail to show reasoning
 * events for that stage.
 */
export const STAGE_FILTER_BY_SUB: Record<AnyStageSub, string | readonly string[]> = {
  // preflight
  target_input: "target_input",
  intake_created: "intake_created",
  clarification: "clarification",
  route: ["route_generation", "route_selection", "spec_tree"],
  // fabric
  agent_crew_fabric: "agent_crew_fabric",
  spec_tree: "spec_tree",
  effect_preview: "effect_preview",
  prompt_package: "prompt_packaging", // ← server stageId differs from sub name
  runtime_capability: "runtime_capability",
  engineering_handoff: "engineering_handoff",
  artifact_memory: "artifact_memory",
};
