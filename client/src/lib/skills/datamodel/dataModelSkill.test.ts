import { describe, expect, it } from "vitest";

import {
  bindingEvidence,
  buildDataModelCrossRuntimeEdges,
  buildFieldLineageIndex,
  createDataModelPageRuntimeEvidence,
  createDataModelRbacPolicyImpactEvidence,
  createDataModelRbacRuntimeEvidence,
  dataModelSkill,
  DM_PAGE_RUNTIME_EVIDENCE,
  DM_RBAC_POLICY_IMPACT_EVIDENCE,
  DM_RBAC_RUNTIME_EVIDENCE,
  DM_DATASET_BINDING_FIELD_MISSING,
  DM_LINEAGE_FIELD_MISSING,
  DM_MIGRATION_REMOVED_FIELD_BLOCKER,
  getFieldLifecycle,
  leaveRequestDataModel,
  normalizeDataModelRuntimeContextForSkill,
  planDataModelMigration,
  purchaseApprovalDataModel,
  resolveDatasetBindingRuntime,
  traceFieldLineage,
} from "./dataModelSkill";
import type { DataModelModel, Relation } from "./dataModelModel";

const clone = (m: DataModelModel): DataModelModel => structuredClone(m);

describe("dataModelSkill — the gate", () => {
  it("passes the coherent 请假 data model", () => {
    const report = dataModelSkill.validate(leaveRequestDataModel);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("CATCHES a ref field pointing at a non-existent entity", () => {
    const broken = clone(leaveRequestDataModel);
    broken.entities[1].fields.find(f => f.key === "applicant")!.refEntity = "ghost_entity";
    const report = dataModelSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_REF_MISSING_ENTITY")).toBe(true);
  });

  it("CATCHES an enum field with no values", () => {
    const broken = clone(leaveRequestDataModel);
    broken.entities[1].fields.find(f => f.key === "leaveType")!.enumValues = [];
    const report = dataModelSkill.validate(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_ENUM_NO_VALUES")).toBe(true);
  });

  it("exposes entities + fields for other skills to reference", () => {
    const surface = dataModelSkill.resolve(leaveRequestDataModel);
    expect(surface.entity).toContain("leave_request");
    expect(surface.field).toContain("leave_request.approved");
    // metadata via fields surface
    const approved = surface.fields.find((f: any) => f.ref === "leave_request.approved");
    expect(approved).toBeTruthy();
  });

  it("supports SSOT stable field identity, lifecycle, namespace and storageRole without breaking existing resolve/validate", () => {
    // Existing sample must continue to validate and resolve exactly as before (no breakage)
    const origReport = dataModelSkill.validate(leaveRequestDataModel);
    expect(origReport.ok).toBe(true);
    const origSurface = dataModelSkill.resolve(leaveRequestDataModel);
    expect(origSurface.entity).toContain("employee");
    expect(origSurface.entity).toContain("leave_request");
    expect(origSurface.field).toContain("leave_request.approved");
    expect(origSurface.field).toContain("employee.name");
    const origApproved = origSurface.fields.find((f: any) => f.ref === "leave_request.approved");
    const origName = origSurface.fields.find((f: any) => f.ref === "employee.name");
    expect(origApproved).toBeTruthy();
    expect(origName).toBeTruthy();

    // The real leave-approval sample is the SSOT host; do not prove this only
    // with a temporary test-only model.
    const sampleIdField = leaveRequestDataModel.entities[1].fields.find(f => f.key === "id")!;
    expect(sampleIdField.fieldId).toBe("f_leave_id_v1");
    expect(sampleIdField.version).toBe(1);
    expect(sampleIdField.lifecycle).toBe("active");
    expect(sampleIdField.storageRole).toBe("ssot");
    expect(leaveRequestDataModel.entities[0].namespace).toBe("hr");

    for (const entity of leaveRequestDataModel.entities) {
      expect(entity.namespace).toBeTruthy();
      for (const field of entity.fields) {
        expect(field.fieldId).toMatch(/^f_/);
        expect(field.version).toBeGreaterThan(0);
        expect(field.lifecycle).toBe("active");
        expect(field.storageRole).toBe("ssot");
      }
    }

    // Construct leave-approval style model using stable field IDs + active lifecycle + namespace + ssot role
    const ssotLeaveModel: DataModelModel = {
      entities: [
        {
          id: "employee",
          name: "员工",
          namespace: "hr",
          fields: [
            { key: "id", name: "工号", type: "string", required: true, fieldId: "f_emp_id_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "name", name: "姓名", type: "string", required: true, fieldId: "f_emp_name_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "dept", name: "部门", type: "string", fieldId: "f_emp_dept_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
          ],
        },
        {
          id: "leave_request",
          name: "请假单",
          namespace: "hr",
          fields: [
            { key: "id", name: "单号", type: "string", required: true, fieldId: "f_leave_id_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "applicant", name: "申请人", type: "ref", refEntity: "employee", required: true, fieldId: "f_leave_applicant_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "leaveType", name: "请假类型", type: "enum", enumValues: ["年假", "病假", "事假"], fieldId: "f_leave_type_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "days", name: "天数", type: "number", required: true, fieldId: "f_leave_days_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "reason", name: "事由", type: "string", fieldId: "f_leave_reason_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "approved", name: "是否通过", type: "boolean", fieldId: "f_leave_approved_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
          ],
        },
      ],
    };

    const ssotReport = dataModelSkill.validate(ssotLeaveModel);
    expect(ssotReport.ok).toBe(true);
    expect(ssotReport.errors).toHaveLength(0);

    const ssotSurface = dataModelSkill.resolve(ssotLeaveModel);
    expect(ssotSurface.entity).toContain("leave_request");
    expect(ssotSurface.field).toContain("leave_request.approved");
    expect(ssotSurface.field).toContain("employee.dept");
    const approvedF = ssotSurface.fields.find((f: any) => f.ref === "leave_request.approved");
    const deptF = ssotSurface.fields.find((f: any) => f.ref === "employee.dept");
    expect(approvedF).toBeTruthy();
    expect(deptF).toBeTruthy();
    // metadata carried for field-level refs
    expect(approvedF.version).toBe(1);
    expect(approvedF.lifecycle).toBe("active");

    // Prove stable IDs and SSOT markers are carried on fields
    const idField = ssotLeaveModel.entities[1].fields.find(f => f.key === "id")!;
    expect(idField.fieldId).toBe("f_leave_id_v1");
    expect(idField.version).toBe(1);
    expect(idField.lifecycle).toBe("active");
    expect(idField.storageRole).toBe("ssot");
    expect(ssotLeaveModel.entities[0].namespace).toBe("hr");

    // OLAP projection role is distinguishable (not authoritative)
    const olapModel: DataModelModel = {
      entities: [{
        id: "leave_request_olap",
        name: "请假单OLAP",
        namespace: "analytics",
        fields: [
          { key: "id", name: "单号", type: "string", fieldId: "f_olap_leave_id", version: 1, lifecycle: "active", storageRole: "olap_projection" },
        ],
      }],
    };
    const olapReport = dataModelSkill.validate(olapModel);
    expect(olapReport.ok).toBe(true);
    expect(olapModel.entities[0].fields[0].storageRole).toBe("olap_projection");
  });

  it("accepts lifecycle values active/deprecated/removed", () => {
    const m: DataModelModel = {
      entities: [{
        id: "x",
        name: "X",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "fx1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "old", name: "Old", type: "string", fieldId: "fx2", version: 2, lifecycle: "deprecated", storageRole: "ssot" },
        ],
      }],
    };
    expect(dataModelSkill.validate(m).ok).toBe(true);
  });

  it("CATCHES duplicate field IDs", () => {
    const dup: DataModelModel = {
      entities: [
        {
          id: "e",
          name: "E",
          fields: [
            { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "name", name: "Name", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          ],
        },
      ],
    };
    const report = dataModelSkill.validate(dup);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_DUP_FIELD_ID")).toBe(true);
  });

  it("CATCHES duplicate entity-field pairs (by fieldId)", () => {
    const dupPair: DataModelModel = {
      entities: [
        {
          id: "e",
          name: "E",
          fields: [
            { key: "a", name: "A", type: "string", fieldId: "fa", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "b", name: "B", type: "string", fieldId: "fa", version: 1, lifecycle: "active", storageRole: "ssot" },
          ],
        },
      ],
    };
    const report = dataModelSkill.validate(dupPair);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_DUP_ENTITY_FIELD" || e.code === "DM_DUP_FIELD_ID")).toBe(true);
  });

  it("CATCHES version mismatch expecting DM_FIELD_VERSION_MISMATCH", () => {
    const mismatch: DataModelModel = {
      entities: [
        {
          id: "e",
          name: "E",
          fields: [
            { key: "id", name: "ID", type: "string", fieldId: "fv", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "v2", name: "V2", type: "string", fieldId: "fv", version: 2, lifecycle: "active", storageRole: "ssot" },
          ],
        },
      ],
    };
    const report = dataModelSkill.validate(mismatch);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_FIELD_VERSION_MISMATCH")).toBe(true);
  });

  it("flags deprecated fields with DM_FIELD_DEPRECATED warning", () => {
    const dep: DataModelModel = {
      entities: [{
        id: "e",
        name: "E",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "old", name: "Old", type: "string", fieldId: "f2", version: 1, lifecycle: "deprecated", storageRole: "ssot" },
        ],
      }],
    };
    const report = dataModelSkill.validate(dep);
    expect(report.ok).toBe(true);
    expect(report.warnings.some(e => e.code === "DM_FIELD_DEPRECATED")).toBe(true);
  });

  it("flags removed fields with DM_FIELD_REMOVED error", () => {
    const rem: DataModelModel = {
      entities: [{
        id: "e",
        name: "E",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "gone", name: "Gone", type: "string", fieldId: "f3", version: 1, lifecycle: "removed", storageRole: "ssot" },
        ],
      }],
    };
    const report = dataModelSkill.validate(rem);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_FIELD_REMOVED")).toBe(true);
  });

  it("CATCHES OLAP projection misuse expecting DM_OLAP_NOT_SSOT", () => {
    const olapMisuse: DataModelModel = {
      entities: [
        {
          id: "leave_request",
          name: "请假单",
          fields: [
            { key: "id", name: "单号", type: "string", fieldId: "f_leave_id_v1", version: 1, lifecycle: "active", storageRole: "ssot" },
            { key: "olapview", name: "OLAP视图", type: "string", fieldId: "f_leave_id_v1", version: 1, lifecycle: "active", storageRole: "olap_projection" },
          ],
        },
      ],
    };
    const report = dataModelSkill.validate(olapMisuse);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_OLAP_NOT_SSOT")).toBe(true);
  });

  it("resolve() exposes entity and field surfaces with version/lifecycle metadata", () => {
    const surface = dataModelSkill.resolve(leaveRequestDataModel);
    expect(Array.isArray(surface.entity)).toBe(true);
    expect(surface.entity).toContain("leave_request");
    expect(Array.isArray(surface.field)).toBe(true);
    expect(surface.field).toContain("leave_request.approved");
    // detailed fields surface carries metadata
    expect(Array.isArray(surface.fields)).toBe(true);
    const approved = surface.fields.find((f: any) => f.ref === "leave_request.approved");
    expect(approved).toBeTruthy();
    expect(approved.version).toBe(1);
    expect(approved.lifecycle).toBe("active");
    const idF = surface.fields.find((f: any) => f.ref === "leave_request.id");
    expect(idF && idF.fieldId).toBe("f_leave_id_v1");
  });

  it("refNodeId('field', ...) maps to distinct field node (supports @vN form)", () => {
    const f1 = dataModelSkill.refNodeId("field", "leave_request.approved");
    const f2 = dataModelSkill.refNodeId("field", "leave_request.approved@v1");
    expect(f1).toBe("dm_leave_request_approved");
    expect(f2).toBe("dm_leave_request_approved");
    // field node is not the entity node
    expect(f1).not.toBe("dm_leave_request");
    expect(dataModelSkill.refNodeId("entity", "leave_request")).toBe("dm_leave_request");
    // also for other field
    expect(dataModelSkill.refNodeId("field", "employee.name")).toBe("dm_employee_name");
  });

  it("project() emits distinct readable SSOT field nodes (entities kept)", () => {
    const proj = dataModelSkill.project(leaveRequestDataModel);
    const entNodes = proj.nodes.filter((n: any) => n.kind === "entity");
    const fldNodes = proj.nodes.filter((n: any) => n.kind === "field");
    expect(entNodes.map((n: any) => n.id)).toContain("dm_leave_request");
    expect(fldNodes.map((n: any) => n.id)).toContain("dm_leave_request_approved");
    expect(fldNodes.length).toBeGreaterThan(0);
    // entities and fields remain distinct sets
    const allIds = new Set([...entNodes.map((n: any) => n.id), ...fldNodes.map((n: any) => n.id)]);
    expect(allIds.size).toBe(entNodes.length + fldNodes.length);
  });

  it("provides purchase_request.amount field versioning fixture coverage on purchaseApprovalDataModel", () => {
    // Direct fixture use (not temp model) per task requirement
    expect(purchaseApprovalDataModel).toBeTruthy();
    const purchEntity = purchaseApprovalDataModel.entities.find(e => e.id === "purchase_request")!;
    expect(purchEntity).toBeTruthy();
    expect(purchEntity.namespace).toBe("procurement");
    const amount = purchEntity.fields.find(f => f.key === "amount")!;
    expect(amount).toBeTruthy();
    expect(amount.name).toBe("Amount");
    expect(amount.type).toBe("number");
    expect(amount.required).toBe(true);
    // SSOT field identity/version/lifecycle/storageRole must be present and deterministic
    expect(amount.fieldId).toBe("f_purchase_request_amount_v1");
    expect(amount.version).toBe(1);
    expect(amount.lifecycle).toBe("active");
    expect(amount.storageRole).toBe("ssot");

    const report = dataModelSkill.validate(purchaseApprovalDataModel);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);

    const surface = dataModelSkill.resolve(purchaseApprovalDataModel);
    expect(surface.entity).toContain("purchase_request");
    expect(surface.field).toContain("purchase_request.amount");
    const amtF = surface.fields.find((f: any) => f.ref === "purchase_request.amount");
    expect(amtF).toBeTruthy();
    expect(amtF.fieldId).toBe("f_purchase_request_amount_v1");
    expect(amtF.version).toBe(1);
    expect(amtF.lifecycle).toBe("active");
    // 115.20 sensitive field policy: amount marked and exports PDP delegation metadata
    expect(amtF.sensitivity).toBe("financial");
    expect(amtF.policyRef).toBe("pdp:purchase:amount");
    expect(Array.isArray(amtF.pdpVisibleTo)).toBe(true);
    expect(amtF.pdpVisibleTo).toContain("finance");
    expect(amtF.pdpVisibleTo).toContain("admin");
  });

  it("purchase approval model remains compatible via generate() and carries amount versioning", async () => {
    const model = await dataModelSkill.generate("purchase request for amount");
    expect(model).toBe(purchaseApprovalDataModel);
    const amount = model.entities
      .find(e => e.id === "purchase_request")!
      .fields.find(f => f.key === "amount")!;
    expect(amount.fieldId).toBe("f_purchase_request_amount_v1");
    expect(amount.version).toBe(1);
    expect(amount.storageRole).toBe("ssot");
    const report = dataModelSkill.validate(model);
    expect(report.ok).toBe(true);
  });

  // --- 115.20.06 DataModel sensitive field policy focused +ve/-ve (per review findings) ---
  it("purchase_request.amount is marked sensitive with PDP delegation metadata visible to finance/admin (positive)", () => {
    const purch = purchaseApprovalDataModel.entities.find(e => e.id === "purchase_request")!;
    const amount = purch.fields.find(f => f.key === "amount")!;
    expect(amount.sensitivity).toBe("financial");
    expect(amount.policyRef).toBe("pdp:purchase:amount");
    expect(amount.pdpVisibleTo).toEqual(["finance", "admin"]);

    const surface = dataModelSkill.resolve(purchaseApprovalDataModel);
    const amtF = surface.fields.find((f: any) => f.ref === "purchase_request.amount");
    expect(amtF.sensitivity).toBe("financial");
    expect(amtF.policyRef).toBe("pdp:purchase:amount");
    expect(amtF.pdpVisibleTo).toContain("finance");
    expect(amtF.pdpVisibleTo).toContain("admin");
  });

  it("sensitive field without policyRef is rejected by gate (negative)", () => {
    const bad: DataModelModel = {
      entities: [{
        id: "purchase_request",
        name: "PR",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "secretAmount", name: "Secret", type: "number", sensitivity: "financial", fieldId: "f2", version: 1, lifecycle: "active", storageRole: "ssot" /* no policyRef */ },
        ],
      }],
    };
    const report = dataModelSkill.validate(bad);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_SENSITIVE_FIELD_NO_POLICY")).toBe(true);
  });

  it("non-sensitive fields (sensitivity none or absent) do not require policyRef (positive compat)", () => {
    const okM: DataModelModel = {
      entities: [{
        id: "e",
        name: "E",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "pub", name: "Pub", type: "string", sensitivity: "none", fieldId: "f2", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "norm", name: "Norm", type: "string", fieldId: "f3", version: 1, lifecycle: "active", storageRole: "ssot" },
        ],
      }],
    };
    const report = dataModelSkill.validate(okM);
    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code === "DM_SENSITIVE_FIELD_NO_POLICY")).toBe(false);
  });

  it("project() advances sensitive/policy diagram semantics (policy nodes + edges)", () => {
    const proj = dataModelSkill.project(purchaseApprovalDataModel);
    // policy node for the amount's policyRef
    expect(proj.nodes.some((n: any) => n.kind === "policy" && (n.id || "").includes("pdp_purchase_amount"))).toBe(true);
    // edge from sensitive amount field to its policy
    const polEdge = proj.edges.find((e: any) => e.kind === "policy" && (e.label || "").includes("sensitive:financial"));
    expect(polEdge).toBeTruthy();
    expect(polEdge!.from).toContain("purchase_request_amount");
  });

  it("getFieldLifecycle exposes lifecycle from resolve() surface for consumer-side checks (deprecated/removed)", () => {
    const depM: DataModelModel = {
      entities: [{
        id: "e",
        name: "E",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "old", name: "Old", type: "string", fieldId: "f2", version: 1, lifecycle: "deprecated", storageRole: "ssot" },
          { key: "gone", name: "Gone", type: "string", fieldId: "f3", version: 1, lifecycle: "removed", storageRole: "ssot" },
        ],
      }],
    };
    const surf = dataModelSkill.resolve(depM);
    expect(getFieldLifecycle(surf, "e.id")).toBe("active");
    expect(getFieldLifecycle(surf, "e.old")).toBe("deprecated");
    expect(getFieldLifecycle(surf, "e.gone")).toBe("removed");
    expect(getFieldLifecycle(surf, "e.missing")).toBe(undefined);
    expect(getFieldLifecycle(undefined as any, "e.id")).toBe(undefined);
  });

  // --- V2 relation cardinality gate focused tests (positive + negative) ---
  it("accepts all four cardinalities with valid targets (positive)", () => {
    const m: DataModelModel = {
      entities: [
        { id: "dept", name: "Dept", fields: [{ key: "id", name: "ID", type: "string" }] },
        { id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] },
        { id: "project", name: "Project", fields: [{ key: "id", name: "ID", type: "string" }] },
      ],
      relations: [
        { key: "r11", fromEntity: "dept", toEntity: "emp", cardinality: "one-to-one", name: "head" },
        { key: "r1n", fromEntity: "dept", toEntity: "emp", cardinality: "one-to-many", name: "members" },
        { key: "rn1", fromEntity: "emp", toEntity: "dept", cardinality: "many-to-one", name: "dept" },
        { key: "rnn", fromEntity: "emp", toEntity: "project", cardinality: "many-to-many", name: "assignments" },
      ],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("accepts self-relation only when allowSelf=true (positive)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] }],
      relations: [
        { key: "mgr", fromEntity: "emp", toEntity: "emp", cardinality: "many-to-one", name: "manager", allowSelf: true },
      ],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(true);
  });

  it("accepts bidirectional inverse pair (positive)", () => {
    const m: DataModelModel = {
      entities: [
        { id: "dept", name: "D", fields: [] },
        { id: "emp", name: "E", fields: [] },
      ],
      relations: [
        { key: "members", fromEntity: "dept", toEntity: "emp", cardinality: "one-to-many", inverse: "deptOf" },
        { key: "deptOf", fromEntity: "emp", toEntity: "dept", cardinality: "many-to-one", inverse: "members" },
      ],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(true);
  });

  it("CATCHES relation missing target entity (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "a", name: "A", fields: [] }],
      relations: [{ fromEntity: "a", toEntity: "ghost", cardinality: "one-to-many" }],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_REL_MISSING_TO")).toBe(true);
  });

  it("CATCHES invalid self-relation without allowSelf (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "E", fields: [] }],
      relations: [{ fromEntity: "emp", toEntity: "emp", cardinality: "one-to-one" }],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_REL_INVALID_SELF")).toBe(true);
  });

  it("CATCHES inverse ref missing or mismatched (negative)", () => {
    const m: DataModelModel = {
      entities: [
        { id: "dept", name: "D", fields: [] },
        { id: "emp", name: "E", fields: [] },
      ],
      relations: [
        { key: "members", fromEntity: "dept", toEntity: "emp", cardinality: "one-to-many", inverse: "missingInv" },
      ],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_REL_INVERSE_MISMATCH")).toBe(true);
  });

  it("project() emits explicit relation edges with cardinality and inverse labels", () => {
    const m: DataModelModel = {
      entities: [
        { id: "dept", name: "Dept", fields: [] },
        { id: "emp", name: "Emp", fields: [] },
      ],
      relations: [
        { key: "members", fromEntity: "dept", toEntity: "emp", cardinality: "one-to-many", name: "Members", inverse: "dept" },
      ],
    };
    const proj = dataModelSkill.project(m);
    const relEdges = proj.edges.filter((e: any) => e.kind === "relation" && e.from.includes("dept") && e.to.includes("emp"));
    expect(relEdges.length).toBeGreaterThan(0);
    const label = relEdges[0].label || "";
    expect(label).toContain("one-to-many");
    expect(label).toContain("Members");
    expect(label).toContain("inv:dept");
  });

  it("CATCHES invalid cardinality value (negative)", () => {
    const m: DataModelModel = {
      entities: [
        { id: "dept", name: "Dept", fields: [] },
        { id: "emp", name: "Emp", fields: [] },
      ],
      relations: [
        { fromEntity: "dept", toEntity: "emp", cardinality: "unknown-cardinality" as any },
      ],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_REL_INVALID_CARDINALITY")).toBe(true);
  });

  // --- migration plan gate focused tests (positive + negative per task) ---
  it("accepts planned rename with planRef (positive)", () => {
    const m: DataModelModel = {
      entities: [
        { id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }, { key: "fullName", name: "Full Name", type: "string" }] },
      ],
      migrationPlan: {
        id: "plan-rename-001",
        version: 2,
        actions: [{ action: "rename", entity: "emp", field: "name", from: "name", to: "fullName", planRef: "TICKET-115-01" }],
      },
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("accepts planned remove with planRef (positive)", () => {
    const m: DataModelModel = {
      entities: [
        { id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] },
      ],
      migrationPlan: {
        actions: [{ action: "remove", entity: "emp", field: "legacyCode", planRef: "MIG-115-REMOVE-42" }],
      },
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("accepts planned type-change with planRef (positive)", () => {
    const m: DataModelModel = {
      entities: [{ id: "order", name: "Order", fields: [{ key: "amount", name: "Amount", type: "number" }] }],
      migrationPlan: {
        actions: [{ action: "type-change", entity: "order", field: "amount", from: "string", to: "number", planRef: "PR-115-TC" }],
      },
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(true);
  });

  it("CATCHES destructive remove without planRef (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] }],
      migrationPlan: {
        actions: [{ action: "remove", entity: "emp", field: "oldField" /* no planRef */ }],
      },
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_MIGRATION_DESTRUCTIVE_NO_PLAN")).toBe(true);
  });

  it("CATCHES destructive type-change without planRef (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "doc", name: "Doc", fields: [{ key: "ver", name: "Ver", type: "number" }] }],
      migrationPlan: {
        actions: [{ action: "type-change", entity: "doc", field: "ver", from: "string", to: "number" }],
      },
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_MIGRATION_DESTRUCTIVE_NO_PLAN")).toBe(true);
  });

  it("warns on high-risk deprecate without planRef (but ok=true)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] }],
      migrationPlan: {
        actions: [{ action: "deprecate", entity: "emp", field: "legacy", /*no ref*/ }],
      },
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(true);
    expect(report.warnings.some(e => e.code === "DM_MIGRATION_HIGH_RISK_NO_REF")).toBe(true);
  });

  it("CATCHES invalid migration action type (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] }],
      migrationPlan: {
        actions: [{ action: "drop" as any, entity: "emp", field: "foo" }],
      },
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_MIGRATION_INVALID_ACTION")).toBe(true);
  });

  // --- V2 dataset binding model focused tests (positive + negative) ---
  it("accepts valid dataset binding with entity refs, selected fields, params, output aliases (positive)", () => {
    const m: DataModelModel = {
      entities: [
        { id: "order", name: "Order", fields: [
          { key: "id", name: "ID", type: "string" },
          { key: "amount", name: "Amount", type: "number" },
          { key: "status", name: "Status", type: "string" },
        ] },
      ],
      datasets: [
        {
          id: "order_amounts",
          name: "订单金额",
          entityRef: "order",
          selectedFields: [
            { field: "id" },
            { field: "amount", alias: "total" },
            { field: "status" },
          ],
          parameters: [{ key: "minAmount", type: "number", required: false }],
          outputAliases: { "amount": "totalAmount", "status": "orderStatus" },
        },
      ],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);

    const surface = dataModelSkill.resolve(m);
    expect(surface.dataset).toContain("order_amounts");
    const ds = surface.datasets.find((d: any) => d.id === "order_amounts");
    expect(ds).toBeTruthy();
    expect(ds.entityRef).toBe("order");
    expect(ds.selectedFields).toContain("amount");
    expect(ds.selectedFieldRefs).toContain("order.amount");
    expect(ds.outputAliases["amount"]).toBe("totalAmount");
    expect(ds.parameters).toContain("minAmount");

    // dataset resolve surface exposes refs usable by consumers
    expect(dataModelSkill.refNodeId("dataset", "order_amounts")).toBe("ds_order_amounts");
  });

  it("leaves existing leave/purchase samples compatible and exposes their dataset bindings (compat)", () => {
    const lrReport = dataModelSkill.validate(leaveRequestDataModel);
    expect(lrReport.ok).toBe(true);
    const lrSurf = dataModelSkill.resolve(leaveRequestDataModel);
    expect(lrSurf.dataset).toContain("leave_summary");
    const lrDs = lrSurf.datasets.find((d: any) => d.id === "leave_summary");
    expect(lrDs.entityRef).toBe("leave_request");
    expect(lrDs.selectedFields).toContain("days");
    expect(lrDs.outputAliases["days"]).toBe("leaveDays");

    const paReport = dataModelSkill.validate(purchaseApprovalDataModel);
    expect(paReport.ok).toBe(true);
    const paSurf = dataModelSkill.resolve(purchaseApprovalDataModel);
    expect(paSurf.dataset).toContain("purchase_amount_query");
  });

  it("project() emits dataset nodes and bind/selection edges (V2 diagram)", () => {
    const m: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "f", name: "F", type: "string" }] }],
      datasets: [{ id: "d1", entityRef: "e", selectedFields: [{ field: "f", alias: "ff" }] }],
    };
    const proj = dataModelSkill.project(m);
    expect(proj.nodes.some((n: any) => n.id === "ds_d1" && n.kind === "dataset")).toBe(true);
    const dsEdge = proj.edges.find((e: any) => e.from === "ds_d1" && e.to === "dm_e");
    expect(dsEdge).toBeTruthy();
    expect(dsEdge.label).toBe("binds");
    const selEdge = proj.edges.find((e: any) => e.from === "ds_d1" && e.to.includes("dm_e_f"));
    expect(selEdge).toBeTruthy();
    expect(selEdge.label).toBe("ff");
  });

  it("CATCHES dataset bound to non-existent entity (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] }],
      datasets: [{ id: "bad", entityRef: "ghost", selectedFields: [{ field: "id" }] }],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_DATASET_MISSING_ENTITY")).toBe(true);
  });

  it("CATCHES dataset selecting field not present on entity (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] }],
      datasets: [{ id: "badfields", entityRef: "emp", selectedFields: [{ field: "ghostField" }, { field: "id" }] }],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_DATASET_FIELD_NOT_ON_ENTITY")).toBe(true);
  });

  it("CATCHES duplicate dataset ids (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "id", name: "ID", type: "string" }] }],
      datasets: [
        { id: "dup", entityRef: "e", selectedFields: [{ field: "id" }] },
        { id: "dup", entityRef: "e", selectedFields: [{ field: "id" }] },
      ],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_DUP_DATASET_ID")).toBe(true);
  });

  it("CATCHES dataset missing selectedFields entirely (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] }],
      datasets: [{ id: "bad-missing", entityRef: "emp" } as any],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_DATASET_FIELD_INVALID")).toBe(true);
  });

  it("CATCHES dataset with empty selectedFields array (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] }],
      datasets: [{ id: "bad-empty", entityRef: "emp", selectedFields: [] }],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_DATASET_FIELD_INVALID")).toBe(true);
  });

  it("CATCHES dataset with non-array selectedFields (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "emp", name: "Emp", fields: [{ key: "id", name: "ID", type: "string" }] }],
      datasets: [{ id: "bad-nonarray", entityRef: "emp", selectedFields: "not-an-array" as any }],
    };
    const report = dataModelSkill.validate(m);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_DATASET_FIELD_INVALID")).toBe(true);
  });

  it("exposes dataset via resolve even when using full sample with aliases/params", () => {
    const surf = dataModelSkill.resolve(leaveRequestDataModel);
    const ds = surf.datasets.find((d: any) => d.id === "leave_summary");
    expect(ds).toBeTruthy();
    expect(ds.outputAliases).toBeTruthy();
    expect(Object.keys(ds.outputAliases).length).toBeGreaterThan(0);
  });

  // --- 115.20.07 DataModel PDP delegation policy definitions (model/row/field/export) + decisionScope gate (focused +ve/-ve) ---
  it("policyDefinitions (model/row/field/export) validate when decisionScope present via external.rbac (positive)", () => {
    const m: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" }] }],
      policyDefinitions: [
        { id: "model_pol", level: "model", decisionScope: "RBAC_DECISION_ALLOW" },
        { id: "row_pol", level: "row", decisionScope: "RBAC_DECISION_FAIL_CLOSED", name: "row level" },
        { id: "fld_pol", level: "field", decisionScope: "RBAC_DECISION_ALLOW" },
        { id: "exp_pol", level: "export", decisionScope: "RBAC_DECISION_FAIL_CLOSED" },
      ],
    };
    const report = dataModelSkill.validate(m, {
      external: { rbac: { decisionScope: ["RBAC_DECISION_ALLOW", "RBAC_DECISION_FAIL_CLOSED"] } },
    });
    expect(report.ok).toBe(true);
    expect(report.errors.some(e => e.code && e.code.includes("POLICY"))).toBe(false);
    // resolve exposes the policyDefinition surface
    const surf = dataModelSkill.resolve(m);
    expect(surf.policyDefinition).toContain("model_pol");
    expect(surf.policyDefinition).toContain("exp_pol");
  });

  it("policyDefinition with missing decisionScope in external.rbac is rejected by gate (negative)", () => {
    const m: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" }] }],
      policyDefinitions: [
        { id: "bad_scope", level: "row", decisionScope: "RBAC_DECISION_GHOST" },
      ],
    };
    const report = dataModelSkill.validate(m, {
      external: { rbac: { decisionScope: ["RBAC_DECISION_ALLOW"] } },
    });
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DM_POLICY_DEF_SCOPE_NOT_IN_RBAC")).toBe(true);
  });

  it("policyDefinition requires level and decisionScope (structure negative)", () => {
    const bad1: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "id", name: "ID", type: "string" }] }],
      policyDefinitions: [{ id: "no_level" } as any],
    };
    const r1 = dataModelSkill.validate(bad1);
    expect(r1.ok).toBe(false);
    expect(r1.errors.some(e => e.code === "DM_POLICY_DEF_INVALID_LEVEL")).toBe(true);

    const bad2: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "id", name: "ID", type: "string" }] }],
      policyDefinitions: [{ id: "no_scope", level: "field" } as any],
    };
    const r2 = dataModelSkill.validate(bad2);
    expect(r2.ok).toBe(false);
    expect(r2.errors.some(e => e.code === "DM_POLICY_DEF_NO_SCOPE")).toBe(true);
  });

  it("policyDefinitions project as policy nodes (diagram semantics)", () => {
    const m: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "id", name: "ID", type: "string" }] }],
      policyDefinitions: [{ id: "row_access", level: "row", decisionScope: "RBAC_DECISION_ALLOW" }],
    };
    const proj = dataModelSkill.project(m);
    expect(proj.nodes.some((n: any) => n.kind === "policy" && (n.id || "").includes("row_access"))).toBe(true);
  });

  // --- V2 projector hardening: SSOT central host + migration projection (per review findings) ---
  it("project() projects SSOT as central host node (kind ssot-host) + host edges to entities/fields/datasets/policies/migrations (positive)", () => {
    const m: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "f", name: "F", type: "string", lifecycle: "active" }] }],
      datasets: [{ id: "d1", entityRef: "e", selectedFields: [{ field: "f" }] }],
      policyDefinitions: [{ id: "p1", level: "model", decisionScope: "S" }],
      migrationPlan: { id: "plan-v2", actions: [{ action: "add", entity: "e", field: "f", planRef: "T-115" }] },
    };
    const proj = dataModelSkill.project(m);
    expect(proj.nodes.some((n: any) => n.id === "ssot_datamodel" && n.kind === "ssot-host")).toBe(true);
    // central host edges exist
    expect(proj.edges.some((e: any) => e.from === "ssot_datamodel" && e.to === "dm_e" && e.kind === "ssot")).toBe(true);
    expect(proj.edges.some((e: any) => e.from === "ssot_datamodel" && e.to.includes("dm_e_f") && e.kind === "ssot")).toBe(true);
    expect(proj.edges.some((e: any) => e.from === "ssot_datamodel" && e.to.includes("mig_") && e.kind === "ssot")).toBe(true);
    expect(proj.mermaid).toContain("ssot_datamodel");
    expect(proj.mermaid).toContain("SSOT");
  });

  it("project() projects migrationPlan/actions as diagram nodes and edges (positive)", () => {
    const m: DataModelModel = {
      entities: [
        { id: "emp", name: "Emp", fields: [{ key: "name", name: "Name", type: "string" }] },
      ],
      migrationPlan: {
        id: "plan-115",
        version: 2,
        actions: [
          { action: "rename", entity: "emp", field: "name", from: "oldName", to: "name", planRef: "TICKET-115-01" },
          { action: "deprecate", entity: "emp", field: "legacy", planRef: "MIG-42" },
        ],
      },
    };
    const proj = dataModelSkill.project(m);
    // migration plan node and per-action nodes
    expect(proj.nodes.some((n: any) => n.kind === "migration" && (n.id || "").includes("mig_plan_115"))).toBe(true);
    expect(proj.nodes.some((n: any) => n.kind === "migration" && (n.label || "").includes("rename:emp.name"))).toBe(true);
    expect(proj.nodes.some((n: any) => n.kind === "migration" && (n.label || "").includes("deprecate"))).toBe(true);
    // migration edges
    expect(proj.edges.some((e: any) => e.kind === "migration" && (e.label || "") === "rename")).toBe(true);
    expect(proj.edges.some((e: any) => e.kind === "migration" && (e.label || "") === "affects")).toBe(true);
    // mermaid must contain V2 migration nodes
    expect(proj.mermaid).toContain("mig_");
    expect(proj.mermaid).toContain("rename");
  });

  it("project() surfaces field lifecycle in node labels (V2 diagram)", () => {
    const proj = dataModelSkill.project(leaveRequestDataModel);
    const fld = proj.nodes.find((n: any) => n.kind === "field" && n.id.includes("approved"));
    expect(fld).toBeTruthy();
    expect(fld!.label).toContain("[active]");
  });

  it("project() emits no migration nodes when migrationPlan absent (compat negative)", () => {
    const proj = dataModelSkill.project(leaveRequestDataModel);
    expect(proj.nodes.some((n: any) => n.kind === "migration")).toBe(false);
    // but SSOT host is always present for V2
    expect(proj.nodes.some((n: any) => n.id === "ssot_datamodel" && n.kind === "ssot-host")).toBe(true);
  });

  it("refNodeId supports migration kind", () => {
    expect(dataModelSkill.refNodeId("migration", "plan-115")).toBe("mig_plan_115");
  });

  // --- 117 field lineage runtime index (pure, focused +ve/-ve per task) ---
  it("buildFieldLineageIndex + traceFieldLineage on purchase_request.amount (positive runtime case, covers purchase amount path)", () => {
    const idx = buildFieldLineageIndex(purchaseApprovalDataModel);
    expect(idx).toBeTruthy();
    expect(Array.isArray(idx.fieldRefs)).toBe(true);
    expect(idx.fieldRefs).toContain("purchase_request.amount");
    expect(idx.nodes.some((n: any) => n.kind === "field" && n.ref === "purchase_request.amount")).toBe(true);
    // references from datasets, policies
    const hasDatasetSel = idx.edges.some((e: any) => e.kind === "selects" && (e.label || "").includes("amount"));
    const hasPolicy = idx.edges.some((e: any) => e.kind === "policy" && (e.from || "").includes("purchase_request_amount"));
    expect(hasDatasetSel || hasPolicy).toBe(true);

    const trace = traceFieldLineage(idx, "purchase_request.amount");
    expect(trace.fieldRef).toBe("purchase_request.amount");
    expect(trace.findings).toHaveLength(0);
    expect(Array.isArray(trace.upstream)).toBe(true);
    expect(Array.isArray(trace.downstream)).toBe(true);
    // at least some lineage refs derived
    expect(trace.downstream.length + trace.upstream.length).toBeGreaterThan(0);
  });

  it("buildFieldLineageIndex + traceFieldLineage on leave model remains compatible", () => {
    const idx = buildFieldLineageIndex(leaveRequestDataModel);
    expect(idx.fieldRefs).toContain("leave_request.approved");
    expect(idx.fieldRefs).toContain("leave_request.days");
    const trace = traceFieldLineage(idx, "leave_request.days");
    expect(trace.findings).toHaveLength(0);
  });

  it("traceFieldLineage on missing field returns DM_LINEAGE_FIELD_MISSING (negative / fail-closed case)", () => {
    const idx = buildFieldLineageIndex(purchaseApprovalDataModel);
    const trace = traceFieldLineage(idx, "purchase_request.nonexistent");
    expect(trace.fieldRef).toBe("purchase_request.nonexistent");
    expect(trace.findings.length).toBeGreaterThan(0);
    expect(trace.findings.some((f: any) => f.code === DM_LINEAGE_FIELD_MISSING)).toBe(true);
    expect(trace.upstream).toHaveLength(0);
    expect(trace.downstream).toHaveLength(0);
  });

  it("traceFieldLineage on ghost entity field also yields DM_LINEAGE_FIELD_MISSING (fail-closed)", () => {
    const idx = buildFieldLineageIndex(leaveRequestDataModel);
    const trace = traceFieldLineage(idx, "ghost_entity.x");
    expect(trace.findings.some((f: any) => f.code === DM_LINEAGE_FIELD_MISSING)).toBe(true);
  });

  // --- 117 runtime pure migration planner: planDataModelMigration + blocker (focused +ve/-ve) ---
  it("planDataModelMigration no-op on identical leave model is green (positive, preserves compat)", () => {
    const res = planDataModelMigration(leaveRequestDataModel, leaveRequestDataModel);
    expect(res).toBeTruthy();
    expect(Array.isArray(res.migrationActions)).toBe(true);
    expect(res.migrationActions.length).toBe(0);
    expect(Array.isArray(res.findings)).toBe(true);
    expect(res.findings.length).toBe(0);
  });

  it("planDataModelMigration on identical purchase model is no-op green (positive, preserves compat)", () => {
    const res = planDataModelMigration(purchaseApprovalDataModel, purchaseApprovalDataModel);
    expect(res.migrationActions.length).toBe(0);
    expect(res.findings.length).toBe(0);
  });

  it("planDataModelMigration detects added field and deprecate lifecycle (positive runtime case)", () => {
    const prev: DataModelModel = {
      entities: [{
        id: "emp",
        name: "Emp",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "name", name: "Name", type: "string", fieldId: "f2", version: 1, lifecycle: "active", storageRole: "ssot" },
        ],
      }],
    };
    const next: DataModelModel = {
      entities: [{
        id: "emp",
        name: "Emp",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "name", name: "Name", type: "string", fieldId: "f2", version: 2, lifecycle: "deprecated", storageRole: "ssot" },
          { key: "email", name: "Email", type: "string", fieldId: "f3", version: 1, lifecycle: "active", storageRole: "ssot" },
        ],
      }],
    };
    const res = planDataModelMigration(prev, next);
    expect(res.migrationActions.some(a => a.action === "add" && a.field === "email")).toBe(true);
    expect(res.migrationActions.some(a => a.action === "deprecate" && a.field === "name")).toBe(true);
    // no blockers
    expect(res.findings.some(f => f.code === DM_MIGRATION_REMOVED_FIELD_BLOCKER)).toBe(false);
  });

  it("planDataModelMigration classifies removed referenced field (by dataset) as blocker (negative/fail-closed case)", () => {
    const prev: DataModelModel = {
      entities: [{
        id: "order",
        name: "Order",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "legacyAmt", name: "Legacy", type: "number", fieldId: "f2", version: 1, lifecycle: "active", storageRole: "ssot" },
        ],
      }],
      datasets: [{ id: "ds1", entityRef: "order", selectedFields: [{ field: "id" }, { field: "legacyAmt" }] }],
    };
    const next: DataModelModel = {
      entities: [{
        id: "order",
        name: "Order",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "legacyAmt", name: "Legacy", type: "number", fieldId: "f2", version: 1, lifecycle: "removed", storageRole: "ssot" },
        ],
      }],
      datasets: [{ id: "ds1", entityRef: "order", selectedFields: [{ field: "id" }, { field: "legacyAmt" }] }],
    };
    const res = planDataModelMigration(prev, next);
    expect(res.migrationActions.some(a => a.action === "remove" && a.field === "legacyAmt")).toBe(true);
    const blocker = res.findings.find(f => f.code === DM_MIGRATION_REMOVED_FIELD_BLOCKER);
    expect(blocker).toBeTruthy();
    expect(blocker!.severity).toBe("error");
    expect(blocker!.message).toContain("referenced by datasets");
  });

  it("planDataModelMigration remove without dataset ref does not emit blocker (compat positive)", () => {
    const prev: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" }, { key: "tmp", name: "Tmp", type: "string", fieldId: "f2", version: 1, lifecycle: "active", storageRole: "ssot" }] }],
    };
    const next: DataModelModel = {
      entities: [{ id: "e", name: "E", fields: [{ key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" }] }],
    };
    const res = planDataModelMigration(prev, next);
    expect(res.migrationActions.some(a => a.action === "remove")).toBe(true);
    expect(res.findings.some(f => f.code === DM_MIGRATION_REMOVED_FIELD_BLOCKER)).toBe(false);
  });

  // --- 117 dataset binding runtime focused tests (positive + negative/fail-closed) ---
  it("resolveDatasetBindingRuntime resolves valid dataset+field bindings with metadata, lifecycle, sensitivity, policyRef (positive, preserves leave/purchase compat)", () => {
    // positive case using existing purchase sample (amount has policy)
    const res = resolveDatasetBindingRuntime(purchaseApprovalDataModel, [
      "purchase_amount_query.amount",
      "purchase_request.amount",
      "purchase_amount_query.id",
    ]);
    expect(res.ok).toBe(true);
    expect(res.resolved.length).toBe(3);
    const amt = res.resolved.find((r: any) => r.ref.includes("amount"));
    expect(amt).toBeTruthy();
    expect(amt.entityRef).toBe("purchase_request");
    expect(amt.fieldKey).toBe("amount");
    expect(amt.lifecycle).toBe("active");
    expect(amt.sensitivity).toBe("financial");
    expect(amt.policyRef).toBe("pdp:purchase:amount");
    expect(amt.version).toBe(1);
    // also direct field ref works
    const idb = res.resolved.find((r: any) => r.ref === "purchase_amount_query.id");
    expect(idb && idb.entityRef).toBe("purchase_request");

    // positive using leave sample for compat
    const resLeave = resolveDatasetBindingRuntime(leaveRequestDataModel, ["leave_summary.days", "leave_request.approved"]);
    expect(resLeave.ok).toBe(true);
    expect(resLeave.resolved.length).toBe(2);
    const days = resLeave.resolved.find((r: any) => r.ref.includes("days"));
    expect(days && days.lifecycle).toBe("active");
  });

  it("resolveDatasetBindingRuntime produces DM_DATASET_BINDING_FIELD_MISSING and evidence for missing field (negative/fail-closed)", () => {
    const res = resolveDatasetBindingRuntime(leaveRequestDataModel, ["leave_summary.ghost", "employee.nonexistent"]);
    expect(res.ok).toBe(false);
    expect(res.findings.some((f: any) => f.code === DM_DATASET_BINDING_FIELD_MISSING)).toBe(true);
    // evidence present for consumers (RBAC/AIGC)
    expect(Array.isArray(res.evidence)).toBe(true);
    expect(res.evidence.some((e: any) => e.code === DM_DATASET_BINDING_FIELD_MISSING)).toBe(true);
    expect(res.evidence.some((e: any) => e.ref === "leave_summary.ghost")).toBe(true);
  });

  it("resolveDatasetBindingRuntime produces stable findings for removed field bindings (fail-closed)", () => {
    const removedM: DataModelModel = {
      entities: [{
        id: "e",
        name: "E",
        fields: [
          { key: "id", name: "ID", type: "string", fieldId: "f1", version: 1, lifecycle: "active", storageRole: "ssot" },
          { key: "gone", name: "Gone", type: "string", fieldId: "f2", version: 1, lifecycle: "removed", storageRole: "ssot" },
        ],
      }],
      datasets: [{ id: "ds", entityRef: "e", selectedFields: [{ field: "gone" }] }],
    };
    const res = resolveDatasetBindingRuntime(removedM, ["ds.gone", "e.gone"]);
    // removed is hard error via finding
    expect(res.ok).toBe(false);
    expect(res.findings.some((f: any) => f.code === "DM_FIELD_REMOVED" || f.code === DM_DATASET_BINDING_FIELD_MISSING)).toBe(true);
    expect(res.resolved.length).toBe(0);
  });

  it("bindingEvidence produces stable evidence object for audit", () => {
    const ev = bindingEvidence(DM_DATASET_BINDING_FIELD_MISSING, "ds.f", "missing field", "error");
    expect(ev.code).toBe(DM_DATASET_BINDING_FIELD_MISSING);
    expect(ev.ref).toBe("ds.f");
    expect(ev.severity).toBe("error");
  });
});

describe("dataModelSkill - 119 datamodel to rbac policy impact evidence", () => {
  it("allows when changed DataModel fields overlap RBAC policy field refs", () => {
    const evidence = createDataModelRbacPolicyImpactEvidence(
      purchaseApprovalDataModel,
      { field: ["purchase_request.amount", "purchase_request.status"] },
      ["purchase_request.amount", "purchase_request.status"]
    );

    expect(evidence.evidenceKey).toBe(DM_RBAC_POLICY_IMPACT_EVIDENCE);
    expect(evidence.state).toBe("allowed");
    expect(evidence.reasonCode).toBe("DM_RBAC_POLICY_IMPACT_POSITIVE");
    expect(evidence.changedFieldRefs).toContain("purchase_request.amount");
    expect(evidence.impactedPolicyRefs).toContain("purchase_request.amount");
    expect(evidence.hasPositiveEvidence).toBe(true);
  });

  it("fails closed when a removed DataModel field is still referenced by RBAC policy refs", () => {
    const removedModel = clone(purchaseApprovalDataModel);
    const purchaseRequest = removedModel.entities.find((entity) => entity.id === "purchase_request")!;
    purchaseRequest.fields = purchaseRequest.fields.map((field) =>
      field.key === "amount" ? { ...field, lifecycle: "removed" as const } : field
    );

    const evidence = createDataModelRbacPolicyImpactEvidence(
      removedModel,
      { field: ["purchase_request.amount"] },
      ["purchase_request.amount"]
    );

    expect(evidence.evidenceKey).toBe(DM_RBAC_POLICY_IMPACT_EVIDENCE);
    expect(evidence.state).toBe("blocked");
    expect(evidence.reasonCode).toBe("DM_RBAC_POLICY_IMPACT_FAIL_CLOSED_REMOVED_FIELD");
    expect(evidence.hasPositiveEvidence).toBe(false);
  });
});

describe("dataModelSkill - 118 cross-runtime evidence", () => {
  it("exposes deterministic datamodel cross-runtime edges through resolve", () => {
    const surface = dataModelSkill.resolve(leaveRequestDataModel) as any;

    expect(surface.runtimeEvidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("DM_CROSS_RUNTIME_EVIDENCE:rbac"),
        expect.stringContaining("DM_CROSS_RUNTIME_EVIDENCE:page"),
      ]),
    );
    expect(surface.crossSkillRuntimeEdges).toEqual(
      expect.arrayContaining(["datamodel->rbac:allowed", "datamodel->page:allowed"]),
    );
  });

  it("builds rbac runtime evidence with entity, field, and policy refs", () => {
    const evidence = createDataModelRbacRuntimeEvidence(leaveRequestDataModel, { decision: ["RBAC_DECISION_ALLOW"] });

    expect(evidence.evidenceKey).toBe(DM_RBAC_RUNTIME_EVIDENCE);
    expect(evidence.targetSkill).toBe("rbac");
    expect(evidence.state).toBe("allowed");
    expect(evidence.entityRefs).toContain("leave_request");
    expect(evidence.fieldRefs).toContain("leave_request.approved");
  });

  it("fails closed for page evidence when upstream page surface is absent", () => {
    const evidence = createDataModelPageRuntimeEvidence(leaveRequestDataModel);

    expect(evidence.evidenceKey).toBe(DM_PAGE_RUNTIME_EVIDENCE);
    expect(evidence.targetSkill).toBe("page");
    expect(evidence.state).toBe("blocked");
    expect(evidence.reasonCode).toBe("DM_RUNTIME_UPSTREAM_ABSENT");
  });

  it("normalizes target context and carries lineage refs", () => {
    const ctx = normalizeDataModelRuntimeContextForSkill(
      purchaseApprovalDataModel,
      "aigc",
      { capability: ["budget_risk_summary"] },
    );

    expect(ctx.targetSkill).toBe("aigc");
    expect(ctx.upstreamEvidencePresent).toBe(true);
    expect(ctx.datasetRefs).toContain("purchase_amount_query");
    expect(ctx.evidence.lineageRefs.length).toBeGreaterThan(0);
    expect(buildDataModelCrossRuntimeEdges(purchaseApprovalDataModel).map(edge => edge.targetSkill)).toEqual(
      expect.arrayContaining(["rbac", "workflow", "page", "aigc", "appbundle"]),
    );
  });
});
