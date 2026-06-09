import { describe, expectTypeOf, it } from "vitest";

import type {
  BlueprintChecksLedgerEntry,
  BlueprintCheckType,
} from "../checks-ledger/types.js";

describe("BlueprintCheckType v4 full-loop extensions", () => {
  it("accepts brainstorm deliberation, impact and traceability matrix check types", () => {
    expectTypeOf<"brainstorm_deliberation">().toExtend<BlueprintCheckType>();
    expectTypeOf<"brainstorm_impact">().toExtend<BlueprintCheckType>();
    expectTypeOf<"traceability_matrix">().toExtend<BlueprintCheckType>();
  });

  it("allows ledger entries for brainstorm evidence and traceability coverage", () => {
    const brainstormEntry = {
      id: "chk-job-1",
      jobId: "job-1",
      stage: "route_planning",
      checkType: "brainstorm_deliberation",
      checkName: "brainstorm:evidence:session-1",
      status: "pass",
      validator: "brainstorm/orchestrator.ts",
      triggeredAt: "2026-06-08T00:00:00.000Z",
    } satisfies BlueprintChecksLedgerEntry;

    const matrixEntry = {
      id: "chk-job-2",
      jobId: "job-1",
      stage: "spec_document",
      checkType: "traceability_matrix",
      checkName: "matrix:coverage_check",
      status: "warn",
      validator: "traceability-matrix/derive.ts",
      triggeredAt: "2026-06-08T00:00:00.000Z",
    } satisfies BlueprintChecksLedgerEntry;

    expectTypeOf(brainstormEntry.checkType).toEqualTypeOf<"brainstorm_deliberation">();
    expectTypeOf(matrixEntry.checkType).toEqualTypeOf<"traceability_matrix">();
  });
});
