import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RightRailStaleIndicator } from "../RightRailStaleIndicator";

describe("<RightRailStaleIndicator>", () => {
  it("renders nothing for a fresh current-stage artifact", () => {
    const markup = renderToStaticMarkup(
      <RightRailStaleIndicator
        artifact={{ id: "spec-docs", stage: "spec_documents" }}
        currentStage="spec_documents"
        onRegenerate={vi.fn()}
      />
    );

    expect(markup).toBe("");
  });

  it("renders stale warning and per-stage regenerate button for current artifact", () => {
    const markup = renderToStaticMarkup(
      <RightRailStaleIndicator
        artifact={{
          id: "spec-docs",
          stage: "spec_documents",
          staleSince: "2026-05-23T08:00:00.000Z",
        }}
        currentStage="spec_documents"
        onRegenerate={vi.fn()}
      />
    );

    expect(markup).toContain("Current stage artifact is stale");
    expect(markup).toContain("Regenerate documents");
    expect(markup).toContain(
      'data-testid="autopilot-right-rail-stale-indicator"'
    );
  });

  it("renders localized stale warning and regenerate action in Chinese mode", () => {
    const markup = renderToStaticMarkup(
      <RightRailStaleIndicator
        artifact={{
          id: "spec-docs",
          stage: "spec_documents",
          staleSince: "2026-05-23T08:00:00.000Z",
        }}
        currentStage="spec_documents"
        locale="zh-CN"
        onRegenerate={vi.fn()}
      />
    );

    expect(markup).toContain("当前阶段产物已过期");
    expect(markup).toContain("重新生成规格文档");
    expect(markup).not.toContain("Current stage artifact is stale");
    expect(markup).not.toContain("Regenerate documents");
  });

  it("disables regenerate while an upstream stage is running", () => {
    const markup = renderToStaticMarkup(
      <RightRailStaleIndicator
        artifact={{
          id: "preview",
          stage: "effect_preview",
          staleSince: "2026-05-23T08:00:00.000Z",
        }}
        currentStage="effect_preview"
        onRegenerate={vi.fn()}
        status={{ isUpstreamRunning: true, runningStage: "spec_documents" }}
      />
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain("Waiting for spec_documents");
  });
});
