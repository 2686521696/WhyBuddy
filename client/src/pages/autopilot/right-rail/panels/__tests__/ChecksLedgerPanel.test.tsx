/**
 * Component tests for `ChecksLedgerView` (task 31).
 *
 * 本仓未集成 `@testing-library/react` / jsdom，沿用 `renderToStaticMarkup` SSR +
 * 字符串/正则断言。测试纯展示组件 `ChecksLedgerView`（effect-driven 外层
 * `ChecksLedgerPanel` 的异步态由 hook 单测覆盖）。
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { ChecksLedgerView } from "../ChecksLedgerPanel";
import type {
  BlueprintChecksLedgerEntry,
  BlueprintChecksLedgerResponse,
  BlueprintCheckStatus,
  BlueprintCheckType,
} from "../../trust/types";

function entry(
  id: string,
  checkType: BlueprintCheckType,
  status: BlueprintCheckStatus,
  stage = "spec_tree",
  checkName = id
): BlueprintChecksLedgerEntry {
  return {
    id,
    jobId: "job-1",
    stage: stage as BlueprintChecksLedgerEntry["stage"],
    checkType,
    checkName,
    status,
    validator: "v.ts",
    triggeredAt: "2026-05-24T00:00:00.000Z",
  };
}

function response(
  entries: BlueprintChecksLedgerEntry[]
): BlueprintChecksLedgerResponse {
  const summary = { total: entries.length, pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const e of entries) summary[e.status] += 1;
  return { jobId: "job-1", entries, summary };
}

const render = (props: Parameters<typeof ChecksLedgerView>[0]) =>
  renderToStaticMarkup(createElement(ChecksLedgerView, props));

describe("ChecksLedgerView", () => {
  it("renders summary badges with counts", () => {
    const html = render({
      status: "ready",
      locale: "en-US",
      data: response([
        entry("a", "schema", "pass"),
        entry("b", "invariant", "warn"),
        entry("c", "preview_audit", "fail", "effect_preview"),
      ]),
    });
    expect(html).toContain('data-testid="checks-ledger-panel"');
    expect(html).toContain('data-testid="ledger-summary-pass"');
    expect(html).toContain('data-testid="ledger-summary-warn"');
    expect(html).toContain('data-testid="ledger-summary-fail"');
  });

  it("groups entries by stage and renders entries", () => {
    const html = render({
      status: "ready",
      locale: "en-US",
      data: response([
        entry("a", "schema", "pass", "spec_tree"),
        entry("b", "content_quality", "warn", "spec_docs"),
      ]),
    });
    expect(html).toContain('data-testid="ledger-stage-spec_tree"');
    expect(html).toContain('data-testid="ledger-stage-spec_docs"');
    expect(html).toContain('data-testid="ledger-entry"');
  });

  it("highlights warn/fail entries (data-status attr present)", () => {
    const html = render({
      status: "ready",
      locale: "en-US",
      data: response([entry("a", "invariant", "fail")]),
    });
    expect(html).toContain('data-status="fail"');
  });

  it("renders the filter bar with checkType and status chips", () => {
    const html = render({
      status: "ready",
      locale: "en-US",
      data: response([entry("a", "schema", "pass")]),
    });
    expect(html).toContain('data-testid="ledger-filter-checktype-invariant"');
    expect(html).toContain('data-testid="ledger-filter-status-warn"');
  });

  it("renders the SP_INV invariant section", () => {
    const html = render({
      status: "ready",
      locale: "en-US",
      data: response([
        entry(
          "a",
          "invariant",
          "warn",
          "spec_tree",
          "business_requirement_coverage"
        ),
      ]),
    });
    expect(html).toContain('data-testid="ledger-section-invariant"');
    expect(html).toContain("business_requirement_coverage");
  });

  it("renders the QA_CONTENT section", () => {
    const html = render({
      status: "ready",
      locale: "en-US",
      data: response([
        entry("a", "content_quality", "warn", "spec_docs", "EARS check"),
      ]),
    });
    expect(html).toContain('data-testid="ledger-section-content-quality"');
  });

  it("renders companion_trace cross-reference when present", () => {
    const html = render({
      status: "ready",
      locale: "en-US",
      data: response([entry("a", "companion_trace", "warn", "clarification")]),
    });
    expect(html).toContain('data-testid="ledger-companion-xref"');
  });

  it("renders gates-off empty state", () => {
    const html = render({
      status: "empty",
      locale: "zh-CN",
      data: response([]),
    });
    expect(html).toContain('data-testid="ledger-empty"');
  });

  it("renders error state with retry", () => {
    const html = render({ status: "error", locale: "en-US", data: null });
    expect(html).toContain('data-testid="ledger-error"');
    expect(html).toContain('data-testid="ledger-retry"');
  });

  it("always shows the non-blocking note (human is the gate)", () => {
    const html = render({
      status: "ready",
      locale: "zh-CN",
      data: response([entry("a", "schema", "pass")]),
    });
    expect(html).toContain('data-testid="ledger-nonblocking-note"');
  });
});
