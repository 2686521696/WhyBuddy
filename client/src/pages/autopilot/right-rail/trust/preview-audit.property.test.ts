/**
 * Property tests for `preview-audit.ts` (task 14.1).
 * design.md §Correctness Properties: Property 4.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import type {
  BlueprintChecksLedgerEntry,
  BlueprintCheckStatus,
  BlueprintCheckType,
} from "./types";
import { derivePreviewAuditVerdict } from "./preview-audit";

const STATUSES: BlueprintCheckStatus[] = ["pass", "fail", "warn", "skip"];
const CHECK_TYPES: BlueprintCheckType[] = [
  "schema",
  "invariant",
  "preview_audit",
  "content_quality",
];

const arbEntry: fc.Arbitrary<BlueprintChecksLedgerEntry> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  jobId: fc.constant("job-1"),
  stage: fc.constant("effect_preview"),
  checkType: fc.constantFrom(...CHECK_TYPES),
  checkName: fc.constantFrom(
    "preview_audit_batch",
    "preview_audit_retry_exhausted",
    "fallback_pretending",
    "fake_success",
    "duplicate_content",
    "other",
  ),
  status: fc.constantFrom(...STATUSES),
  validator: fc.constant("v"),
  triggeredAt: fc.constant("2026-05-24T00:00:00.000Z"),
}) as fc.Arbitrary<BlueprintChecksLedgerEntry>;

describe("preview-audit property tests", () => {
  it("Property 4: batchStatus reflects ledger; never throws on missing optionals", () => {
    fc.assert(
      fc.property(fc.array(arbEntry, { maxLength: 30 }), (entries) => {
        const verdict = derivePreviewAuditVerdict(entries);
        const audit = entries.filter((e) => e.checkType === "preview_audit");
        const hasFail = audit.some((e) => e.status === "fail");
        const hasWarn = audit.some((e) => e.status === "warn");
        const expected = hasFail ? "fail" : hasWarn ? "warn" : "pass";
        expect(verdict.batchStatus).toBe(expected);
        // exhausted iff a retry_exhausted preview_audit entry exists
        const exhausted = audit.some((e) =>
          (e.checkName ?? "").toLowerCase().includes("retry_exhausted"),
        );
        expect(verdict.exhausted).toBe(exhausted);
        expect(verdict.retryCount).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("Property 4 (defensive): empty / undefined inputs yield a pass verdict, no throw", () => {
    expect(derivePreviewAuditVerdict(undefined).batchStatus).toBe("pass");
    expect(derivePreviewAuditVerdict([]).batchStatus).toBe("pass");
    expect(derivePreviewAuditVerdict(null).findings).toEqual([]);
  });
});
