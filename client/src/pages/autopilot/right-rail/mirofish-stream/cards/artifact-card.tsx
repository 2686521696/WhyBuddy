/**
 * autopilot-mirofish-card-diversity / Task 2.4 — ArtifactCard
 *
 * 独立的产物创建卡片组件，展示文件/代码/文档等产物信息。
 *
 * 视觉特征：
 * - 文件图标 + 文件名 + 类型标签横向布局
 * - 类型色调映射（code=bg-blue-500/5, document=bg-emerald-500/5,
 *   image=bg-violet-500/5, data=bg-amber-500/5）
 * - 进入动画：animate-mirofish-slide-in
 * - 支持点击展开预览摘要
 */

import { useState, type FC } from "react";

import { blueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";

import type { MiroFishArtifactCreatedEntry } from "../mirofish-stream-types";

/** 产物类型 → 背景色映射 */
const ARTIFACT_BG: Record<string, string> = {
  code: "bg-blue-500/5",
  document: "bg-emerald-500/5",
  image: "bg-violet-500/5",
  data: "bg-amber-500/5",
};

/** 产物类型 → 文件图标映射 */
const ARTIFACT_ICON: Record<string, string> = {
  code: "📄",
  document: "📝",
  image: "🖼",
  data: "📊",
};

export interface ArtifactCardProps {
  entry: MiroFishArtifactCreatedEntry;
  locale?: AppLocale;
  /** 预览摘要文本（可选） */
  previewSummary?: string;
}

/**
 * ArtifactCard — 产物创建卡片
 *
 * 横向布局展示文件图标、文件名和类型标签，
 * 根据产物类型使用差异化背景色调。支持点击展开预览摘要。
 */
export const ArtifactCard: FC<ArtifactCardProps> = ({
  entry,
  locale = "zh-CN",
  previewSummary,
}) => {
  const [expanded, setExpanded] = useState(false);

  const artType = entry.artifactType.toLowerCase();
  const bgClass = ARTIFACT_BG[artType] ?? "bg-white/5";
  const icon = ARTIFACT_ICON[artType] ?? "📦";
  const titleText = blueprintCopy(entry.title, locale);

  return (
    <div
      data-testid="mirofish-card-artifact"
      data-tone={entry.tone}
      data-artifact-id={entry.artifactId}
      data-artifact-type={entry.artifactType}
      className={`animate-mirofish-slide-in rounded-md border border-slate-200 ${bgClass}`}
    >
      {/* 主行：图标 + 文件名 + 类型标签 */}
      <button
        type="button"
        className="flex items-center gap-2 px-2.5 py-2 w-full text-left"
        onClick={() => previewSummary && setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {/* 文件图标 */}
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-sm text-slate-500" aria-hidden="true">
          {icon}
        </span>

        {/* 文件名 */}
        <span className="text-[11px] font-medium text-slate-700 truncate flex-1">
          {titleText}
        </span>

        {/* 类型标签（兼容旧格式 "artifact · {type}"） */}
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono flex-shrink-0">
          {`artifact · ${entry.artifactType}`}
        </span>
      </button>

      {/* 展开预览摘要 */}
      {expanded && previewSummary && (
        <div className="px-2.5 pb-2 text-[10px] text-slate-500 leading-relaxed border-t border-slate-100 pt-1.5">
          {previewSummary}
        </div>
      )}
    </div>
  );
};

export default ArtifactCard;
