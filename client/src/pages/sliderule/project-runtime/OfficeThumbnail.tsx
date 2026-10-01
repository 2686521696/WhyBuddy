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

/**
 * Word 一次只画一份，排队的每一张有超时（防一份卡死的堵住后面整队）；PPT / Excel 照旧并行直接画。
 *
 * ⚠ 2026-10-01 隔离真机「我的应用」文件栏：同屏 6 份 Word 一起画，4 份（智能门锁说明书、入职管理系统方案……）
 *   停在 loading 30 秒以上，canvas 还是默认的 300×150；同一份单独打开会话画只要一下（448 宽）。PPT / Excel 并发没事，
 *   是 @silurus/ooxml 的 docx 引擎并发 load + renderPage 互相卡住。
 *   ⚠ 第一版把三种都排进一条队：实测每张 0.1～2.5 秒、全都画成了，可卡片墙按挂载顺序排队，最上面那排排在一长串
 *   PPT / Excel 后面，45 秒时还是空白——比并行还难看。只排 Word。
 *   排队的那一张被卸载（滚出视口、换了标签）就不画了，不占队。
 */
let renderQueue: Promise<unknown> = Promise.resolve();

/** 排队的 Word 一张画超过这个时长就放弃（按画不出来处理），别让一份卡死的把后面整队堵住。 */
export const OFFICE_RENDER_TIMEOUT_MS = 30_000;

function withRenderTimeout<T>(job: () => Promise<T>, signal: AbortSignal,
  timeoutMs: number = OFFICE_RENDER_TIMEOUT_MS): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("office_render_timeout")), timeoutMs);
  });
  return Promise.race([job(), limit]).finally(() => clearTimeout(timer));
}

export function enqueueOfficeRender<T>(job: () => Promise<T>, signal: AbortSignal,
  timeoutMs: number = OFFICE_RENDER_TIMEOUT_MS): Promise<T> {
  const run = renderQueue.then(() => {
    return withRenderTimeout(job, signal, timeoutMs);
  });
  renderQueue = run.catch(() => undefined);
  return run;
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
    const draw = async () => {
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
    };
    // Word 排队（见 enqueueOfficeRender 头注）；PPT / Excel 照旧直接画，不加超时——它们从没卡过，
    // 加了超时反而在同屏 30 张一起画时把慢的那几张误判成「画不出来」（2026-10-01 第二版实测）。
    void (name.endsWith(".docx") ? enqueueOfficeRender(draw, ac.signal) : draw()).catch(() => {
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
