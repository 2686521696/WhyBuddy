// @vitest-environment jsdom
/**
 * 「我的应用」文件卡：Word 封面取第一页有字的那块铺满，不再把整页缩成一张白纸。
 *
 * ⚠ 2026-10-03 用户截图：「采购审批应用 产品/技术方案」DOCX 的卡一片白，同一份文件结果卡上封面好好的。
 *   隔离真机量了卡上的 canvas：字都画上了，可整页 242×313 被缩进 105×136，标题只剩两三像素。
 *   同屏 84 张卡一打开全部开画、Word 按 DOM 顺序排队（masonic 瀑布流，DOM 顺序 ≠ 屏幕位置），
 *   最上面那排 Word 第 55～57 秒才画出来——那一分钟里也是白卡。
 *
 * 走真 WorkThumb + 真 OfficeThumbnail，@silurus/ooxml 换替身（接口照 0.88：DocxDocument.load/renderPage），
 * HTTP 换桩，canvas 2D 换成记账替身（jsdom 没有 canvas）。替身画出来的「页」照用户那张封面：
 * 标题块在页面 38%～50% 高、横向 25%～75%。
 *
 * 变异（逐条实测过）：AppsWorkbench 里 fit 写死 "page" → 第一、四条红；contentCrop 改成返回整页 → 第一、三条红；
 *   OfficeThumbnail 去掉「进视口才开画」→ 第四条红；排队改回按进队顺序 → office-thumbnail-queue 的「离顶最近先画」红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkThumb } from "../AppsWorkbench";
import { contentCrop } from "@/pages/sliderule/project-runtime/OfficeThumbnail";

const PAGE_RATIO = 1.294; // A4 竖版
type Drawn = { src: HTMLCanvasElement; args: number[] };
const drawn: Drawn[] = [];
const rendered: string[] = [];
const pages = new WeakSet<HTMLCanvasElement>();

vi.mock("@silurus/ooxml/docx", () => ({
  DocxDocument: {
    load: async () => ({
      renderPage: async (c: HTMLCanvasElement, i: number, o: { width: number }) => {
        c.width = o.width;
        c.height = Math.round(o.width * PAGE_RATIO);
        pages.add(c);
        rendered.push(`docx:${i}:${o.width}:${c.isConnected ? "onscreen" : "offscreen"}`);
      },
      destroy() {},
    }),
  },
}));
vi.mock("@silurus/ooxml/pptx", () => ({
  PptxPresentation: {
    load: async () => ({
      renderSlide: async (c: HTMLCanvasElement, i: number) => void rendered.push(`pptx:${i}:${c.isConnected ? "onscreen" : "offscreen"}`),
      destroy() {},
    }),
  },
}));

/** 用户那张封面：白底，标题块在 38%～50% 高、横向 25%～75%。 */
function coverPixels(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = Math.round(height * 0.38); y < Math.round(height * 0.5); y += 1) {
    for (let x = Math.round(width * 0.25); x < Math.round(width * 0.75); x += 1) {
      const i = (y * width + x) * 4;
      data[i] = 30; data[i + 1] = 70; data[i + 2] = 120;
    }
  }
  return { width, height, data };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const canvas = this;
    return {
      fillStyle: "",
      fillRect() {},
      getImageData: (_x: number, _y: number, w: number, h: number) =>
        pages.has(canvas) ? coverPixels(w, h) : { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) },
      drawImage: (src: HTMLCanvasElement, ...args: number[]) => void drawn.push({ src, args }),
    };
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const fetched: string[] = [];
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  drawn.length = 0;
  rendered.length = 0;
  fetched.length = 0;
  HTMLCanvasElement.prototype.getContext = realGetContext;
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); });
}

async function mountCover(path: string) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/artifacts"))
      return new Response(JSON.stringify({ files: [{ artifactId: "art-1", path, sha256: "s", sizeBytes: 3 }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<WorkThumb item={{ workKind: "office", projectId: "p1", officePath: path, officeSha: "s" }} />);
  });
  await settle();
  return container.querySelector<HTMLElement>('[data-testid="turn-result-office-thumb"]');
}

const WORD = "output/采购审批应用产品技术方案.docx";

describe("「我的应用」Word 封面", () => {
  it("取第一页有字的那块（标题）铺满卡片，不是整页缩小、也不是从页顶的白边开始", async () => {
    const thumb = await mountCover(WORD);
    expect(thumb?.dataset.state).toBe("ok");
    expect(thumb?.dataset.fit).toBe("content");
    expect(rendered).toEqual([expect.stringMatching(/^docx:0:\d+:offscreen$/)]);
    expect(drawn).toHaveLength(1);
    const { src, args } = drawn[0];
    const [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    expect(sy).toBeGreaterThan(src.height * 0.3);        // 从标题那里开始，跳过上面那一大块空白
    expect(sw).toBeLessThan(src.width * 0.7);            // 横向也只取标题那一段，放大看得清
    expect(sx).toBeGreaterThan(0);
    expect(sy + sh).toBeLessThanOrEqual(src.height);
    expect([dx, dy]).toEqual([0, 0]);
    const canvas = thumb!.querySelector("canvas")!;
    expect([dw, dh]).toEqual([canvas.width, canvas.height]); // 铺满卡片
  });

  it("反向：PPT 照旧整张直接画到卡上，不裁", async () => {
    const thumb = await mountCover("output/经营分析.pptx");
    expect(thumb?.dataset.fit).toBe("page");
    expect(rendered).toEqual(["pptx:0:onscreen"]);
    expect(drawn).toHaveLength(0);
  });

  it("裁剪：标题块被框住、比例跟卡片一样；一个字都没有返回 null", () => {
    const page = coverPixels(726, Math.round(726 * PAGE_RATIO));
    const crop = contentCrop(page, { w: 242, h: 136 })!;
    expect(crop.sy).toBeGreaterThan(page.height * 0.3);
    expect(crop.sy).toBeLessThanOrEqual(Math.round(page.height * 0.38));
    expect(crop.sx).toBeLessThanOrEqual(Math.round(726 * 0.25));
    expect(crop.sx + crop.sw).toBeGreaterThanOrEqual(Math.round(726 * 0.75));
    expect(crop.sh / crop.sw).toBeCloseTo(136 / 242, 1);
    const blank = { width: 10, height: 10, data: new Uint8ClampedArray(400).fill(255) };
    expect(contentCrop(blank, { w: 242, h: 136 })).toBeNull();
  });

  it("没进视口不开画：滚到了才去拉文件", async () => {
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(cb); }
      observe() {}
      disconnect() {}
    });
    await mountCover(WORD);
    expect(fetched).toEqual([]);
    expect(observers.length).toBeGreaterThan(0);
    await act(async () => observers.at(-1)!([{ isIntersecting: true }]));
    await settle();
    expect(fetched.some(url => url.endsWith("/artifacts"))).toBe(true);
    expect(drawn).toHaveLength(1);
  });
});
