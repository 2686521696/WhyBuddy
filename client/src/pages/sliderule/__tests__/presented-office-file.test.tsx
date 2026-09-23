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
import { PresentedOfficeFile } from "../project-runtime/PresentedOfficeFile";

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

vi.mock("@silurus/ooxml/pptx", () => ({
  PptxViewer: class {
    constructor(el: HTMLCanvasElement) {
      el.dataset.viewer = "pptx";
    }
    load(buf: ArrayBuffer) {
      loaded.push(`pptx:${buf.byteLength}`);
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
});
