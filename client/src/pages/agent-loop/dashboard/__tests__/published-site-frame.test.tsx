// @vitest-environment jsdom
/**
 * 应用市场里「在线运行」：发布的网页工程在弹窗里直接跑作者那一版构建。
 *
 * ⚠ 2026-10-02（slide-rule-python/services/published_site.py 头注）：页面是别人写的 JS，只能在
 *   不透明来源里跑（sandbox 不给 allow-same-origin），于是它自己的 localStorage 用不了——记账页
 *   一刷新数据就没了。宿主替它存：初值经 iframe name 递进去，改动经 postMessage 递出来。
 *   这里盯三件事：
 *     ① 快照里有 site 才在线打开，没有就说清为什么（要后端 / 没留构建），不假装能跑；
 *     ② iframe 的 sandbox 不含 allow-same-origin（含了等于把我们的域名借给别人的脚本）；
 *     ③ 只收这一框发来的存储消息——别的窗口发同样形状的消息不许写进来。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppArtifactPreview,
  acceptSiteStorage,
  deriveDetailFromAppRecord,
  publishedSiteUrl,
} from "../AppsWorkbench";

const snapshot = (extra: Record<string, unknown>) => ({
  projectSnapshot: { projectId: "p1", revision: "r1", templateVersion: "v", sessionId: "s1", ...extra },
});

describe("published snapshot → online open", () => {
  it("a kept build turns online open on; none keeps it off with the reason", () => {
    const live = deriveDetailFromAppRecord(snapshot({ site: { outputHash: "a".repeat(64) }, siteUnavailable: null }));
    expect(live.publishedSnapshot?.onlineOpen).toBe(true);
    const server = deriveDetailFromAppRecord(snapshot({ site: null, siteUnavailable: "needs_server" }));
    expect(server.publishedSnapshot?.onlineOpen).toBe(false);
    expect(server.publishedSnapshot?.siteUnavailable).toBe("needs_server");
    // 早于在线打开发布的那批卡：快照里压根没有 site 字段
    const legacy = deriveDetailFromAppRecord(snapshot({}));
    expect(legacy.publishedSnapshot?.onlineOpen).toBe(false);
  });

  it("site url keeps the trailing slash (relative assets resolve under it)", () => {
    expect(publishedSiteUrl("a/b")).toBe("/api/sliderule/apps/a%2Fb/site/");
  });
});

describe("storage message shape", () => {
  it("accepts a flat string map only", () => {
    expect(acceptSiteStorage({ type: "wb-site-storage", data: { k: "v" } })).toEqual({ k: "v" });
    expect(acceptSiteStorage({ type: "other", data: { k: "v" } })).toBeNull();
    expect(acceptSiteStorage({ type: "wb-site-storage", data: { k: 1 } })).toBeNull();
    expect(acceptSiteStorage({ type: "wb-site-storage", data: ["v"] })).toBeNull();
    expect(acceptSiteStorage({ type: "wb-site-storage", data: { k: "x".repeat(2 * 1024 * 1024) } })).toBeNull();
    expect(acceptSiteStorage(null)).toBeNull();
  });
});

describe("PublishedSiteFrame in the preview modal", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount(extra: Record<string, unknown>) {
    const detail = deriveDetailFromAppRecord(snapshot(extra));
    await act(async () => root.render(<AppArtifactPreview detail={detail} previewKey="app-1" appTitle="咖啡店" />));
    return container.querySelector<HTMLIFrameElement>('[data-testid="published-site-frame"]');
  }

  it("runs in an opaque-origin sandbox, seeded from this viewer's storage", async () => {
    window.localStorage.setItem("wb-site:app-1", JSON.stringify({ orders: "[1]" }));
    const frame = await mount({ site: { outputHash: "a".repeat(64) } });
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("src")).toBe("/api/sliderule/apps/app-1/site/");
    const sandbox = (frame!.getAttribute("sandbox") || "").split(/\s+/);
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(frame!.getAttribute("name")).toBe('wbstore:{"orders":"[1]"}');
  });

  it("only the frame's own messages are stored", async () => {
    const frame = await mount({ site: { outputHash: "a".repeat(64) } });
    const payload = { type: "wb-site-storage", data: { orders: "[2]" } };
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { ...payload, data: { orders: "forged" } }, source: window }));
    });
    expect(window.localStorage.getItem("wb-site:app-1")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: payload, source: frame!.contentWindow }));
    });
    expect(JSON.parse(window.localStorage.getItem("wb-site:app-1") || "null")).toEqual({ orders: "[2]" });
  });

  it("no kept build: no iframe, says why", async () => {
    expect(await mount({ site: null, siteUnavailable: "needs_server" })).toBeNull();
    expect(container.textContent).toContain("要后端服务");
    expect(container.querySelector('[data-testid="app-preview-published"]')).not.toBeNull();
  });
});
