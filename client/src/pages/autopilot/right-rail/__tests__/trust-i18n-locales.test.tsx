/**
 * i18n locale snapshot for v4 trust-layer panels (tasks 65–66).
 *
 * 验证每个新面板 header / labels 在 zh-CN 与 en-US 两个 locale 下都给出对应语言
 * 文案（无单语硬编码泄漏；v4 术语保持）。沿用 SSR 字符串断言。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { ChecksLedgerView } from "../panels/ChecksLedgerPanel";
import { TraceabilityMatrixView } from "../panels/TraceabilityMatrixPanel";
import { CompanionFindingsView } from "../panels/CompanionFindingsPanel";
import { HandoffTrustBundleView } from "../panels/handoff-trust/HandoffTrustBundle";
import type {
  BlueprintChecksLedgerResponse,
  CompanionFinding,
  TraceabilityMatrix,
} from "../trust/types";

const ledger: BlueprintChecksLedgerResponse = {
  jobId: "job-1",
  entries: [
    {
      id: "a",
      jobId: "job-1",
      stage: "spec_tree",
      checkType: "schema",
      checkName: "schema",
      status: "pass",
      validator: "v.ts",
      triggeredAt: "2026-05-24T00:00:00.000Z",
    },
  ],
  summary: { total: 1, pass: 1, fail: 0, warn: 0, skip: 0 },
};

const matrix: TraceabilityMatrix = {
  jobId: "job-1",
  generatedAt: "2026-05-24T00:00:00.000Z",
  entries: [],
  coverage: {
    totalRequirements: 1,
    coveredByDesign: 1,
    coveredByTasks: 1,
    coveredByEvidence: 0,
    coveredByTests: 1,
    coveragePercent: 75,
    gaps: [],
  },
};

const finding: CompanionFinding = {
  id: "f1",
  role: "critic",
  stage: "spec_tree",
  targetArtifactId: "a",
  findings: ["finding"],
  severity: "warn",
  suggestedActions: [],
  citations: [],
  timestamp: "2026-05-24T00:00:00.000Z",
};

describe("trust panels i18n — both locales render", () => {
  it("ChecksLedgerView header switches zh-CN / en-US", () => {
    const zh = renderToStaticMarkup(
      createElement(ChecksLedgerView, {
        status: "ready",
        locale: "zh-CN",
        data: ledger,
      })
    );
    const en = renderToStaticMarkup(
      createElement(ChecksLedgerView, {
        status: "ready",
        locale: "en-US",
        data: ledger,
      })
    );
    expect(zh).toContain("校验台账");
    expect(en).toContain("Checks Ledger");
  });

  it("TraceabilityMatrixView header switches zh-CN / en-US", () => {
    const zh = renderToStaticMarkup(
      createElement(TraceabilityMatrixView, {
        status: "ready",
        locale: "zh-CN",
        matrix,
      })
    );
    const en = renderToStaticMarkup(
      createElement(TraceabilityMatrixView, {
        status: "ready",
        locale: "en-US",
        matrix,
      })
    );
    expect(zh).toContain("可追溯矩阵");
    expect(en).toContain("Traceability Matrix");
  });

  it("CompanionFindingsView header switches zh-CN / en-US", () => {
    const zh = renderToStaticMarkup(
      createElement(CompanionFindingsView, {
        locale: "zh-CN",
        findings: [finding],
      })
    );
    const en = renderToStaticMarkup(
      createElement(CompanionFindingsView, {
        locale: "en-US",
        findings: [finding],
      })
    );
    expect(zh).toContain("伴随发现");
    expect(en).toContain("Companion Findings");
  });

  it("HandoffTrustBundleView header switches zh-CN / en-US", () => {
    const props = {
      ledgerStatus: "ready" as const,
      ledger,
      matrixStatus: "ready" as const,
      matrix,
      locale: "zh-CN" as const,
    };
    const zh = renderToStaticMarkup(
      createElement(HandoffTrustBundleView, props)
    );
    const en = renderToStaticMarkup(
      createElement(HandoffTrustBundleView, { ...props, locale: "en-US" })
    );
    expect(zh).toContain("信任层交付包");
    expect(en).toContain("Trust Bundle");
  });
});
