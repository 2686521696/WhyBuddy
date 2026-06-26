import { describe, expect, it } from "vitest";

import { dataModelSkill, leaveRequestDataModel } from "./dataModelSkill";
import type { DataModelModel } from "./dataModelModel";

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
});
