import { describe, expect, it } from "vitest";

import { dataModelSkill, leaveRequestDataModel } from "../datamodel/dataModelSkill";
import { leaveApprovalRbac, rbacSkill } from "../rbac/rbacSkill";
import { leaveApprovalPage, pageSkill } from "./pageSkill";
import type { BindingSchema, PageModel, PermissionRender } from "./pageModel";

const clone = (m: PageModel): PageModel => structuredClone(m);

const fullSurface = {
  datamodel: dataModelSkill.resolve(leaveRequestDataModel),
  rbac: rbacSkill.resolve(leaveApprovalRbac),
};

describe("pageSkill - the gate", () => {
  it("passes the coherent leave approval page when DataModel and RBAC surfaces are supplied", () => {
    const report = pageSkill.validate(leaveApprovalPage, { external: fullSurface });

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it("warns instead of failing when external DataModel/RBAC surfaces are not supplied yet", () => {
    const report = pageSkill.validate(leaveApprovalPage);

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings.some(w => w.code === "PAGE_ENTITY_UNRESOLVED")).toBe(true);
    expect(report.warnings.some(w => w.code === "PAGE_FIELD_UNRESOLVED")).toBe(true);
    expect(report.warnings.some(w => w.code === "PAGE_ROLE_UNRESOLVED")).toBe(true);
  });

  it("catches a component bound to a field that DataModel never defined", () => {
    const broken = clone(leaveApprovalPage);
    broken.components.find(c => c.id === "days")!.field = "leave_request.ghost";

    const report = pageSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_REF_MISSING_FIELD")).toBe(true);
  });

  it("catches a component visible to a role RBAC never defined", () => {
    const broken = clone(leaveApprovalPage);
    broken.components.find(c => c.id === "approve")!.visibleToRoles = ["director"];

    const report = pageSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_REF_MISSING_ROLE")).toBe(true);
  });

  it("catches linkage rules whose source or target component is missing", () => {
    const broken = clone(leaveApprovalPage);
    broken.linkageRules.push(
      { id: "lk_missing_source", source: { component: "ghost", event: "onChange" }, target: { component: "days", action: "setVisible" } },
      { id: "lk_missing_target", source: { component: "leaveType", event: "onChange" }, target: { component: "ghost", action: "setValue" } },
    );

    const report = pageSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_LINKAGE_MISSING_SOURCE")).toBe(true);
    expect(report.errors.some(e => e.code === "PAGE_LINKAGE_MISSING_TARGET")).toBe(true);
  });

  it("catches incompatible linkage semantics", () => {
    const broken = clone(leaveApprovalPage);
    broken.linkageRules.push({
      id: "lk_bad_options",
      source: { component: "days", event: "onClick" },
      target: { component: "reason", action: "setOptions" },
    });

    const report = pageSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_LINKAGE_ACTION_INCOMPATIBLE")).toBe(true);
  });
});

describe("pageSkill - surface, projector, and cross-skill refs", () => {
  it("exposes page and component ids for other skills to reference", () => {
    const surface = pageSkill.resolve(leaveApprovalPage);

    expect(surface.page).toEqual(["page_leave_request"]);
    expect(surface.component).toContain("approve");
    expect(surface.entity).toContain("leave_request");
    expect(surface.field).toContain("leave_request.approved");
  });

  it("derives a page diagram with component nodes and linkage edges", () => {
    const projection = pageSkill.project(leaveApprovalPage);

    expect(projection.mermaid.startsWith("flowchart LR")).toBe(true);
    expect(projection.nodes.some(n => n.id === "cmp_approve" && n.kind === "button")).toBe(true);
    expect(projection.edges.some(e => e.from === "cmp_approve" && e.to === "cmp_reason" && e.kind === "linkage")).toBe(true);
  });

  it("declares DataModel field refs and RBAC role refs for the combined diagram", () => {
    const refs = pageSkill.crossRefs(leaveApprovalPage);

    expect(refs.some(r => r.fromNode === "page_page_leave_request" && r.toSkill === "datamodel" && r.toKind === "entity" && r.toValue === "leave_request")).toBe(true);
    expect(refs.some(r => r.fromNode === "cmp_approve" && r.toSkill === "datamodel" && r.toKind === "field" && r.toValue === "leave_request.approved")).toBe(true);
    expect(refs.some(r => r.fromNode === "cmp_approve" && r.toSkill === "rbac" && r.toKind === "role" && r.toValue === "manager")).toBe(true);
  });
});

describe("pageSkill — V2 PEP model (BindingSchema, PermissionRender, componentVersion, traceSpan)", () => {
  it("sample page remains readable and can express bindings, permission rendering, and linkage rules", () => {
    const page = clone(leaveApprovalPage);

    // Prove sample expresses the new PEP constructs
    expect(page.traceSpan).toBe("page.leave.request.v2");
    expect(page.componentVersion).toBe("1.0.0");
    // bindings expressed where field refs exist (not all buttons have data fields)
    const withField = page.components.filter(c => c.field);
    expect(withField.length).toBeGreaterThan(0);
    expect(withField.every(c => !!c.bindingSchema)).toBe(true);
    expect(page.components.every(c => !!c.permissionRender && c.permissionRender.roleRefs.length > 0)).toBe(true);
    expect(page.components.some(c => c.componentVersion)).toBe(true);

    // Linkage rules (local Page-owned execution graph, not global truth) preserved
    expect(page.linkageRules.length).toBeGreaterThan(0);
    expect(page.linkageRules.some(r => r.id === "lk_type_days")).toBe(true);

    // Existing visibleToRoles kept for BC; new PDP refs co-exist
    expect(page.components.find(c => c.id === "approve")!.visibleToRoles).toContain("manager");
    expect(page.components.find(c => c.id === "approve")!.permissionRender!.roleRefs).toContain("manager");

    // Binding expresses DataModel SSOT ref
    const approveBinding = page.components.find(c => c.id === "approve")!.bindingSchema!;
    expect(approveBinding.entity).toBe("leave_request");
    expect(approveBinding.field).toBe("leave_request.approved");

    // PermissionRender expresses RBAC PDP delegation (not local only auth)
    const approvePerm = page.components.find(c => c.id === "approve")!.permissionRender!;
    expect(approvePerm.roleRefs).toContain("manager");

    const report = pageSkill.validate(page, { external: fullSurface });
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("PEP metadata and schemas can be set without breaking validate or linkage when surfaces supplied", () => {
    const pepPage = clone(leaveApprovalPage);
    pepPage.traceSpan = "page.leave.trace";
    pepPage.componentVersion = "2.1.0";
    const days = pepPage.components.find(c => c.id === "days")!;
    days.bindingSchema = { entity: "leave_request", field: "leave_request.days" } as BindingSchema;
    days.permissionRender = { roleRefs: ["employee", "manager"] } as PermissionRender;
    days.componentVersion = "2.1.0";

    const report = pageSkill.validate(pepPage, { external: fullSurface });
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(pepPage.traceSpan).toBe("page.leave.trace");
    expect(days.bindingSchema!.field).toBe("leave_request.days");
    expect(days.permissionRender!.roleRefs).toContain("manager");
    expect(days.componentVersion).toBe("2.1.0");
  });

  it("catches in test construction that linkage still enforces after PEP fields added", () => {
    const broken = clone(leaveApprovalPage);
    broken.components.find(c => c.id === "approve")!.bindingSchema = { entity: "leave_request", field: "leave_request.approved" } as BindingSchema;
    broken.components.find(c => c.id === "approve")!.permissionRender = { roleRefs: ["manager"] } as PermissionRender;
    broken.linkageRules.push(
      { id: "lk_pep_test", source: { component: "approve", event: "onClick" }, target: { component: "reason", action: "setDisabled" } },
    );

    const report = pageSkill.validate(broken, { external: fullSurface });
    expect(report.ok).toBe(true); // this one is compatible
  });
});
