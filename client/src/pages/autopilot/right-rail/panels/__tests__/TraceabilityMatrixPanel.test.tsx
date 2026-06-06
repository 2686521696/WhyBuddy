/**
 * Component tests for `TraceabilityMatrixView` (task 45). SSR + 字符串断言。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { TraceabilityMatrixView } from "../TraceabilityMatrixPanel";
import type { TraceabilityMatrix } from "../../trust/types";

function matrix(overrides?: Partial<TraceabilityMatrix>): TraceabilityMatrix {
  return {
    jobId: "job-1",
    generatedAt: "2026-05-24T00:00:00.000Z",
    entries: [
      {
        requirementId: "R1",
        requirementTitle: "Login",
        designSections: ["§A"],
        taskIds: ["1", "2"],
        evidenceSources: [],
        testCases: ["t1"],
      },
    ],
    coverage: {
      totalRequirements: 1,
      coveredByDesign: 1,
      coveredByTasks: 1,
      coveredByEvidence: 0,
      coveredByTests: 1,
      coveragePercent: 75,
      gaps: [
        { requirementId: "R1", requirementTitle: "Login", missingLinks: ["evidence"] },
      ],
    },
    ...overrides,
  };
}

const render = (props: Parameters<typeof TraceabilityMatrixView>[0]) =>
  renderToStaticMarkup(createElement(TraceabilityMatrixView, props));

describe("TraceabilityMatrixView", () => {
  it("renders coverage ring + dimension counts + five-column table", () => {
    const html = render({ status: "ready", locale: "en-US", matrix: matrix() });
    expect(html).toContain('data-testid="traceability-matrix-panel"');
    expect(html).toContain('data-testid="matrix-coverage-ring"');
    expect(html).toContain('data-coverage-percent="75"');
    expect(html).toContain('data-testid="matrix-table"');
    expect(html).toContain('data-testid="matrix-row"');
    expect(html).toContain('data-requirement-id="R1"');
  });

  it("renders the gap list", () => {
    const html = render({ status: "ready", locale: "en-US", matrix: matrix() });
    expect(html).toContain('data-testid="matrix-gaps"');
    expect(html).toContain('data-testid="matrix-gap-row"');
    expect(html).toContain("evidence");
  });

  it("renders the export button", () => {
    const html = render({ status: "ready", locale: "en-US", matrix: matrix() });
    expect(html).toContain('data-testid="matrix-export-markdown"');
  });

  it("renders the stale badge when status is stale", () => {
    const html = render({
      status: "stale",
      locale: "en-US",
      matrix: matrix({ stale: true }),
    });
    expect(html).toContain('data-testid="matrix-stale-badge"');
  });

  it("renders not_generated empty state", () => {
    const html = render({ status: "not_generated", locale: "zh-CN", matrix: null });
    expect(html).toContain('data-testid="matrix-not-generated"');
  });

  it("renders error state with retry", () => {
    const html = render({ status: "error", locale: "en-US", matrix: null });
    expect(html).toContain('data-testid="matrix-error"');
    expect(html).toContain('data-testid="matrix-retry"');
  });
});
