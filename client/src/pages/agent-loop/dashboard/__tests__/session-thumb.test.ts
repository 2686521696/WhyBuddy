import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AppStoreSummary } from "../app-store-client";
import { appPreviewUrl } from "../app-store-client";
import {
  coverScale,
  firstLandingPage,
  indexAppsBySession,
  sessionRowTitle,
  sessionUsesSheet,
} from "../session-thumb";

function summary(partial: Partial<AppStoreSummary>): AppStoreSummary {
  return {
    id: "app-1",
    root_id: "root-1",
    parent_id: null,
    version: 1,
    session_id: "sr-1",
    goal: "做一个社区团购站",
    gate_passed: true,
    created_at: "2026-08-19",
    product_name: "安康随访通",
    theme_id: "azure",
    theme_label: "Azure",
    device: "desktop",
    landing_page_ref: "p1",
    entity_count: 4,
    page_count: 4,
    ...partial,
  };
}

describe("侧栏封面回落链", () => {
  it("按 session_id 建索引，后到的同会话不覆盖", () => {
    const map = indexAppsBySession([
      summary({ id: "a1", session_id: "s1", product_name: "先" }),
      summary({ id: "a2", session_id: "s1", product_name: "后" }),
      summary({ id: "a3", session_id: "", product_name: "无会话" }),
    ]);
    expect(map.get("s1")?.id).toBe("a1");
    expect(map.has("")).toBe(false);
  });

  it("有图才贴图，没图 / 无 app 走活渲染", () => {
    expect(sessionUsesSheet(summary({ has_preview: true }))).toBe(true);
    expect(sessionUsesSheet(summary({ has_preview: false }))).toBe(false);
    expect(sessionUsesSheet(summary({}))).toBe(false);
    expect(sessionUsesSheet(null)).toBe(false);
    expect(appPreviewUrl("app-1", "shot.1")).toBe(
      "/api/sliderule/apps/app-1/preview?v=shot.1"
    );
  });

  it("行标题优先产品名，没有才用 goal", () => {
    expect(sessionRowTitle("做一个站", summary({ product_name: "安康随访通" }))).toBe(
      "安康随访通"
    );
    expect(sessionRowTitle("做一个站", summary({ product_name: "" }))).toBe(
      "做一个站"
    );
    expect(sessionRowTitle("", null)).toBe("新会话");
  });

  it("落地页取导航第一项，空壳不算有页面", () => {
    expect(firstLandingPage({})).toBeNull();
    expect(firstLandingPage({ pages: {} })).toBeNull();
    const page = firstLandingPage({
      device: "phone",
      navItems: [{ pageId: "p2" }, { pageId: "p1" }],
      pages: { p1: "<html>一</html>", p2: "<html>二</html>" },
    });
    expect(page).toEqual({ html: "<html>二</html>", device: "phone" });
  });

  it("方格 cover 取更紧的边，16:9 画进 1:1 不留边", () => {
    expect(coverScale(48, 48, 1920, 1080)).toBeCloseTo(48 / 1080);
    expect(coverScale(48, 48, 1920, 1080)).toBeGreaterThan(48 / 1920);
  });

  it("活路径不引 AppsWorkbench，贴图走 appPreviewUrl", () => {
    const src = readFileSync(new URL("../session-thumb.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toContain("appPreviewUrl");
    expect(src).toContain("getApp");
    expect(src).toContain("LazyHtmlAppSurface");
    expect(src).toContain("sessionUsesSheet");
    expect(src).toContain("coverScale(");
    expect(src).not.toContain("AppsWorkbench");
    expect(src).not.toContain("from \"./AppsWorkbench\"");
  });
});
