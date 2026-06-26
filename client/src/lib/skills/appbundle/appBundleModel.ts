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

export type AppBundleSkillId = "datamodel" | "rbac" | "workflow" | "page" | "appbundle";

export interface AppBundleVersionPin {
  skillId: AppBundleSkillId;
  ref: string;
  version: string;
  pinnedAt: string;
}

export interface AppBundleIncludedRefs {
  entities: string[];
  roles: string[];
  workflows: string[];
  pages: string[];
  app: string[];
}

export type AppBundleGateStatus = "not_run" | "passed" | "failed";

export interface AppBundlePublishManifest {
  appId: string;
  appVersion: string;
  createdAt: string;
  includedRefs: AppBundleIncludedRefs;
  gateStatus: AppBundleGateStatus;
}

export interface AppBundleRuntimeSnapshot {
  appId: string;
  appVersion: string;
  refMode: "pinned";
  pinnedRefs: string[];
}

export interface AppBundleModel {
  id: string;
  name: string;
  description: string;
  entityRefs: string[];
  roleRefs: string[];
  workflowRefs: string[];
  pageRefs: string[];
  pageBindings: PageWorkflowBinding[];
  menuEntries: AppMenuEntry[];
  versionPins?: AppBundleVersionPin[];
  publishManifest?: AppBundlePublishManifest;
  runtimeSnapshot?: AppBundleRuntimeSnapshot;
}
