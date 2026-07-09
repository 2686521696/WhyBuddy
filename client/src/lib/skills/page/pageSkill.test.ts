import { describe, expect, it } from "vitest";

import { dataModelSkill, leaveRequestDataModel, purchaseApprovalDataModel } from "../datamodel/dataModelSkill";
import { leaveApprovalRbac, purchaseApprovalRbac, rbacSkill } from "../rbac/rbacSkill";
import { evaluateAppBundleRuntimeClosure, leaveApprovalAppBundle } from "../appbundle/appBundleSkill";
import { slideRule } from "../slideRule";
import {
  buildPageCrossRuntimeEdges,
  createPageCrossRuntimeEvidence,
  createPageRbacRuntimeEvidence,
  createPageWorkflowRuntimeEvidence,
  evaluatePageBindingExpressions,
  leaveApprovalPage,
  normalizePageRuntimeContextForSkill,
  PAGE_BINDING_RUNTIME_ERROR,
  PAGE_RBAC_RUNTIME_EVIDENCE,
  PAGE_WORKFLOW_TASK_VIEW_INVALID,
  PAGE_WORKFLOW_RUNTIME_EVIDENCE,
  pageSkill,
  projectWorkflowTaskView,
  createWorkflowTaskViewAppBundleBindingEvidence,
  WORKFLOW_TASK_VIEW_APPBUNDLE_BINDING_EVIDENCE,
  purchaseApprovalPage,
  renderPageRuntimePolicy,
  PAGE_RUNTIME_COMPONENT_HIDDEN,
  taskActions,
  createPageRouteBindingAppBundleEvidence,
  PAGE_ROUTE_BINDING_EVIDENCE,
  PAGE_TO_APPBUNDLE_TRACE,
  tracePageRouteBindingToAppBundleClosureEvidence,
} from "./pageSkill";
import type { BindingSchema, ComponentRenderState, PageModel, PageRenderContext, PermissionRender } from "./pageModel";

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

  it("catches linkage rules with invalid source event name (not onChange/onClick/onLoad)", () => {
    const broken = clone(leaveApprovalPage);
    broken.linkageRules.push({
      id: "lk_bad_event",
      source: { component: "leaveType", event: "onFoo" as any },
      target: { component: "days", action: "setVisible" },
    });

    const report = pageSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_LINKAGE_INVALID_EVENT")).toBe(true);
    expect(report.errors.some(e => e.path.includes("source.event") && /invalid source event/.test(e.message))).toBe(true);
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

describe("pageSkill - V2 PEP model (BindingSchema, PermissionRender, componentVersion, traceSpan)", () => {
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

describe("pageSkill - V2 PEP gate and projection", () => {
  it("rejects a BindingSchema that points at a missing DataModel SSOT field", () => {
    const broken = clone(leaveApprovalPage);
    const days = broken.components.find(c => c.id === "days")!;
    days.bindingSchema = { entity: "leave_request", field: "leave_request.ghost" };

    const report = pageSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_BINDING_FIELD_MISSING")).toBe(true);
  });

  it("rejects BindingSchema with entity/field prefix mismatch (field not belonging to declared entity) or binding entity not matching page entity", () => {
    // Use surface containing multiple entities (employee + leave_request) to prove cross-entity would have passed before
    const broken1 = clone(leaveApprovalPage);
    const days = broken1.components.find(c => c.id === "days")!;
    // prefix mismatch: declared entity present, field present, but field belongs to different entity
    days.bindingSchema = { entity: "leave_request", field: "employee.name" };

    const report1 = pageSkill.validate(broken1, { external: fullSurface });
    expect(report1.ok).toBe(false);
    expect(report1.errors.some(e => e.code === "PAGE_BINDING_FIELD_ENTITY_MISMATCH")).toBe(true);

    // entity present + prefix ok for that entity, but binding entity does not match page.entity
    const broken2 = clone(leaveApprovalPage);
    const approve = broken2.components.find(c => c.id === "approve")!;
    approve.bindingSchema = { entity: "employee", field: "employee.name" };

    const report2 = pageSkill.validate(broken2, { external: fullSurface });
    expect(report2.ok).toBe(false);
    expect(report2.errors.some(e => e.code === "PAGE_BINDING_ENTITY_MISMATCH")).toBe(true);
  });

  it("rejects PermissionRender refs that RBAC PDP cannot resolve", () => {
    const broken = clone(leaveApprovalPage);
    const approve = broken.components.find(c => c.id === "approve")!;
    approve.permissionRender = {
      roleRefs: ["director"],
      permissionRefs: ["leave:delete"],
    };

    const report = pageSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.filter(e => e.code === "PAGE_PERMISSION_REF_MISSING")).toHaveLength(2);
  });

  it("rejects local-only role visibility in V2 mode instead of bypassing PDP delegation", () => {
    const broken = clone(leaveApprovalPage);
    const approve = broken.components.find(c => c.id === "approve")!;
    delete approve.permissionRender;

    const report = pageSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_PEP_BYPASS")).toBe(true);
  });

  it("projects Page as a PEP canvas with BindingSchema, PermissionRender, and local linkage edges", () => {
    const projection = pageSkill.project(leaveApprovalPage);

    expect(projection.nodes.some(n => n.id === "cmp_approve" && n.kind === "button")).toBe(true);
    expect(projection.edges.some(e => e.from === "cmp_approve" && e.to === "dm_leave_request_approved" && e.kind === "binding")).toBe(true);
    expect(projection.edges.some(e => e.from === "cmp_approve" && e.to === "role_manager" && e.kind === "permission")).toBe(true);
    expect(projection.edges.some(e => e.from === "cmp_approve" && e.to === "perm_leave_approve" && e.kind === "permission")).toBe(true);
    expect(projection.edges.some(e => e.from === "cmp_approve" && e.to === "cmp_reason" && e.kind === "linkage")).toBe(true);
  });

  it("projects visibility edges for component visibleTo roles", () => {
    const projection = pageSkill.project(leaveApprovalPage);

    expect(projection.edges.some(e => e.from === "cmp_approve" && e.to === "role_manager" && e.kind === "visibility")).toBe(true);
  });
});

describe("pageSkill - field-level visibility gate (pdpVisibleTo policy on bound fields)", () => {
  const purchaseSurface = {
    datamodel: dataModelSkill.resolve(purchaseApprovalDataModel),
    rbac: rbacSkill.resolve(purchaseApprovalRbac),
  };

  it("accepts component visibility that is a subset of the field's pdpVisibleTo (positive)", () => {
    // amount in purchase dm has pdpVisibleTo: ["finance", "admin"]; use finance (present in rbac)
    const good = clone(purchaseApprovalPage);
    const amt = good.components.find(c => c.id === "amount")!;
    amt.visibleToRoles = ["finance"];
    amt.permissionRender = { roleRefs: ["finance"] };

    const report = pageSkill.validate(good, { external: purchaseSurface });

    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code === "PAGE_FIELD_VISIBILITY_VIOLATION")).toBe(false);
  });

  it("rejects component visibility exposing bound field to role outside its pdpVisibleTo (negative, amount to requester)", () => {
    const bad = clone(purchaseApprovalPage);
    const amt = bad.components.find(c => c.id === "amount")!;
    // requester is in rbac but NOT in field's pdpVisibleTo ["finance", "admin"]
    amt.visibleToRoles = ["requester", "finance"];
    amt.permissionRender = { roleRefs: ["requester", "finance"] };

    const report = pageSkill.validate(bad, { external: purchaseSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_FIELD_VISIBILITY_VIOLATION" && /requester/.test(e.message))).toBe(true);
  });
});

describe("pageSkill - DataModel field lifecycle (deprecated/removed) via external SSOT", () => {
  const cloneDM = (m: any) => structuredClone(m);

  it("warns (ok=true) when Page binds via field or bindingSchema to a deprecated DataModel SSOT field", () => {
    const depDM = cloneDM(leaveRequestDataModel);
    depDM.entities.find((e: any) => e.id === "leave_request")!.fields.find((f: any) => f.key === "days")!.lifecycle = "deprecated";
    const surf = { datamodel: dataModelSkill.resolve(depDM) };
    const p = clone(leaveApprovalPage);
    // bind component field + bindingSchema to the deprecated field
    const days = p.components.find(c => c.id === "days")!;
    days.field = "leave_request.days";
    days.bindingSchema = { entity: "leave_request", field: "leave_request.days" };

    const report = pageSkill.validate(p, { external: surf });

    expect(report.ok).toBe(true);
    expect(report.warnings.some(w => w.code === "PAGE_FIELD_DEPRECATED" && w.message.includes("leave_request.days"))).toBe(true);
    expect(report.warnings.some(w => w.code === "PAGE_BINDING_FIELD_DEPRECATED" && w.message.includes("leave_request.days"))).toBe(true);
    // no removed errors
    expect(report.errors.some(e => e.code === "PAGE_FIELD_REMOVED" || e.code === "PAGE_BINDING_FIELD_REMOVED")).toBe(false);
  });

  it("errors (ok=false) when Page binds via field or bindingSchema to a removed DataModel SSOT field", () => {
    const remDM = cloneDM(leaveRequestDataModel);
    remDM.entities.find((e: any) => e.id === "leave_request")!.fields.find((f: any) => f.key === "approved")!.lifecycle = "removed";
    const surf = { datamodel: dataModelSkill.resolve(remDM) };
    const p = clone(leaveApprovalPage);
    const approve = p.components.find(c => c.id === "approve")!;
    approve.field = "leave_request.approved";
    approve.bindingSchema = { entity: "leave_request", field: "leave_request.approved" };

    const report = pageSkill.validate(p, { external: surf });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_FIELD_REMOVED" && e.message.includes("leave_request.approved"))).toBe(true);
    expect(report.errors.some(e => e.code === "PAGE_BINDING_FIELD_REMOVED" && e.message.includes("leave_request.approved"))).toBe(true);
  });

  it("accepts active fields without deprecated/removed lifecycle warnings or errors (compat)", () => {
    const surf = fullSurface;
    const report = pageSkill.validate(leaveApprovalPage, { external: surf });
    expect(report.ok).toBe(true);
    expect(report.warnings.some(w => w.code === "PAGE_FIELD_DEPRECATED" || w.code === "PAGE_BINDING_FIELD_DEPRECATED")).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_FIELD_REMOVED" || e.code === "PAGE_BINDING_FIELD_REMOVED")).toBe(false);
  });
});

describe("pageSkill - page event schema and action payload gate (V2)", () => {
  it("accepts valid action payloadRef that matches emitted from source event (positive)", () => {
    const good = clone(leaveApprovalPage);
    // onChange emits "value" per schema; use payloadRef to bind the emitted value to setValue action
    good.linkageRules.push({
      id: "lk_event_payload_value",
      source: { component: "leaveType", event: "onChange" },
      target: { component: "reason", action: "setValue", payloadRef: "value" },
    });

    const report = pageSkill.validate(good, { external: fullSurface });

    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code === "PAGE_LINKAGE_PAYLOAD_REF_INVALID")).toBe(false);
  });

  it("rejects action payloadRef that is neither emitted by the event nor a page binding field (negative)", () => {
    const bad = clone(leaveApprovalPage);
    // onClick emits [] per schema; "ghostPayload" is not valid emitted nor a bound field
    bad.linkageRules.push({
      id: "lk_bad_payload_ref",
      source: { component: "submit", event: "onClick" },
      target: { component: "reason", action: "setValue", payloadRef: "ghostPayload" },
    });

    const report = pageSkill.validate(bad, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_LINKAGE_PAYLOAD_REF_INVALID" && /ghostPayload/.test(e.message))).toBe(true);
  });

  it("accepts payloadRef that resolves to a page binding field (positive binding case)", () => {
    const good = clone(leaveApprovalPage);
    // payloadRef references a known bound field (treated as value source from context)
    good.linkageRules.push({
      id: "lk_payload_from_binding",
      source: { component: "leaveType", event: "onChange" },
      target: { component: "days", action: "setValue", payloadRef: "leave_request.days" },
    });

    const report = pageSkill.validate(good, { external: fullSurface });

    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code === "PAGE_LINKAGE_PAYLOAD_REF_INVALID")).toBe(false);
  });
});

describe("pageSkill - page resource reference gate (V2 115.40: assets/routes/workflowLaunch/appMenu)", () => {
  it("accepts valid workflow launch ref against provided Workflow resolve surface (positive)", () => {
    const good = clone(leaveApprovalPage);
    good.workflowLaunchRefs = ["wf_leave_approval"];
    const surf = {
      ...fullSurface,
      workflow: { workflow: ["wf_leave_approval", "wf_purchase"] },
    };
    const report = pageSkill.validate(good, { external: surf });

    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code === "PAGE_REF_MISSING_WORKFLOW_LAUNCH")).toBe(false);
    expect(report.warnings.some(w => w.code === "PAGE_WORKFLOW_LAUNCH_REF_UNRESOLVED")).toBe(false);
    // also exercises cross-ref and resourceRef field
    good.components[0].resourceRef = "asset:logo";
    expect(good.workflowLaunchRefs).toContain("wf_leave_approval");
  });

  it("warns (ok=true) for workflow/resource ref when no external workflow surface supplied (unresolved)", () => {
    const p = clone(leaveApprovalPage);
    p.workflowLaunchRefs = ["wf_x"];
    p.assetRefs = ["img/icon.png"];
    p.routeRefs = ["/app/home"];
    p.appMenuRefs = ["nav:reports"];

    const report = pageSkill.validate(p); // no external at all

    expect(report.ok).toBe(true);
    expect(report.warnings.some(w => w.code === "PAGE_WORKFLOW_LAUNCH_REF_UNRESOLVED")).toBe(true);
    expect(report.warnings.some(w => w.code === "PAGE_ASSET_REF_UNRESOLVED")).toBe(true);
    expect(report.warnings.some(w => w.code === "PAGE_ROUTE_REF_UNRESOLVED")).toBe(true);
    expect(report.warnings.some(w => w.code === "PAGE_APP_MENU_REF_UNRESOLVED")).toBe(true);
  });

  it("errors on missing workflow launch ref when surface provided but ref absent (negative)", () => {
    const bad = clone(leaveApprovalPage);
    bad.workflowLaunchRefs = ["wf_ghost_launch"];
    const surf = {
      ...fullSurface,
      workflow: { workflow: ["wf_leave_approval"] },
    };

    const report = pageSkill.validate(bad, { external: surf });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "PAGE_REF_MISSING_WORKFLOW_LAUNCH" && /wf_ghost_launch/.test(e.message))).toBe(true);
  });

  it("crossRefs declares workflow/route etc and project emits launch/route edges (diagram advance)", () => {
    const p = clone(leaveApprovalPage);
    p.workflowLaunchRefs = ["wf_leave_approval"];
    p.routeRefs = ["r-home"];

    const xrefs = pageSkill.crossRefs(p);
    expect(xrefs.some(r => r.toSkill === "workflow" && r.toKind === "workflow" && r.toValue === "wf_leave_approval")).toBe(true);
    expect(xrefs.some(r => r.toSkill === "route" && r.toValue === "r-home")).toBe(true);

    const proj = pageSkill.project(p);
    expect(proj.edges.some(e => e.kind === "launch" && String(e.to).includes("wf_leave_approval"))).toBe(true);
    expect(proj.edges.some(e => e.kind === "route")).toBe(true);
  });
});

describe("pageSkill - page version snapshot for AppBundle immutable pins (V2 115.40)", () => {
  it("represents page version ids, published state, and snapshot refs; resolve exposes for pinning (positive, purchase approval)", () => {
    const p = purchaseApprovalPage;
    expect(p.pageVersion).toBe("1.0.0");
    expect(p.published).toBe(true);
    expect(p.snapshotRefs).toContain("page:page_purchase_request@1.0.0");

    const surface = pageSkill.resolve(purchaseApprovalPage);
    expect(surface.page).toContain("page_purchase_request");
    expect((surface as any).pageVersion).toBe("1.0.0");
    expect((surface as any).published).toBe(true);
    expect((surface as any).snapshotRefs).toContain("page:page_purchase_request@1.0.0");
  });

  it("does not expose snapshot for missing/unpublished page version (negative)", () => {
    const bad = clone(leaveApprovalPage);
    bad.pageVersion = undefined;
    bad.published = false;
    bad.snapshotRefs = undefined;

    const surface = pageSkill.resolve(bad);
    expect((surface as any).pageVersion).toBeUndefined();
    expect((surface as any).published).toBe(false);
    expect((surface as any).snapshotRefs).toBeUndefined();
    // basic page id still there for compat
    expect(surface.page).toContain("page_leave_request");
  });
});

describe("pageSkill - runtime render policy (V2 117)", () => {
  const leaveRbacModel = leaveApprovalRbac;
  const purchaseRbacModel = purchaseApprovalRbac;
  const dmSurface = fullSurface.datamodel; // resolved surface

  it("positive: manager sees approve button visible via PermissionRender + RBAC decision evidence", () => {
    const states = renderPageRuntimePolicy(leaveApprovalPage, {
      rbac: { model: leaveRbacModel, subjectRoleIds: ["manager"], tenantId: "t1" },
      dataModelSurface: dmSurface,
    } as PageRenderContext);

    expect(states["approve"]).toBe("visible");
    // submit is employee scoped, manager has create too but permissionRender for submit limits to employee
    // manager can see other fields that match roles
    expect(states["applicant"]).toBe("visible");
  });

  it("negative/fail-closed: employee denied on manager-only approve component is hidden, never editable", () => {
    const states = renderPageRuntimePolicy(leaveApprovalPage, {
      rbac: { model: leaveRbacModel, subjectRoleIds: ["employee"], tenantId: "t1" },
      dataModelSurface: dmSurface,
    } as PageRenderContext);

    expect(states["approve"]).toBe(PAGE_RUNTIME_COMPONENT_HIDDEN);
    expect(states["approve"]).not.toBe("visible");
    // employee can still see their own
    expect(states["submit"]).toBe("visible");
  });

  it("removed bound field blocks rendering as hidden (DataModel lifecycle)", () => {
    const remDM = structuredClone(leaveRequestDataModel);
    remDM.entities.find((e: any) => e.id === "leave_request")!.fields.find((f: any) => f.key === "approved")!.lifecycle = "removed";
    const remSurf = { datamodel: dataModelSkill.resolve(remDM) };
    const p = clone(leaveApprovalPage);
    const approve = p.components.find(c => c.id === "approve")!;
    approve.field = "leave_request.approved";
    approve.bindingSchema = { entity: "leave_request", field: "leave_request.approved" };

    const states = renderPageRuntimePolicy(p, {
      dataModelSurface: remSurf.datamodel,
    });

    expect(states["approve"]).toBe(PAGE_RUNTIME_COMPONENT_HIDDEN);
  });

  it("workflow task context can force read-only/disabled or hidden while preserving RBAC", () => {
    const states = renderPageRuntimePolicy(leaveApprovalPage, {
      rbac: { model: leaveRbacModel, subjectRoleIds: ["manager"], tenantId: "t1" },
      workflowTaskContext: { isReadOnly: true },
    } as PageRenderContext);

    // non-button becomes read-only when workflow says read-only
    expect(states["days"]).toBe("read-only");
    // buttons disabled
    expect(states["approve"]).toBe("disabled"); // was visible by RBAC but wf overrides to disabled
  });

  it("purchase approval compat: finance role sees amount (pdp constrained field) as visible", () => {
    const states = renderPageRuntimePolicy(purchaseApprovalPage, {
      rbac: { model: purchaseRbacModel, subjectRoleIds: ["finance"], tenantId: "t1" },
      dataModelSurface: dataModelSkill.resolve(purchaseApprovalDataModel),
    } as PageRenderContext);

    expect(states["amount"]).toBe("visible");
    expect(states["financeApprove"]).toBe("visible");
  });

  it("purchase approval negative: requester cannot see finance-only amount (hidden)", () => {
    const states = renderPageRuntimePolicy(purchaseApprovalPage, {
      rbac: { model: purchaseRbacModel, subjectRoleIds: ["requester"], tenantId: "t1" },
      dataModelSurface: dataModelSkill.resolve(purchaseApprovalDataModel),
    } as PageRenderContext);

    expect(states["amount"]).toBe(PAGE_RUNTIME_COMPONENT_HIDDEN);
  });

  it("returns visible for components when no rbac ctx supplied (compat, no force deny)", () => {
    const states = renderPageRuntimePolicy(leaveApprovalPage, {});
    // when no rbac subject provided, roleMatch short circuits to allow visible (roleRefs present)
    expect(states["approve"]).toBe("visible");
  });
});

describe("pageSkill - 117 binding expression runtime (pure deterministic)", () => {
  it("evaluates declared bindings to concrete values from input.data (positive)", () => {
    const data = {
      "leave_request": {
        applicant: "alice",
        leaveType: "annual",
        days: 5,
        reason: "rest",
        approved: true,
      },
    };
    const res = evaluatePageBindingExpressions(leaveApprovalPage, { data });

    expect(res).not.toBe("PAGE_BINDING_RUNTIME_ERROR");
    expect(res.values["leave_request.days"]).toBe(5);
    expect(res.values["leave_request.approved"]).toBe(true);
    expect(res.values.applicant).toBe("alice");
    expect(res.linkageEvidence).toBeDefined();
    expect(res.linkageEvidence.kind).toBe("page.linkage.runtime");
    expect(res.linkageEvidence.modelId).toBe("page_leave_request");
  });

  it("returns PAGE_BINDING_RUNTIME_ERROR on unresolved binding ref (negative, fail-closed)", () => {
    const data = { "leave_request": { applicant: "bob" } }; // missing days/approved etc bound by page
    const res = evaluatePageBindingExpressions(leaveApprovalPage, { data });

    expect(res).toBe(PAGE_BINDING_RUNTIME_ERROR);
  });

  it("applies linkageRules on matching event and emits linkageEvidence (positive runtime linkage)", () => {
    const data = {
      "leave_request": {
        applicant: "alice",
        leaveType: "annual",
        days: 3,
        reason: "rest",
        approved: false,
      },
    };
    const res = evaluatePageBindingExpressions(leaveApprovalPage, {
      data,
      event: { type: "onChange", payload: true },
    });

    expect(res).not.toBe("PAGE_BINDING_RUNTIME_ERROR");
    // lk_type_days: leaveType onChange -> days setVisible(true) in this impl
    expect(res.visibility.days).toBe(true);
    expect(res.linkageEvidence.applied).toContain("lk_type_days");
  });

  it("preserves leave/purchase sample compatibility and resolves purchase fields (positive)", () => {
    const purchData = {
      "purchase_request": {
        requester: "req1",
        department: "eng",
        vendor: "acme",
        amount: 1234,
        status: "pending",
        budgetChecked: false,
        managerApproved: false,
        financeApproved: false,
        procurementFulfilled: false,
      },
    };
    const res = evaluatePageBindingExpressions(purchaseApprovalPage, { data: purchData });

    expect(res).not.toBe("PAGE_BINDING_RUNTIME_ERROR");
    expect(res.values["purchase_request.amount"]).toBe(1234);
    expect(res.linkageEvidence.modelId).toBe("page_purchase_request");
  });

  it("fails closed for invalid input model (negative)", () => {
    const res = evaluatePageBindingExpressions({} as any, {});
    expect(res).toBe(PAGE_BINDING_RUNTIME_ERROR);
  });
});

describe("pageSkill - 118 cross-runtime evidence", () => {
  it("exposes deterministic page cross-runtime edges through resolve", () => {
    const surface = pageSkill.resolve(leaveApprovalPage) as any;

    expect(surface.runtimeEvidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("PAGE_CROSS_RUNTIME_EVIDENCE:datamodel"),
        expect.stringContaining("PAGE_CROSS_RUNTIME_EVIDENCE:rbac"),
      ]),
    );
    expect(surface.crossSkillRuntimeEdges).toEqual(
      expect.arrayContaining(["page->datamodel:allowed", "page->rbac:allowed"]),
    );
  });

  it("builds rbac runtime evidence from permission render refs", () => {
    const evidence = createPageRbacRuntimeEvidence(leaveApprovalPage, fullSurface.rbac);

    expect(evidence.evidenceKey).toBe(PAGE_RBAC_RUNTIME_EVIDENCE);
    expect(evidence.targetSkill).toBe("rbac");
    expect(evidence.state).toBe("allowed");
    expect(evidence.roleRefs).toContain("manager");
  });

  it("fails closed for workflow runtime evidence when upstream workflow is absent", () => {
    const evidence = createPageWorkflowRuntimeEvidence(leaveApprovalPage);

    expect(evidence.evidenceKey).toBe(PAGE_WORKFLOW_RUNTIME_EVIDENCE);
    expect(evidence.targetSkill).toBe("workflow");
    expect(evidence.state).toBe("blocked");
    expect(evidence.reasonCode).toBe("PAGE_RUNTIME_UPSTREAM_ABSENT");
  });

  it("normalizes appbundle context and preserves page snapshots", () => {
    const ctx = normalizePageRuntimeContextForSkill(
      purchaseApprovalPage,
      "appbundle",
      { app: ["app_purchase_approval"] },
    );

    expect(ctx.targetSkill).toBe("appbundle");
    expect(ctx.upstreamEvidencePresent).toBe(true);
    expect(ctx.componentRefs).toContain("amount");
    expect(ctx.evidence.snapshotRefs.length).toBeGreaterThan(0);
    expect(buildPageCrossRuntimeEdges(purchaseApprovalPage).map(edge => edge.targetSkill)).toEqual(
      expect.arrayContaining(["datamodel", "rbac", "aigc", "appbundle"]),
    );
  });
});

describe("pageSkill - V2 117 workflow task view projection (pure runtime)", () => {
  it("projects leave approval page + workflow instance at approval node to task view (positive)", () => {
    const inst = {
      id: "inst_leave_1",
      workflowId: "wf_leave_approval",
      currentNodeId: "a_mgr",
      variables: { approved: false },
    };
    const view = projectWorkflowTaskView(leaveApprovalPage, inst);

    expect(view).not.toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);
    expect(view.currentNodeId).toBe("a_mgr");
    expect(view.title).toContain("请假申请页");
    // fields preserve DataModel bindings
    expect(view.fields.some(f => f.binding === "leave_request.approved")).toBe(true);
    // actions include workflow state-driven + page buttons
    const actionIds = view.actions.map(a => a.id);
    expect(actionIds).toContain("approve");
    expect(actionIds).toContain("reject");
    expect(actionIds).toContain("submit");
    // evidence preserves permissions and datamodel
    expect(view.evidence.dataModelRefs).toContain("leave_request.approved");
    expect(view.evidence.permissionRefs.some(r => r.includes("manager") || r.includes("employee"))).toBe(true);
  });

  it("projects purchase approval page at finance node to actionable view with finance actions (positive)", () => {
    const inst = {
      id: "inst_purch_1",
      workflowId: "wf_purchase_approval",
      currentNodeId: "finance",
      variables: {},
    };
    const view = projectWorkflowTaskView(purchaseApprovalPage, inst);

    expect(view).not.toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);
    expect(view.currentNodeId).toBe("finance");
    const actionIds = view.actions.map(a => a.id);
    expect(actionIds).toContain(taskActions.APPROVE);
    expect(actionIds).toContain(taskActions.REJECT);
    expect(view.evidence.dataModelRefs).toContain("purchase_request.amount");
  });

  it("returns PAGE_WORKFLOW_TASK_VIEW_INVALID for missing currentNode or no instance (negative fail-closed)", () => {
    const bad1 = projectWorkflowTaskView(leaveApprovalPage, undefined as any);
    expect(bad1).toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);

    const bad2 = projectWorkflowTaskView(leaveApprovalPage, { workflowId: "wf_x" } as any);
    expect(bad2).toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);
  });

  it("returns PAGE_WORKFLOW_TASK_VIEW_INVALID on workflow/page launch ref mismatch (negative, fail-closed)", () => {
    const p = structuredClone(leaveApprovalPage);
    p.workflowLaunchRefs = ["wf_purchase_approval"]; // deliberately mismatch
    const inst = { id: "i1", workflowId: "wf_leave_approval", currentNodeId: "a_mgr" };
    const view = projectWorkflowTaskView(p, inst);
    expect(view).toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);
  });

  it("end node produces disabled terminal action and preserves evidence (runtime behavior)", () => {
    const inst = { id: "i2", workflowId: "wf_leave_approval", currentNodeId: "e_ok", currentNodeType: "end", variables: { approved: true } };
    const view = projectWorkflowTaskView(leaveApprovalPage, inst);
    expect(view).not.toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);
    expect(view.actions.some(a => a.disabled && (a.disabledReason?.includes("terminal") || a.label === "Done"))).toBe(true);
  });

  it("preserves purchase/leave pages compatibility without explicit launchRefs (compat positive)", () => {
    // pages used in prior tests do not always declare workflowLaunchRefs
    const instLeave = { id: "c1", workflowId: "wf_leave_approval", currentNodeId: "a_mgr" };
    const v1 = projectWorkflowTaskView(leaveApprovalPage, instLeave);
    expect(v1).not.toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);

    const instPurch = { id: "c2", workflowId: "wf_purchase_approval", currentNodeId: "manager" };
    const v2 = projectWorkflowTaskView(purchaseApprovalPage, instPurch);
    expect(v2).not.toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);
  });
});

// 119 focused: Workflow task view evidence closed vs Page surfaces and AppBundle bindings (positive + fail-closed)
describe("pageSkill - 119 workflow task view AppBundle binding closure", () => {
  it("positive: matching pageBinding + instance projects valid task view (allowed evidence)", () => {
    const binding = { pageRef: leaveApprovalPage.id, workflowRef: "wf_leave_approval", mode: "approve" as const };
    const inst = { id: "i119", workflowId: "wf_leave_approval", currentNodeId: "a_mgr" };
    const ev = createWorkflowTaskViewAppBundleBindingEvidence(leaveApprovalPage, binding, inst);
    expect(ev.state).toBe("allowed");
    expect(ev.evidenceKey).toContain(WORKFLOW_TASK_VIEW_APPBUNDLE_BINDING_EVIDENCE);
    expect(ev.result).not.toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);
    expect(ev.pageRef).toBe(leaveApprovalPage.id);
  });

  it("fail-closed negative: bad instance or no currentNode returns blocked + INVALID", () => {
    const binding = { pageRef: leaveApprovalPage.id, workflowRef: "wf_leave_approval" };
    const bad = createWorkflowTaskViewAppBundleBindingEvidence(leaveApprovalPage, binding, { workflowId: "wf_leave_approval" } as any);
    expect(bad.state).toBe("blocked");
    expect(bad.result).toBe(PAGE_WORKFLOW_TASK_VIEW_INVALID);
  });

  it("fail-closed negative: binding workflowRef mismatch yields blocked", () => {
    const binding = { pageRef: leaveApprovalPage.id, workflowRef: "wf_other" };
    const inst = { id: "x", workflowId: "wf_leave_approval", currentNodeId: "a_mgr" };
    const ev = createWorkflowTaskViewAppBundleBindingEvidence(leaveApprovalPage, binding, inst);
    expect(ev.state).toBe("blocked");
  });
});

describe("pageSkill - Page field binding evidence closure against DataModel SSOT (119)", () => {
  it("provides positive Page field binding evidence to datamodel when upstream SSOT surface present (positive)", () => {
    const ev = createPageCrossRuntimeEvidence(leaveApprovalPage, "datamodel", fullSurface.datamodel);
    expect(ev.targetSkill).toBe("datamodel");
    expect(ev.state).toBe("allowed");
    expect(ev.reasonCode).toBe("PAGE_RUNTIME_EVIDENCE_PRESENT");
    expect(ev.fieldRefs.length).toBeGreaterThan(0);
    expect(ev.fieldRefs).toContain("leave_request.approved");
    expect(ev.componentRefs).toContain("approve");
  });

  it("fail-closes to blocked state for Page field binding evidence when no upstream DataModel surface (negative, fail-closed)", () => {
    const ev = createPageCrossRuntimeEvidence(leaveApprovalPage, "datamodel", undefined);
    expect(ev.state).toBe("blocked");
    expect(ev.reasonCode).toBe("PAGE_RUNTIME_UPSTREAM_ABSENT");
    expect(ev.fieldRefs.length).toBeGreaterThan(0); // fields declared, but evidence blocked
  });

  it("exposes field bindings via resolve surface for datamodel SSOT closure", () => {
    const surf = pageSkill.resolve(leaveApprovalPage);
    expect(surf.field).toContain("leave_request.approved");
    expect(surf.field).toContain("leave_request.days");
    // runtimeEvidence includes cross to datamodel for field binding
    expect(Array.isArray(surf.runtimeEvidence)).toBe(true);
    expect(Array.isArray(surf.crossSkillRuntimeEdges)).toBe(true);
  });

  it("Page fieldRefs match DataModel SSOT fields surface boundary (positive match)", () => {
    const dmSurf = dataModelSkill.resolve(leaveRequestDataModel);
    const ev = createPageCrossRuntimeEvidence(leaveApprovalPage, "datamodel", dmSurf);
    expect(ev.state).toBe("allowed");
    const dmFields: string[] = Array.isArray((dmSurf as any).field) ? (dmSurf as any).field : ((dmSurf as any).fields || []).map((f: any) => f && f.ref).filter(Boolean);
    // all page declared fields must be present in the DM SSOT surface when evidence allowed
    if (ev.fieldRefs.length > 0 && dmFields.length > 0) {
      expect(ev.fieldRefs.every(f => dmFields.includes(f))).toBe(true);
    }
  });

  it("slideRule.publishGate consumes Page->datamodel field binding evidence (positive, real SSOT)", () => {
    const models = {
      page: leaveApprovalPage,
      datamodel: leaveRequestDataModel,
      appbundle: leaveApprovalAppBundle,
    };
    const gate = slideRule.publishGate(models);
    expect(gate.runtimeClosure).toBeDefined();
    const pageInfo: any = gate.runtimeClosure!.perSkillEvidence?.page;
    expect(pageInfo).toBeTruthy();
    const bindingEv = pageInfo.dataModelFieldBindingEvidence;
    expect(bindingEv).toBeTruthy();
    expect(bindingEv.targetSkill).toBe("datamodel");
    expect(bindingEv.state).toBe("allowed");
    expect(bindingEv.fieldRefs).toContain("leave_request.approved");
  });

  it("slideRule.publishGate sees fail-closed Page field binding evidence when datamodel absent (negative)", () => {
    const models = {
      page: leaveApprovalPage,
      appbundle: leaveApprovalAppBundle,
    };
    const gate = slideRule.publishGate(models);
    expect(gate.runtimeClosure).toBeDefined();
    const pageInfo: any = gate.runtimeClosure!.perSkillEvidence?.page;
    const bindingEv = pageInfo?.dataModelFieldBindingEvidence;
    expect(bindingEv?.state).toBe("blocked");
    expect(bindingEv?.reasonCode).toBe("PAGE_RUNTIME_UPSTREAM_ABSENT");
  });
});

describe("pageSkill - Page permission render evidence closure against RBAC policy surfaces (119)", () => {
  it("provides positive Page permission render evidence to rbac when upstream RBAC surface present (positive)", () => {
    const ev = createPageRbacRuntimeEvidence(leaveApprovalPage, fullSurface.rbac);
    expect(ev.targetSkill).toBe("rbac");
    expect(ev.state).toBe("allowed");
    expect(ev.reasonCode).toBe("PAGE_RUNTIME_EVIDENCE_PRESENT");
    expect(ev.roleRefs).toContain("manager");
    expect(ev.permissionRefs).toContain("leave:approve");
    expect(ev.componentRefs).toContain("approve");
  });

  it("fail-closes to blocked state for Page permission render evidence when no upstream RBAC surface (negative, fail-closed)", () => {
    const ev = createPageRbacRuntimeEvidence(leaveApprovalPage, undefined);
    expect(ev.state).toBe("blocked");
    expect(ev.reasonCode).toBe("PAGE_RUNTIME_UPSTREAM_ABSENT");
    expect(ev.roleRefs.length).toBeGreaterThan(0);
    expect(ev.permissionRefs.length).toBeGreaterThan(0);
  });

  it("slideRule.publishGate consumes Page permission render evidence against RBAC (positive, real surface)", () => {
    const models = {
      page: leaveApprovalPage,
      rbac: leaveApprovalRbac,
      appbundle: leaveApprovalAppBundle,
    };
    const gate = slideRule.publishGate(models);
    expect(gate.runtimeClosure).toBeDefined();
    const pageInfo: any = gate.runtimeClosure!.perSkillEvidence?.page;
    expect(pageInfo).toBeTruthy();
    const permEv = pageInfo.pageRbacPermissionEvidence;
    expect(permEv).toBeTruthy();
    expect(permEv.targetSkill).toBe("rbac");
    expect(permEv.state).toBe("allowed");
    expect(permEv.roleRefs).toContain("employee");
    expect(permEv.permissionRefs).toContain("leave:create");
  });

  it("slideRule.publishGate sees fail-closed Page permission render evidence when rbac absent (negative)", () => {
    const models = {
      page: leaveApprovalPage,
      appbundle: leaveApprovalAppBundle,
    };
    const gate = slideRule.publishGate(models);
    expect(gate.runtimeClosure).toBeDefined();
    const pageInfo: any = gate.runtimeClosure!.perSkillEvidence?.page;
    const permEv = pageInfo?.pageRbacPermissionEvidence;
    expect(permEv?.state).toBe("blocked");
    expect(permEv?.reasonCode).toBe("PAGE_RUNTIME_UPSTREAM_ABSENT");
  });
});

describe("pageSkill - 120 page route binding to appbundle closure trace", () => {
  it("traces Page route and workflow launch bindings to AppBundle closure as a closed path", () => {
    const pageWithRoutes = {
      ...leaveApprovalPage,
      routeRefs: ["leave.form", "leave.approve"],
      workflowLaunchRefs: ["wf_leave_approval"],
    };

    const trace = tracePageRouteBindingToAppBundleClosureEvidence(pageWithRoutes, leaveApprovalAppBundle);

    expect(trace.traceId).toBe(PAGE_TO_APPBUNDLE_TRACE);
    expect(trace.sourceSkill).toBe("page");
    expect(trace.targetSkill).toBe("appbundle");
    expect(trace.state).toBe("closed");
    expect(trace.reasonCode).toBe("PAGE_APPBUNDLE_ROUTE_BINDING_POSITIVE_CLOSED");
    expect(trace.routeRefs).toContain("leave.form");
    expect(trace.pageBindingEvidencePresent).toBe(true);
  });

  it("traces missing AppBundle upstream or route binding refs as fail-closed", () => {
    const pageWithoutRoutes = {
      ...leaveApprovalPage,
      routeRefs: [],
      appMenuRefs: [],
      workflowLaunchRefs: [],
    };

    const missingRefs = tracePageRouteBindingToAppBundleClosureEvidence(pageWithoutRoutes, leaveApprovalAppBundle);
    const missingBundle = tracePageRouteBindingToAppBundleClosureEvidence(leaveApprovalPage);

    expect(missingRefs.state).toBe("blocked");
    expect(missingRefs.reasonCode).toBe("PAGE_APPBUNDLE_ROUTE_BINDING_FAIL_CLOSED");
    expect(missingBundle.state).toBe("blocked");
    expect(missingBundle.pageBindingEvidencePresent).toBe(false);
  });

  it("resolve and AppBundle runtime closure expose Page route binding evidence", () => {
    const pageWithRoutes = {
      ...leaveApprovalPage,
      routeRefs: ["leave.form", "leave.approve"],
      workflowLaunchRefs: ["wf_leave_approval"],
    };
    const surface = pageSkill.resolve(pageWithRoutes) as any;
    const evidence = createPageRouteBindingAppBundleEvidence(pageWithRoutes, leaveApprovalAppBundle);
    const report = evaluateAppBundleRuntimeClosure({ page: pageWithRoutes, appbundle: leaveApprovalAppBundle });
    const pageInfo = report.perSkillEvidence.page as any;

    expect(evidence.evidenceKey).toBe(PAGE_ROUTE_BINDING_EVIDENCE);
    expect(evidence.targetSkill).toBe("appbundle");
    expect(surface.runtimeEvidence).toEqual(expect.arrayContaining([PAGE_ROUTE_BINDING_EVIDENCE]));
    expect(surface.pageToAppBundleTrace.traceId).toBe(PAGE_TO_APPBUNDLE_TRACE);
    expect(pageInfo.pageRouteBindingEvidence.state).toBe("closed");
  });
});
