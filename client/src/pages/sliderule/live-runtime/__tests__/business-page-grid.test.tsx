import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BusinessPageGrid from "../BusinessPageGrid";

describe("BusinessPageGrid", () => {
  it("renders normalized desktop coordinates through CSS Grid", () => {
    const html = renderToStaticMarkup(
      <BusinessPageGrid
        breakpoint="desktop"
        items={[
          { blockRef: "metrics", x: 0, y: 0, w: 4, h: 1 },
          { blockRef: "page-content", x: 4, y: 0, w: 8, h: 2 },
        ]}
        renderItem={ref => <div>{ref}</div>}
      />
    );

    expect(html).toContain("repeat(12,minmax(0,1fr))");
    expect(html).toContain("grid-column:1 / span 4");
    expect(html).toContain("grid-column:5 / span 8");
    expect(html).toContain('data-layout-ref="page-content"');
  });

  it("skips unrenderable refs without failing the remaining layout", () => {
    const html = renderToStaticMarkup(
      <BusinessPageGrid
        breakpoint="phone"
        items={[
          { blockRef: "missing", x: 0, y: 0, w: 4, h: 1 },
          { blockRef: "feed", x: 0, y: 1, w: 4, h: 1 },
        ]}
        renderItem={ref => (ref === "feed" ? <div>动态</div> : null)}
      />
    );

    expect(html).not.toContain('data-layout-ref="missing"');
    expect(html).toContain('data-layout-ref="feed"');
    expect(html).toContain("动态");
  });
});
