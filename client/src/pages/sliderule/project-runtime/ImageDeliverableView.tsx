import { useEffect, useState } from "react";
import { imageMimeOf } from "./deliverable-files";

/**
 * 图片交付物（图表、导出的页面图）：取到的字节拼成 Blob 地址画进 <img>。
 *
 * ⚠ 2026-10-07 真机 r85（@data-visualization-discipline）：图表 PNG 是这一轮的主交付，产物库原来不收，
 *   右栏也不认（deliverable-files 头注）。下载头是 attachment + nosniff，不能直接当 src——跟文本交付物一样取字节自己画。
 */
export function ImageDeliverableView({ bytes, path, compact = false }: { bytes: ArrayBuffer; path: string; compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: imageMimeOf(path) || "image/png" }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [bytes, path]);
  if (!url) return null;
  const name = String(path || "").split("/").pop() || "图片";
  return (
    <div
      data-testid="image-deliverable"
      className={`flex min-h-0 w-full flex-1 items-center justify-center bg-[#f6f6f6] ${compact ? "p-1" : "overflow-auto p-4"}`}
    >
      <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
    </div>
  );
}
