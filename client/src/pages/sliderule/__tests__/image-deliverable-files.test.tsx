// @vitest-environment jsdom
/**
 * 图片交付物在右栏和结果卡里画成图，不是「这份文件读不到」。
 *
 * ⚠ 2026-10-07 真机 r85 sr-20261007155747-HMKAPNJ7WK（@data-visualization-discipline 四店趋势图）：主交付是两张 PNG，
 *   产物库原来不收；后端收了之后，前端不认 .png 就会在这两处被静默滤掉（deliverable-files 头注）。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresentedOfficeFile } from "../project-runtime/PresentedOfficeFile";
import { OfficeThumbnail } from "../project-runtime/OfficeThumbnail";

const PATH = "output/门店上半年销售额趋势.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
let root: Root | null = null;
let container: HTMLDivElement | null = null;
const blobs: Blob[] = [];

beforeEach(() => {
  blobs.length = 0;
  vi.stubGlobal("URL", Object.assign(Object.create(URL), URL, {
    createObjectURL: (blob: Blob) => { blobs.push(blob); return `blob:test/${blobs.length}`; },
    revokeObjectURL: () => {},
  }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
    observe() { this.cb([{ isIntersecting: true }]); }
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input).split("?")[0];
    if (url.endsWith("/artifacts"))
      return new Response(JSON.stringify({ files: [{ artifactId: "art-png", path: PATH, sha256: "s", sizeBytes: PNG.length }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/art-png")) return new Response(PNG, { status: 200 });
    return new Response("{}", { status: 404 });
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

async function settle() { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); }

describe("图片交付物", () => {
  it("右栏：画成一张图，字节就是取回来的那份，类型是 PNG", async () => {
    await act(async () => { root!.render(<PresentedOfficeFile projectId="p1" path={PATH} refreshKey="a" />); });
    await settle();
    const img = container!.querySelector('[data-testid="image-deliverable"] img');
    expect(img?.getAttribute("src")).toBe("blob:test/1");
    expect(img?.getAttribute("alt")).toBe("门店上半年销售额趋势.png");
    expect(blobs[0].type).toBe("image/png");
    expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(PNG);
    expect(container!.textContent).not.toContain("这份文件读不到");          // 反向：不再被当成认不得的文件
  });

  it("结果卡缩略图：同一张图，不上 canvas", async () => {
    await act(async () => { root!.render(<OfficeThumbnail projectId="p1" path={PATH} refreshKey="a" />); });
    await settle();
    const thumb = container!.querySelector('[data-testid="turn-result-office-thumb"]');
    expect(thumb?.querySelector("img")?.getAttribute("src")).toMatch(/^blob:test\//);
    expect(thumb?.querySelector("canvas")).toBeNull();
  });
});
