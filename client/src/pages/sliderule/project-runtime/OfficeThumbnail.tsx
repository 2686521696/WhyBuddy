import React, { useEffect, useRef, useState } from "react";
import { listOfficeArtifacts, officeArtifactDownloadUrl } from "./office-artifacts-client";

/**
 * 结果卡上那张办公文件的「第一页」缩略图：PPT 第一张、Word 第一页、Excel 第一张表左上角。
 *
 * ⚠ 2026-09-30 用户点名「跑完之后会话里预览卡片的图片显示情况」。结果卡的缩略图只接验收截图
 *   （网页工程），办公会话从来没有图——隔离真机第 137 / 140 / 143 轮三张卡全是一行字。
 *   文件字节本来就在产物库里，右栏用 @silurus/ooxml 画整份；这里用同一个库的无头引擎
 *   只画第一页到一块小 canvas 上，不经过服务器截图、不进沙盒。
 *   画不出来（读不到、库炸了）就什么都不画——跟网页缩略图同一条规矩，不挂占位图。
 */
type ThumbnailSheet = {
  rows: Array<{ cells: Array<{ col: number; value?: { type?: string } }> }>;
  colWidths?: Record<number, number>;
  mergeCells?: Array<{ top: number; left: number; right: number }>;
};

/**
 * Excel 缩略图画到哪一列、缩多少。
 *
 * ⚠ 2026-09-30 隔离真机第 157 轮（工作室年度预算）：缩略图按库的默认列宽只画得下 A–C 三列，
 *   第 1 行是跨 A–D 合并、居中的大标题——字落在第 D 列那一侧，卡片上是一条没字的深蓝横条。
 *   右栏整张表是好的，只有卡片上缺。改成量出前 20 行实际用到的最右一列（含合并区域），
 *   按列宽算出要多宽，再用 cellScale 缩到卡片宽度里。量不出来返回 null，照旧画 8 列（fail-open）。
 *   ⚠ 第一版下限 0.45、最多 12 列：整张表都进来了，字小到卡片上读不出。现在 0.6 / 8 列——
 *   第 157 轮从「3 列 4 个月」变成「6 列 12 个月」，还读得清；跨 14 列居中的大标题仍只露个头，
 *   那是缩略图宽度的硬上限，别为它再往下压比例。
 *   列宽按字符数存，库里一个字符约 7px，行号栏 50px（@silurus/ooxml 0.88 渲染器的常数）。
 */
export function xlsxThumbnailViewport(ws: ThumbnailSheet, width: number) {
  const rows = ws.rows.slice(0, 20);
  const cols = rows.flatMap(row => row.cells.filter(cell => cell.value?.type !== "empty").map(cell => cell.col));
  if (!cols.length) return null;
  const base = Math.min(...cols) === 0 ? 0 : 1;
  const merged = (ws.mergeCells ?? []).filter(m => m.top - base < 20).map(m => m.right);
  const last = Math.min(Math.max(...cols, ...merged), base + 7);
  let needed = 50;
  for (let col = base; col <= last; col += 1) needed += (ws.colWidths?.[col] ?? 8.43) * 7 + 5;
  const scale = Math.max(0.6, Math.min(1, width / needed));
  return {
    range: { row: 0, col: 0, rows: Math.ceil(16 / scale), cols: last - base + 1 },
    scale,
  };
}

export function OfficeThumbnail({
  projectId,
  path,
  refreshKey = "",
  onDrawn,
}: {
  projectId: string;
  path: string;
  refreshKey?: string;
  onDrawn?: (ok: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const drawnRef = useRef(onDrawn);
  drawnRef.current = onDrawn;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ac = new AbortController();
    let disposer: { destroy?: () => void } | null = null;
    setState("loading");
    const name = path.toLowerCase();
    void (async () => {
      const items = await listOfficeArtifacts(projectId, ac.signal);
      const match = items.find(item => item.path === path);
      if (!match) throw new Error("missing");
      const res = await fetch(officeArtifactDownloadUrl(projectId, match.artifactId), {
        credentials: "include",
        cache: "no-store",
        signal: ac.signal,
      });
      if (!res.ok) throw new Error("missing");
      const bytes = await res.arrayBuffer();
      if (ac.signal.aborted) return;
      const width = Math.max(240, Math.floor(el.parentElement?.clientWidth || 440));
      if (name.endsWith(".pptx")) {
        const { PptxPresentation } = await import("@silurus/ooxml/pptx");
        const deck = await PptxPresentation.load(bytes);
        disposer = deck as { destroy?: () => void };
        await deck.renderSlide(el, 0, { width });
      } else if (name.endsWith(".docx")) {
        const { DocxDocument } = await import("@silurus/ooxml/docx");
        const doc = await DocxDocument.load(bytes);
        disposer = doc as { destroy?: () => void };
        await doc.renderPage(el, 0, { width });
      } else if (name.endsWith(".xlsx")) {
        const { XlsxWorkbook } = await import("@silurus/ooxml/xlsx");
        const book = await XlsxWorkbook.load(bytes);
        disposer = book as { destroy?: () => void };
        const sheet = Math.max(0, [...Array(book.sheetCount).keys()].find(i => !book.isHidden(i)) ?? 0);
        // Promise.resolve().then：getWorksheet 同步抛也要落到 catch 里，量不出来照旧画（fail-open）
        const fit = await Promise.resolve()
          .then(() => book.getWorksheet(sheet))
          .then(ws => xlsxThumbnailViewport(ws, width))
          .catch(() => null);
        await book.renderViewport(el, sheet, fit?.range ?? { row: 0, col: 0, rows: 16, cols: 8 }, {
          width,
          height: Math.round(width * 0.5),
          ...(fit ? { cellScale: fit.scale } : {}),
        });
      } else {
        throw new Error("not-office");
      }
      if (!ac.signal.aborted) {
        setState("ok");
        drawnRef.current?.(true);
      }
    })().catch(() => {
      if (!ac.signal.aborted) {
        setState("failed");
        drawnRef.current?.(false);
      }
    });
    return () => {
      ac.abort();
      try {
        disposer?.destroy?.();
      } catch {
        // 引擎自己的清理炸了不影响卡片
      }
    };
  }, [projectId, path, refreshKey]);

  if (state === "failed") return null;
  return (
    <div
      className="max-h-64 w-full overflow-hidden bg-[#fafafa]"
      data-testid="turn-result-office-thumb"
      data-state={state}
      data-office-path={path}
    >
      <canvas ref={canvas} className="block h-auto w-full" aria-hidden />
    </div>
  );
}
