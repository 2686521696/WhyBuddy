/**
 * 侧栏会话封面。
 *
 * ⚠ 2026-08-23 这份测试整体反转过：原来钉的是"有图贴图、没图**活渲染**"，
 *   现在钉"有图贴图、没图**首字母**"。活渲染那一档删了，理由与实测数据见
 *   session-thumb.tsx 的模块头注（它一个人占了那页首屏 2.42 MB 里的 1.4 MB）。
 *
 * 下面那条反向判据是本次的重点：**光有"贴图能贴上"是不够的**，把活渲染悄悄
 * 加回来它照样绿，而那 1.4 MB 就回来了，页面看起来还更"好看"——没人会报。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppStoreSummary } from "../app-store-client";
import { appPreviewUrl } from "../app-store-client";
import {
  SessionThumb,
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

/** 剥掉注释再看源码——本仓踩过：判据 grep 的词同时出现在文档字符串里，
 *  改回去照样绿（见 CLAUDE.md 第二条）。这个模块的头注里恰好写着
 *  `GET /sessions/{id}` 和 getApp，不剥就是假绿。 */
function sourceWithoutComments(): string {
  return readFileSync(new URL("../session-thumb.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("侧栏封面：只贴图", () => {
  it("按 session_id 建索引，后到的同会话不覆盖", () => {
    const map = indexAppsBySession([
      summary({ id: "a1", session_id: "s1", product_name: "先" }),
      summary({ id: "a2", session_id: "s1", product_name: "后" }),
      summary({ id: "a3", session_id: "", product_name: "无会话" }),
    ]);
    expect(map.get("s1")?.id).toBe("a1");
    expect(map.has("")).toBe(false);
  });

  it("有图才贴图", () => {
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
    expect(sessionRowTitle("做一个站", summary({ product_name: "" }))).toBe("做一个站");
    expect(sessionRowTitle("", null)).toBe("新会话");
  });

  it("有图 → 贴 <img>，URL 带版本位", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionThumb, {
        sessionId: "s1",
        title: "安康随访通",
        app: summary({ has_preview: true, preview_tag: "shot.42" }),
      })
    );
    expect(html).toContain('data-testid="sidebar-session-thumb-sheet"');
    expect(html).toContain("/api/sliderule/apps/app-1/preview?v=shot.42");
  });

  it("没图 → 首字母块，**不是**现渲一个应用", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionThumb, {
        sessionId: "s1",
        title: "安康随访通",
        app: summary({ has_preview: false }),
      })
    );
    expect(html).toContain("native-agent-session-thumb-letter");
    expect(html).toContain("安"); // 取标题首字
    expect(html).not.toContain("sidebar-session-thumb-sheet");
    expect(html).not.toContain("iframe");
  });

  it("**反向：侧栏不许再拉整包**（剥注释后源码里不该有这些）", () => {
    // 这条钉的是那 1.4 MB。把活渲染加回来时，上面几条正向判据全都照样绿——
    // 页面甚至更好看，所以没人会报。只有这一条会红。
    const src = sourceWithoutComments();
    expect(src).toContain("appPreviewUrl"); // 先确认判据没打空：贴图那条还在
    expect(src).not.toContain("getApp"); // 整包：model_json + pages_json
    expect(src).not.toContain("/sessions/${"); // 完整会话状态，单条约 413 KB
    expect(src).not.toContain("HtmlAppSurface");
    expect(src).not.toContain("AppRuntimeScreen");
    expect(src).not.toContain("React.lazy");
  });
});
