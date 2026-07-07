/**
 * SlideRuleStudio — 统一页主布局容器（左 38% + 右 62%）
 *
 * 左侧：Chat 对话区（ClaudeChatSurface，含唯一空态：logo 水印 + hero 文案 + 示例 chips）。
 * 左栏对话流本身就是实时推演过程（步骤流 + LLM 实时草稿），
 * 右侧只负责一件事：系统画面（SkillThumbnailBar + ActiveSystemScreen 16:9 六系统屏）。
 * 曾有的「推演过程」右栏标签页与左栏完全重复，已按用户反馈移除。
 */

import React, { useState, useCallback } from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import { SkillThumbnailBar } from "./SkillThumbnailBar";
import { ActiveSystemScreen } from "./system-screens/ActiveSystemScreen";
import type { SkillRuntimeGraphLike } from "./system-screens/five-system-model";

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
  /** Persisted cross-skill runtime graph (python /drive-full projection) */
  skillRuntimeGraph?: SkillRuntimeGraphLike | null;
  /** 试运行（浏览器运行时）状态的持久化命名空间 */
  sessionId?: string;
  /** 运行应用标题（话题名） */
  appTitle?: string;

  className?: string;
}

export function SlideRuleStudio({
  chatSlot,
  activeSkillId,
  publishClosure,
  latestMermaid,
  skillContents,
  skillRuntimeGraph,
  sessionId,
  appTitle,
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
      {/* Left panel — 38% — Chat（对话 + 实时推演过程） */}
      <div className="flex h-full shrink-0 flex-col border-r border-[#E7E2D9] bg-[#FAF9F5]"
           style={{ width: "38%" }}>
        {chatSlot}
      </div>

      {/* Right panel — 62% — 系统画面 only */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-[#F5F1EA] p-4">
        <div className="flex shrink-0 items-center">
          <SkillThumbnailBar
            activeSkillId={displaySkillId}
            publishClosure={publishClosure}
            onSelect={handleThumbnailSelect}
          />
        </div>

        <ActiveSystemScreen
          activeSkillId={displaySkillId}
          publishClosure={publishClosure}
          latestMermaid={latestMermaid}
          skillContents={skillContents}
          skillRuntimeGraph={skillRuntimeGraph}
          sessionId={sessionId}
          appTitle={appTitle}
          className="min-h-0 flex-1"
        />
      </div>
    </div>
  );
}
