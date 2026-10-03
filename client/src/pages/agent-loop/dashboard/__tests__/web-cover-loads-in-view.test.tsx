// @vitest-environment jsdom
/**
 * 「我的应用」网页工程卡：进视口才查封面；查的时候画占位，不写「还没有页面截图」；预览截图只下一次。
 *
 * ⚠ 2026-10-03 用户截图：网页工程卡一律先显示「还没有页面截图」，过好一阵图才冒出来。
 *   隔离真机量了：64 个网页工程的卡一打开同时查验收（82 个请求，本地 p50 3.3 秒），屏幕外的也在抢；
 *   没有验收截图的再 fetch 整张预览 PNG（no-store）只为看类型，<img> 显示时又下一遍。
 *   改完同一屏：24 个请求，p50 1.3 秒。
 *
 * 走真 WorkThumb + 真 useProjectThumbnailState，HTTP 换桩，Image 换记账替身（jsdom 不加载图片）。
 * 验收接口「没有验收」的原样载荷：{ operationId: null, operationStatus: null, snapshot: null }。
 *
 * 变异（逐条实测过）：WebCover 去掉 inView 门（直接传 projectId）→ 第一条红；
 *   查的时候也画「还没有页面截图」→ 第一条红；预览截图改回 fetch 预检 → 第二条红；
 *   预览图加载失败也当成有图 → 第三条红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WorkThumb } from "../AppsWorkbench";

const NO_VERIFICATION = { operationId: null, operationStatus: null, snapshot: null };
const fetched: string[] = [];
const imageSrcs: string[] = [];
let snapshotExists = true;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  set src(value: string) {
    if (!value) return;
    imageSrcs.push(value);
    queueMicrotask(() => {
      if (snapshotExists) {
        this.naturalWidth = 1280;
        this.onload?.();
      } else {
        this.onerror?.();
      }
    });
  }
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  fetched.length = 0;
  imageSrcs.length = 0;
  snapshotExists = true;
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); });
}

async function mountWebCover() {
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/verification"))
      return new Response(JSON.stringify(NO_VERIFICATION), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<WorkThumb item={{ workKind: "web", projectId: "prj-1" }} />);
  });
  await settle();
  return container;
}

/** 让 IntersectionObserver 可控：返回「让它进视口」的开关。 */
function stubObserver() {
  const callbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { callbacks.push(cb); }
    observe() {}
    disconnect() {}
  });
  return () => act(async () => callbacks.at(-1)!([{ isIntersecting: true }]));
}

describe("「我的应用」网页工程封面", () => {
  it("没进视口不查；查的时候画占位，不写「还没有页面截图」", async () => {
    const enter = stubObserver();
    const box = await mountWebCover();
    expect(fetched).toEqual([]);
    expect(box.querySelector('[data-testid="app-thumb-loading"]')).not.toBeNull();
    expect(box.textContent).not.toContain("还没有页面截图");
    await enter();
    await settle();
    expect(fetched.some(url => url.endsWith("/prj-1/verification"))).toBe(true);
  });

  it("没有验收、有预览截图：贴预览图，PNG 不另外 fetch 一遍", async () => {
    const box = await mountWebCover();
    const img = box.querySelector<HTMLImageElement>('[data-testid="app-thumb-web"]');
    expect(img?.getAttribute("src")).toBe("/api/sliderule/projects/prj-1/preview-snapshot");
    expect(imageSrcs).toEqual(["/api/sliderule/projects/prj-1/preview-snapshot"]);
    expect(fetched.filter(url => url.includes("preview-snapshot"))).toEqual([]);
  });

  it("反向：验收、预览截图都没有，查完才写「还没有页面截图」", async () => {
    snapshotExists = false;
    const box = await mountWebCover();
    expect(box.querySelector('[data-testid="app-thumb-web"]')).toBeNull();
    expect(box.querySelector('[data-testid="app-thumb-loading"]')).toBeNull();
    expect(box.textContent).toContain("还没有页面截图");
  });
});
