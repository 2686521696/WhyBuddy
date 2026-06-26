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
  });
});
