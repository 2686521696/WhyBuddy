/**
 * 预览头条上的下载。跟当前打开的那一份走，不在底下钉文件名。
 *
 * ⚠ 2026-09-22 启动会预览底下是一条「文件名 + 下载」。那是产物清单，
 *   换一份打开的文件，条还是清单里的名字。Manus 是预览右上角一个下载，
 *   下的是正在看的那份。没点名就不画，不拿清单第一份顶上。
 */
import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  listOfficeArtifacts,
  officeArtifactDownloadUrl,
} from "./office-artifacts-client";

export function PreviewFileDownload({
  projectId,
  path,
}: {
  projectId: string;
  path: string | null;
}) {
  const [target, setTarget] = useState<{ href: string; name: string } | null>(
    null
  );

  useEffect(() => {
    const id = projectId.trim();
    const named = String(path || "").trim();
    setTarget(null);
    if (!id || !named) return;
    const ac = new AbortController();
    void listOfficeArtifacts(id, ac.signal)
      .then(items => {
        if (ac.signal.aborted) return;
        const match = items.find(item => item.path === named);
        if (!match) return;
        const name = match.path.split("/").pop() || match.path;
        setTarget({
          href: officeArtifactDownloadUrl(id, match.artifactId),
          name,
        });
      })
      .catch(() => {
        // 清单读不到就没有下载。不改预览本身。
      });
    return () => ac.abort();
  }, [projectId, path]);

  if (!target) return null;
  return (
    <a
      href={target.href}
      download={target.name}
      data-testid="preview-file-download"
      aria-label="下载"
      title={target.name}
      className="flex h-7 w-7 items-center justify-center rounded-md text-[#3c3c3c] hover:bg-[#f4f4f5]"
    >
      <Download className="h-4 w-4" aria-hidden />
    </a>
  );
}
