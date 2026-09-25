import React, { useEffect, useRef, useState } from "react";
import {
  listOfficeArtifacts,
  officeArtifactDownloadUrl,
} from "./office-artifacts-client";

type OfficeKind = "xlsx" | "pptx" | "docx";

function officeKind(path: string): OfficeKind | null {
  const name = path.toLowerCase();
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".docx")) return "docx";
  return null;
}

/**
 * 浏览器里用 @silurus/ooxml 画宿主正在看的那份文件。
 *
 * ⚠ 2026-09-23 上一版在 E2B 里转 PDF，再塞进 sandbox iframe。Chrome 不在
 *   沙箱框里开 PDF 查看器，右侧是「此页面已被 Chrome 屏蔽」。这份库在本页
 *   Canvas 上画 xlsx/pptx/docx，不经过 PDF，也不进 Linux 沙盒。
 */
export function PresentedOfficeFile({
  projectId,
  path,
  refreshKey = "",
}: {
  projectId: string;
  path: string;
  /** 同名文件被改写、或人按了刷新。变了就重新取字节。 */
  refreshKey?: string;
}) {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const kind = officeKind(path);

  useEffect(() => {
    const ac = new AbortController();
    setBytes(null);
    setMissing(false);
    setFailed(false);
    if (!kind) {
      setMissing(true);
      return () => ac.abort();
    }
    void listOfficeArtifacts(projectId, ac.signal)
      .then(async items => {
        if (ac.signal.aborted) return;
        const match = items.find(item => item.path === path);
        if (!match) {
          setMissing(true);
          return;
        }
        const response = await fetch(
          officeArtifactDownloadUrl(projectId, match.artifactId),
          { credentials: "include", cache: "no-store", signal: ac.signal }
        );
        if (!response.ok) throw new Error("missing");
        const body = await response.arrayBuffer();
        if (!ac.signal.aborted) setBytes(body);
      })
      .catch(() => {
        if (!ac.signal.aborted) setMissing(true);
      });
    return () => ac.abort();
  }, [projectId, path, kind, refreshKey]);

  if (!kind || missing) {
    return <p className="m-0 px-3 py-6 text-sm">这份文件读不到。</p>;
  }
  if (failed) {
    return <p className="m-0 px-3 py-6 text-sm">这份文件画不出来。</p>;
  }
  if (!bytes) {
    return <p className="m-0 px-3 py-6 text-sm opacity-70">正在打开这份文件…</p>;
  }
  return (
    <OfficeOoxmlView
      bytes={bytes}
      kind={kind}
      onError={() => setFailed(true)}
    />
  );
}

/** 幻灯片翻页栏上的字。纯函数，判据直接跑它。 */
export function slidePagerLabel(index: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "";
  const current = Math.min(Math.max(Math.trunc(index) + 1, 1), total);
  return `第 ${current} / ${total} 页`;
}

type SlideNav = {
  prev: () => void;
  next: () => void;
};

function OfficeOoxmlView({
  bytes,
  kind,
  onError,
}: {
  bytes: ArrayBuffer;
  kind: OfficeKind;
  onError: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // ⚠ 2026-09-25 luna 隔离真机 sr-20260925003931-HP3KEB33FR：10 页的复盘稿，
  //   右栏只在左上角画了一张 ~300px 的封面，下面整片空白，另外 9 页看不到、
  //   也没有翻页。PptxViewer 默认按库里的缺省宽度画当前页，不会自己铺满容器，
  //   也不带翻页 UI——这两件事都得宿主做：按面板宽度 fitPage，尺寸变了再 fit，
  //   底下给「上一页 / 第 i / N 页 / 下一页」。
  const [slide, setSlide] = useState<{ index: number; total: number }>({
    index: 0,
    total: 0,
  });
  const nav = useRef<SlideNav | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let viewer: { destroy: () => void } | null = null;
    let resize: ResizeObserver | null = null;
    setSlide({ index: 0, total: 0 });
    nav.current = null;
    void (async () => {
      try {
        if (kind === "xlsx") {
          const { XlsxViewer } = await import("@silurus/ooxml/xlsx");
          if (dead) return;
          const view = new XlsxViewer(el);
          viewer = view;
          await view.load(bytes);
        } else if (kind === "pptx") {
          const { PptxViewer } = await import("@silurus/ooxml/pptx");
          if (dead) return;
          const canvas = document.createElement("canvas");
          el.replaceChildren(canvas);
          const view = new PptxViewer(canvas, {
            width: Math.max(320, Math.floor(el.clientWidth || 0)),
            onSlideChange: (index, total) => {
              if (!dead) setSlide({ index, total });
            },
          });
          viewer = view;
          await view.load(bytes);
          if (dead) return;
          await view.fitPage();
          setSlide({ index: view.slideIndex, total: view.slideCount });
          nav.current = {
            prev: () => void view.prevSlide(),
            next: () => void view.nextSlide(),
          };
          if (typeof ResizeObserver !== "undefined") {
            resize = new ResizeObserver(() => {
              if (!dead) void view.fitPage();
            });
            resize.observe(el);
          }
        } else {
          const { DocxViewer } = await import("@silurus/ooxml/docx");
          if (dead) return;
          const canvas = document.createElement("canvas");
          canvas.className = "h-full w-full";
          el.replaceChildren(canvas);
          const view = new DocxViewer(canvas);
          viewer = view;
          await view.load(bytes);
        }
      } catch {
        if (!dead) onErrorRef.current();
      }
    })();
    return () => {
      dead = true;
      resize?.disconnect();
      nav.current = null;
      viewer?.destroy();
    };
  }, [bytes, kind]);
  const pager = kind === "pptx" ? slidePagerLabel(slide.index, slide.total) : "";
  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col bg-white"
      tabIndex={pager ? 0 : undefined}
      onKeyDown={event => {
        if (!pager) return;
        if (event.key === "ArrowRight" || event.key === "PageDown") nav.current?.next();
        if (event.key === "ArrowLeft" || event.key === "PageUp") nav.current?.prev();
      }}
    >
      <div
        ref={host}
        data-testid="office-ooxml-view"
        data-office-kind={kind}
        className="min-h-0 w-full flex-1 overflow-auto"
      />
      {pager ? (
        <div
          data-testid="office-slide-pager"
          className="flex shrink-0 items-center justify-center gap-3 border-t border-[#eeeeee] py-1.5 text-[12px] text-[#525252]"
        >
          <button
            type="button"
            data-testid="office-slide-prev"
            disabled={slide.index <= 0}
            onClick={() => nav.current?.prev()}
            className="rounded px-2 py-0.5 hover:bg-[#f2f2f2] disabled:opacity-40"
          >
            上一页
          </button>
          <span data-testid="office-slide-position" className="tabular-nums">
            {pager}
          </span>
          <button
            type="button"
            data-testid="office-slide-next"
            disabled={slide.index >= slide.total - 1}
            onClick={() => nav.current?.next()}
            className="rounded px-2 py-0.5 hover:bg-[#f2f2f2] disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}
