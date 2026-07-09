/**
 * Component tests for `PreviewProvenanceChip` + `PreviewAuditBadge` (task 36).
 * SSR `renderToStaticMarkup` + 字符串断言（本仓未集成 @testing-library/react）。
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { PreviewProvenanceChip } from "../PreviewProvenanceChip";
import { PreviewAuditBadge } from "../PreviewAuditBadge";
import type { BlueprintPreviewProvenance } from "@shared/blueprint/preview-audit/types";
import type { PreviewAuditVerdict } from "../../../pages/autopilot/right-rail/trust/types";

function prov(p: Partial<BlueprintPreviewProvenance>): BlueprintPreviewProvenance {
  return {
    source: "model",
    ok: true,
    errorIndicators: [],
    generatedAt: "2026-05-24T00:00:00.000Z",
    retryCount: 0,
    ...p,
  };
}

describe("PreviewProvenanceChip", () => {
  it("renders model_ok success variant", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewProvenanceChip, {
        provenance: prov({ source: "model", ok: true, modelUsed: "gpt-image-2" }),
        locale: "en-US",
      }),
    );
    expect(html).toContain('data-provenance-class="model_ok"');
    expect(html).toContain('data-testid="preview-provenance-model"');
    expect(html).toContain("gpt-image-2");
  });

  it("renders fallback (non-success) variant for fallback+ok and never model_ok", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewProvenanceChip, {
        provenance: prov({ source: "fallback", ok: true }),
        locale: "en-US",
      }),
    );
    expect(html).toContain('data-provenance-class="fallback"');
    expect(html).not.toContain('data-provenance-class="model_ok"');
  });

  it("renders failed variant + error indicators when ok:false", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewProvenanceChip, {
        provenance: prov({ source: "fallback", ok: false, errorIndicators: ["503_exhausted"] }),
        locale: "en-US",
      }),
    );
    expect(html).toContain('data-provenance-class="failed"');
    expect(html).toContain("503_exhausted");
  });
});

describe("PreviewAuditBadge", () => {
  const baseVerdict: PreviewAuditVerdict = {
    batchStatus: "pass",
    retryCount: 0,
    exhausted: false,
    findings: [],
  };

  it("renders pass batch verdict", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewAuditBadge, { verdict: baseVerdict, locale: "en-US" }),
    );
    expect(html).toContain('data-batch-status="pass"');
    expect(html).toContain('data-testid="preview-audit-accountability"');
  });

  it("renders fraud category chips + reforge + exhausted", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewAuditBadge, {
        locale: "en-US",
        verdict: {
          batchStatus: "fail",
          retryCount: 2,
          exhausted: true,
          findings: [
            { reason: "fallback_pretending", details: "x", severity: "error" },
            { reason: "duplicate_content", details: "y", severity: "warn" },
          ],
        },
      }),
    );
    expect(html).toContain('data-batch-status="fail"');
    expect(html).toContain('data-testid="preview-audit-fraud-fallback_pretending"');
    expect(html).toContain('data-testid="preview-audit-fraud-duplicate_content"');
    expect(html).toContain('data-testid="preview-audit-retry"');
    expect(html).toContain('data-testid="preview-audit-exhausted"');
  });

  it("renders empty state when no data", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewAuditBadge, {
        verdict: baseVerdict,
        locale: "en-US",
        hasData: false,
      }),
    );
    expect(html).toContain('data-testid="preview-audit-empty"');
  });
});
