/**
 * Integration tests for the cross-cutting `TrustSection` (tasks 53–55).
 *
 * 验证：信任层 tab 组出现；可用性 gating（spec_tree / spec docs 之前渲染空态）；
 * 既有右栏 sub-stage 契约不受影响（本组件不新增 AutopilotRailSubStage —
 * 仅作为附加 section，故此处只断言 TrustSection 自身的 tab + gating 行为）。
 *
 * 沿用本仓 SSR 约定：`renderToStaticMarkup` + `createElement` + data-testid 断言。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { TrustSection } from "../TrustSection";
import type { TrustSectionProps } from "../TrustSection";

const render = (props: TrustSectionProps) =>
  renderToStaticMarkup(createElement(TrustSection, props));

const base: TrustSectionProps = {
  jobId: "job-1",
  job: { companionFindings: [] },
  locale: "en-US",
  hasSpecTree: true,
  hasSpecDocs: true,
};

describe("TrustSection", () => {
  it("renders the Trust tab group with all three tabs", () => {
    const html = render(base);
    expect(html).toContain('data-testid="autopilot-trust-section"');
    expect(html).toContain('data-testid="trust-tablist"');
    expect(html).toContain('data-testid="trust-tab-ledger"');
    expect(html).toContain('data-testid="trust-tab-matrix"');
    expect(html).toContain('data-testid="trust-tab-companion"');
  });

  it("marks tabs unavailable before spec_tree / spec docs exist", () => {
    const html = render({ ...base, hasSpecTree: false, hasSpecDocs: false });
    expect(html).toContain('data-testid="trust-tab-ledger"');
    // ledger + companion gated on spec_tree; matrix gated on spec docs
    const ledger = html.match(/trust-tab-ledger"[^>]*data-available="false"/);
    const matrix = html.match(/trust-tab-matrix"[^>]*data-available="false"/);
    const companion = html.match(/trust-tab-companion"[^>]*data-available="false"/);
    expect(ledger).not.toBeNull();
    expect(matrix).not.toBeNull();
    expect(companion).not.toBeNull();
  });

  it("renders the ledger gated empty state when spec tree is absent", () => {
    const html = render({ ...base, hasSpecTree: false, initialTab: "ledger" });
    expect(html).toContain('data-testid="trust-ledger-gated"');
  });

  it("renders the matrix gated empty state when spec docs are absent", () => {
    const html = render({ ...base, hasSpecDocs: false, initialTab: "matrix" });
    expect(html).toContain('data-testid="trust-matrix-gated"');
  });

  it("renders the companion gated empty state when spec tree is absent", () => {
    const html = render({ ...base, hasSpecTree: false, initialTab: "companion" });
    expect(html).toContain('data-testid="trust-companion-gated"');
  });

  it("mounts the ChecksLedger panel when spec tree exists (ledger tab)", () => {
    const html = render({ ...base, initialTab: "ledger" });
    expect(html).toContain('data-testid="trust-panel-ledger"');
    // gated empty must NOT be present once available
    expect(html).not.toContain('data-testid="trust-ledger-gated"');
  });

  it("mounts the Companion panel when spec tree exists (companion tab)", () => {
    const html = render({
      ...base,
      initialTab: "companion",
      job: {
        companionFindings: [
          {
            id: "f1",
            role: "critic",
            stage: "spec_tree",
            targetArtifactId: "a",
            findings: ["finding"],
            severity: "warn",
            suggestedActions: [],
            citations: [],
            timestamp: "2026-05-24T00:00:00.000Z",
          },
        ],
      },
    });
    expect(html).toContain('data-testid="trust-panel-companion"');
    expect(html).toContain('data-testid="companion-findings-panel"');
  });
});
