// @vitest-environment jsdom
/**
 * 办公会话的结果卡画出文件第一页的缩略图。
 *
 * ⚠ 2026-09-30 用户点名「跑完之后会话中预览卡片的图片显示情况」：结果卡只接网页工程的验收截图，
 *   隔离真机第 137 / 140 / 143 轮的办公卡全是一行字，没有图。
 *
 * 走真 TurnResultCard + 真 OfficeThumbnail，只把 @silurus/ooxml 的无头引擎换成记名替身（接口照
 * 0.88 dist/types：PptxPresentation.load/renderSlide、DocxDocument.load/renderPage、
 * XlsxWorkbook.load/renderViewport），HTTP 换桩。把 TurnResultCard 里办公缩略图那支删掉，第一条变红；
 * SlideRule.tsx 不接 officeThumbnail，最后一条变红。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TurnResultCard } from "../TurnResultCard";
import type { TurnStep, UiTurn } from "../types";

const rendered: string[] = [];
let fail = false;
vi.mock("@silurus/ooxml/pptx", () => ({
  PptxPresentation: {
    load: async () => ({
      renderSlide: async (_c: unknown, i: number, o: { width: number }) => {
        if (fail) throw new Error("boom");
        rendered.push(`pptx:${i}:${o.width}`);
      },
      destroy() {},
    }),
  },
}));
vi.mock("@silurus/ooxml/docx", () => ({
  DocxDocument: { load: async () => ({ renderPage: async (_c: unknown, i: number) => void rendered.push(`docx:${i}`), destroy() {} }) },
}));
vi.mock("@silurus/ooxml/xlsx", () => ({
  XlsxWorkbook: {
    load: async () => ({
      sheetCount: 2,
      isHidden: (i: number) => i === 0,
      renderViewport: async (_c: unknown, sheet: number) => void rendered.push(`xlsx:${sheet}`),
      destroy() {},
    }),
  },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const chip = (tool: string): Extract<TurnStep, { kind: "chip" }> => ({
  id: `chip-${tool}`, kind: "chip", roleId: "control", label: tool, realLlm: true, progressType: "completed",
  capabilityId: tool as Extract<TurnStep, { kind: "chip" }>["capabilityId"],
});
const turn: UiTurn = {
  id: "t1", user: "做一份 6 页 PPT", status: "complete", steps: [chip("shell_exec")],
  routeFacts: {} as UiTurn["routeFacts"], routeExpanded: false, routeLitCount: 0,
  assistant: "做好了。", assistantSource: "llm", actions: [],
  main: { artifactId: "a1", kind: "page", realLlm: true },
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  rendered.length = 0;
  fail = false;
  vi.unstubAllGlobals();
});

async function card(path: string | null) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/artifacts"))
      return new Response(JSON.stringify({ files: path ? [{ artifactId: "art-1", path, sha256: "s", sizeBytes: 3 }] : [] }),
        { status: 200, headers: { "content-type": "application/json" } });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <TurnResultCard turn={turn} runtimeKind="project" projectRevision="prv-1" deliverableKind="office-file"
        hasOfficeArtifact officeThumbnail={path ? { projectId: "p1", path, key: "s" } : null} />
    );
  });
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
  return container.querySelector<HTMLElement>('[data-testid="turn-result-office-thumb"]');
}

describe("办公结果卡缩略图", () => {
  it("PPT：卡上画第一张幻灯片", async () => {
    const thumb = await card("output/复盘.pptx");
    expect(thumb?.dataset.state).toBe("ok");
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatch(/^pptx:0:\d+$/);
  });

  it("Word 画第一页；Excel 画第一张没隐藏的表", async () => {
    await card("output/方案.docx");
    expect(rendered).toEqual(["docx:0"]);
    await act(async () => root!.unmount()); root = undefined; container?.remove(); rendered.length = 0;
    await card("output/数据.xlsx");
    expect(rendered).toEqual(["xlsx:1"]);
  });

  it("反向：画不出来就整块不画，不挂占位图", async () => {
    fail = true;
    const thumb = await card("output/复盘.pptx");
    expect(thumb).toBeNull();
  });

  it("反向：没有文件就没有缩略图", async () => {
    expect(await card(null)).toBeNull();
  });

  it("SlideRule 把最新收回的那份接到交付那一轮的卡上", () => {
    const src = readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/officeThumbnail=\{\s*turn\.id === ctx\.verdictTurnId \? ctx\.officeThumbnail : null\s*\}/);
    expect(src).toMatch(/useLatestOfficeArtifact\(/);
  });
});
