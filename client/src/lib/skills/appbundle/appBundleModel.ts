// AppBundle metamodel - the application-center layer. It does not run the app;
// it packages the other skill outputs into one materializable application spec.

export type PageBindingMode = "create" | "edit" | "view" | "approve";

export interface PageWorkflowBinding {
  pageRef: string;
  workflowRef?: string;
  mode: PageBindingMode;
}

export interface AppMenuEntry {
  id: string;
  label: string;
  pageRef: string;
  roleRefs: string[];
}

export type AppBundleSkillId =
  | "datamodel"
  | "rbac"
  | "workflow"
  | "page"
  | "aigc"
  | "appbundle";

export interface AppBundleVersionPin {
  skillId: AppBundleSkillId;
  ref: string;
  version: string;
  pinnedAt: string;
}

export interface AppBundleIncludedRefs {
  entities: string[];
  fields?: string[];
  roles: string[];
  permissions?: string[];
  workflows: string[];
  pages: string[];
  aigcCapabilities?: string[];
  app: string[];
}

export type AppBundleGateStatus = "not_run" | "passed" | "failed";

export interface AppBundlePublishManifest {
  appId: string;
  appVersion: string;
  createdAt: string;
  includedRefs: AppBundleIncludedRefs;
  gateStatus: AppBundleGateStatus;
  closureEvidenceDigest?: string;
}

export interface AppBundleRuntimeSnapshot {
  appId: string;
  appVersion: string;
  refMode: "pinned";
  pinnedRefs: string[];
  publishGateEvidence?: {
    status: AppBundleGateStatus;
    passedAt?: string;
    evidenceSummary?: string;
  };
  closureHash?: string;
}

export interface AppBundleReleaseArtifactRuntimeClosureSummary {
  closureId?: string;
  closureHash?: string;
  generatedAt?: string;
  stableDigest?: string;
  blocked: boolean;
  blockerCount: number;
  evidencePresentCount?: number;
  skillCount?: number;
}

export interface AppBundleReleaseArtifact {
  appId: string;
  appVersion: string;
  traceId: string;
  publishGateEvidence: {
    status: AppBundleGateStatus;
    passedAt?: string;
    evidenceSummary?: string;
  };
  runtimeClosureSummary?: AppBundleReleaseArtifactRuntimeClosureSummary;
}

export interface AppBundleRollbackTarget {
  appId: string;
  appVersion: string;
  traceId?: string;
  exists: boolean;
  immutable: boolean;
}

export interface AppBundleModel {
  id: string;
  name: string;
  description: string;
  entityRefs: string[];
  fieldRefs?: string[];
  roleRefs: string[];
  permissionRefs?: string[];
  workflowRefs: string[];
  pageRefs: string[];
  aigcCapabilityRefs?: string[];
  pageBindings: PageWorkflowBinding[];
  menuEntries: AppMenuEntry[];
  versionPins?: AppBundleVersionPin[];
  publishManifest?: AppBundlePublishManifest;
  runtimeSnapshot?: AppBundleRuntimeSnapshot;
  releaseArtifact?: AppBundleReleaseArtifact;
  rollbackTargets?: AppBundleRollbackTarget[];
}

export interface AppBundleRollbackPlan {
  appId: string;
  fromVersion: string;
  toVersion: string;
  changedRefs: string[];
  closureHashMatch?: boolean;
}

export interface AppBundleRollbackClosureComparison {
  appId: string;
  fromVersion: string;
  toVersion: string;
  closureHashMatch: boolean;
  changedClosureRefs: string[];
}

export interface AppBundleRollbackClosureDiffEvidence {
  appId: string;
  currentVersion?: string;
  targetVersion?: string;
  currentStableDigest?: string;
  targetStableDigest?: string;
  digestMatch: boolean;
  changedPerSkillRefs: string[];
  evidencePresentCountCurrent?: number;
  evidencePresentCountTarget?: number;
  degraded?: boolean;
}

export type AppBundleClosureTier = "hard_blocker" | "warning" | "info";

export const APPBUNDLE_CLOSURE_TIERS: readonly AppBundleClosureTier[] = [
  "hard_blocker",
  "warning",
  "info",
] as const;

export interface ClassifiedAppBundleClosureFinding {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
  tier: AppBundleClosureTier;
}
