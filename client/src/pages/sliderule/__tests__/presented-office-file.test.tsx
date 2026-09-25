// @vitest-environment jsdom
/**
 * 办公预览直接画文件字节，不把 PDF 塞进 iframe。
 *
 * ⚠ 2026-09-23 报价表预览是 PDF，Chrome 沙箱框显示「此页面已被屏蔽」。
 *   再走 render=browser 或 sandbox iframe，本条变红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PresentedOfficeFile, slidePagerLabel } from "../project-runtime/PresentedOfficeFile";

const loaded: string[] = [];

vi.mock("@silurus/ooxml/xlsx", () => ({
  XlsxViewer: class {
    constructor(el: HTMLElement) {
      el.dataset.viewer = "xlsx";
    }
    load(buf: ArrayBuffer) {
      loaded.push(`xlsx:${buf.byteLength}`);
      return Promise.resolve();
    }
    destroy() {}
  },
}));

const pptxCalls: string[] = [];

// 替身跟真实 PptxViewer 的接口走（@silurus/ooxml 0.88 dist/types/pptx.d.ts）：
// 构造时收 onSlideChange，翻页后回报 (index, total)。
vi.mock("@silurus/ooxml/pptx", () => ({
  PptxViewer: class {
    slideIndex = 0;
    readonly slideCount = 3;
    private readonly opts: { onSlideChange?: (i: number, t: number, done: boolean) => void };
    constructor(
      el: HTMLCanvasElement,
      opts: { onSlideChange?: (i: number, t: number, done: boolean) => void } = {}
    ) {
      el.dataset.viewer = "pptx";
      this.opts = opts;
    }
    load(buf: ArrayBuffer) {
      loaded.push(`pptx:${buf.byteLength}`);
      return Promise.resolve();
    }
    fitPage() {
      pptxCalls.push("fitPage");
      return Promise.resolve();
    }
    nextSlide() {
      pptxCalls.push("next");
      this.slideIndex = Math.min(this.slideIndex + 1, this.slideCount - 1);
      this.opts.onSlideChange?.(this.slideIndex, this.slideCount, true);
      return Promise.resolve();
    }
    prevSlide() {
      pptxCalls.push("prev");
      this.slideIndex = Math.max(this.slideIndex - 1, 0);
      this.opts.onSlideChange?.(this.slideIndex, this.slideCount, true);
      return Promise.resolve();
    }
    destroy() {}
  },
}));

vi.mock("@silurus/ooxml/docx", () => ({
  DocxViewer: class {
    constructor(el: HTMLCanvasElement) {
      el.dataset.viewer = "docx";
    }
    load(buf: ArrayBuffer) {
      loaded.push(`docx:${buf.byteLength}`);
      return Promise.resolve();
    }
    destroy() {}
  },
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("PresentedOfficeFile", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    loaded.length = 0;
    pptxCalls.length = 0;
    vi.unstubAllGlobals();
  });

  async function show(path: string, bytes: Uint8Array) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).not.toContain("render=browser");
        expect(url).not.toContain("/preview");
        if (url.endsWith("/artifacts")) {
          return new Response(
            JSON.stringify({
              files: [{ artifactId: "art-1", path, sha256: "abc", sizeBytes: bytes.byteLength }],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(bytes, { status: 200 });
      })
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<PresentedOfficeFile projectId="proj-office" path={path} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("xlsx 交给表格查看器，不打开 PDF 框", async () => {
    await show("items.xlsx", new Uint8Array([1, 2, 3, 4]));
    expect(container?.querySelector("iframe")).toBeNull();
    expect(container?.querySelector("[data-viewer='xlsx']")).not.toBeNull();
    expect(loaded).toEqual(["xlsx:4"]);
  });

  it("同名文件再次点名会重新取字节", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/artifacts")) {
          return new Response(
            JSON.stringify({
              files: [{ artifactId: "art-1", path: "items.xlsx", sha256: "abc", sizeBytes: 4 }],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      })
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PresentedOfficeFile projectId="proj-office" path="items.xlsx" refreshKey="a" />
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const downloads = () => calls.filter(url => url.endsWith("/art-1")).length;
    expect(downloads()).toBe(1);
    await act(async () => {
      root!.render(
        <PresentedOfficeFile projectId="proj-office" path="items.xlsx" refreshKey="b" />
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(downloads()).toBe(2);
  });

  it("pptx 交给幻灯片查看器", async () => {
    await show("deck.pptx", new Uint8Array([9, 9]));
    expect(container?.querySelector("canvas")?.dataset.viewer).toBe("pptx");
    expect(loaded).toEqual(["pptx:2"]);
  });

  /**
   * ⚠ 2026-09-25 luna 隔离真机：10 页的稿子只在左上角画了一张 ~300px 封面，
   *   没有翻页。去掉 fitPage 或翻页栏，本条变红。
   */
  it("pptx 铺满面板，能翻到别的页", async () => {
    await show("deck.pptx", new Uint8Array([9, 9]));
    expect(pptxCalls).toContain("fitPage");
    const position = () =>
      container?.querySelector('[data-testid="office-slide-position"]')?.textContent;
    expect(position()).toBe("第 1 / 3 页");
    const prev = container?.querySelector<HTMLButtonElement>('[data-testid="office-slide-prev"]');
    expect(prev?.disabled).toBe(true);
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="office-slide-next"]')
        ?.click();
    });
    expect(pptxCalls).toContain("next");
    expect(position()).toBe("第 2 / 3 页");
  });

  it("反向：表格没有幻灯片翻页栏", async () => {
    await show("items.xlsx", new Uint8Array([1, 2, 3, 4]));
    expect(container?.querySelector('[data-testid="office-slide-pager"]')).toBeNull();
  });
});

describe("slidePagerLabel", () => {
  it("从 1 数，越界夹住，没有页就不出字", () => {
    expect(slidePagerLabel(0, 10)).toBe("第 1 / 10 页");
    expect(slidePagerLabel(9, 10)).toBe("第 10 / 10 页");
    expect(slidePagerLabel(42, 10)).toBe("第 10 / 10 页");
    expect(slidePagerLabel(0, 0)).toBe("");
  });
});
