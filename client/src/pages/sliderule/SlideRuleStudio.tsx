/**
 * SlideRuleStudio — 统一页主布局容器（左 38% + 右 62%）
 *
 * 左侧：Chat 对话区（ClaudeChatSurface，含唯一空态：logo 水印 + hero 文案 + 示例 chips）
 * 右侧：SkillThumbnailBar + 内容区，内容区在两个视图间切换：
 *   - 系统画面（ActiveSystemScreen，16:9 六系统屏）
 *   - 推演过程（processSlot — 执行时间线 INTAKE → C_* → Commit Gate + SKILL LINKAGE）
 *
 * 切换规则：
 *   - 一轮推演启动时自动切到「推演过程」；
 *   - SSE skill 事件激活某个系统屏时自动切回「系统画面」（保留既有 auto-show 行为）；
 *   - 任何时刻可手动点 tab / 缩略图切换。
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import { SkillThumbnailBar } from "./SkillThumbnailBar";
import { ActiveSystemScreen } from "./system-screens/ActiveSystemScreen";
import type { SkillRuntimeGraphLike } from "./system-screens/five-system-model";

type RailView = "screens" | "process";

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
  /** 推演过程 view — execution timeline + skill linkage (ArchitectureProcessPanel) */
  processSlot?: React.ReactNode;
  /** Drives the auto-switch to the 推演过程 view at run start */
  isRunning?: boolean;

  className?: string;
}

export function SlideRuleStudio({
  chatSlot,
  activeSkillId,
  publishClosure,
  latestMermaid,
  skillContents,
  skillRuntimeGraph,
  processSlot,
  isRunning = false,
  className = "",
}: SlideRuleStudioProps) {
  // Allow manual override of the displayed screen (click thumbnail)
  const [manualSkill, setManualSkill] = useState<SkillId | null>(null);

  // Right-rail view: skill screens vs 推演过程 (execution timeline).
  // Initial value covers SSR/first paint: a running turn without an active
  // skill yet starts on the process feed.
  const [railView, setRailView] = useState<RailView>(
    isRunning && !activeSkillId && processSlot ? "process" : "screens"
  );

  // Run start → show the 推演过程 feed by default.
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (isRunning && !prevRunningRef.current && processSlot) {
      setRailView("process");
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, processSlot]);

  // SSE skill activation → auto-show the active skill screen (existing behavior).
  useEffect(() => {
    if (activeSkillId) setRailView("screens");
  }, [activeSkillId]);

  // SSE events take priority during a run; manual selection persists between runs.
  const displaySkillId = activeSkillId ?? manualSkill;

  const handleThumbnailSelect = useCallback((id: SkillId) => {
    setManualSkill(id);
    setRailView("screens");
  }, []);

  return (
    <div className={`flex h-full w-full overflow-hidden ${className}`}>
      {/* Left panel — 38% — Chat */}
      <div className="flex h-full shrink-0 flex-col border-r border-[#E7E2D9] bg-[#FAF9F5]"
           style={{ width: "38%" }}>
        {chatSlot}
      </div>

      {/* Right panel — 62% — Skill visualisation + 推演过程 */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-[#F5F1EA] p-4">
        {/* Thumbnail bar + rail view tabs */}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <SkillThumbnailBar
            activeSkillId={displaySkillId}
            publishClosure={publishClosure}
            onSelect={handleThumbnailSelect}
          />
          {processSlot && (
            <div
              className="flex items-center gap-0.5 rounded-full bg-[#F0EDE5] p-0.5 ring-1 ring-[#E7E2D9]/80"
              data-testid="sliderule-rail-view-toggle"
            >
              {(
                [
                  { id: "screens" as const, label: "系统画面" },
                  { id: "process" as const, label: "推演过程" },
                ]
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`sliderule-rail-tab-${id}`}
                  onClick={() => setRailView(id)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    railView === id
                      ? "bg-white text-stone-800 shadow-sm"
                      : "text-stone-500 hover:text-stone-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content area — 16:9 system screen or 推演过程 feed */}
        {railView === "process" && processSlot ? (
          <div
            data-testid="sliderule-rail-process"
            className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[#E7E2D9] bg-white/70 p-3 shadow-sm"
          >
            {processSlot}
          </div>
        ) : (
          <ActiveSystemScreen
            activeSkillId={displaySkillId}
            publishClosure={publishClosure}
            latestMermaid={latestMermaid}
            skillContents={skillContents}
            skillRuntimeGraph={skillRuntimeGraph}
            className="min-h-0 flex-1"
          />
        )}
      </div>
    </div>
  );
}
