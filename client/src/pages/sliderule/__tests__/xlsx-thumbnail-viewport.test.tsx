// @vitest-environment jsdom
/**
 * Excel 缩略图按表实际用到的列缩放，不再只露出 A–C 三列。
 *
 * ⚠ 2026-09-30 隔离真机第 157 轮（工作室年度预算）：卡片缩略图按默认列宽只画得下 A–C，第 1 行跨列
 *   居中的大标题落在画面外，卡片上是一条没字的深蓝横条；右栏整张表是好的。
 *
 * 前三条直接喂 xlsxThumbnailViewport 真实形状的 Worksheet（@silurus/ooxml 0.88 的 rows / colWidths /
 * mergeCells）。最后一条走真 OfficeThumbnail，引擎换记名替身，证明 cellScale 真的传进了 renderViewport——
 * 把 OfficeThumbnail 里 `cellScale: fit.scale` 那行删掉，它变红；替身没有 getWorksheet 时照旧画（fail-open）。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OfficeThumbnail, xlsxThumbnailViewport } from "../project-runtime/OfficeThumbnail";

const cell = (col: number) => ({ col, value: { type: "text" } });
const row = (...cols: number[]) => ({ cells: cols.map(cell) });

describe("xlsxThumbnailViewport", () => {
  it("a small table keeps its natural size", () => {
    const fit = xlsxThumbnailViewport({ rows: [row(0, 1, 2)], colWidths: { 0: 10, 1: 10, 2: 10 } }, 440);
    expect(fit).toEqual({ range: { row: 0, col: 0, rows: 16, cols: 3 }, scale: 1 });
  });

  it("a wide table zooms out to its used columns, merged title included, but stays readable", () => {
    const widths = Object.fromEntries([...Array(14).keys()].map(c => [c, 14]));
    const fit = xlsxThumbnailViewport({
      rows: [row(0), row(0, 1, 2, 3, 4, 5)],
      colWidths: widths,
      mergeCells: [{ top: 0, left: 0, right: 13 }],               // 第 157 轮：标题跨整张表
    }, 440)!;
    expect(fit.scale).toBe(0.6);                                   // 不压到读不出
    expect(fit.range.cols).toBe(8);                                // 最多 8 列
    expect(fit.range.rows).toBe(Math.ceil(16 / 0.6));              // 缩了就多画几行，不留白
  });

  it("an empty sheet gives no opinion", () => {
    expect(xlsxThumbnailViewport({ rows: [{ cells: [{ col: 0, value: { type: "empty" } }] }] }, 440)).toBeNull();
  });
});

const calls: Array<{ range: unknown; opts: Record<string, unknown> }> = [];
let withWorksheet = true;
vi.mock("@silurus/ooxml/xlsx", () => ({
  XlsxWorkbook: {
    load: async () => ({
      sheetCount: 1,
      isHidden: () => false,
      ...(withWorksheet ? {
        getWorksheet: async () => ({ rows: [row(0, 1, 2, 3, 4, 5, 6, 7)], colWidths: { 0: 14, 1: 14, 2: 14, 3: 14, 4: 14, 5: 14, 6: 14, 7: 14 } }),
      } : {}),
      renderViewport: async (_c: unknown, _s: number, range: unknown, opts: Record<string, unknown>) => void calls.push({ range, opts }),
      destroy() {},
    }),
  },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  calls.length = 0;
  withWorksheet = true;
  vi.unstubAllGlobals();
});

async function draw() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/artifacts")
    ? new Response(JSON.stringify({ files: [{ artifactId: "art-1", path: "output/预算.xlsx", sha256: "s", sizeBytes: 3 }] }),
      { status: 200, headers: { "content-type": "application/json" } })
    : new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<OfficeThumbnail projectId="p1" path="output/预算.xlsx" />));
  await act(async () => { for (let i = 0; i < 20 && !calls.length; i += 1) await new Promise(r => setTimeout(r, 10)); });
}

describe("OfficeThumbnail xlsx", () => {
  it("passes the fitted scale to the renderer", async () => {
    await draw();
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.cellScale).toBeLessThan(1);
    expect(calls[0].range).toMatchObject({ cols: 8 });
  });

  it("still draws with the old window when the worksheet cannot be read", async () => {
    withWorksheet = false;
    await draw();
    expect(calls).toHaveLength(1);
    expect(calls[0].range).toEqual({ row: 0, col: 0, rows: 16, cols: 8 });
    expect(calls[0].opts.cellScale).toBeUndefined();
  });
});
