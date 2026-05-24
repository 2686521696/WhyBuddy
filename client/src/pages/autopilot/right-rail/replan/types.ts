export type ReplanStage =
  | "input"
  | "clarification"
  | "route_generation"
  | "agent_crew_fabric"
  | "spec_tree"
  | "spec_docs"
  | "effect_preview"
  | "prompt_packaging"
  | "runtime_capability"
  | "engineering_handoff"
  | "engineering_landing"
  | "artifact_memory";

export type ReplanStatus =
  | "pending"
  | "running"
  | "waiting"
  | "reviewing"
  | "completed"
  | "failed";

export type ReplanMode = "in_place" | "branch";

export interface ReplanArtifact {
  id: string;
  type: string;
  title?: string;
  createdAt?: string;
  stage?: string;
  payload?: unknown;
}

export interface ReplanImpact {
  artifactIds: string[];
  artifactCount: number;
  stages: ReplanStage[];
}

export interface ReplanJobSummary {
  id: string;
  stage?: string;
  status?: string;
}

export interface ReplanPostRequest {
  jobId: string;
  fromStage: ReplanStage;
  mode: ReplanMode;
  reason: string;
  impactArtifactIds: string[];
  triggerSource?: "replan";
}

export interface ReplanPostResult {
  mode: ReplanMode;
  job: ReplanJobSummary;
  [key: string]: unknown;
}
