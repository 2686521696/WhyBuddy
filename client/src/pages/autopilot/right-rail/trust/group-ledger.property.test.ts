/**
 * Property tests for `group-ledger.ts` (tasks 10.1 / 10.2 / 10.3).
 * design.md §Correctness Properties: Property 1 / 2 / 6.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import type {
  BlueprintChecksLedgerEntry,
  BlueprintCheckStatus,
  BlueprintCheckType,
} from "./types";
import {
  applyLedgerFilters,
  groupLedgerByStage,
  sortWarnFailFirst,
} from "./group-ledger";

const STAGES = ["input", "clarification", "route_generation", "spec_tree", "spec_docs", "effect_preview"] as const;
const STATUSES: BlueprintCheckStatus[] = ["pass", "fail", "warn", "skip"];
const CHECK_TYPES: BlueprintCheckType[] = [
  "schema",
  "invariant",
  "content_quality",
  "test",
  "merge_gate",
  "companion_trace",
  "preview_audit",
];

const arbEntry: fc.Arbitrary<BlueprintChecksLedgerEntry> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  jobId: fc.constant("job-1"),
  stage: fc.constantFrom(...STAGES),
  checkType: fc.constantFrom(...CHECK_TYPES),
  checkName: fc.string({ maxLength: 12 }),
  status: fc.constantFrom(...STATUSES),
  validator: fc.string({ maxLength: 12 }),
  triggeredAt: fc.constant("2026-05-24T00:00:00.000Z"),
}) as fc.Arbitrary<BlueprintChecksLedgerEntry>;

const arbEntries = fc.array(arbEntry, { maxLength: 40 });

const isFirstBucket = (s: BlueprintCheckStatus) => s === "fail" || s === "warn";

describe("group-ledger property tests", () => {
  it("Property 1: groupLedgerByStage partition integrity (no drop, no dup)", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const groups = groupLedgerByStage(entries);
        const flat = groups.flatMap((g) => g.entries);
        expect(flat.length).toBe(entries.length);
        // every output entry is an input entry (same reference)
        for (const e of flat) expect(entries.includes(e)).toBe(true);
        // each group is homogeneous by stage
        for (const g of groups) for (const e of g.entries) expect(e.stage).toBe(g.stage);
      }),
    );
  });

  it("Property 2: sortWarnFailFirst is a stable status-priority permutation, idempotent", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const sorted = sortWarnFailFirst(entries);
        // permutation
        expect(sorted.length).toBe(entries.length);
        // every warn/fail precedes every pass/skip
        const lastFirstBucket = sorted.reduce(
          (acc, e, i) => (isFirstBucket(e.status) ? i : acc),
          -1,
        );
        const firstSecondBucket = sorted.findIndex((e) => !isFirstBucket(e.status));
        if (lastFirstBucket >= 0 && firstSecondBucket >= 0) {
          expect(lastFirstBucket).toBeLessThan(firstSecondBucket);
        }
        // idempotent
        const twice = sortWarnFailFirst(sorted);
        expect(twice).toEqual(sorted);
      }),
    );
  });

  it("Property 6: applyLedgerFilters commutes and is idempotent", () => {
    fc.assert(
      fc.property(
        arbEntries,
        fc.option(fc.constantFrom(...CHECK_TYPES), { nil: undefined }),
        fc.option(fc.constantFrom(...STATUSES), { nil: undefined }),
        (entries, checkType, status) => {
          const both = applyLedgerFilters(entries, { checkType, status });
          // order-independent: filter by checkType then status === reverse
          const byTypeThenStatus = applyLedgerFilters(
            applyLedgerFilters(entries, { checkType }),
            { status },
          );
          const byStatusThenType = applyLedgerFilters(
            applyLedgerFilters(entries, { status }),
            { checkType },
          );
          expect(byTypeThenStatus).toEqual(byStatusThenType);
          expect(both).toEqual(byTypeThenStatus);
          // idempotent
          expect(applyLedgerFilters(both, { checkType, status })).toEqual(both);
        },
      ),
    );
  });
});
