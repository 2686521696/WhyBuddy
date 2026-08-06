import { describe, expect, it } from "vitest";
import {
  PAGE_CONTENT_REF,
  ensurePageContentItem,
  normalizeBusinessGrid,
  resolveBusinessGrid,
  upgradeLegacySlotsToGrid,
} from "../business-page-layout";

describe("business page responsive layout", () => {
  it("normalizes declared items, clamps bounds, and removes duplicate or dangling refs", () => {
    const grid = normalizeBusinessGrid(
      {
        desktop: [
          { blockRef: "metrics", x: -2, y: 1, w: 20, h: 2 },
          { blockRef: "metrics", x: 4, y: 2, w: 4, h: 1 },
          { blockRef: "feed", x: 8, y: 0, w: 4, h: 2 },
          { blockRef: "missing", x: 0, y: 4, w: 4, h: 1 },
          { blockRef: "fractional", x: 0.5, y: 4, w: 4, h: 1 },
        ],
      },
      new Set(["metrics", "feed", "fractional", PAGE_CONTENT_REF])
    );

    expect(grid?.desktop).toEqual([
      { blockRef: "feed", x: 8, y: 0, w: 4, h: 2 },
      { blockRef: "metrics", x: 0, y: 1, w: 12, h: 2 },
    ]);
  });

  it("falls back from phone to tablet to desktop and projects wider layouts into the target columns", () => {
    const grid = normalizeBusinessGrid(
      {
        desktop: [{ blockRef: "content", x: 8, y: 0, w: 4, h: 2 }],
      },
      new Set(["content"])
    )!;

    expect(resolveBusinessGrid(grid, "phone")).toEqual([
      { blockRef: "content", x: 0, y: 0, w: 4, h: 2 },
    ]);
  });

  it("upgrades workbench slots into a content-led 8/4 desktop composition", () => {
    const grid = upgradeLegacySlotsToGrid("workbench", {
      summary: ["filter", "metrics"],
      primary: ["timeline"],
      secondary: [],
      activity: ["feed"],
      content: [],
    });

    expect(grid.desktop).toEqual([
      { blockRef: "filter", x: 0, y: 0, w: 12, h: 1 },
      { blockRef: "metrics", x: 0, y: 1, w: 12, h: 1 },
      { blockRef: "timeline", x: 0, y: 2, w: 12, h: 1 },
      { blockRef: PAGE_CONTENT_REF, x: 0, y: 3, w: 8, h: 3 },
      { blockRef: "feed", x: 8, y: 3, w: 4, h: 3 },
    ]);
  });

  it("gives kanban and calendar content full visual ownership instead of appending a generic table", () => {
    for (const kind of ["kanban", "calendar"] as const) {
      const grid = upgradeLegacySlotsToGrid(kind, {
        summary: ["filter"],
        primary: ["timeline"],
        secondary: [],
        activity: ["feed"],
        content: [],
      });

      expect(grid.desktop.find(item => item.blockRef === PAGE_CONTENT_REF)).toMatchObject({
        x: 0,
        w: 9,
      });
      expect(grid.desktop.find(item => item.blockRef === "feed")).toMatchObject({
        x: 9,
        w: 3,
      });
    }
  });

  it("keeps dashboard data and activity in the first row and moves workflow below them", () => {
    const grid = upgradeLegacySlotsToGrid("dashboard", {
      summary: [],
      primary: ["payment_timeline"],
      secondary: [],
      activity: ["payment_activity"],
      content: [],
    });

    expect(grid.desktop).toEqual([
      { blockRef: PAGE_CONTENT_REF, x: 0, y: 0, w: 8, h: 3 },
      { blockRef: "payment_activity", x: 8, y: 0, w: 4, h: 3 },
      { blockRef: "payment_timeline", x: 0, y: 3, w: 12, h: 1 },
    ]);
    expect(grid.phone.map(item => item.blockRef)).toEqual([
      PAGE_CONTENT_REF,
      "payment_activity",
      "payment_timeline",
    ]);
  });

  it("turns every phone layout into one semantic column with page content before activity", () => {
    const grid = upgradeLegacySlotsToGrid("workbench", {
      summary: ["filter"],
      primary: ["timeline"],
      secondary: ["ranking"],
      activity: ["feed"],
      content: [],
    });

    expect(grid.phone).toEqual([
      { blockRef: "filter", x: 0, y: 0, w: 4, h: 1 },
      { blockRef: "timeline", x: 0, y: 1, w: 4, h: 1 },
      { blockRef: PAGE_CONTENT_REF, x: 0, y: 2, w: 4, h: 2 },
      { blockRef: "ranking", x: 0, y: 3, w: 4, h: 1 },
      { blockRef: "feed", x: 0, y: 4, w: 4, h: 1 },
    ]);
  });

  it("appends the protected page content surface when an explicit grid forgets it", () => {
    expect(
      ensurePageContentItem(
        [{ blockRef: "filter", x: 0, y: 0, w: 12, h: 1 }],
        "desktop"
      )
    ).toEqual([
      { blockRef: "filter", x: 0, y: 0, w: 12, h: 1 },
      { blockRef: PAGE_CONTENT_REF, x: 0, y: 1, w: 12, h: 3 },
    ]);
  });
});
