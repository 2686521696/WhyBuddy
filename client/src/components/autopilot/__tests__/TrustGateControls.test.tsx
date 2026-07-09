/**
 * Component tests for RT_GATE / ESC / QA_MERGE controls (task 63).
 * SSR + 字符串断言；含信息占位（informational-only）态。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  AbortEscalateControl,
  MergeGateStatusView,
  RouteConfirmGate,
  deriveMergeGateStatus,
} from "../TrustGateControls";
import type { BlueprintChecksLedgerEntry } from "@/pages/autopilot/right-rail/trust/types";

function entry(
  checkType: BlueprintChecksLedgerEntry["checkType"],
  status: BlueprintChecksLedgerEntry["status"],
  id = `${checkType}-${status}`
): BlueprintChecksLedgerEntry {
  return {
    id,
    jobId: "job-1",
    stage: "spec_docs",
    checkType,
    checkName: id,
    status,
    validator: "v.ts",
    triggeredAt: "2026-05-24T00:00:00.000Z",
  };
}

describe("deriveMergeGateStatus", () => {
  it("derives test + content status and fail-dominant overall", () => {
    const s = deriveMergeGateStatus([
      entry("test", "pass"),
      entry("test", "fail"),
      entry("content_quality", "warn"),
      entry("schema", "fail"),
    ]);
    expect(s.testStatus).toBe("fail");
    expect(s.contentStatus).toBe("warn");
    expect(s.overall).toBe("fail");
  });

  it("returns none when no relevant entries / empty", () => {
    expect(deriveMergeGateStatus([]).overall).toBe("none");
    expect(deriveMergeGateStatus(null).testStatus).toBe("none");
    expect(deriveMergeGateStatus([entry("schema", "pass")]).overall).toBe(
      "none"
    );
  });
});

describe("RouteConfirmGate", () => {
  it("disables confirm until a route is selected", () => {
    const html = renderToStaticMarkup(
      createElement(RouteConfirmGate, { locale: "en-US", routeSelected: false })
    );
    expect(html).toContain('data-testid="rt-gate"');
    expect(html).toContain('data-route-selected="false"');
    expect(html).toMatch(/rt-gate-confirm[^>]*disabled/);
  });

  it("enables confirm when route is selected", () => {
    const html = renderToStaticMarkup(
      createElement(RouteConfirmGate, {
        locale: "en-US",
        routeSelected: true,
        onConfirm: () => {},
      })
    );
    expect(html).toContain('data-route-selected="true"');
    expect(html).not.toMatch(/rt-gate-confirm[^>]*disabled/);
  });
});

describe("AbortEscalateControl", () => {
  it("renders an actionable button when escalation is available", () => {
    const html = renderToStaticMarkup(
      createElement(AbortEscalateControl, {
        locale: "en-US",
        onEscalate: () => {},
      })
    );
    expect(html).toContain('data-available="true"');
    expect(html).toContain('data-testid="esc-action"');
  });

  it("renders an informational placeholder (no fabricated success) when unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(AbortEscalateControl, { locale: "en-US" })
    );
    expect(html).toContain('data-available="false"');
    expect(html).toContain('data-testid="esc-placeholder"');
    expect(html).not.toContain('data-testid="esc-action"');
  });
});

describe("MergeGateStatusView", () => {
  it("renders human-judged merge gate with derived statuses", () => {
    const status = deriveMergeGateStatus([
      entry("test", "pass"),
      entry("content_quality", "warn"),
    ]);
    const html = renderToStaticMarkup(
      createElement(MergeGateStatusView, { locale: "en-US", status })
    );
    expect(html).toContain('data-testid="qa-merge"');
    expect(html).toContain('data-overall="warn"');
    expect(html).toContain('data-testid="qa-merge-test"');
    expect(html).toContain('data-testid="qa-merge-content"');
  });
});
