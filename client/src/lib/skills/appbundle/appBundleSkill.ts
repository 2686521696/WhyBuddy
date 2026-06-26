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
import type { AppBundleModel, AppBundleSkillId, AppMenuEntry } from "./appBundleModel";

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

function pushMissingSurfaceFindings(
  f: Finding[],
  code: string,
  refs: string[],
  surface: string[] | undefined,
  missingCode: string,
  pathPrefix: string,
  label: string,
): void {
  refs.forEach((ref, index) => {
    if (surface === undefined) {
      f.push({
        code,
        severity: "warning",
        path: `${pathPrefix}[${index}]`,
        message: `AppBundle references ${label} "${ref}", but the ${label} surface was not provided.`,
      });
    } else if (!surface.includes(ref)) {
      f.push({
        code: missingCode,
        severity: "error",
        path: `${pathPrefix}[${index}]`,
        message: `AppBundle references missing ${label}: ${ref}`,
      });
    }
  });
}

function menuRoleRefs(menuEntries: AppMenuEntry[]): string[] {
  return menuEntries.flatMap(entry => entry.roleRefs);
}

const REQUIRED_PIN_SKILLS: AppBundleSkillId[] = ["datamodel", "rbac", "workflow", "page", "appbundle"];

function pinnedRef(skillId: AppBundleSkillId, ref: string, version: string): string {
  return `${skillId}:${ref}@${version}`;
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
    model.roleRefs.forEach(role =>
      refs.push({ fromNode, toSkill: "rbac", toKind: "role", toValue: role, label: "角色" }),
    );
    model.workflowRefs.forEach(workflow =>
      refs.push({ fromNode, toSkill: "workflow", toKind: "workflow", toValue: workflow, label: "流程" }),
    );
    model.pageRefs.forEach(page =>
      refs.push({ fromNode, toSkill: "page", toKind: "page", toValue: page, label: "页面" }),
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
    const datamodelEntities = ctx?.external?.datamodel?.entity;
    const rbacRoles = ctx?.external?.rbac?.role;
    const workflowIds = ctx?.external?.workflow?.workflow;
    const pageIds = ctx?.external?.page?.page;

    for (const dup of findDuplicates(model.menuEntries.map(menu => menu.id))) {
      f.push({
        code: "APPBUNDLE_DUP_MENU_ID",
        severity: "error",
        path: `menuEntries.${dup}`,
        message: `Duplicate app menu entry id: ${dup}`,
      });
    }

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
    }

    pushMissingSurfaceFindings(
      f,
      "APPBUNDLE_ENTITY_UNRESOLVED",
      model.entityRefs,
      datamodelEntities,
      "APPBUNDLE_REF_MISSING_ENTITY",
      "entityRefs",
      "DataModel entity",
    );
    pushMissingSurfaceFindings(
      f,
      "APPBUNDLE_ROLE_UNRESOLVED",
      [...model.roleRefs, ...menuRoleRefs(model.menuEntries)],
      rbacRoles,
      "APPBUNDLE_REF_MISSING_ROLE",
      "roleRefs",
      "RBAC role",
    );
    pushMissingSurfaceFindings(
      f,
      "APPBUNDLE_WORKFLOW_UNRESOLVED",
      [...model.workflowRefs, ...model.pageBindings.flatMap(binding => (binding.workflowRef ? [binding.workflowRef] : []))],
      workflowIds,
      "APPBUNDLE_REF_MISSING_WORKFLOW",
      "workflowRefs",
      "Workflow",
    );
    pushMissingSurfaceFindings(
      f,
      "APPBUNDLE_PAGE_UNRESOLVED",
      [...model.pageRefs, ...model.menuEntries.map(menu => menu.pageRef), ...model.pageBindings.map(binding => binding.pageRef)],
      pageIds,
      "APPBUNDLE_REF_MISSING_PAGE",
      "pageRefs",
      "Page",
    );

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
    ];

    const lines: string[] = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}["${n.label}"]`);
    for (const e of edges) lines.push(`  ${e.from} -->|${e.label ?? ""}| ${e.to}`);
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  resolve(model: AppBundleModel): ResolvableSurface {
    return {
      app: [model.id],
      menu: model.menuEntries.map(menu => menu.id),
      pageBinding: model.pageBindings.map(binding => `${binding.pageRef}->${binding.workflowRef ?? "none"}`),
    };
  },

  async generate(intent: string): Promise<AppBundleModel> {
    if (/请假|leave|审批/i.test(intent)) return leaveApprovalAppBundle;
    throw new Error(`appBundleSkill.generate: needs the reasoning engine to package an app bundle for intent: "${intent}"`);
  },
};

export const leaveApprovalAppBundle: AppBundleModel = {
  id: "app_leave_approval",
  name: "请假审批平台",
  description: "A runtime-less application package for leave request submission and manager approval.",
  entityRefs: ["employee", "leave_request"],
  roleRefs: ["employee", "manager"],
  workflowRefs: ["wf_leave_approval"],
  pageRefs: ["page_leave_request"],
  pageBindings: [{ pageRef: "page_leave_request", workflowRef: "wf_leave_approval", mode: "approve" }],
  versionPins: [
    { skillId: "datamodel", ref: "employee", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "datamodel", ref: "leave_request", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "employee", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "rbac", ref: "manager", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "workflow", ref: "wf_leave_approval", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "page", ref: "page_leave_request", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
    { skillId: "appbundle", ref: "app_leave_approval", version: "1.0.0", pinnedAt: "PUBLISH_TIME" },
  ],
  publishManifest: {
    appId: "app_leave_approval",
    appVersion: "1.0.0",
    createdAt: "PUBLISH_TIME",
    gateStatus: "not_run",
    includedRefs: {
      entities: ["employee", "leave_request"],
      roles: ["employee", "manager"],
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
      "rbac:employee@1.0.0",
      "rbac:manager@1.0.0",
      "workflow:wf_leave_approval@1.0.0",
      "page:page_leave_request@1.0.0",
      "appbundle:app_leave_approval@1.0.0",
    ],
  },
  menuEntries: [
    { id: "menu_leave_request", label: "请假申请", pageRef: "page_leave_request", roleRefs: ["employee", "manager"] },
  ],
};
