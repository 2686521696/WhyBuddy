/**
 * SlideRuleStudio — 主布局容器（左 38% + 右 62%）
 *
 * 左侧：Chat 对话区（ClaudeChatSurface）
 * 右侧：SkillThumbnailBar + ActiveSystemScreen（16:9 视觉输出区）
 *
 * activeSkillId 由 useSlideRuleSession SSE 事件驱动，实时高亮缩略图。
 */

import React, { useState, useCallback } from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import type { UiTurn } from "./types";
import type { LiveAction } from "@shared/blueprint/capability-process-labels";
import { SkillThumbnailBar } from "./SkillThumbnailBar";
import { ActiveSystemScreen } from "./system-screens/ActiveSystemScreen";

interface SlideRuleStudioProps {
  // --- Chat panel (left) ---
  chatSlot: React.ReactNode;

  // --- Right panel data ---
  activeSkillId: SkillId | null;
  publishClosure?: PublishClosureSummary | null;
  /** Latest mermaid string from an SSE skill_result event */
  latestMermaid?: string | null;
  /** Per-skill raw content accumulated from SSE skill_result events */
  skillContents?: Partial<Record<SkillId, string>>;

  className?: string;
}

export function SlideRuleStudio({
  chatSlot,
  activeSkillId,
  publishClosure,
  latestMermaid,
  skillContents,
  className = "",
}: SlideRuleStudioProps) {
  // Allow manual override of the displayed screen (click thumbnail)
  const [manualSkill, setManualSkill] = useState<SkillId | null>(null);

  // SSE events take priority during a run; manual selection persists between runs.
  const displaySkillId = activeSkillId ?? manualSkill;

  const handleThumbnailSelect = useCallback((id: SkillId) => {
    setManualSkill(id);
  }, []);

  return (
    <div className={`flex h-full w-full overflow-hidden ${className}`}>
      {/* Left panel — 38% — Chat */}
      <div className="flex h-full shrink-0 flex-col border-r border-slate-200 bg-white"
           style={{ width: "38%" }}>
        {chatSlot}
      </div>

      {/* Right panel — 62% — Skill visualisation */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-[#f8fafc] p-4">
        {/* Thumbnail bar */}
        <SkillThumbnailBar
          activeSkillId={displaySkillId}
          publishClosure={publishClosure}
          onSelect={handleThumbnailSelect}
          className="shrink-0"
        />

        {/* 16:9 active system screen */}
        <ActiveSystemScreen
          activeSkillId={displaySkillId}
          publishClosure={publishClosure}
          latestMermaid={latestMermaid}
          skillContents={skillContents}
          className="min-h-0 flex-1"
        />
      </div>
    </div>
  );
}
