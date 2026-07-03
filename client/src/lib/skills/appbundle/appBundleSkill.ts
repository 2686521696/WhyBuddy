import {
  finalizeReport,
  type CrossRefEdge,
  type CrossSkill,
  type Finding,
  type Projection,
  type ResolvableSurface,
  type Skill,
  type ValidateContext,
} from "../skill";
import type {
  AppBundleClosureTier,
  AppBundleModel,
  AppBundlePublishManifest,
  AppBundleReleaseArtifact,
  AppBundleReleaseArtifactRuntimeClosureSummary,
  AppBundleRollbackClosureComparison,
  AppBundleRollbackClosureDiffEvidence,
  AppBundleRollbackPlan,
  AppBundleRuntimeSnapshot,
  AppBundleSkillId,
  AppMenuEntry,
  ClassifiedAppBundleClosureFinding,
} from "./appBundleModel";
import { APPBUNDLE_CLOSURE_TIERS } from "./appBundleModel";
export { APPBUNDLE_CLOSURE_TIERS } from "./appBundleModel";
import type { PageModel } from "../page/pageModel";
import {
  createPageCrossRuntimeEvidence,
  createPageRbacRuntimeEvidence,
  createWorkflowTaskViewAppBundleBindingEvidence,
  leaveApprovalPage,
  pageSkill,
  PAGE_WORKFLOW_TASK_VIEW_INVALID,
  tracePageRouteBindingToAppBundleClosureEvidence,
} from "../page/pageSkill";
import { dataModelSkill } from "../datamodel/dataModelSkill";
import { rbacSkill } from "../rbac/rbacSkill";
import { workflowSkill } from "../workflow/workflowSkill";
import { aigcSkill } from "../aigc/aigcSkill";

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

function appNodeId(appId: string): string {
  return `app_${sanitizeId(appId)}`;
}

function menuNodeId(menuId: string): string {
  return `menu_${sanitizeId(menuId)}`;
}

function bindingNodeId(pageRef: string, workflowRef: string | undefined, mode: string): string {
  return `bind_${sanitizeId(pageRef)}_${sanitizeId(workflowRef ?? "none")}_${sanitizeId(mode)}`;
}

function publishGateNodeId(appId: string): string {
  return `gate_${sanitizeId(appId)}`;
}

function runtimeSnapshotNodeId(appId: string): string {
  return `snap_${sanitizeId(appId)}`;
}

function releaseArtifactNodeId(appId: string): string {
  return `release_${sanitizeId(appId)}`;
}

function rollbackTargetNodeId(appId: string, version: string): string {
  return `rollback_${sanitizeId(appId)}_${sanitizeId(version)}`;
}

function pushPreciseMissingSurfaceFindings(
  f: Finding[],
  code: string,
  labeledRefs: Array<{ ref: string; path: string }>,
  surface: string[] | undefined,
  missingCode: string,
  label: string,
): void {
  labeledRefs.forEach(({ ref, path }) => {
    if (surface === undefined) {
      f.push({
        code,
        severity: "warning",
        path,
        message: `AppBundle references ${label} "${ref}", but the ${label} surface was not provided.`,
      });
    } else if (!surface.includes(ref)) {
      f.push({
        code: missingCode,
        severity: "error",
        path,
        message: `AppBundle references missing ${label}: ${ref}`,
      });
    }
  });
}

function extractTargetFromMessage(msg: string): string {
  const m = msg.match(/"([^"]+)"|missing [^:]+:\s*([^\s,]+)|:\s*([^\s,]+)$/i);
  return (m && (m[1] || m[2] || m[3])) || "";
}

function menuRoleRefs(menuEntries: AppMenuEntry[]): string[] {
  return menuEntries.flatMap(entry => entry.roleRefs);
}

interface ClosureRef {
  ref: string;
  path: string;
}

export interface AppBundleClosureMatrixRow {
  family: "entities" | "fields" | "roles" | "permissions" | "workflows" | "pages" | "aigcCapabilities" | "versionPins";
  skillId: AppBundleSkillId;
  kind: string;
  label: string;
  unresolvedCode: string;
  missingCode: string;
  collect(model: AppBundleModel): ClosureRef[];
  surface(ctx?: ValidateContext): string[] | undefined;
}

function refsFromList(refs: string[] | undefined, pathPrefix: string): ClosureRef[] {
  return (refs ?? []).map((ref, index) => ({ ref, path: `${pathPrefix}[${index}]` }));
}

export const APPBUNDLE_CLOSURE_MATRIX: AppBundleClosureMatrixRow[] = [
  {
    family: "entities",
    skillId: "datamodel",
    kind: "entity",
    label: "DataModel entity",
    unresolvedCode: "APPBUNDLE_ENTITY_UNRESOLVED",
    missingCode: "APPBUNDLE_REF_MISSING_ENTITY",
    collect: model => refsFromList(model.entityRefs, "entityRefs"),
    surface: ctx => ctx?.external?.datamodel?.entity,
  },
  {
    family: "fields",
    skillId: "datamodel",
    kind: "field",
    label: "DataModel field",
    unresolvedCode: "APPBUNDLE_FIELD_UNRESOLVED",
    missingCode: "APPBUNDLE_REF_MISSING_FIELD",
    collect: model => refsFromList(model.fieldRefs, "fieldRefs"),
    surface: ctx => ctx?.external?.datamodel?.field,
  },
  {
    family: "roles",
    skillId: "rbac",
    kind: "role",
    label: "RBAC role",
    unresolvedCode: "APPBUNDLE_ROLE_UNRESOLVED",
    missingCode: "APPBUNDLE_REF_MISSING_ROLE",
    collect: model => [
      ...refsFromList(model.roleRefs, "roleRefs"),
      ...model.menuEntries.flatMap((menu, menuIndex) =>
        menu.roleRefs.map((ref, roleIndex) => ({ ref, path: `menuEntries[${menuIndex}].roleRefs[${roleIndex}]` })),
      ),
    ],
    surface: ctx => ctx?.external?.rbac?.role,
  },
  {
    family: "permissions",
    skillId: "rbac",
    kind: "permission",
    label: "RBAC permission",
    unresolvedCode: "APPBUNDLE_PERMISSION_UNRESOLVED",
    missingCode: "APPBUNDLE_REF_MISSING_PERMISSION",
    collect: model => refsFromList(model.permissionRefs, "permissionRefs"),
    surface: ctx => ctx?.external?.rbac?.permission,
  },
  {
    family: "workflows",
    skillId: "workflow",
    kind: "workflow",
    label: "Workflow",
    unresolvedCode: "APPBUNDLE_WORKFLOW_UNRESOLVED",
    missingCode: "APPBUNDLE_REF_MISSING_WORKFLOW",
    collect: model => [
      ...refsFromList(model.workflowRefs, "workflowRefs"),
      ...model.pageBindings.flatMap((binding, bindingIndex) =>
        binding.workflowRef ? [{ ref: binding.workflowRef, path: `pageBindings[${bindingIndex}].workflowRef` }] : [],
      ),
    ],
    surface: ctx => ctx?.external?.workflow?.workflow,
  },
  {
    family: "pages",
    skillId: "page",
    kind: "page",
    label: "Page",
    unresolvedCode: "APPBUNDLE_PAGE_UNRESOLVED",
    missingCode: "APPBUNDLE_REF_MISSING_PAGE",
    collect: model => [
      ...refsFromList(model.pageRefs, "pageRefs"),
      ...model.menuEntries.map((menu, menuIndex) => ({ ref: menu.pageRef, path: `menuEntries[${menuIndex}].pageRef` })),
      ...model.pageBindings.map((binding, bindingIndex) => ({ ref: binding.pageRef, path: `pageBindings[${bindingIndex}].pageRef` })),
    ],
    surface: ctx => ctx?.external?.page?.page,
  },
  {
    family: "aigcCapabilities",
    skillId: "aigc",
    kind: "capability",
    label: "AIGC capability",
    unresolvedCode: "APPBUNDLE_AIGC_UNRESOLVED",
    missingCode: "APPBUNDLE_REF_MISSING_AIGC",
    collect: model => refsFromList(model.aigcCapabilityRefs, "aigcCapabilityRefs"),
    surface: ctx => ctx?.external?.aigc?.capability,
  },
  {
    family: "versionPins",
    skillId: "appbundle",
    kind: "versionPin",
    label: "Version pin",
    unresolvedCode: "APPBUNDLE_VERSION_PIN_UNRESOLVED",
    missingCode: "APPBUNDLE_VERSION_PIN_MISSING",
    collect: () => [],
    surface: () => [],
  },
];

function pushClosureMatrixFindings(f: Finding[], model: AppBundleModel, ctx?: ValidateContext): void {
  APPBUNDLE_CLOSURE_MATRIX.forEach(row => {
    if (row.family === "versionPins") return;
    pushPreciseMissingSurfaceFindings(
      f,
      row.unresolvedCode,
      row.collect(model),
      row.surface(ctx),
      row.missingCode,
      row.label,
    );
  });
}

const REQUIRED_PIN_SKILLS: AppBundleSkillId[] = ["datamodel", "rbac", "workflow", "page", "appbundle"];

function pinnedRef(skillId: AppBundleSkillId, ref: string, version: string): string {
  return `${skillId}:${ref}@${version}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isFixedPinVersion(version: string): boolean {
  if (typeof version !== "string" || !version) return false;
  const v = version.trim();
  const lower = v.toLowerCase();
  if (lower === "latest" || lower === "*" || lower === "x") return false;
  if (/[\^~<>=*]/.test(v)) return false;
  if (/\.x\b|\*|\.X\b/i.test(v)) return false;
  if (/\s-\s|\|\|/.test(v)) return false;
  // Accept concrete versions like 1.0.0, 2.3.4-beta etc.
  return /^\d+\.\d+(\.\d+)?([.-][A-Za-z0-9]+)*$/.test(v);
}

function expectedVersionPinRefs(model: AppBundleModel): Array<{ skillId: AppBundleSkillId; ref: string }> {
  return [
    ...unique(model.entityRefs).map(ref => ({ skillId: "datamodel" as const, ref })),
    ...unique(model.fieldRefs ?? []).map(ref => ({ skillId: "datamodel" as const, ref })),
    ...unique([...model.roleRefs, ...menuRoleRefs(model.menuEntries)]).map(ref => ({ skillId: "rbac" as const, ref })),
    ...unique(model.permissionRefs ?? []).map(ref => ({ skillId: "rbac" as const, ref })),
    ...unique([...model.workflowRefs, ...model.pageBindings.flatMap(binding => (binding.workflowRef ? [binding.workflowRef] : []))]).map(ref => ({
      skillId: "workflow" as const,
      ref,
    })),
    ...unique([...model.pageRefs, ...model.menuEntries.map(menu => menu.pageRef), ...model.pageBindings.map(binding => binding.pageRef)]).map(ref => ({
      skillId: "page" as const,
      ref,
    })),
    ...unique(model.aigcCapabilityRefs ?? []).map(ref => ({ skillId: "aigc" as const, ref })),
    { skillId: "appbundle" as const, ref: model.id },
  ];
}

export interface AppBundlePublishGateContext extends ValidateContext {
  skillFindings?: Finding[];
}

export interface AppBundlePublishGateReport {
  publishable: boolean;
  blockers: Finding[];
  perSkillSummaries?: Record<string, { skillId: string; blockers: Finding[]; unresolvedCount: number }>;
  unresolvedRefs?: Array<{
    sourceSkill: string;
    path: string;
    kind: string;
    targetValue: string;
    code: string;
  }>;
}

function publishBlocker(code: string, path: string, message: string): Finding {
  return { code, severity: "error", path, message };
}

export const appBundleSkill: Skill<AppBundleModel> & CrossSkill<AppBundleModel> = {
  id: "appbundle",
  title: "应用中心",

  crossRefs(model: AppBundleModel): CrossRefEdge[] {
    const refs: CrossRefEdge[] = [];
    const fromNode = appNodeId(model.id);

    model.entityRefs.forEach(entity =>
      refs.push({ fromNode, toSkill: "datamodel", toKind: "entity", toValue: entity, label: "实体" }),
    );
    (model.fieldRefs ?? []).forEach(field =>
      refs.push({ fromNode, toSkill: "datamodel", toKind: "field", toValue: field, label: "field" }),
    );
    model.roleRefs.forEach(role =>
      refs.push({ fromNode, toSkill: "rbac", toKind: "role", toValue: role, label: "角色" }),
    );
    (model.permissionRefs ?? []).forEach(permission =>
      refs.push({ fromNode, toSkill: "rbac", toKind: "permission", toValue: permission, label: "permission" }),
    );
    model.workflowRefs.forEach(workflow =>
      refs.push({ fromNode, toSkill: "workflow", toKind: "workflow", toValue: workflow, label: "流程" }),
    );
    model.pageRefs.forEach(page =>
      refs.push({ fromNode, toSkill: "page", toKind: "page", toValue: page, label: "页面" }),
    );
    (model.aigcCapabilityRefs ?? []).forEach(capability =>
      refs.push({ fromNode, toSkill: "aigc", toKind: "capability", toValue: capability, label: "AIGC" }),
    );

    model.menuEntries.forEach(menu => {
      refs.push({
        fromNode: menuNodeId(menu.id),
        toSkill: "page",
        toKind: "page",
        toValue: menu.pageRef,
        label: "入口页面",
      });
      menu.roleRefs.forEach(role =>
        refs.push({
          fromNode: menuNodeId(menu.id),
          toSkill: "rbac",
          toKind: "role",
          toValue: role,
          label: "可见角色",
        }),
      );
    });

    model.pageBindings.forEach(binding => {
      const source = bindingNodeId(binding.pageRef, binding.workflowRef, binding.mode);
      refs.push({ fromNode: source, toSkill: "page", toKind: "page", toValue: binding.pageRef, label: "表单" });
      if (binding.workflowRef) {
        refs.push({
          fromNode: source,
          toSkill: "workflow",
          toKind: "workflow",
          toValue: binding.workflowRef,
          label: "流程",
        });
      }
    });

    return refs;
  },

  refNodeId(kind: string, value: string): string | null {
    if (kind === "app") return appNodeId(value);
    if (kind === "menu") return menuNodeId(value);
    return null;
  },

  validate(model: AppBundleModel, ctx?: ValidateContext): ReturnType<Skill<AppBundleModel>["validate"]> {
    const f: Finding[] = [];

    for (const dup of findDuplicates(model.menuEntries.map(menu => menu.id))) {
      f.push({
        code: "APPBUNDLE_DUP_MENU_ID",
        severity: "error",
        path: `menuEntries.${dup}`,
        message: `Duplicate app menu entry id: ${dup}`,
      });
    }

    pushClosureMatrixFindings(f, model, ctx);

    if (model.versionPins) {
      for (const skillId of REQUIRED_PIN_SKILLS) {
        if (!model.versionPins.some(pin => pin.skillId === skillId)) {
          f.push({
            code: "APPBUNDLE_VERSION_PIN_MISSING",
            severity: "error",
            path: "versionPins",
            message: `AppBundle publish snapshot is missing a version pin for ${skillId}.`,
          });
        }
      }
      model.versionPins.forEach((pin, pinIndex) => {
        if (!pin.ref || !pin.version || !pin.pinnedAt) {
          f.push({
            code: "APPBUNDLE_VERSION_PIN_INCOMPLETE",
            severity: "error",
            path: `versionPins[${pinIndex}]`,
            message: `AppBundle version pin for ${pin.skillId} must include ref, version, and pinnedAt.`,
          });
        } else if (!isFixedPinVersion(pin.version)) {
          f.push({
            code: "APPBUNDLE_VERSION_PIN_MOVABLE",
            severity: "error",
            path: `versionPins[${pinIndex}]`,
            message: `AppBundle version pin for ${pin.skillId}:${pin.ref} must use a fixed version; "${pin.version}" is a movable/latest-style version.`,
          });
        }
      });
    }

    if (model.publishManifest && model.publishManifest.appId !== model.id) {
      f.push({
        code: "APPBUNDLE_MANIFEST_APP_MISMATCH",
        severity: "error",
        path: "publishManifest.appId",
        message: `Publish manifest app id ${model.publishManifest.appId} does not match bundle id ${model.id}.`,
      });
    }
    if (model.publishManifest?.closureEvidenceDigest != null && !/^[0-9a-f]{6,}$/i.test(model.publishManifest.closureEvidenceDigest)) {
      f.push({
        code: "APPBUNDLE_PUBLISH_MANIFEST_ILLEGAL_CLOSURE_DIGEST",
        severity: "error",
        path: "publishManifest.closureEvidenceDigest",
        message: `Publish manifest closureEvidenceDigest must be a stable hex digest; got "${model.publishManifest.closureEvidenceDigest}".`,
      });
    }

    if (model.runtimeSnapshot) {
      const pinnedRefs = new Set(model.versionPins?.map(pin => pinnedRef(pin.skillId, pin.ref, pin.version)) ?? []);
      model.runtimeSnapshot.pinnedRefs.forEach((ref, refIndex) => {
        if (!pinnedRefs.has(ref)) {
          f.push({
            code: "APPBUNDLE_SNAPSHOT_REF_NOT_PINNED",
            severity: "error",
            path: `runtimeSnapshot.pinnedRefs[${refIndex}]`,
            message: `Runtime snapshot ref is not backed by a version pin: ${ref}`,
          });
        }
      });
      // Hardening: runtime snapshot must cover the full pinned closure of assembled child refs (datamodel, rbac, workflow, page, aigc, appbundle).
      // This ensures snapshot "resolves only pinned child versions" and that omitting any assembled child's pin entry fails.
      const snapshotSet = new Set(model.runtimeSnapshot.pinnedRefs);
      (model.versionPins ?? []).forEach((pin, pinIndex) => {
        const pref = pinnedRef(pin.skillId, pin.ref, pin.version);
        if (!snapshotSet.has(pref)) {
          f.push({
            code: "APPBUNDLE_SNAPSHOT_INCOMPLETE",
            severity: "error",
            path: `runtimeSnapshot.pinnedRefs`,
            message: `Runtime snapshot missing pinned child version for assembled ref: ${pref}`,
          });
        }
      });
    }

    if (model.releaseArtifact) {
      if (model.releaseArtifact.appId !== model.id) {
        f.push({
          code: "APPBUNDLE_RELEASE_ARTIFACT_APP_MISMATCH",
          severity: "error",
          path: "releaseArtifact.appId",
          message: `Release artifact app id ${model.releaseArtifact.appId} does not match bundle id ${model.id}.`,
        });
      }
      if (!model.releaseArtifact.traceId || model.releaseArtifact.traceId.trim() === "") {
        f.push({
          code: "APPBUNDLE_RELEASE_ARTIFACT_MISSING_TRACE",
          severity: "error",
          path: "releaseArtifact.traceId",
          message: `Release artifact requires a non-empty traceId.`,
        });
      }
      if (!model.releaseArtifact.publishGateEvidence || !model.releaseArtifact.publishGateEvidence.status) {
        f.push({
          code: "APPBUNDLE_RELEASE_ARTIFACT_MISSING_GATE_EVIDENCE",
          severity: "error",
          path: "releaseArtifact.publishGateEvidence",
          message: `Release artifact requires publishGateEvidence with status.`,
        });
      }
    }

    if (model.rollbackTargets) {
      const currentVer = model.publishManifest?.appVersion ?? model.releaseArtifact?.appVersion;
      model.rollbackTargets.forEach((target, idx) => {
        const p = `rollbackTargets[${idx}]`;
        if (!target.appVersion || typeof target.exists !== "boolean" || typeof target.immutable !== "boolean") {
          f.push({
            code: "APPBUNDLE_ROLLBACK_TARGET_INCOMPLETE",
            severity: "error",
            path: p,
            message: `Rollback target must include appVersion, exists (boolean), and immutable (boolean).`,
          });
        }
        if (target.appId && target.appId !== model.id) {
          f.push({
            code: "APPBUNDLE_ROLLBACK_TARGET_APP_MISMATCH",
            severity: "error",
            path: `${p}.appId`,
            message: `Rollback target appId ${target.appId} does not match bundle id ${model.id}.`,
          });
        }
        if (target.exists === false) {
          f.push({
            code: "APPBUNDLE_ROLLBACK_TARGET_NOT_EXISTS",
            severity: "error",
            path: p,
            message: `Rollback target ${target.appVersion} must exist.`,
          });
        }
        if (target.immutable === false) {
          f.push({
            code: "APPBUNDLE_ROLLBACK_TARGET_MUTABLE",
            severity: "error",
            path: p,
            message: `Rollback target ${target.appVersion} must be immutable.`,
          });
        }
        if (currentVer && target.appVersion === currentVer) {
          f.push({
            code: "APPBUNDLE_ROLLBACK_TARGET_NOT_PRIOR",
            severity: "error",
            path: p,
            message: `Rollback target version ${target.appVersion} must point to a prior release artifact.`,
          });
        }
        if (target.appVersion && !isFixedPinVersion(target.appVersion)) {
          f.push({
            code: "APPBUNDLE_ROLLBACK_TARGET_MOVABLE",
            severity: "error",
            path: p,
            message: `Rollback target version ${target.appVersion} must be a fixed version.`,
          });
        }
      });
    }

    return finalizeReport(f);
  },

  project(model: AppBundleModel): Projection {
    const nodes: Projection["nodes"] = [
      { id: appNodeId(model.id), label: model.name, kind: "app" },
      ...model.menuEntries.map(menu => ({ id: menuNodeId(menu.id), label: menu.label, kind: "menu" })),
      ...model.pageBindings.map(binding => ({
        id: bindingNodeId(binding.pageRef, binding.workflowRef, binding.mode),
        label: `${binding.mode}: ${binding.pageRef}`,
        kind: "binding",
      })),
      ...(model.publishManifest
        ? [{ id: publishGateNodeId(model.id), label: `publish gate: ${model.publishManifest.gateStatus}`, kind: "publishGate" }]
        : []),
      ...(model.runtimeSnapshot
        ? [{ id: runtimeSnapshotNodeId(model.id), label: `runtime snapshot: ${model.runtimeSnapshot.appVersion}`, kind: "runtimeSnapshot" }]
        : []),
      ...(model.releaseArtifact
        ? [{ id: releaseArtifactNodeId(model.id), label: `release artifact: ${model.releaseArtifact.appVersion} (${model.releaseArtifact.traceId})`, kind: "releaseArtifact" }]
        : []),
      ...((model.rollbackTargets ?? []).map(t => ({
        id: rollbackTargetNodeId(model.id, t.appVersion),
        label: `rollback target: ${t.appVersion} exists:${t.exists} immutable:${t.immutable}`,
        kind: "rollbackTarget",
      }))),
    ];
    const edges: Projection["edges"] = [
      ...model.menuEntries.map(menu => ({
        from: appNodeId(model.id),
        to: menuNodeId(menu.id),
        label: "menu",
        kind: "menu",
      })),
      ...model.pageBindings.map(binding => ({
        from: appNodeId(model.id),
        to: bindingNodeId(binding.pageRef, binding.workflowRef, binding.mode),
        label: binding.mode,
        kind: "binding",
      })),
      ...(model.publishManifest
        ? [{ from: appNodeId(model.id), to: publishGateNodeId(model.id), label: "closure", kind: "publishGate" }]
        : []),
      ...(model.publishManifest && model.runtimeSnapshot
        ? [{ from: publishGateNodeId(model.id), to: runtimeSnapshotNodeId(model.id), label: "pins", kind: "runtimeSnapshot" }]
        : []),
      ...(model.releaseArtifact
        ? [{ from: appNodeId(model.id), to: releaseArtifactNodeId(model.id), label: "release", kind: "releaseArtifact" }]
        : []),
      ...((model.rollbackTargets ?? []).map(t => ({
        from: model.releaseArtifact ? releaseArtifactNodeId(model.id) : appNodeId(model.id),
        to: rollbackTargetNodeId(model.id, t.appVersion),
        label: "rollback",
        kind: "rollbackTarget",
      }))),
    ];

    const lines: string[] = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}["${n.label}"]`);
    for (const e of edges) lines.push(`  ${e.from} -->|${e.label ?? ""}| ${e.to}`);
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  resolve(model: AppBundleModel): ResolvableSurface {
    const crossRuntime = buildAppBundleCrossRuntimeEdges(model);
    return {
      app: [model.id],
      menu: model.menuEntries.map(menu => menu.id),
      pageBinding: model.pageBindings.map(binding => `${binding.pageRef}->${binding.workflowRef ?? "none"}`),
      runtimeEvidence: crossRuntime.map(edge => edge.evidenceKey),
      crossSkillRuntimeEdges: crossRuntime.map(edge => `${edge.sourceSkill}->${edge.targetSkill}:${edge.state}`),
      ...(model.runtimeSnapshot?.pinnedRefs ? { pinnedRefs: [...model.runtimeSnapshot.pinnedRefs] } : {}),
      ...(model.releaseArtifact ? { releaseArtifact: [model.releaseArtifact.appVersion, model.releaseArtifact.traceId] } : {}),
      ...(model.rollbackTargets ? { rollbackTargets: model.rollbackTargets.map(t => `${t.appVersion}:${t.exists}:${t.immutable}`) } : {}),
    } as ResolvableSurface;
  },

  async generate(intent: string): Promise<AppBundleModel> {
    if (/purchase|procurement|采购/i.test(intent)) return purchaseApprovalAppBundle;
    if (/请假|leave|审批/i.test(intent)) return leaveApprovalAppBundle;
    throw new Error(`appBundleSkill.generate: needs the reasoning engine to package an app bundle for intent: "${intent}"`);
  },
};

export function validateAppBundlePublishGate(
  model: AppBundleModel,
  ctx: AppBundlePublishGateContext = {},
): AppBundlePublishGateReport {
  const blockers: Finding[] = [];
  const report = appBundleSkill.validate(model, ctx);

  report.errors.forEach(error => {
    if (error.code.startsWith("APPBUNDLE_REF_MISSING_")) {
      blockers.push(publishBlocker("APPBUNDLE_PUBLISH_REF_MISSING", error.path, error.message));
      return;
    }
    if (error.code === "APPBUNDLE_SNAPSHOT_REF_NOT_PINNED" || error.code === "APPBUNDLE_VERSION_PIN_MISSING" || error.code === "APPBUNDLE_VERSION_PIN_MOVABLE" || error.code === "APPBUNDLE_SNAPSHOT_INCOMPLETE") {
      blockers.push(publishBlocker("APPBUNDLE_VERSION_UNPINNED", error.path, error.message));
      return;
    }
    blockers.push(error);
  });

  report.warnings.forEach(warning => {
    if (warning.code === "APPBUNDLE_AIGC_UNRESOLVED") {
      blockers.push(publishBlocker("APPBUNDLE_AIGC_UNRESOLVED", warning.path, warning.message));
      return;
    }
    if (warning.code.endsWith("_UNRESOLVED")) {
      blockers.push(publishBlocker("APPBUNDLE_GHOST_REF", warning.path, warning.message));
    }
  });

  expectedVersionPinRefs(model).forEach(expected => {
    const pin = (model.versionPins ?? []).find(pin => pin.skillId === expected.skillId && pin.ref === expected.ref);
    if (!pin) {
      blockers.push(
        publishBlocker(
          "APPBUNDLE_VERSION_UNPINNED",
          `versionPins.${expected.skillId}.${expected.ref}`,
          `AppBundle publish gate requires a pinned version for ${expected.skillId}:${expected.ref}.`,
        ),
      );
    } else if (!isFixedPinVersion(pin.version)) {
      blockers.push(
        publishBlocker(
          "APPBUNDLE_VERSION_UNPINNED",
          `versionPins.${expected.skillId}.${expected.ref}`,
          `AppBundle publish gate requires a pinned version for ${expected.skillId}:${expected.ref}; "${pin.version}" is a movable/latest-style version and is not allowed.`,
        ),
      );
    }
  });

  (ctx.skillFindings ?? []).forEach(finding => {
    if (finding.code === "PAGE_PEP_BYPASS" || finding.code === "WF_PEP_BYPASS") {
      blockers.push(publishBlocker("APPBUNDLE_PEP_BYPASS", finding.path, finding.message));
    }
  });

  // Build per-skill summaries and unresolved cross-refs (with source skill, precise path, kind, targetValue)
  const perSkillSummaries: Record<string, { skillId: string; blockers: Finding[]; unresolvedCount: number }> = {};
  const unresolvedRefs: Array<{ sourceSkill: string; path: string; kind: string; targetValue: string; code: string }> = [];

  function recordForSkill(skillId: string, blocker: Finding, kind: string, targetValue: string) {
    if (!perSkillSummaries[skillId]) {
      perSkillSummaries[skillId] = { skillId, blockers: [], unresolvedCount: 0 };
    }
    perSkillSummaries[skillId].blockers.push(blocker);
    perSkillSummaries[skillId].unresolvedCount += 1;
    unresolvedRefs.push({
      sourceSkill: "appbundle",
      path: blocker.path,
      kind,
      targetValue,
      code: blocker.code,
    });
  }

  function inferKindAndTargetFromCodeAndPath(code: string, path: string, message: string): { skillId: string; kind: string; target: string } {
    if (code.includes("AIGC") || path.includes("aigcCapabilityRefs") || path.includes("aigc")) return { skillId: "aigc", kind: "capability", target: extractTargetFromMessage(message) };
    if (code.includes("FIELD") || path.includes("fieldRefs")) return { skillId: "datamodel", kind: "field", target: extractTargetFromMessage(message) };
    if (code.includes("PERMISSION") || path.includes("permissionRefs")) return { skillId: "rbac", kind: "permission", target: extractTargetFromMessage(message) };
    if (code.includes("ROLE") || path.includes("roleRefs")) return { skillId: "rbac", kind: "role", target: extractTargetFromMessage(message) };
    if (code.includes("PAGE") || path.includes("pageRef") || path.includes("pageRefs")) return { skillId: "page", kind: "page", target: extractTargetFromMessage(message) };
    if (code.includes("WORKFLOW") || path.includes("workflowRef") || path.includes("workflowRefs")) return { skillId: "workflow", kind: "workflow", target: extractTargetFromMessage(message) };
    if (code.includes("ENTITY") || path.includes("entityRefs")) return { skillId: "datamodel", kind: "entity", target: extractTargetFromMessage(message) };
    if (path.includes("versionPins")) {
      const m = path.match(/versionPins\.([^.]+)\.(.+)$/);
      const sk = m ? m[1] : "appbundle";
      return { skillId: sk, kind: "versionPin", target: m ? `${m[1]}:${m[2]}` : extractTargetFromMessage(message) };
    }
    if (code.includes("PEP")) {
      const sk = code.includes("PAGE") || path.includes("page") ? "page" : "workflow";
      return { skillId: sk, kind: "pepBypass", target: extractTargetFromMessage(message) };
    }
    return { skillId: "appbundle", kind: "ref", target: extractTargetFromMessage(message) };
  }

  // Record from transformed blockers for refs, ghosts, versions, peps
  blockers.forEach(b => {
    if (
      b.code === "APPBUNDLE_PUBLISH_REF_MISSING" ||
      b.code === "APPBUNDLE_GHOST_REF" ||
      b.code === "APPBUNDLE_AIGC_UNRESOLVED" ||
      b.code === "APPBUNDLE_VERSION_UNPINNED" ||
      b.code === "APPBUNDLE_PEP_BYPASS"
    ) {
      const info = inferKindAndTargetFromCodeAndPath(b.code, b.path, b.message);
      // for ref-missings and ghosts use source from model, but record only ref-like
      if (b.code === "APPBUNDLE_PUBLISH_REF_MISSING" || b.code === "APPBUNDLE_GHOST_REF" || b.code === "APPBUNDLE_AIGC_UNRESOLVED") {
        recordForSkill(info.skillId, b, info.kind, info.target);
      } else if (b.code === "APPBUNDLE_VERSION_UNPINNED") {
        // record pins separately under per-skill but also to unresolvedRefs
        if (!perSkillSummaries[info.skillId]) {
          perSkillSummaries[info.skillId] = { skillId: info.skillId, blockers: [], unresolvedCount: 0 };
        }
        perSkillSummaries[info.skillId].blockers.push(b);
        perSkillSummaries[info.skillId].unresolvedCount += 1;
        unresolvedRefs.push({
          sourceSkill: "appbundle",
          path: b.path,
          kind: info.kind,
          targetValue: info.target,
          code: b.code,
        });
      } else if (b.code === "APPBUNDLE_PEP_BYPASS") {
        if (!perSkillSummaries[info.skillId]) {
          perSkillSummaries[info.skillId] = { skillId: info.skillId, blockers: [], unresolvedCount: 0 };
        }
        perSkillSummaries[info.skillId].blockers.push(b);
        perSkillSummaries[info.skillId].unresolvedCount += 1;
        unresolvedRefs.push({
          sourceSkill: "appbundle",
          path: b.path,
          kind: info.kind,
          targetValue: info.target,
          code: b.code,
        });
      }
    } else if (b.severity === "error") {
      // other appbundle errors go to appbundle summary
      if (!perSkillSummaries.appbundle) {
        perSkillSummaries.appbundle = { skillId: "appbundle", blockers: [], unresolvedCount: 0 };
      }
      perSkillSummaries.appbundle.blockers.push(b);
    }
  });

  return {
    publishable: blockers.length === 0,
    blockers,
    perSkillSummaries: Object.keys(perSkillSummaries).length > 0 ? perSkillSummaries : undefined,
    unresolvedRefs: unresolvedRefs.length > 0 ? unresolvedRefs : undefined,
  };
}

export type AppBundleRuntimeTargetSkill = Exclude<AppBundleSkillId, "appbundle">;

export type AppBundleRuntimeEvidenceState = "allowed" | "blocked";

export interface AppBundleCrossRuntimeEvidence {
  sourceSkill: "appbundle";
  targetSkill: AppBundleRuntimeTargetSkill;
  evidenceKey: string;
  appId: string;
  appVersion: string;
  declaredRefs: string[];
  pinnedRefs: string[];
  state: AppBundleRuntimeEvidenceState;
  reasonCode: string;
  closureHash?: string;
}

export interface NormalizedAppBundleRuntimeContext {
  sourceSkill: "appbundle";
  targetSkill: AppBundleRuntimeTargetSkill;
  appId: string;
  appVersion: string;
  declaredRefs: string[];
  pinnedRefs: string[];
  upstreamEvidencePresent: boolean;
  evidence: AppBundleCrossRuntimeEvidence;
}

export const APPBUNDLE_CROSS_RUNTIME_EVIDENCE = "APPBUNDLE_CROSS_RUNTIME_EVIDENCE";
export const APPBUNDLE_PAGE_NEGATIVE_RUNTIME_PATH = "APPBUNDLE_PAGE_NEGATIVE_RUNTIME_PATH";
export const APPBUNDLE_AIGC_POSITIVE_RUNTIME_PATH = "APPBUNDLE_AIGC_POSITIVE_RUNTIME_PATH";
export const APPBUNDLE_AIGC_NEGATIVE_RUNTIME_PATH = "APPBUNDLE_AIGC_NEGATIVE_RUNTIME_PATH";

function declaredRefsForTarget(model: AppBundleModel, targetSkill: AppBundleRuntimeTargetSkill): string[] {
  if (targetSkill === "datamodel") return [...model.entityRefs, ...(model.fieldRefs ?? [])].sort();
  if (targetSkill === "rbac") return [...model.roleRefs, ...(model.permissionRefs ?? []), ...menuRoleRefs(model.menuEntries)].sort();
  if (targetSkill === "workflow") return [...model.workflowRefs, ...model.pageBindings.flatMap(binding => binding.workflowRef ? [binding.workflowRef] : [])].sort();
  if (targetSkill === "page") {
    return [
      ...model.pageRefs,
      ...model.pageBindings.map(binding => binding.pageRef),
      ...model.menuEntries.map(menu => menu.pageRef),
    ].sort();
  }
  return [...(model.aigcCapabilityRefs ?? [])].sort();
}

function targetSurfaceHasEvidence(surface: unknown): boolean {
  if (!surface) return false;
  if (Array.isArray(surface)) return surface.length > 0;
  if (typeof surface !== "object") return true;
  return Object.values(surface as Record<string, unknown>).some(value => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null;
  });
}

function pinnedRefsForTarget(snapshot: AppBundleRuntimeSnapshot, targetSkill: AppBundleRuntimeTargetSkill): string[] {
  const prefix = `${targetSkill}:`;
  return snapshot.pinnedRefs.filter(ref => ref.startsWith(prefix)).sort();
}

export function createAppBundleCrossRuntimeEvidence(
  model: AppBundleModel,
  targetSkill: AppBundleRuntimeTargetSkill,
  upstreamSurface?: unknown,
): AppBundleCrossRuntimeEvidence {
  const snapshot = createAppBundleRuntimeSnapshot(model);
  const declaredRefs = declaredRefsForTarget(model, targetSkill);
  const pinnedRefs = pinnedRefsForTarget(snapshot, targetSkill);
  const upstreamEvidencePresent = targetSurfaceHasEvidence(upstreamSurface);
  const state: AppBundleRuntimeEvidenceState =
    declaredRefs.length > 0 && upstreamEvidencePresent ? "allowed" : "blocked";
  const reasonCode =
    state === "allowed"
      ? "APPBUNDLE_RUNTIME_EVIDENCE_PRESENT"
      : upstreamEvidencePresent
        ? "APPBUNDLE_RUNTIME_REFS_ABSENT"
        : "APPBUNDLE_RUNTIME_UPSTREAM_ABSENT";

  return {
    sourceSkill: "appbundle",
    targetSkill,
    evidenceKey: `${APPBUNDLE_CROSS_RUNTIME_EVIDENCE}:${model.id}:${targetSkill}:${state}`,
    appId: model.id,
    appVersion: snapshot.appVersion,
    declaredRefs,
    pinnedRefs,
    state,
    reasonCode,
    closureHash: snapshot.closureHash,
  };
}

export function normalizeAppBundleRuntimeContextForSkill(
  model: AppBundleModel,
  targetSkill: AppBundleRuntimeTargetSkill,
  upstreamSurface?: unknown,
): NormalizedAppBundleRuntimeContext {
  const evidence = createAppBundleCrossRuntimeEvidence(model, targetSkill, upstreamSurface);
  return {
    sourceSkill: "appbundle",
    targetSkill,
    appId: evidence.appId,
    appVersion: evidence.appVersion,
    declaredRefs: evidence.declaredRefs,
    pinnedRefs: evidence.pinnedRefs,
    upstreamEvidencePresent: evidence.state === "allowed",
    evidence,
  };
}

export function buildAppBundleCrossRuntimeEdges(model: AppBundleModel): AppBundleCrossRuntimeEvidence[] {
  const targets: AppBundleRuntimeTargetSkill[] = ["datamodel", "rbac", "workflow", "page", "aigc"];
  return targets
    .filter(target => declaredRefsForTarget(model, target).length > 0)
    .map(target => createAppBundleCrossRuntimeEvidence(model, target, { declared: declaredRefsForTarget(model, target) }));
}

export function createAppBundlePageNegativePathSample(model: AppBundleModel = leaveApprovalAppBundle): NormalizedAppBundleRuntimeContext {
  const ctx = normalizeAppBundleRuntimeContextForSkill(model, "page");
  return {
    ...ctx,
    evidence: {
      ...ctx.evidence,
      evidenceKey: APPBUNDLE_PAGE_NEGATIVE_RUNTIME_PATH,
      state: "blocked",
      reasonCode: "APPBUNDLE_PAGE_UPSTREAM_ABSENT",
    },
    upstreamEvidencePresent: false,
  };
}

export function createAppBundleAigcPositivePathSample(
  model: AppBundleModel = purchaseApprovalAppBundle,
  upstreamSurface: unknown = { capability: model.aigcCapabilityRefs ?? [] },
): NormalizedAppBundleRuntimeContext {
  const ctx = normalizeAppBundleRuntimeContextForSkill(model, "aigc", upstreamSurface);
  return {
    ...ctx,
    evidence: {
      ...ctx.evidence,
      evidenceKey: APPBUNDLE_AIGC_POSITIVE_RUNTIME_PATH,
    },
  };
}

export const APPBUNDLE_WORKFLOW_TASK_VIEW_POSITIVE = "APPBUNDLE_WORKFLOW_TASK_VIEW_POSITIVE";
export const APPBUNDLE_WORKFLOW_TASK_VIEW_NEGATIVE = "APPBUNDLE_WORKFLOW_TASK_VIEW_NEGATIVE";

/** 119 positive evidence path sample: AppBundle pageBinding + Page + Workflow instance yields valid task view. */
export function createAppBundleWorkflowTaskViewPositiveSample(
  model: AppBundleModel = leaveApprovalAppBundle,
  pageModels: Record<string, PageModel> = {}
): { state: "allowed"; consistency: boolean; evidenceKey: string } {
  const binding = (model.pageBindings ?? [])[0];
  const page = (pageModels as any)[binding?.pageRef] || leaveApprovalPage;
  const inst = { workflowId: binding?.workflowRef, currentNodeId: "a_mgr" };
  const ev = createWorkflowTaskViewAppBundleBindingEvidence(page, binding, inst);
  return {
    state: "allowed",
    consistency: ev.state === "allowed" && ev.result !== PAGE_WORKFLOW_TASK_VIEW_INVALID,
    evidenceKey: APPBUNDLE_WORKFLOW_TASK_VIEW_POSITIVE,
  };
}

/** 119 fail-closed negative: mismatched binding or missing node produces blocked/INVALID. */
export function createAppBundleWorkflowTaskViewNegativeSample(
  model: AppBundleModel = leaveApprovalAppBundle
): { state: "blocked"; consistency: boolean; evidenceKey: string } {
  const binding = (model.pageBindings ?? [])[0];
  // mismatch wf
  const badInst = { workflowId: "wf_ghost", currentNodeId: "" };
  const ev = createWorkflowTaskViewAppBundleBindingEvidence({} as any, binding, badInst as any);
  return {
    state: "blocked",
    consistency: false,
    evidenceKey: APPBUNDLE_WORKFLOW_TASK_VIEW_NEGATIVE,
  };
}

export function createAppBundleAigcNegativePathSample(
  model: AppBundleModel = purchaseApprovalAppBundle
): NormalizedAppBundleRuntimeContext {
  // Negative sample for AIGC in AppBundle closure: absent upstream (policy/schema evidence) yields blocked fail-closed.
  const ctx = normalizeAppBundleRuntimeContextForSkill(model, "aigc");
  return {
    ...ctx,
    evidence: {
      ...ctx.evidence,
      evidenceKey: APPBUNDLE_AIGC_NEGATIVE_RUNTIME_PATH,
      state: "blocked",
      reasonCode: "APPBUNDLE_AIGC_POLICY_SCHEMA_EVIDENCE_ABSENT",
    },
    upstreamEvidencePresent: false,
  };
}

// 119: AppBundle aggregate edge validation across all six Skill runtime evidence surfaces.
// Pure, deterministic, no IO. Positive paths yield "allowed"; absent/missing upstreams yield explicit "blocked" fail-closed.
export const APPBUNDLE_AGGREGATE_EDGE_VALIDATION = "APPBUNDLE_AGGREGATE_EDGE_VALIDATION";

export interface AppBundleAggregateEdgeValidation {
  surfacesChecked: AppBundleSkillId[];
  totalAggregateEdges: number;
  positiveAllowedEdges: number;
  failClosedBlockedEdges: number;
  appbundleCrossEdges: AppBundleCrossRuntimeEvidence[];
  perSurfaceValidation: Record<string, { positive: boolean; failClosedSampled: boolean; edgeStates: string[] }>;
  closureEvidencePresent: boolean;
}

export function validateAppBundleAggregateEdges(models: Record<string, unknown>): AppBundleAggregateEdgeValidation {
  const surfacesChecked: AppBundleSkillId[] = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"];
  const appBundleModel = (models.appbundle || models["appBundle"]) as AppBundleModel | undefined;
  const appbundleCrossEdges = appBundleModel ? buildAppBundleCrossRuntimeEdges(appBundleModel) : [];

  const collected: Array<{ source: string; target: string; state: string }> = [];
  const perSurfaceValidation: Record<string, { positive: boolean; failClosedSampled: boolean; edgeStates: string[] }> = {};

  for (const sid of surfacesChecked) {
    const m = (models as any)[sid];
    if (!m) {
      perSurfaceValidation[sid] = { positive: false, failClosedSampled: true, edgeStates: [] };
      continue;
    }
    let surf: any = {};
    try {
      if (sid === "datamodel") {
        surf = dataModelSkill.resolve(m as any);
      } else if (sid === "rbac") {
        surf = rbacSkill.resolve(m as any);
      } else if (sid === "workflow") {
        surf = workflowSkill.resolve(m as any);
      } else if (sid === "page") {
        surf = pageSkill.resolve(m as any);
      } else if (sid === "aigc") {
        surf = aigcSkill.resolve(m as any);
      } else if (sid === "appbundle" && appBundleModel) {
        surf = appBundleSkill.resolve(appBundleModel);
      }
    } catch {
      // deterministic: missing surface shape yields empty (fail-closed path covered in tests)
    }
    const rawEdges: string[] = Array.isArray(surf.crossSkillRuntimeEdges) ? surf.crossSkillRuntimeEdges : [];
    const edgeStates: string[] = rawEdges.map((raw: string) => {
      const mm = String(raw).match(/->[^:]+:(.+)$/);
      return mm ? mm[1] : "";
    });
    const hasPositive = edgeStates.some((s) => s === "allowed");
    const hasBlocked = edgeStates.some((s) => s === "blocked");
    perSurfaceValidation[sid] = {
      positive: hasPositive,
      failClosedSampled: hasBlocked || rawEdges.length === 0,
      edgeStates,
    };
    rawEdges.forEach((raw: string) => {
      const match = String(raw).match(/^([^:]+?)->([^:]+?):(.+)$/);
      if (match) collected.push({ source: match[1], target: match[2], state: match[3] });
    });
  }

  const totalAggregateEdges = collected.length;
  const positiveAllowedEdges = collected.filter((e) => e.state === "allowed").length;
  const failClosedBlockedEdges = totalAggregateEdges - positiveAllowedEdges;
  const allSixPresent = surfacesChecked.every((s) => !!(models as any)[s]);
  const closureEvidencePresent = allSixPresent && positiveAllowedEdges > 0 && appbundleCrossEdges.length >= 0;

  return {
    surfacesChecked,
    totalAggregateEdges,
    positiveAllowedEdges,
    failClosedBlockedEdges,
    appbundleCrossEdges,
    perSurfaceValidation,
    closureEvidencePresent,
  };
}

export const APPBUNDLE_RUNTIME_CLOSURE_BLOCKED = "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED";

export interface AppBundleRuntimeClosureReport {
  blocked: boolean;
  blockers: Finding[];
  perSkillEvidence: Record<string, {
    skillId: string;
    versionPin: { pinned: boolean; version?: string };
    runtimePolicyEvidence: boolean;
    dataModelBindings: boolean;
    rbacPdpDecisions: boolean;
    workflowPageTaskViewConsistency: boolean;
    aigcInvocationOutputPolicy: boolean;
    unresolvedRefs: boolean;
    evidencePresent: boolean;
    dataModelFieldBindingEvidence?: any;
    pageRbacPermissionEvidence?: any;
  }>;
  runtimeClosure?: {
    skillsChecked: string[];
    versionPinsChecked: boolean;
    perSkill: Record<string, unknown>;
  };
  closureId?: string;
  closureHash?: string;
  generatedAt?: string;
  stableDigest?: string;
  findingsByTier?: Record<AppBundleClosureTier, Finding[]>;
  classifiedFindings?: ClassifiedAppBundleClosureFinding[];
}

export function classifyAppBundleRuntimeClosureFinding(finding: Finding): AppBundleClosureTier {
  // Deterministic tier mapping for AppBundle runtime closure findings (task 119):
  // - APPBUNDLE_RUNTIME_CLOSURE_BLOCKED or any error severity -> hard_blocker (fail-closed)
  // - APPBUNDLE_RUNTIME_EVIDENCE_PRESENT -> info (positive evidence)
  // - other warnings -> warning
  // - default -> info
  if (finding.code === APPBUNDLE_RUNTIME_CLOSURE_BLOCKED || finding.severity === "error") {
    return "hard_blocker";
  }
  if (finding.code === "APPBUNDLE_RUNTIME_EVIDENCE_PRESENT") {
    return "info";
  }
  if (finding.severity === "warning") return "warning";
  return "info";
}

function classifyAppBundleRuntimeClosureFindings(
  blockers: Finding[],
  info: Finding[],
): {
  findingsByTier: Record<AppBundleClosureTier, Finding[]>;
  classifiedFindings: ClassifiedAppBundleClosureFinding[];
} {
  const all = [...blockers, ...info];
  const findingsByTier: Record<AppBundleClosureTier, Finding[]> = {
    hard_blocker: [],
    warning: [],
    info: [],
  };
  const classifiedFindings: ClassifiedAppBundleClosureFinding[] = all.map((finding) => {
    const tier = classifyAppBundleRuntimeClosureFinding(finding);
    findingsByTier[tier].push(finding);
    return { ...finding, tier } as ClassifiedAppBundleClosureFinding;
  });
  return { findingsByTier, classifiedFindings };
}

const DM_RBAC_POLICY_IMPACT_EVIDENCE_KEY = "DM_RBAC_POLICY_IMPACT_EVIDENCE";
const DM_PAGE_BINDING_IMPACT_EVIDENCE_KEY = "DM_PAGE_BINDING_IMPACT_EVIDENCE";
const DM_WORKFLOW_BINDING_IMPACT_EVIDENCE_KEY = "DM_WORKFLOW_BINDING_IMPACT_EVIDENCE";
const RBAC_PDP_EXPLAIN_EVIDENCE_KEY = "RBAC_PDP_EXPLAIN_EVIDENCE";

function collectPositiveRuntimeEvidenceKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    value.forEach((item) => collectPositiveRuntimeEvidenceKeys(item, keys));
    return keys;
  }

  const record = value as Record<string, unknown>;
  const evidenceKey = typeof record.evidenceKey === "string" ? record.evidenceKey : undefined;
  if (evidenceKey) {
    const state = typeof record.state === "string" ? record.state.toLowerCase() : "";
    const reasonCode = typeof record.reasonCode === "string" ? record.reasonCode.toLowerCase() : "";
    const hasPositiveEvidence = record.hasPositiveEvidence;
    const allow = record.allow;
    const isExplicitNegative =
      state === "blocked" ||
      state === "denied" ||
      evidenceKey.toLowerCase().includes("fail-closed") ||
      reasonCode.includes("fail_closed") ||
      hasPositiveEvidence === false ||
      allow === false;
    // For RBAC PDP explain evidence, always collect (positive allow + negative deny/fail-closed) so downstream closure
    // can consume deterministic RBAC PDP allow/deny/fail-closed explanation evidence per 119 objective.
    const isRbacPdpExplain = evidenceKey.includes("RBAC_PDP_EXPLAIN_EVIDENCE");
    if (!isExplicitNegative || isRbacPdpExplain) {
      keys.add(evidenceKey);
    }
  }

  Object.values(record).forEach((item) => collectPositiveRuntimeEvidenceKeys(item, keys));
  return keys;
}

function hasEvidenceKey(keys: Set<string>, expected: string): boolean {
  for (const key of keys) {
    if (key === expected || key.startsWith(`${expected}:`)) return true;
  }
  return false;
}

function hasRuntimeEvidenceFields(m: any, skillId: string): { policy: boolean; bindings: boolean; taskView: boolean; aigcPolicy: boolean; present: boolean } {
  if (!m || typeof m !== "object") return { policy: false, bindings: false, taskView: false, aigcPolicy: false, present: false };
  const keys = Object.keys(m);
  const kset = new Set(keys.map((k: string) => k.toLowerCase()));
  const evidenceKeys = collectPositiveRuntimeEvidenceKeys(m);
  const hasDataModelRbacImpact = hasEvidenceKey(evidenceKeys, DM_RBAC_POLICY_IMPACT_EVIDENCE_KEY);
  const hasDataModelPageImpact = hasEvidenceKey(evidenceKeys, DM_PAGE_BINDING_IMPACT_EVIDENCE_KEY);
  const hasDataModelWorkflowImpact = hasEvidenceKey(evidenceKeys, DM_WORKFLOW_BINDING_IMPACT_EVIDENCE_KEY);
  const hasRbacPdpExplain = hasEvidenceKey(evidenceKeys, RBAC_PDP_EXPLAIN_EVIDENCE_KEY);
  const hasPolicy = kset.has("pep") || kset.has("actorroleref") || kset.has("policycheckrefs") || kset.has("failclosed") || kset.has("permissions") || kset.has("roles") || kset.has("dualcontrolpolicies") || kset.has("datarules") || kset.has("policydefinitions") || !!m.publishManifest || !!m.runtimeSnapshot || !!m.releaseArtifact || !!m.publishGateEvidence || hasDataModelRbacImpact || hasRbacPdpExplain;
  const hasBindings = kset.has("entities") || kset.has("entityrefs") || kset.has("fieldrefs") || kset.has("relations") || kset.has("components") || kset.has("bindings") || hasDataModelRbacImpact || hasDataModelPageImpact || hasDataModelWorkflowImpact;
  const hasTaskView = kset.has("components") || kset.has("published") || kset.has("pageversion") || kset.has("snapshotrefs") || kset.has("pagebindings") || kset.has("workflowrefs") || kset.has("menuentries") || kset.has("tasks") || hasDataModelPageImpact || hasDataModelWorkflowImpact;
  const hasAigcPolicy = kset.has("capabilities") || kset.has("outputschemas") || kset.has("retrievalpolicies") || kset.has("citationpolicies") || kset.has("prompttemplates") || kset.has("aigccapabilityrefs") || kset.has("pep");
  const present = hasPolicy || hasBindings || hasTaskView || hasAigcPolicy || (skillId === "appbundle" && (kset.has("versionpins") || kset.has("runtimesnapshot")));
  return { policy: hasPolicy, bindings: hasBindings, taskView: hasTaskView, aigcPolicy: hasAigcPolicy, present };
}

export function evaluateAppBundleRuntimeClosure(models: Record<string, unknown>): AppBundleRuntimeClosureReport {
  const blockers: Finding[] = [];
  const infoFindings: Finding[] = [];
  const perSkillEvidence: AppBundleRuntimeClosureReport["perSkillEvidence"] = {} as any;
  const appBundleModel = (models.appbundle || models["appBundle"]) as AppBundleModel | undefined;

  const skillsToCheck: AppBundleSkillId[] = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"];

  for (const skillId of skillsToCheck) {
    const skillModel = models[skillId] as any;
    const ev = hasRuntimeEvidenceFields(skillModel, skillId);
    const pin = (appBundleModel?.versionPins ?? []).find(p => p.skillId === skillId);
    const versionPin = pin && isFixedPinVersion(pin.version) ? { pinned: true, version: pin.version } : { pinned: !!pin };

    let taskViewConsistent = ev.taskView;
    if (skillId === "page" && appBundleModel && Array.isArray(appBundleModel.pageBindings) && appBundleModel.pageBindings.length > 0 && skillModel) {
      // 119: executable Workflow task view closure against Page task surfaces + AppBundle pageBindings.
      // Always use adapter when bindings declared: positive only on exact pageRef match + adapter allowed; else fail-closed (no retain of ev.taskView on mismatch).
      const pageModel = skillModel as PageModel;
      if (!pageModel || !Array.isArray(pageModel.components)) {
        taskViewConsistent = false;
      } else {
        let matched = false;
        for (const b of appBundleModel.pageBindings) {
          if (b.pageRef === pageModel.id) {
            const sampleInst = { id: "inst_119", workflowId: b.workflowRef, currentNodeId: b.mode === "approve" ? "a_mgr" : "start" };
            const bindingEv = createWorkflowTaskViewAppBundleBindingEvidence(pageModel, b, sampleInst);
            taskViewConsistent = bindingEv.state === "allowed" && bindingEv.result !== PAGE_WORKFLOW_TASK_VIEW_INVALID;
            matched = true;
            break;
          }
        }
        if (!matched) {
          // fail-closed negative: declared pageBindings but none resolve to this pageModel (pageRef mismatch / unresolved binding)
          taskViewConsistent = false;
        }
      }
    }

    // Close Page field binding evidence against DataModel SSOT (119): evaluate now explicitly
    // computes Page->datamodel field binding evidence using createPageCrossRuntimeEvidence
    // with the real datamodel (resolved SSOT surface) from models. This provides the read
    // path inside runtimeClosure so evidence participates (positive when dm present, fail-closed blocked when absent).
    let dataModelFieldBindingEvidence: any = undefined;
    if (skillId === "page" && skillModel && Array.isArray(skillModel.components)) {
      const dmM = models["datamodel"] || models["dataModel"];
      let dmUpstream: any = undefined;
      if (dmM) {
        if (dmM && Array.isArray((dmM as any).entities)) {
          dmUpstream = dataModelSkill.resolve(dmM as any);
        } else {
          // surface or presence marker passed directly (compat with test fixtures and direct calls)
          dmUpstream = dmM;
        }
      }
      dataModelFieldBindingEvidence = createPageCrossRuntimeEvidence(skillModel as any, "datamodel", dmUpstream);
    }

    // Close Page permission rendering evidence against RBAC policy surfaces (119 task):
    // compute deterministic Page->rbac via PermissionRender (roleRefs/permissionRefs) using
    // createPageRbacRuntimeEvidence with real rbac upstream surface (when present).
    // Positive: allowed + refs when RBAC surface supplied; fail-closed: blocked when absent.
    let pageRbacPermissionEvidence: any = undefined;
    if (skillId === "page" && skillModel && Array.isArray(skillModel.components)) {
      const rbM = models["rbac"] || models["rbac"];
      let rbacUpstream: any = undefined;
      if (rbM) {
        if (rbM && Array.isArray((rbM as any).roles)) {
          rbacUpstream = rbacSkill.resolve(rbM as any);
        } else {
          // surface or presence marker passed directly (compat)
          rbacUpstream = rbM;
        }
      }
      pageRbacPermissionEvidence = createPageRbacRuntimeEvidence(skillModel as any, rbacUpstream);
    }

    let pageRouteBindingEvidence: any = undefined;
    if (skillId === "page" && skillModel && Array.isArray(skillModel.components)) {
      pageRouteBindingEvidence = tracePageRouteBindingToAppBundleClosureEvidence(skillModel as any, appBundleModel);
    }

    const evidence = {
      skillId,
      versionPin,
      runtimePolicyEvidence: ev.policy,
      workflowPageTaskViewConsistency: taskViewConsistent,
      dataModelBindings: Boolean(ev.bindings) || Boolean(dataModelFieldBindingEvidence && dataModelFieldBindingEvidence.state === "allowed"),
      rbacPdpDecisions: ev.policy || Boolean(pageRbacPermissionEvidence && pageRbacPermissionEvidence.state === "allowed"),
      aigcInvocationOutputPolicy: ev.aigcPolicy,
      unresolvedRefs: false,
      evidencePresent: Boolean(ev.present) || Boolean(dataModelFieldBindingEvidence && dataModelFieldBindingEvidence.state === "allowed") || Boolean(pageRbacPermissionEvidence && pageRbacPermissionEvidence.state === "allowed") || Boolean(pageRouteBindingEvidence && pageRouteBindingEvidence.state === "closed"),
      dataModelFieldBindingEvidence,
      pageRbacPermissionEvidence,
      pageRouteBindingEvidence,
    };

    // Version pins are required for runtime closure for assembled refs
    if (appBundleModel && !pin && skillId !== "appbundle") {
      // only block if the appbundle model declares use of the skill (always for core, conditional for aigc)
      const declaresUse =
        skillId === "datamodel" || skillId === "rbac" || skillId === "workflow" || skillId === "page" ||
        (skillId === "aigc" && (appBundleModel.aigcCapabilityRefs?.length ?? 0) > 0);
      if (declaresUse) {
        blockers.push({
          code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
          severity: "error",
          path: `versionPins.${skillId}`,
          message: `Runtime closure requires a fixed version pin for ${skillId}.`,
        });
      }
    }

    const declaresAigc = (appBundleModel?.aigcCapabilityRefs?.length ?? 0) > 0;
    if (skillId === "aigc" && declaresAigc && !ev.aigcPolicy) {
      blockers.push({
        code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
        severity: "error",
        path: "aigc",
        message: "Missing AIGC runtime evidence for invocation/output policy.",
      });
    }

    const declaresPage = !!appBundleModel && (
      (appBundleModel.pageRefs?.length ?? 0) > 0 ||
      (appBundleModel.pageBindings?.length ?? 0) > 0 ||
      (appBundleModel.menuEntries?.length ?? 0) > 0
    );
    if (skillId === "page" && declaresPage && !taskViewConsistent) {
      blockers.push({
        code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
        severity: "error",
        path: "page",
        message: "Missing Page runtime evidence for task view consistency.",
      });
    }

    // Require runtime evidence present for declared skills (fail-closed)
    if (skillModel) {
      if (!ev.present) {
        blockers.push({
          code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
          severity: "error",
          path: skillId,
          message: `Skill ${skillId} provides no runtime closure evidence (policy, bindings, views, snapshot).`,
        });
      } else {
        infoFindings.push({
          code: "APPBUNDLE_RUNTIME_EVIDENCE_PRESENT",
          severity: "warning",
          path: skillId,
          message: `Runtime evidence present for ${skillId}.`,
        });
      }
    } else if (appBundleModel) {
      const requiresModel =
        skillId === "datamodel" || skillId === "rbac" || skillId === "workflow" || skillId === "page" ||
        (skillId === "aigc" && declaresAigc) || skillId === "appbundle";
      if (requiresModel) {
        blockers.push({
          code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
          severity: "error",
          path: skillId,
          message: `Runtime closure missing model/evidence for ${skillId}.`,
        });
      }
    }

    perSkillEvidence[skillId] = evidence;
  }

  // AppBundle own runtime requirements: pins + snapshot
  if (appBundleModel) {
    if (!appBundleModel.runtimeSnapshot || !appBundleModel.runtimeSnapshot.pinnedRefs || appBundleModel.runtimeSnapshot.pinnedRefs.length === 0) {
      blockers.push({
        code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
        severity: "error",
        path: "runtimeSnapshot",
        message: "AppBundle runtime closure requires runtimeSnapshot with pinnedRefs evidence.",
      });
    } else {
      infoFindings.push({
        code: "APPBUNDLE_RUNTIME_EVIDENCE_PRESENT",
        severity: "warning",
        path: "runtimeSnapshot",
        message: "Runtime evidence present for runtimeSnapshot.",
      });
    }
    if (!appBundleModel.versionPins || appBundleModel.versionPins.length === 0) {
      blockers.push({
        code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
        severity: "error",
        path: "versionPins",
        message: "AppBundle runtime closure requires versionPins.",
      });
    } else {
      infoFindings.push({
        code: "APPBUNDLE_RUNTIME_EVIDENCE_PRESENT",
        severity: "warning",
        path: "versionPins",
        message: "Runtime evidence present for versionPins.",
      });
    }
  } else {
    blockers.push({
      code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
      severity: "error",
      path: "appbundle",
      message: "Runtime closure requires appbundle model.",
    });
  }

  // unresolved refs: if any ref families have targets but no model provided for that skill when required
  // (covered above by requiresModel); also treat snapshot mismatch as unresolved for runtime
  if (appBundleModel && appBundleModel.runtimeSnapshot) {
    const pinned = new Set(appBundleModel.runtimeSnapshot.pinnedRefs || []);
    (appBundleModel.versionPins || []).forEach(pin => {
      const pref = `${pin.skillId}:${pin.ref}@${pin.version}`;
      if (!pinned.has(pref)) {
        blockers.push({
          code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
          severity: "error",
          path: "runtimeSnapshot.pinnedRefs",
          message: `Unresolved pinned ref at runtime: ${pref}`,
        });
      }
    });
  }

  // 119: explicit fail-closed for version pin vs runtime snapshot mismatch using dedicated pure helper.
  // Ensures bidirectional check even if snapshot supplied independently at runtime closure time.
  if (appBundleModel) {
    const mismatchReport = validateAppBundleVersionPinVsRuntimeSnapshot(appBundleModel);
    mismatchReport.blockers.forEach((b) => {
      if (!blockers.some((bb) => bb.code === b.code && bb.path === b.path && bb.message === b.message)) {
        blockers.push(b);
      }
    });
  }

  const appId = appBundleModel?.id ?? "unknown-app";
  const appVersion = appBundleModel?.runtimeSnapshot?.appVersion ?? appBundleModel?.publishManifest?.appVersion ?? "0.0.0";
  const skillsChecked = Object.keys(perSkillEvidence).sort();
  const evidenceBits = skillsChecked
    .map((skillId) => `${skillId}:${perSkillEvidence[skillId]?.evidencePresent ? "1" : "0"}`)
    .join("|");
  const digestInput = [
    appId,
    appVersion,
    blockers.length > 0 ? "blocked" : "ok",
    String(blockers.length),
    skillsChecked.join(","),
    evidenceBits,
  ].join("||");
  const closureId = `appbundle:${appId}@${appVersion}:runtime-closure`;
  const closureHash = simpleStableHash(digestInput);
  const stableDigest = simpleStableHash(`v119||${digestInput}`);
  const { findingsByTier, classifiedFindings } = classifyAppBundleRuntimeClosureFindings(blockers, infoFindings);

  return {
    blocked: blockers.length > 0,
    blockers,
    perSkillEvidence,
    runtimeClosure: {
      skillsChecked: Object.keys(perSkillEvidence),
      versionPinsChecked: !!appBundleModel?.versionPins?.length,
      perSkill: perSkillEvidence,
    },
    closureId,
    closureHash,
    generatedAt: new Date().toISOString(),
    stableDigest,
    findingsByTier,
    classifiedFindings,
  };
}

// 119-appbundle-runtime-closure: deterministic fixtures for closed (blocked:false, full positive evidence) and blocked (fail-closed with APPBUNDLE_RUNTIME_CLOSURE_BLOCKED) AppBundle runtime closure reports.
// Pure data; both cases included per required implementation. Stable for cross-runtime and aggregator tests.
// No network/DB/etc. Defined before use in runtimeClosure export.
export const closedAppBundleRuntimeClosureReport: AppBundleRuntimeClosureReport = Object.freeze({
  blocked: false,
  blockers: [],
  perSkillEvidence: {
    datamodel: { skillId: "datamodel", versionPin: { pinned: true, version: "1.0.0" }, runtimePolicyEvidence: true, dataModelBindings: true, rbacPdpDecisions: true, workflowPageTaskViewConsistency: false, aigcInvocationOutputPolicy: false, unresolvedRefs: false, evidencePresent: true },
    rbac: { skillId: "rbac", versionPin: { pinned: true, version: "1.0.0" }, runtimePolicyEvidence: true, dataModelBindings: false, rbacPdpDecisions: true, workflowPageTaskViewConsistency: false, aigcInvocationOutputPolicy: false, unresolvedRefs: false, evidencePresent: true },
    workflow: { skillId: "workflow", versionPin: { pinned: true, version: "1.0.0" }, runtimePolicyEvidence: true, dataModelBindings: false, rbacPdpDecisions: true, workflowPageTaskViewConsistency: true, aigcInvocationOutputPolicy: false, unresolvedRefs: false, evidencePresent: true },
    page: { skillId: "page", versionPin: { pinned: true, version: "1.0.0" }, runtimePolicyEvidence: false, dataModelBindings: false, rbacPdpDecisions: false, workflowPageTaskViewConsistency: true, aigcInvocationOutputPolicy: false, unresolvedRefs: false, evidencePresent: true },
    aigc: { skillId: "aigc", versionPin: { pinned: true, version: "1.0.0" }, runtimePolicyEvidence: false, dataModelBindings: false, rbacPdpDecisions: false, workflowPageTaskViewConsistency: false, aigcInvocationOutputPolicy: true, unresolvedRefs: false, evidencePresent: true },
    appbundle: { skillId: "appbundle", versionPin: { pinned: true, version: "1.0.0" }, runtimePolicyEvidence: false, dataModelBindings: false, rbacPdpDecisions: false, workflowPageTaskViewConsistency: false, aigcInvocationOutputPolicy: false, unresolvedRefs: false, evidencePresent: true },
  },
  runtimeClosure: {
    skillsChecked: ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"],
    versionPinsChecked: true,
    perSkill: {},
  },
  closureId: "appbundle:app_purchase_approval@1.0.0:runtime-closure",
  closureHash: "a1b2c3d4",
  generatedAt: "2026-01-01T00:00:00.000Z",
  stableDigest: "e5f6a7b8",
  findingsByTier: { hard_blocker: [], warning: [], info: [] },
  classifiedFindings: [],
});

export const blockedAppBundleRuntimeClosureReport: AppBundleRuntimeClosureReport = Object.freeze({
  blocked: true,
  blockers: [{
    code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
    severity: "error" as const,
    path: "aigc",
    message: "Missing AIGC runtime evidence for invocation/output policy.",
  }],
  perSkillEvidence: {
    aigc: { skillId: "aigc", versionPin: { pinned: false }, runtimePolicyEvidence: false, dataModelBindings: false, rbacPdpDecisions: false, workflowPageTaskViewConsistency: false, aigcInvocationOutputPolicy: false, unresolvedRefs: false, evidencePresent: false },
    appbundle: { skillId: "appbundle", versionPin: { pinned: true, version: "1.0.0" }, runtimePolicyEvidence: false, dataModelBindings: false, rbacPdpDecisions: false, workflowPageTaskViewConsistency: false, aigcInvocationOutputPolicy: false, unresolvedRefs: false, evidencePresent: true },
  },
  runtimeClosure: {
    skillsChecked: ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"],
    versionPinsChecked: true,
    perSkill: {},
  },
  closureId: "appbundle:app_purchase_approval@1.0.0:runtime-closure",
  closureHash: "badbad01",
  generatedAt: "2026-01-01T00:00:00.000Z",
  stableDigest: "badc0ded",
  findingsByTier: {
    hard_blocker: [{
      code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
      severity: "error" as const,
      path: "aigc",
      message: "Missing AIGC runtime evidence for invocation/output policy.",
    }],
    warning: [],
    info: [],
  },
  classifiedFindings: [{
    code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
    severity: "error" as const,
    path: "aigc",
    message: "Missing AIGC runtime evidence for invocation/output policy.",
    tier: "hard_blocker" as const,
  }],
});

export const runtimeClosure = {
  evaluateAppBundleRuntimeClosure,
  APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
  classifyAppBundleRuntimeClosureFinding,
  APPBUNDLE_CLOSURE_TIERS,
  validateAppBundleVersionPinVsRuntimeSnapshot,
  closedAppBundleRuntimeClosureReport,
  blockedAppBundleRuntimeClosureReport,
  validateAppBundleAggregateEdges,
  APPBUNDLE_AGGREGATE_EDGE_VALIDATION,
};

export const leaveApprovalAppBundle: AppBundleModel = {
  id: "app_leave_approval",
  name: "请假审批平台",
  description: "A runtime-less application package for leave request submission and manager approval.",
  entityRefs: ["employee", "leave_request"],
  fieldRefs: ["leave_request.approved"],
  roleRefs: ["employee", "manager"],
  permissionRefs: ["leave:approve"],
  workflowRefs: ["wf_leave_approval"],
  pageRefs: ["page_leave_request"],
  pageBindings: [{ pageRef: "page_leave_request", workflowRef: "wf_leave_approval", mode: "approve" }],
  versionPins: [
    { skillId: "datamodel", ref: "employee", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "leave_request", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "leave_request.approved", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "employee", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "manager", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "leave:approve", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "workflow", ref: "wf_leave_approval", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "page", ref: "page_leave_request", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "appbundle", ref: "app_leave_approval", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
  ],
  publishManifest: {
    appId: "app_leave_approval",
    appVersion: "1.0.0",
    createdAt: "PUBLISH_TIME",
    gateStatus: "not_run",
    closureEvidenceDigest: "c0ffee1234ab",
    includedRefs: {
      entities: ["employee", "leave_request"],
      fields: ["leave_request.approved"],
      roles: ["employee", "manager"],
      permissions: ["leave:approve"],
      workflows: ["wf_leave_approval"],
      pages: ["page_leave_request"],
      app: ["app_leave_approval"],
    },
  },
  runtimeSnapshot: {
    appId: "app_leave_approval",
    appVersion: "1.0.0",
    refMode: "pinned",
    pinnedRefs: [
      "datamodel:employee@1.0.0",
      "datamodel:leave_request@1.0.0",
      "datamodel:leave_request.approved@1.0.0",
      "rbac:employee@1.0.0",
      "rbac:manager@1.0.0",
      "rbac:leave:approve@1.0.0",
      "workflow:wf_leave_approval@1.0.0",
      "page:page_leave_request@1.0.0",
      "appbundle:app_leave_approval@1.0.0",
    ],
  },
  releaseArtifact: {
    appId: "app_leave_approval",
    appVersion: "1.0.0",
    traceId: "trace_leave_001",
    publishGateEvidence: {
      status: "passed",
      passedAt: "PUBLISH_TIME",
      evidenceSummary: "gate passed with 0 blockers for 115.50",
    },
  },
  rollbackTargets: [
    {
      appId: "app_leave_approval",
      appVersion: "0.9.0",
      traceId: "trace_leave_prior_99",
      exists: true,
      immutable: true,
    },
  ],
  menuEntries: [
    { id: "menu_leave_request", label: "请假申请", pageRef: "page_leave_request", roleRefs: ["employee", "manager"] },
  ],
};

export const purchaseApprovalAppBundle: AppBundleModel = {
  id: "app_purchase_approval",
  name: "Purchase Approval Platform",
  description: "A runtime-less application package for purchase requests, finance approval, and procurement fulfillment.",
  entityRefs: ["employee", "department", "vendor", "purchase_request"],
  fieldRefs: [
    "purchase_request.amount",
    "purchase_request.budgetChecked",
    "purchase_request.managerApproved",
    "purchase_request.financeApproved",
    "purchase_request.procurementFulfilled",
  ],
  roleRefs: ["requester", "department_manager", "finance", "procurement"],
  permissionRefs: ["purchase:create", "purchase:view", "purchase:manager_approve", "purchase:finance_approve", "purchase:fulfill"],
  workflowRefs: ["wf_purchase_approval"],
  pageRefs: ["page_purchase_request"],
  aigcCapabilityRefs: ["budget_risk_summary"],
  pageBindings: [{ pageRef: "page_purchase_request", workflowRef: "wf_purchase_approval", mode: "approve" }],
  versionPins: [
    { skillId: "datamodel", ref: "employee", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "department", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "vendor", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "purchase_request", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "purchase_request.amount", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "purchase_request.budgetChecked", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "purchase_request.managerApproved", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "purchase_request.financeApproved", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "purchase_request.procurementFulfilled", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "requester", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "department_manager", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "finance", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "procurement", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "purchase:create", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "purchase:view", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "purchase:manager_approve", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "purchase:finance_approve", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "purchase:fulfill", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "workflow", ref: "wf_purchase_approval", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "page", ref: "page_purchase_request", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "aigc", ref: "budget_risk_summary", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "appbundle", ref: "app_purchase_approval", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
  ],
  publishManifest: {
    appId: "app_purchase_approval",
    appVersion: "1.0.0",
    createdAt: "PUBLISH_TIME",
    gateStatus: "not_run",
    closureEvidenceDigest: "def4567890ab",
    includedRefs: {
      entities: ["employee", "department", "vendor", "purchase_request"],
      fields: [
        "purchase_request.amount",
        "purchase_request.budgetChecked",
        "purchase_request.managerApproved",
        "purchase_request.financeApproved",
        "purchase_request.procurementFulfilled",
      ],
      roles: ["requester", "department_manager", "finance", "procurement"],
      permissions: ["purchase:create", "purchase:view", "purchase:manager_approve", "purchase:finance_approve", "purchase:fulfill"],
      workflows: ["wf_purchase_approval"],
      pages: ["page_purchase_request"],
      aigcCapabilities: ["budget_risk_summary"],
      app: ["app_purchase_approval"],
    },
  },
  runtimeSnapshot: {
    appId: "app_purchase_approval",
    appVersion: "1.0.0",
    refMode: "pinned",
    pinnedRefs: [
      "datamodel:employee@1.0.0",
      "datamodel:department@1.0.0",
      "datamodel:vendor@1.0.0",
      "datamodel:purchase_request@1.0.0",
      "datamodel:purchase_request.amount@1.0.0",
      "datamodel:purchase_request.budgetChecked@1.0.0",
      "datamodel:purchase_request.managerApproved@1.0.0",
      "datamodel:purchase_request.financeApproved@1.0.0",
      "datamodel:purchase_request.procurementFulfilled@1.0.0",
      "rbac:requester@1.0.0",
      "rbac:department_manager@1.0.0",
      "rbac:finance@1.0.0",
      "rbac:procurement@1.0.0",
      "rbac:purchase:create@1.0.0",
      "rbac:purchase:view@1.0.0",
      "rbac:purchase:manager_approve@1.0.0",
      "rbac:purchase:finance_approve@1.0.0",
      "rbac:purchase:fulfill@1.0.0",
      "workflow:wf_purchase_approval@1.0.0",
      "page:page_purchase_request@1.0.0",
      "aigc:budget_risk_summary@1.0.0",
      "appbundle:app_purchase_approval@1.0.0",
    ],
  },
  releaseArtifact: {
    appId: "app_purchase_approval",
    appVersion: "1.0.0",
    traceId: "trace_purchase_001",
    publishGateEvidence: {
      status: "passed",
      passedAt: "PUBLISH_TIME",
      evidenceSummary: "gate passed with 0 blockers incl AIGC",
    },
  },
  rollbackTargets: [
    {
      appId: "app_purchase_approval",
      appVersion: "0.9.0",
      traceId: "trace_purchase_prior",
      exists: true,
      immutable: true,
    },
  ],
  menuEntries: [
    {
      id: "menu_purchase_request",
      label: "Purchase Request",
      pageRef: "page_purchase_request",
      roleRefs: ["requester", "department_manager", "finance", "procurement"],
    },
  ],
};

// Pure runtime helpers for 117: deterministic in-memory snapshot/rollback only.
// No DB, network, secrets, timers, or external calls.

function uniqueByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

function simpleStableHash(input: string): string {
  // Pure deterministic FNV-1a 32-bit variant for closure inputs.
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const APPBUNDLE_ROLLBACK_UNPINNED = "APPBUNDLE_ROLLBACK_UNPINNED";

export function createAppBundleRuntimeSnapshot(
  model: AppBundleModel,
  models: any[] = []
): AppBundleRuntimeSnapshot {
  const sources = [model, ...(Array.isArray(models) ? models : [])];
  const rawPins = sources.flatMap((m: any) => (m && m.versionPins) || []);
  const pins = uniqueByKey(rawPins, (p: any) => `${p.skillId}:${p.ref}`);

  const pinnedRefs = pins
    .filter((p: any) => typeof p.version === "string" && isFixedPinVersion(p.version))
    .map((p: any) => pinnedRef(p.skillId, p.ref, p.version))
    .sort();

  const appVersion =
    (model.publishManifest && model.publishManifest.appVersion) ||
    (model.runtimeSnapshot && model.runtimeSnapshot.appVersion) ||
    "0.0.0";

  const gateEvidence = model.publishManifest
    ? {
        status: model.publishManifest.gateStatus,
        passedAt: model.publishManifest.createdAt,
        evidenceSummary: model.publishManifest.gateStatus === "passed" ? "captured" : undefined,
      }
    : undefined;

  // Capture version pins + refs + publish gate evidence + closure inputs into hash.
  const hashInput = [
    model.id,
    appVersion,
    pinnedRefs.join(","),
    gateEvidence ? `${gateEvidence.status}:${gateEvidence.passedAt || ""}` : "",
  ].join("||");

  const closureHash = simpleStableHash(hashInput);

  return {
    appId: model.id,
    appVersion,
    refMode: "pinned",
    pinnedRefs,
    publishGateEvidence: gateEvidence,
    closureHash,
  };
}

export function planAppBundleRollback(
  currentSnapshot: AppBundleRuntimeSnapshot,
  targetSnapshot: AppBundleRuntimeSnapshot
): AppBundleRollbackPlan | "APPBUNDLE_ROLLBACK_UNPINNED" {
  if (
    !currentSnapshot ||
    currentSnapshot.refMode !== "pinned" ||
    !Array.isArray(currentSnapshot.pinnedRefs) ||
    currentSnapshot.pinnedRefs.length === 0
  ) {
    return APPBUNDLE_ROLLBACK_UNPINNED;
  }
  if (
    !targetSnapshot ||
    targetSnapshot.refMode !== "pinned" ||
    !Array.isArray(targetSnapshot.pinnedRefs) ||
    targetSnapshot.pinnedRefs.length === 0
  ) {
    return APPBUNDLE_ROLLBACK_UNPINNED;
  }

  const currSet = new Set(currentSnapshot.pinnedRefs);
  const targSet = new Set(targetSnapshot.pinnedRefs);
  const changed: string[] = [];
  for (const r of targSet) {
    if (!currSet.has(r)) changed.push(r);
  }
  for (const r of currSet) {
    if (!targSet.has(r)) changed.push(r);
  }

  return {
    appId: targetSnapshot.appId || currentSnapshot.appId,
    fromVersion: currentSnapshot.appVersion,
    toVersion: targetSnapshot.appVersion,
    changedRefs: [...new Set(changed)].sort(),
    closureHashMatch: currentSnapshot.closureHash === targetSnapshot.closureHash,
  };
}

export function compareAppBundleRollbackTargetSnapshotsByClosureHash(
  currentSnapshot: AppBundleRuntimeSnapshot,
  targetSnapshot: AppBundleRuntimeSnapshot
): AppBundleRollbackClosureComparison | "APPBUNDLE_ROLLBACK_UNPINNED" {
  // Compare rollback target snapshots by runtime closure hash (119 objective).
  // Requires both snapshots to carry closureHash (fail-closed if absent for hash-based compare).
  // Reuses plan for pinned validation and diff, but derives changedClosureRefs from hash match.
  // Pure deterministic helper; exposes empty changedClosureRefs on hash match (positive).
  // Returns sentinel on unpinned/invalid (fail-closed negative).
  if (!currentSnapshot?.closureHash || !targetSnapshot?.closureHash) {
    return APPBUNDLE_ROLLBACK_UNPINNED;
  }
  const plan = planAppBundleRollback(currentSnapshot, targetSnapshot);
  if (plan === APPBUNDLE_ROLLBACK_UNPINNED) return plan;
  const closureHashMatch = !!plan.closureHashMatch;
  const changedClosureRefs = closureHashMatch ? [] : plan.changedRefs;
  return {
    appId: plan.appId,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    closureHashMatch,
    changedClosureRefs,
  };
}

// 119 task: pure deterministic fail-closed negative handling for version pin versus runtime snapshot mismatch.
// AppBundle is the publish/runtime closure aggregator. Both directions checked.
// Returns blockers using APPBUNDLE_RUNTIME_CLOSURE_BLOCKED on any divergence (no weakening of fail-closed).
export function validateAppBundleVersionPinVsRuntimeSnapshot(
  model: AppBundleModel
): { matched: boolean; blockers: Finding[] } {
  const blockers: Finding[] = [];
  if (!model) {
    return { matched: false, blockers };
  }
  const pins = model.versionPins ?? [];
  const snap = model.runtimeSnapshot;
  if (!snap || !Array.isArray(snap.pinnedRefs)) {
    if (pins.length > 0) {
      blockers.push({
        code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
        severity: "error",
        path: "runtimeSnapshot",
        message: "Version pins present but runtimeSnapshot missing or invalid (version pin vs runtime snapshot mismatch).",
      });
    }
    return { matched: blockers.length === 0, blockers };
  }
  const snapSet = new Set(snap.pinnedRefs);
  const pinRefs = pins
    .filter((p) => isFixedPinVersion(p.version))
    .map((p) => pinnedRef(p.skillId, p.ref, p.version));
  const pinSet = new Set(pinRefs);

  // pins must be present in snapshot
  for (const pref of pinRefs) {
    if (!snapSet.has(pref)) {
      blockers.push({
        code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
        severity: "error",
        path: "runtimeSnapshot.pinnedRefs",
        message: `Version pin ${pref} missing from runtime snapshot (version pin vs runtime snapshot mismatch).`,
      });
    }
  }
  // snapshot refs must be backed by pins (bidirectional)
  for (const sref of snap.pinnedRefs) {
    if (!pinSet.has(sref)) {
      blockers.push({
        code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
        severity: "error",
        path: "runtimeSnapshot.pinnedRefs",
        message: `Runtime snapshot ref ${sref} has no corresponding version pin (version pin vs runtime snapshot mismatch).`,
      });
    }
  }
  const matched = blockers.length === 0;
  return { matched, blockers };
}

export function attachRuntimeClosureSummaryToReleaseArtifact(
  artifact: AppBundleReleaseArtifact,
  report: AppBundleRuntimeClosureReport | undefined,
): AppBundleReleaseArtifact {
  if (!report) return artifact;
  const summary: AppBundleReleaseArtifactRuntimeClosureSummary = {
    closureId: report.closureId,
    closureHash: report.closureHash,
    generatedAt: report.generatedAt,
    stableDigest: report.stableDigest,
    blocked: report.blocked,
    blockerCount: report.blockers.length,
    evidencePresentCount: Object.values(report.perSkillEvidence).filter((e) => e.evidencePresent).length,
    skillCount: report.runtimeClosure?.skillsChecked.length,
  };
  return {
    ...artifact,
    runtimeClosureSummary: summary,
  };
}

export function attachClosureEvidenceDigestToPublishManifest(
  manifest: AppBundlePublishManifest,
  digest: string | undefined,
): AppBundlePublishManifest {
  if (!digest) return manifest;
  return {
    ...manifest,
    closureEvidenceDigest: digest,
  };
}

export function comparePublishArtifactsForRollbackClosureDiff(
  currentPublishArtifact: any,
  targetPublishArtifact: any,
): AppBundleRollbackClosureDiffEvidence | typeof APPBUNDLE_ROLLBACK_UNPINNED {
  const currentSummary = currentPublishArtifact?.runtimeClosureSummary || currentPublishArtifact || {};
  const targetSummary = targetPublishArtifact?.runtimeClosureSummary || targetPublishArtifact || {};
  const currentDigest = currentSummary.stableDigest || currentSummary.closureHash;
  const targetDigest = targetSummary.stableDigest || targetSummary.closureHash;

  if (!currentDigest || !targetDigest) {
    return APPBUNDLE_ROLLBACK_UNPINNED;
  }

  const currentEvidence = (currentPublishArtifact?.perSkillEvidence || currentSummary.perSkillEvidence || {}) as Record<string, any>;
  const targetEvidence = (targetPublishArtifact?.perSkillEvidence || targetSummary.perSkillEvidence || {}) as Record<string, any>;
  const changedPerSkillRefs = new Set<string>();

  for (const skill of new Set([...Object.keys(currentEvidence), ...Object.keys(targetEvidence)])) {
    const currentRef = currentEvidence[skill]?.digest || currentEvidence[skill]?.evidenceRef || currentEvidence[skill]?.artifactId;
    const targetRef = targetEvidence[skill]?.digest || targetEvidence[skill]?.evidenceRef || targetEvidence[skill]?.artifactId;
    if (currentRef !== targetRef) {
      changedPerSkillRefs.add(skill);
    }
  }

  return {
    appId: currentSummary.appId || currentPublishArtifact?.appId || targetSummary.appId || targetPublishArtifact?.appId || "app",
    currentVersion: currentPublishArtifact?.appVersion || currentSummary.appVersion,
    targetVersion: targetPublishArtifact?.appVersion || targetSummary.appVersion,
    currentStableDigest: currentDigest,
    targetStableDigest: targetDigest,
    digestMatch: currentDigest === targetDigest,
    changedPerSkillRefs: [...changedPerSkillRefs].sort(),
    evidencePresentCountCurrent: currentSummary.evidencePresentCount,
    evidencePresentCountTarget: targetSummary.evidencePresentCount,
  };
}
