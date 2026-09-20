import React, { useEffect, useState } from "react";
import {
  listOfficeArtifacts,
  loadOfficeArtifactPreview,
  officeArtifactDownloadUrl,
  officeArtifactPreviewUrl,
  type OfficeArtifactMeta,
  type OfficeArtifactPreview,
} from "./office-artifacts-client";

export function OfficeArtifactPane({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<OfficeArtifactMeta[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [preview, setPreview] = useState<OfficeArtifactPreview>({ kind: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setError(null);
    void listOfficeArtifacts(projectId, ac.signal)
      .then(items => {
        setFiles(items);
        setActive(current => current ?? items[0]?.artifactId ?? null);
      })
      .catch(() => {
        if (!ac.signal.aborted) setError("产物列表读不到");
      });
    return () => ac.abort();
  }, [projectId]);

  useEffect(() => {
    if (!active) {
      setPreview({ kind: null });
      return;
    }
    const ac = new AbortController();
    void loadOfficeArtifactPreview(projectId, active, ac.signal)
      .then(setPreview)
      .catch(() => {
        if (!ac.signal.aborted) setPreview({ kind: null });
      });
    return () => ac.abort();
  }, [projectId, active]);

  const current = files.find(item => item.artifactId === active) ?? null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent"
      data-testid="office-artifact-pane"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        {files.length === 0 ? (
          <p className="m-0 text-sm opacity-70">
            还没有办公文件。脚本会留在源码树；.pptx / .docx / .xlsx 成功后出现在这里。
          </p>
        ) : null}
        {files.map(item => (
          <button
            key={item.artifactId}
            type="button"
            data-testid={`office-artifact-${item.artifactId}`}
            className={`rounded-md px-2 py-1 text-sm ${
              item.artifactId === active ? "bg-white/15" : "opacity-70"
            }`}
            onClick={() => setActive(item.artifactId)}
          >
            {item.path}
          </button>
        ))}
        {current ? (
          <a
            className="ml-auto text-sm underline"
            href={officeArtifactDownloadUrl(projectId, current.artifactId)}
            download={current.path.split("/").pop() || current.path}
          >
            下载
          </a>
        ) : null}
      </div>
      {error ? <p className="px-3 text-sm">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="office-artifact-preview">
        {preview.kind === "pdf" && active ? (
          <iframe
            title="办公文件预览"
            className="h-full min-h-[24rem] w-full border-0 bg-white"
            src={officeArtifactPreviewUrl(projectId, active)}
          />
        ) : null}
        {preview.kind === "slides"
          ? preview.slides.map((slide, index) => (
              <section
                key={index}
                className="mb-3 rounded-lg border border-[var(--sr-line)] bg-white p-4 text-slate-900"
                data-testid={`office-slide-${index}`}
              >
                <p className="m-0 mb-2 text-xs text-slate-500">第 {index + 1} 页</p>
                <pre className="m-0 whitespace-pre-wrap font-sans text-sm">
                  {slide.text || "（这一页没有抽出正文）"}
                </pre>
              </section>
            ))
          : null}
        {preview.kind === "document" ? (
          <pre className="m-0 whitespace-pre-wrap text-sm">{preview.text}</pre>
        ) : null}
        {preview.kind === "workbook" ? (
          <p className="m-0 text-sm">工作表 {preview.sheetCount} 张。请下载后在 Excel 里打开。</p>
        ) : null}
        {preview.kind === null && current ? (
          <p className="m-0 text-sm opacity-70">
            这份文件可以下载。当前环境没有幻灯片预览。
          </p>
        ) : null}
      </div>
    </div>
  );
}
