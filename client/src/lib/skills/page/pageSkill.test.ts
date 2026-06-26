import { describe, expect, it } from "vitest";

import { dataModelSkill, leaveRequestDataModel } from "../datamodel/dataModelSkill";
import { leaveApprovalRbac, rbacSkill } from "../rbac/rbacSkill";
import { leaveApprovalPage, pageSkill } from "./pageSkill";
import type { PageModel } from "./pageModel";

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
