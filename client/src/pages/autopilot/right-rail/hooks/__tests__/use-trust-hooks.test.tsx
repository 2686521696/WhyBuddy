/**
 * Tests for the v4 trust-layer hooks (task 21).
 *
 * 测试策略（与本仓既有约定一致）：本仓 *未* 集成 `@testing-library/react` /
 * `jsdom` / `happy-dom`，因此 `useEffect`-驱动的异步 fetch 状态机不能在此直接驱动
 * （`renderToStaticMarkup` 只执行 render 期逻辑，`useMemo` 会执行、`useEffect` 不会）。
 * 因此：
 * - `useCompanionFindings` 是纯 `useMemo` selector，用 SSR probe 完整断言（含
 *   loading→ready 等价的派生输出、empty、排序、分组）。
 * - 两个 fetch hook 的同步初始契约（无 jobId → idle）用 SSR probe 断言；其异步
 *   状态迁移（loading→ready / empty / error / not_generated / abort）由注入式
 *   fetcher + Phase 1 wrapper 单测覆盖，并在后续面板组件测试里端到端走查。
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import type { CompanionFinding } from "@shared/blueprint/companion/types";
import { useCompanionFindings } from "../use-companion-findings";
import { useChecksLedger } from "../use-checks-ledger";
import { useTraceabilityMatrix } from "../use-traceability-matrix";

function finding(
  id: string,
  severity: CompanionFinding["severity"],
  stage: CompanionFinding["stage"]
): CompanionFinding {
  return {
    id,
    role: "critic",
    stage,
    targetArtifactId: "a",
    findings: ["f"],
    severity,
    suggestedActions: [],
    citations: [],
    timestamp: "2026-05-24T00:00:00.000Z",
  };
}

function CompanionProbe({ job }: { job: unknown }) {
  const { sorted, groups, isEmpty } = useCompanionFindings(job as never);
  return createElement(
    "div",
    {
      "data-empty": String(isEmpty),
      "data-order": sorted.map(f => `${f.id}:${f.severity}`).join(","),
      "data-groups": groups
        .map(g => `${g.stage}=${g.findings.length}`)
        .join(","),
    },
    null
  );
}

function ChecksLedgerProbe({ jobId }: { jobId: string | null }) {
  const { status } = useChecksLedger(jobId);
  return createElement("div", { "data-status": status }, null);
}

function MatrixProbe({ jobId }: { jobId: string | null }) {
  const { status } = useTraceabilityMatrix(jobId);
  return createElement("div", { "data-status": status }, null);
}

describe("useCompanionFindings (pure selector, SSR probe)", () => {
  it("returns empty for missing/empty companionFindings", () => {
    expect(
      renderToStaticMarkup(createElement(CompanionProbe, { job: null }))
    ).toContain('data-empty="true"');
    expect(
      renderToStaticMarkup(createElement(CompanionProbe, { job: {} }))
    ).toContain('data-empty="true"');
  });

  it("sorts by severity (error > warn > info) and groups by stage", () => {
    const job = {
      companionFindings: [
        finding("a", "info", "spec_tree"),
        finding("b", "error", "clarification"),
        finding("c", "warn", "spec_tree"),
      ],
    };
    const html = renderToStaticMarkup(createElement(CompanionProbe, { job }));
    expect(html).toContain('data-empty="false"');
    expect(html).toContain('data-order="b:error,c:warn,a:info"');
    // grouped by first-seen stage order: spec_tree (a,c) then clarification (b)
    expect(html).toContain('data-groups="spec_tree=2,clarification=1"');
  });
});

describe("trust fetch hooks — synchronous initial contract (SSR probe)", () => {
  it("useChecksLedger is idle when jobId is null", () => {
    expect(
      renderToStaticMarkup(createElement(ChecksLedgerProbe, { jobId: null }))
    ).toContain('data-status="idle"');
  });

  it("useTraceabilityMatrix is idle when jobId is null", () => {
    expect(
      renderToStaticMarkup(createElement(MatrixProbe, { jobId: null }))
    ).toContain('data-status="idle"');
  });
});
