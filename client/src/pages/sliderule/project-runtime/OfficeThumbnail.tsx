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
        await book.renderViewport(el, sheet, { row: 0, col: 0, rows: 16, cols: 8 }, {
          width,
          height: Math.round(width * 0.5),
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
