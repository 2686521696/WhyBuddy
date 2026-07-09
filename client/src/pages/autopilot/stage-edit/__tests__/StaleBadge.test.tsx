import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StaleBadge } from "../StaleBadge";

describe("<StaleBadge>", () => {
  it("renders nothing when staleSince is absent", () => {
    const markup = renderToStaticMarkup(<StaleBadge />);

    expect(markup).toBe("");
  });

  it("keeps the visible badge compact while preserving the stale detail in the tooltip", () => {
    const markup = renderToStaticMarkup(
      <StaleBadge
        staleSince="2026-05-23T08:00:00.000Z"
        invalidatedBy={{
          stage: "clarification",
          reason: "upstream_clarification_changed",
          triggeredAt: "2026-05-23T08:00:00.000Z",
        }}
      />
    );

    expect(markup).toMatch(/>Stale<\/span>/);
    expect(markup).toContain("clarification");
    expect(markup).toContain("upstream_clarification_changed");
    expect(markup).toContain("2026-05-23");
    expect(markup).not.toContain("Stale: clarification changed");
    expect(markup).not.toContain("Reason:");
  });

  it("localizes the compact badge label in Chinese mode", () => {
    const markup = renderToStaticMarkup(
      <StaleBadge
        locale="zh-CN"
        staleSince="2026-05-23T08:00:00.000Z"
        invalidatedBy={{
          stage: "spec_tree",
          reason: "upstream_spec_tree_changed",
          triggeredAt: "2026-05-23T08:00:00.000Z",
        }}
      />
    );

    expect(markup).toMatch(/>已过期<\/span>/);
    expect(markup).toContain("规格树");
    expect(markup).toContain("upstream_spec_tree_changed");
    expect(markup).not.toContain(">Stale<");
  });
});
