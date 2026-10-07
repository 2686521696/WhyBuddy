import React, { useEffect, useRef, useState } from "react";
import { decodeTextDeliverable, deliverableKind, isTextDeliverableKind } from "./deliverable-files";
import { TextDeliverableView } from "./TextDeliverableView";
import { listOfficeArtifacts, officeArtifactDownloadUrl, officePreviewUrl } from "./office-artifacts-client";
import { useInViewOnce } from "./useInViewOnce";

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
 * 卡片墙上的 Word 封面：只取第一页上真有字的那块，铺满卡片。返回源图上要裁的矩形；一个字都没有返回 null。
 *
 * ⚠ 2026-10-03 用户截图「我的应用 → 文件」：采购审批方案 DOCX 那张卡一片白，同一份文件结果卡上封面好好的。
 *   隔离真机量了 20 张卡的 canvas：Word 全都画上了字（dark 1369～12022 像素），可整页 242×313 被缩进 105×136，
 *   标题只剩两三像素高的浅灰——卡片看着就是白的。10-01 那版「按高缩进整页」只是把「只露页边距」换成「整页太小」。
 *   PPT / Excel 本来就是满幅，不走这里。
 *
 * 宽度至少取页宽的 45%：封面只有一行短标题时别放大到糊。窗口按卡片比例往下取，到底了就往上挪。
 */
export function contentCrop(
  img: { width: number; height: number; data: ArrayLike<number> },
  view: { w: number; h: number },
  pad = 0.04
): { sx: number; sy: number; sw: number; sh: number } | null {
  const { width, height, data } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // 透明像素也算白；浅于 240 的任一通道才算墨
      if (data[i + 3] < 16 || (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const margin = Math.round(width * pad);
  const sw = Math.min(width, Math.max(x1 - x0 + 1 + margin * 2, Math.round(width * 0.45)));
  const sh = Math.min(height, Math.round((sw * view.h) / view.w));
  const center = (x0 + x1) / 2;
  const sx = Math.round(Math.min(Math.max(center - sw / 2, 0), width - sw));
  const sy = Math.round(Math.min(Math.max(y0 - margin, 0), height - sh));
  return { sx, sy, sw, sh };
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
/**
 * ⚠ 2026-10-03 第二版：队列按「谁离屏幕顶上最近」挑下一张，不按进队顺序。
 *   「我的应用」用 masonic 瀑布流，卡片绝对定位，DOM 顺序跟屏幕上的位置无关——只做「进视口才开画」以后，
 *   最上面那排 Word 仍排在第四、五排后面（10 秒 vs 18～20 秒）。rank 在挑的那一刻现量，人滚动了也跟得上；
 *   一样近的按进队顺序。
 */
type PendingRender = {
  job: () => Promise<unknown>;
  signal: AbortSignal;
  timeoutMs: number;
  rank: () => number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};
const pendingRenders: PendingRender[] = [];
let renderRunning = false;

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

function safeRank(item: PendingRender): number {
  try {
    const value = item.rank();
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

async function pumpRenders() {
  if (renderRunning) return;
  renderRunning = true;
  try {
    while (pendingRenders.length) {
      let best = 0;
      let bestRank = safeRank(pendingRenders[0]);
      for (let i = 1; i < pendingRenders.length; i += 1) {
        const rank = safeRank(pendingRenders[i]);
        if (rank < bestRank) {
          best = i;
          bestRank = rank;
        }
      }
      const [next] = pendingRenders.splice(best, 1);
      try {
        next.resolve(await withRenderTimeout(next.job, next.signal, next.timeoutMs));
      } catch (error) {
        next.reject(error);
      }
    }
  } finally {
    renderRunning = false;
  }
}

export function enqueueOfficeRender<T>(job: () => Promise<T>, signal: AbortSignal,
  timeoutMs: number = OFFICE_RENDER_TIMEOUT_MS, rank: () => number = () => 0): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingRenders.push({ job, signal, timeoutMs, rank, resolve: resolve as (value: unknown) => void, reject });
    void pumpRenders();
  });
}

/** 卡片墙 Word：离屏画大一点，裁出第一页有字的那块铺满 el。任何一步炸了由调用方退回整页。 */
async function drawContentCrop(
  doc: { renderPage: (target: HTMLCanvasElement, page: number, opts: { width: number }) => Promise<void> },
  el: HTMLCanvasElement
) {
  const box = el.parentElement;
  const view = { w: Math.max(1, box?.clientWidth || 240), h: Math.max(1, box?.clientHeight || 135) };
  const page = document.createElement("canvas");
  await doc.renderPage(page, 0, { width: Math.min(900, Math.max(480, view.w * 3)) });
  if (!page.width || !page.height) throw new Error("empty_page_canvas");
  // 像素从自己的 2D 画布上读：引擎有时给它的 canvas 拿的是 bitmaprenderer 上下文，那上面 getContext("2d") 是 null
  const copy = document.createElement("canvas");
  copy.width = page.width;
  copy.height = page.height;
  const copyCtx = copy.getContext("2d", { willReadFrequently: true });
  if (!copyCtx) throw new Error("no_2d_context");
  copyCtx.fillStyle = "#fff";
  copyCtx.fillRect(0, 0, copy.width, copy.height);
  copyCtx.drawImage(page, 0, 0);
  const crop = contentCrop(copyCtx.getImageData(0, 0, copy.width, copy.height), view);
  const area = crop ?? { sx: 0, sy: 0, sw: copy.width, sh: Math.min(copy.height, Math.round((copy.width * view.h) / view.w)) };
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  el.width = Math.round(view.w * dpr);
  el.height = Math.round(view.h * dpr);
  const out = el.getContext("2d");
  if (!out) throw new Error("no_card_context");
  out.fillStyle = "#fff";
  out.fillRect(0, 0, el.width, el.height);
  out.drawImage(copy, area.sx, area.sy, area.sw, area.sh, 0, 0, el.width, el.height);
}

export function OfficeThumbnail({
  projectId,
  path,
  refreshKey = "",
  onDrawn,
  fit = "page",
  artifactId,
}: {
  projectId: string;
  path: string;
  refreshKey?: string;
  onDrawn?: (ok: boolean) => void;
  /** "content"：Word 只取第一页有字的那块铺满（卡片墙用，见 contentCrop）。结果卡照旧画整页。 */
  fit?: "page" | "content";
  /** 已知这份文件的 artifactId（画廊从 GET /sessions 拿到）就直接下载，不再列清单找。 */
  artifactId?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  // 文本交付物（.md / .txt / .csv）不上 canvas：取到字就排版开头一段（deliverable-files 头注）。
  const textKind = deliverableKind(path);
  const [text, setText] = useState<string | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);
  const drawnRef = useRef(onDrawn);
  drawnRef.current = onDrawn;
  // ⚠ 2026-10-03 隔离真机「我的应用 → 文件」：113 份文件 84 张卡一打开全部开画，Word 按挂载顺序排队，
  //   屏幕最上面那排 Word 第 55～57 秒才画出来（PPT / Excel 17 秒）——那一分钟里就是用户截图那张白卡。
  //   进了视口（含下方 300px 预取）才开画（useInViewOnce）。
  const [frame, inView] = useInViewOnce<HTMLDivElement>();

  useEffect(() => {
    const el = canvas.current;
    // 文本交付物不画 canvas（下面只渲染一个 div），没有 canvas 也得取字。
    if ((!el && !isTextDeliverableKind(textKind)) || !inView) return;
    const ac = new AbortController();
    let disposer: { destroy?: () => void } | null = null;
    setState("loading");
    setCropError(null);
    const name = path.toLowerCase();
    // ⚠ 2026-10-03 连用户测试库量：下载原来写在 draw 里，Word 排队排的是「列清单 + 下载 + 画」整套——
    //   网络等待也跟着一份一份排，6 份 Word 23～50 秒才依次出来。字节先并行取，队列里只剩画。
    //   画廊给了 artifactId 就直接下载，不再 GET /artifacts（16 张一起发，服务端排成 11～16 秒）。
    const fetchBytes = async () => {
      let id = artifactId;
      if (!id) {
        const items = await listOfficeArtifacts(projectId, ac.signal);
        const match = items.find(item => item.path === path);
        if (!match) throw new Error("missing");
        id = match.artifactId;
      }
      const res = await fetch(officePreviewUrl(officeArtifactDownloadUrl(projectId, id)), {
        credentials: "include",
        cache: "no-store",
        signal: ac.signal,
      });
      if (!res.ok) throw new Error("missing");
      return res.arrayBuffer();
    };
    let bytes: ArrayBuffer;
    setText(null);
    const draw = async () => {
      if (ac.signal.aborted) return;
      if (isTextDeliverableKind(textKind)) {
        setText(decodeTextDeliverable(bytes));
        setState("ok");
        drawnRef.current?.(true);
        return;
      }
      if (!el) throw new Error("no-canvas");
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
        if (fit === "content") {
          // ⚠ 2026-10-03 用户截图（上线后）：采购审批 DOCX 的卡变成「文件预览画不出来」，同一份文件结果卡上画得好好的，
          //   隔离真机上 6 份 Word 也都好。裁剪这一步是增强（CLAUDE.md §7 fail-open）：哪一环炸了都退回画整页，
          //   原因记在 data-error 和控制台，别再把一份画得出来的文件说成画不出来。
          try {
            await drawContentCrop(doc, el);
          } catch (error) {
            if (ac.signal.aborted) return;
            console.warn("[office-thumb] 裁剪失败，改画整页", path, error);
            setCropError(String((error as Error)?.message || error).slice(0, 200));
            await doc.renderPage(el, 0, { width });
          }
        } else {
          await doc.renderPage(el, 0, { width });
        }
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
    // 离屏幕顶上越近越先画（见 PendingRender 头注）；量不到位置的排最后
    const rank = () => {
      const top = frame.current?.getBoundingClientRect().top;
      return top === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(top);
    };
    void fetchBytes()
      .then(got => {
        bytes = got;
        if (ac.signal.aborted) throw new DOMException("aborted", "AbortError");
        return name.endsWith(".docx") ? enqueueOfficeRender(draw, ac.signal, OFFICE_RENDER_TIMEOUT_MS, rank) : draw();
      })
      .catch(error => {
      if (!ac.signal.aborted) {
        console.warn("[office-thumb] 画不出来", path, error);
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
  }, [projectId, path, refreshKey, fit, inView, artifactId]);

  if (state === "failed") return null;
  if (isTextDeliverableKind(textKind)) {
    return (
      <div
        ref={frame}
        className={fit === "content" ? "h-full w-full overflow-hidden bg-white" : "max-h-64 w-full overflow-hidden bg-white"}
        data-testid="turn-result-office-thumb"
        data-state={state}
        data-office-path={path}
        data-fit={fit}
      >
        {text !== null ? <TextDeliverableView kind={textKind} text={text} compact /> : null}
      </div>
    );
  }
  return (
    <div
      ref={frame}
      className={fit === "content" ? "h-full w-full overflow-hidden bg-white" : "max-h-64 w-full overflow-hidden bg-[#fafafa]"}
      data-testid="turn-result-office-thumb"
      data-state={state}
      data-office-path={path}
      data-fit={fit}
      data-error={cropError ?? undefined}
    >
      {/* 裁剪退回整页时：整页按宽铺满、从页顶起（object-cover 不拉伸） */}
      <canvas ref={canvas} className={fit === "content"
        ? `block h-full w-full ${cropError ? "object-cover object-top" : ""}`
        : "block h-auto w-full"} aria-hidden />
    </div>
  );
}
