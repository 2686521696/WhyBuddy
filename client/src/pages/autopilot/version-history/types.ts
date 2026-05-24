import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintGenerationStage,
} from "@shared/blueprint";
import type { AutopilotPage } from "@/lib/autopilot-coordination";

export type VersionHistoryJob = BlueprintGenerationJob & {
  parentJobId?: string;
  branchedAt?: string;
  branchedFromStage?: BlueprintGenerationStage;
  staleArtifactIds?: string[];
};

export type StaleAwareArtifact = BlueprintGenerationArtifact & {
  staleSince?: string;
  invalidatedBy?: string;
};

export type VersionTreeWarningType = "missing-parent" | "cycle";

export interface VersionTreeWarning {
  type: VersionTreeWarningType;
  jobId: string;
  parentJobId?: string;
}

export interface VersionTreeLayoutNode {
  job: VersionHistoryJob;
  depth: number;
  children: VersionTreeLayoutNode[];
  missingParent: boolean;
  cycleDetected: boolean;
}

export interface VersionTreeLayout {
  roots: VersionTreeLayoutNode[];
  nodesById: Record<string, VersionTreeLayoutNode>;
  warnings: VersionTreeWarning[];
}

export interface SwitchActiveApplyPayload {
  jobId: string;
  stage: BlueprintGenerationStage;
}

export interface SwitchActiveStageTransition {
  fromStage: BlueprintGenerationStage;
  toStage: BlueprintGenerationStage;
}

export interface SwitchActivePageTransition {
  fromPage: AutopilotPage;
  toPage: AutopilotPage;
}

export interface SwitchActiveSubmission {
  triggerSource: "switch_active";
  apply: () => void | Promise<void>;
  stageTransition: SwitchActiveStageTransition;
  pageTransition?: SwitchActivePageTransition;
}

export interface SwitchActiveCoordinator {
  submit: (submission: SwitchActiveSubmission) => unknown;
}
