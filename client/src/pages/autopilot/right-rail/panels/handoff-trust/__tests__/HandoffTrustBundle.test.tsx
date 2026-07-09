/**
 * Component tests for `HandoffTrustBundleView` + `collectHandoffOpenItems`
 * (task 59). SSR + 字符串断言；覆盖加厚交付包各 section 与"优雅省略"。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  HandoffTrustBundleView,
  collectHandoffOpenItems,
} from "../HandoffTrustBundle";
import type {
  BlueprintChecksLedgerEntry,
  BlueprintChecksLedgerResponse,
  TraceabilityMatrix,
} from "../../../trust/types";

function entry(
  id: string,
  status: BlueprintChecksLedgerEntry["status"],
  checkName = id,
): BlueprintChecksLedgerEntry {
  return {
    id,
    jobId: "job-1",
    stage: "spec_tree",
    checkType: "schema",
    checkName,
    status,
    validator: "v.ts",
    triggeredAt: "2026-05-24T00:00:00.000Z",
  };
}

function ledger(
  entries: BlueprintChecksLedgerEntry[],
): BlueprintChecksLedgerResponse {
  const summary = { total: entries.length, pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const e of entries) summary[e.status] += 1;
  return { jobId: "job-1", entries, summary };
}

function matrix(): TraceabilityMatrix {
  return {
    jobId: "job-1",
    generatedAt: "2026-05-24T00:00:00.000Z",
    entries: [],
    coverage: {
      totalRequirements: 2,
      coveredByDesign: 2,
      coveredByTasks: 1,
      coveredByEvidence: 0,
      coveredByTests: 1,
      coveragePercent: 60,
      gaps: [
        { requirementId: "R2", requirementTitle: "Logout", missingLinks: ["test"] },
      ],
    },
  };
}

const render = (props: Parameters<typeof HandoffTrustBundleView>[0]) =>
  renderToStaticMarkup(createElement(HandoffTrustBundleView, props));

describe("collectHandoffOpenItems", () => {
  it("collects ledger warn/fail + matrix gaps, skips pass", () => {
    const items = collectHandoffOpenItems({
      ledger: ledger([entry("a", "pass"), entry("b", "warn"), entry("c", "fail")]),
      matrix: matrix(),
    });
    const kinds = items.map((i) => `${i.kind}:${i.id}`);
    expect(kinds).toContain("ledger:b");
    expect(kinds).toContain("ledger:c");
    expect(kinds).toContain("gap:R2");
    expect(kinds).not.toContain("ledger:a");
  });

  it("returns empty array when both inputs are missing", () => {
    expect(collectHandoffOpenItems({})).toEqual([]);
    expect(collectHandoffOpenItems({ ledger: null, matrix: null })).toEqual([]);
  });
});

describe("HandoffTrustBundleView", () => {
  it("renders ledger summary, matrix summary + export, and open items", () => {
    const html = render({
      ledgerStatus: "ready",
      ledger: ledger([entry("a", "pass"), entry("b", "warn")]),
      matrixStatus: "ready",
      matrix: matrix(),
      locale: "en-US",
    });
    expect(html).toContain('data-testid="handoff-trust-bundle"');
    expect(html).toContain('data-testid="handoff-ledger-summary"');
    expect(html).toContain('data-testid="handoff-matrix-summary"');
    expect(html).toContain('data-testid="handoff-matrix-export"');
    expect(html).toContain('data-testid="handoff-open-items"');
    expect(html).toContain('data-testid="handoff-open-item"');
  });

  it("gracefully omits when no trust artifacts are ready", () => {
    const html = render({
      ledgerStatus: "idle",
      ledger: null,
      matrixStatus: "not_generated",
      matrix: null,
      locale: "zh-CN",
    });
    expect(html).toContain('data-testid="handoff-trust-bundle-omitted"');
    expect(html).not.toContain('data-testid="handoff-trust-bundle"');
  });

  it("renders ledger-only when matrix not generated", () => {
    const html = render({
      ledgerStatus: "ready",
      ledger: ledger([entry("a", "pass")]),
      matrixStatus: "not_generated",
      matrix: null,
      locale: "en-US",
    });
    expect(html).toContain('data-testid="handoff-ledger-summary"');
    expect(html).not.toContain('data-testid="handoff-matrix-summary"');
    // no open items → empty marker
    expect(html).toContain('data-testid="handoff-open-items-empty"');
  });
});
