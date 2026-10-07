// @vitest-environment jsdom
/**
 * 办公文件被追问改写后，右栏能切到旧版本看、能把旧版本设回当前。
 *
 * ⚠ 2026-09-30 隔离真机第 140 轮（租房指南 Word，两轮追问各改写一次）：同一路径每次收回都覆盖，
 *   前两版在界面上找不回来。走真 SandboxPreviewSurface + 真 PresentedOfficeFile，@silurus/ooxml 换替身，
 *   HTTP 换桩（形状照 Python ProjectOfficeArtifactStore.versions）。把版本下拉删掉，第一条变红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import { officeVersionLabel } from "../project-computer-view";

vi.mock("@silurus/ooxml/docx", () => ({
  DocxScrollViewer: class {
    topVisiblePage = 0;
    pageCount = 1;
    constructor(el: HTMLElement) { el.dataset.viewer = "docx"; }
    load() { return Promise.resolve(); }
    scrollToPage() {}
    destroy() {}
  },
}));

const V2 = "b".repeat(64);
const V1 = "a".repeat(64);
const FILE = { artifactId: "art-doc", path: "output/第一次租房注意事项指南.docx", sha256: V2, sizeBytes: 3 };
const calls: string[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  calls.length = 0;
  vi.unstubAllGlobals();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
async function settle() { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); }

async function mount(versions: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/artifacts")) return json({ files: [FILE] });
    if (url.endsWith("/versions")) return json({ versions });
    if (url.endsWith("/restore")) return json({ ...FILE, sha256: V1 });
    if (/\/artifacts\/art-doc/.test(url)) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    return json({});
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SandboxPreviewSurface projectId="p1" revisionMode="current" deliverableKind="office-file" />);
  });
  await settle();
}

const TWO = [
  { sha256: V2, sizeBytes: 3, capturedAt: "2026-09-30T03:50:25+00:00", number: 2, current: true },
  { sha256: V1, sizeBytes: 3, capturedAt: "2026-09-30T03:42:27+00:00", number: 1, current: false },
];
const select = () => container?.querySelector<HTMLSelectElement>('[data-testid="office-version-select"]');

describe("办公文件版本切换", () => {
  it("改写过的文件出版本下拉；切到第 1 版就画第 1 版的字节，并说清这是旧版", async () => {
    await mount(TWO);
    expect(select()).not.toBeNull();
    expect([...select()!.options].map(o => o.textContent)).toEqual([
      "第 2 版（当前）",
      officeVersionLabel(TWO[1]),
    ]);
    await act(async () => {
      select()!.value = V1;
      select()!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(calls).toContain(`GET /api/sliderule/projects/p1/artifacts/art-doc/versions/${V1}?view=preview`);   // 预览取的是补过存值的字节
    expect(container?.querySelector('[data-testid="office-old-version-banner"]')?.textContent).toContain("第 1 版（旧版本）");
  });

  it("旧版本能设回当前：发 restore，横幅收起", async () => {
    await mount(TWO);
    await act(async () => {
      select()!.value = V1;
      select()!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await act(async () => container?.querySelector<HTMLButtonElement>('[data-testid="office-version-restore"]')?.click());
    await settle();
    expect(calls).toContain(`POST /api/sliderule/projects/p1/artifacts/art-doc/versions/${V1}/restore`);
    expect(container?.querySelector('[data-testid="office-old-version-banner"]')).toBeNull();
  });

  it("反向：只有一个版本时不出下拉，也不去取历史字节", async () => {
    await mount([TWO[0]]);
    expect(select()).toBeNull();
    expect(calls.some(c => /\/versions\/[0-9a-f]{64}/.test(c))).toBe(false);
  });
});
