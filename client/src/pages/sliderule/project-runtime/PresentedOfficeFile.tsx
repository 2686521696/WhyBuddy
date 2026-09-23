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
 * 浏览器里用 @silurus/ooxml 画 Agent 点名的那份文件。
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
    return <p className="m-0 px-3 py-6 text-sm">点名的文件读不到。</p>;
  }
  if (failed) {
    return <p className="m-0 px-3 py-6 text-sm">这份文件画不出来。</p>;
  }
  if (!bytes) {
    return <p className="m-0 px-3 py-6 text-sm opacity-70">正在打开点名的文件…</p>;
  }
  return (
    <OfficeOoxmlView
      bytes={bytes}
      kind={kind}
      onError={() => setFailed(true)}
    />
  );
}

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
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let viewer: { destroy: () => void } | null = null;
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
          canvas.className = "h-full w-full";
          el.replaceChildren(canvas);
          const view = new PptxViewer(canvas);
          viewer = view;
          await view.load(bytes);
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
      viewer?.destroy();
    };
  }, [bytes, kind]);
  return (
    <div
      ref={host}
      data-testid="office-ooxml-view"
      data-office-kind={kind}
      className="h-full min-h-0 w-full flex-1 overflow-hidden bg-white"
    />
  );
}
