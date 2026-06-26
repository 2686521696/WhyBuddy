import { describe, expect, it } from "vitest";

import { dataModelSkill, leaveRequestDataModel } from "../datamodel/dataModelSkill";
import { leaveApprovalPage, pageSkill } from "../page/pageSkill";
import { leaveApprovalRbac, rbacSkill } from "../rbac/rbacSkill";
import { leaveApprovalWorkflow, workflowSkill } from "../workflow/workflowSkill";
import { appBundleSkill, leaveApprovalAppBundle } from "./appBundleSkill";
import type { AppBundleModel } from "./appBundleModel";

const clone = (m: AppBundleModel): AppBundleModel => structuredClone(m);

const fullSurface = {
  datamodel: dataModelSkill.resolve(leaveRequestDataModel),
  rbac: rbacSkill.resolve(leaveApprovalRbac),
  workflow: workflowSkill.resolve(leaveApprovalWorkflow),
  page: pageSkill.resolve(leaveApprovalPage),
};

describe("appBundleSkill - the gate", () => {
  it("passes the coherent leave approval app bundle when all skill surfaces are supplied", () => {
    const report = appBundleSkill.validate(leaveApprovalAppBundle, { external: fullSurface });

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it("warns instead of failing when upstream skill surfaces are not supplied yet", () => {
    const report = appBundleSkill.validate(leaveApprovalAppBundle);

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings.some(w => w.code === "APPBUNDLE_ENTITY_UNRESOLVED")).toBe(true);
    expect(report.warnings.some(w => w.code === "APPBUNDLE_ROLE_UNRESOLVED")).toBe(true);
    expect(report.warnings.some(w => w.code === "APPBUNDLE_WORKFLOW_UNRESOLVED")).toBe(true);
    expect(report.warnings.some(w => w.code === "APPBUNDLE_PAGE_UNRESOLVED")).toBe(true);
  });

  it("catches a bundled entity that DataModel never defined", () => {
    const broken = clone(leaveApprovalAppBundle);
    broken.entityRefs.push("ghost_entity");

    const report = appBundleSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "APPBUNDLE_REF_MISSING_ENTITY")).toBe(true);
  });

  it("catches a bundled role that RBAC never defined", () => {
    const broken = clone(leaveApprovalAppBundle);
    broken.roleRefs.push("director");

    const report = appBundleSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "APPBUNDLE_REF_MISSING_ROLE")).toBe(true);
  });

  it("catches page bindings that point at missing pages or workflows", () => {
    const broken = clone(leaveApprovalAppBundle);
    broken.pageBindings.push(
      { pageRef: "ghost_page", workflowRef: "wf_leave_approval", mode: "create" },
      { pageRef: "page_leave_request", workflowRef: "ghost_workflow", mode: "approve" },
    );

    const report = appBundleSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "APPBUNDLE_REF_MISSING_PAGE")).toBe(true);
    expect(report.errors.some(e => e.code === "APPBUNDLE_REF_MISSING_WORKFLOW")).toBe(true);
  });

  it("catches duplicate menu entry ids and missing menu page targets", () => {
    const broken = clone(leaveApprovalAppBundle);
    broken.menuEntries.push(
      { id: "menu_leave_request", label: "Duplicate", pageRef: "page_leave_request", roleRefs: ["employee"] },
      { id: "menu_ghost", label: "Ghost", pageRef: "ghost_page", roleRefs: ["employee"] },
    );

    const report = appBundleSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "APPBUNDLE_DUP_MENU_ID")).toBe(true);
    expect(report.errors.some(e => e.code === "APPBUNDLE_REF_MISSING_PAGE")).toBe(true);
  });
});

describe("appBundleSkill - surface, projector, and cross-skill refs", () => {
  it("exposes application package refs for later materialization", () => {
    const surface = appBundleSkill.resolve(leaveApprovalAppBundle);

    expect(surface.app).toEqual(["app_leave_approval"]);
    expect(surface.menu).toContain("menu_leave_request");
    expect(surface.pageBinding).toContain("page_leave_request->wf_leave_approval");
  });

  it("derives an application-center diagram with menu and binding edges", () => {
    const projection = appBundleSkill.project(leaveApprovalAppBundle);

    expect(projection.mermaid.startsWith("flowchart LR")).toBe(true);
    expect(projection.nodes.some(n => n.id === "app_app_leave_approval" && n.kind === "app")).toBe(true);
    expect(projection.edges.some(e => e.from === "app_app_leave_approval" && e.to === "menu_menu_leave_request")).toBe(true);
    expect(projection.edges.some(e => e.kind === "binding")).toBe(true);
  });

  it("declares refs to DataModel, RBAC, Workflow, and Page for the combined diagram", () => {
    const refs = appBundleSkill.crossRefs(leaveApprovalAppBundle);

    expect(refs.some(r => r.toSkill === "datamodel" && r.toKind === "entity" && r.toValue === "leave_request")).toBe(true);
    expect(refs.some(r => r.toSkill === "rbac" && r.toKind === "role" && r.toValue === "manager")).toBe(true);
    expect(refs.some(r => r.toSkill === "workflow" && r.toKind === "workflow" && r.toValue === "wf_leave_approval")).toBe(true);
    expect(refs.some(r => r.toSkill === "page" && r.toKind === "page" && r.toValue === "page_leave_request")).toBe(true);
  });
});

describe("appBundleSkill - V2 version pins and runtime snapshot", () => {
  it("pins every assembled Skill surface plus AppBundle itself", () => {
    const app = leaveApprovalAppBundle as any;
    const pinnedSkills = [...new Set(app.versionPins.map((pin: any) => pin.skillId))].sort();

    expect(pinnedSkills).toEqual(["appbundle", "datamodel", "page", "rbac", "workflow"]);
    expect(app.versionPins.every((pin: any) => pin.version === "1.0.0")).toBe(true);
    expect(app.versionPins.every((pin: any) => pin.ref)).toBe(true);
  });

  it("carries a publish manifest without running the publish gate yet", () => {
    const app = leaveApprovalAppBundle as any;

    expect(app.publishManifest).toMatchObject({
      appId: "app_leave_approval",
      appVersion: "1.0.0",
      createdAt: "PUBLISH_TIME",
      gateStatus: "not_run",
    });
    expect(app.publishManifest.includedRefs).toEqual({
      entities: ["employee", "leave_request"],
      roles: ["employee", "manager"],
      workflows: ["wf_leave_approval"],
      pages: ["page_leave_request"],
      app: ["app_leave_approval"],
    });
  });

  it("keeps runtime snapshot refs pinned and separate from mutable design-time refs", () => {
    const app = leaveApprovalAppBundle as any;

    expect(app.runtimeSnapshot.appId).toBe("app_leave_approval");
    expect(app.runtimeSnapshot.appVersion).toBe("1.0.0");
    expect(app.runtimeSnapshot.refMode).toBe("pinned");
    expect(app.runtimeSnapshot.pinnedRefs).toContain("rbac:employee@1.0.0");
    expect(app.runtimeSnapshot.pinnedRefs).toContain("datamodel:leave_request@1.0.0");
    expect(app.runtimeSnapshot.pinnedRefs).toContain("workflow:wf_leave_approval@1.0.0");
    expect(app.runtimeSnapshot.pinnedRefs).toContain("page:page_leave_request@1.0.0");
    expect(app.runtimeSnapshot.pinnedRefs).toContain("appbundle:app_leave_approval@1.0.0");
    expect(app.runtimeSnapshot.liveRefs).toBeUndefined();
  });
});
