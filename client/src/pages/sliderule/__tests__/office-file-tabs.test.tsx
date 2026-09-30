// @vitest-environment jsdom
/**
 * 一轮收回了几份办公文件，右栏能切着看每一份。
 *
 * ⚠ 2026-09-30 隔离真机第 137 轮 sr-20260930023832-PDJ9NXAV09（季度销售复盘：6 页 PPT + 原始数据 Excel）：
 *   右栏只画最后收回的 Excel，PPT 在预览里看不到、也没处点。走真 SandboxPreviewSurface + 真
 *   PresentedOfficeFile，只把 @silurus/ooxml 换成记名替身、HTTP 换成桩。把切换条删掉，第一条变红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import { officeFileTabs } from "../project-computer-view";

const drawn: string[] = [];
const viewer = (kind: string) =>
  class {
    constructor(el: HTMLElement) {
      el.dataset.viewer = kind;
    }
    load() {
      drawn.push(kind);
      return Promise.resolve();
    }
    fitPage() {
      return Promise.resolve();
    }
    get slideIndex() { return 0; }
    get slideCount() { return 1; }
    get topVisiblePage() { return 0; }
    get pageCount() { return 1; }
    destroy() {}
  };
vi.mock("@silurus/ooxml/xlsx", () => ({ XlsxViewer: viewer("xlsx") }));
vi.mock("@silurus/ooxml/pptx", () => ({ PptxViewer: viewer("pptx") }));
vi.mock("@silurus/ooxml/docx", () => ({ DocxScrollViewer: viewer("docx") }));

const FILES = [
  { artifactId: "art-ppt", path: "output/2025_Q2_季度销售复盘.pptx", sha256: "a", sizeBytes: 3 },
  { artifactId: "art-xls", path: "output/2025_Q2_季度销售复盘_原始数据.xlsx", sha256: "b", sizeBytes: 3 },
];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  drawn.length = 0;
  vi.unstubAllGlobals();
});

async function mount(files = FILES) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/artifacts"))
        return new Response(JSON.stringify({ files }), { status: 200, headers: { "content-type": "application/json" } });
      if (/\/artifacts\/art-/.test(url)) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SandboxPreviewSurface projectId="p1" revisionMode="current" deliverableKind="office-file" />);
  });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
}

const tabs = () => [...(container?.querySelectorAll<HTMLButtonElement>('[data-testid="office-file-tab"]') ?? [])];
const shownKind = () => container?.querySelector<HTMLElement>('[data-testid="office-ooxml-view"]')?.dataset.officeKind;

describe("办公文件切换条", () => {
  it("两份文件都能在右栏看到：默认宿主那份，点另一份就换过去", async () => {
    await mount();
    expect(tabs().map(t => t.textContent)).toEqual(["2025_Q2_季度销售复盘.pptx", "2025_Q2_季度销售复盘_原始数据.xlsx"]);
    expect(shownKind()).toBe("xlsx");                             // 宿主默认：最后收回的那份
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs()[0].click());
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
    expect(shownKind()).toBe("pptx");
    expect(drawn).toContain("pptx");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("反向：只有一份文件时不出切换条", async () => {
    await mount([FILES[0]]);
    expect(tabs()).toHaveLength(0);
    expect(shownKind()).toBe("pptx");
  });
});

describe("officeFileTabs", () => {
  it("人挑的不在列表里就不算数，跟宿主走", () => {
    const paths = FILES.map(f => f.path);
    expect(officeFileTabs(paths, paths[1], "gone.pptx").current).toBe(paths[1]);
    expect(officeFileTabs(paths, paths[1], paths[0]).current).toBe(paths[0]);
    expect(officeFileTabs(["a.html", paths[0]], paths[0], null).tabs).toEqual([]);   // 非办公不算一份
  });
});
