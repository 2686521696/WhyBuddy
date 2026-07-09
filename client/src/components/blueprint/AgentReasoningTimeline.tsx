/**
 * `autopilot-agent-reasoning-stream` spec Task 11：Agent 推理流时间线组件。
 *
 * 参考 MiroFish `Step3Simulation.vue` 的流式时间线模式（Req 13），实现：
 * - 双轨交替布局：Think 左 / Act+Observe 右 / Error+Completed 居中横幅（Req 6.6）
 * - 400ms cubic-bezier 渐入动画（Req 7.3）
 * - pulse-ring 等待占位（Req 6.4）
 * - 32px 阈值自动滚动 + "↓ Latest" 按钮（Req 7.1 / 7.2）
 * - prefers-reduced-motion 降级（Req 7.4）
 * - 重连 chip（Req 9.2 / 9.3）
 * - 终态可见性（Req 8.5）
 *
 * 与 BlueprintLogStream 并存不替换（Req 6.3 / 10.1）。
 */

import { useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

import {
  useBlueprintRealtimeStore,
  type AgentReasoningEntry,
} from "../../lib/blueprint-realtime-store.js";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AgentReasoningTimelineProps {
  jobId: string;
  className?: string;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/** 检测 prefers-reduced-motion（Req 7.4）。 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export function AgentReasoningTimeline({
  jobId,
  className,
}: AgentReasoningTimelineProps) {
  const agentReasoning = useBlueprintRealtimeStore((s) => s.agentReasoning);
  const connectionState = useBlueprintRealtimeStore((s) => s.connectionState);
  const reducedMotion = useReducedMotion();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  // ── 自动滚动逻辑（Req 7.1 / 7.2）──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtBottom(dist <= 32);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!atBottom || !scrollRef.current) return;
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [agentReasoning.entries.length, atBottom]);

  // ── 终态可见性（Req 8.5）──
  useEffect(() => {
    const status = agentReasoning.status;
    if (
      (status === "completed" || status === "failed" || status === "aborted") &&
      terminalRef.current
    ) {
      terminalRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [agentReasoning.status]);

  // ── 按 iteration 分组 ──
  const groupedEntries = useMemo(() => {
    const groups: Array<{ iteration: number; entries: AgentReasoningEntry[] }> =
      [];
    let currentGroup: (typeof groups)[number] | null = null;

    for (const entry of agentReasoning.entries) {
      if (
        entry.phase === "iteration_started" ||
        !currentGroup ||
        entry.iteration !== currentGroup.iteration
      ) {
        currentGroup = { iteration: entry.iteration, entries: [] };
        groups.push(currentGroup);
      }
      // iteration_started / iteration_completed 不渲染独立卡，仅驱动分组
      if (
        entry.phase !== "iteration_started" &&
        entry.phase !== "iteration_completed"
      ) {
        currentGroup.entries.push(entry);
      }
    }
    return groups;
  }, [agentReasoning.entries]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
      setAtBottom(true);
    }
  };

  const isEmpty =
    agentReasoning.entries.length === 0 &&
    (agentReasoning.status === "idle" || agentReasoning.status === "streaming");

  const showReconnectChip =
    connectionState === "connected" &&
    agentReasoning.entries.length === 0 &&
    agentReasoning.status === "idle";

  return (
    <div
      ref={scrollRef}
      className={`relative overflow-y-auto h-full ${className ?? ""}`}
      data-testid="agent-reasoning-timeline"
    >
      {/* 重连 chip（Req 9.2 / 9.3）*/}
      {showReconnectChip && (
        <div className="sticky top-0 z-10 flex justify-center py-2">
          <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
            仅显示重新连接后的推理流
          </span>
        </div>
      )}

      {/* pulse-ring 等待占位（Req 6.4）*/}
      {isEmpty && <PulseRingPlaceholder reducedMotion={reducedMotion} />}

      {/* 时间线主体 */}
      {!isEmpty && (
        <div className="grid grid-cols-[1fr_2px_1fr] gap-4 px-6 py-8 relative">
          {/* 中轴线 */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#EAEAEA] -translate-x-1/2" />

          <AnimatePresence>
            {groupedEntries.map((group) => (
              <IterationGroup
                key={group.iteration}
                group={group}
                reducedMotion={reducedMotion}
                terminalRef={terminalRef}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* "↓ Latest" 浮动按钮（Req 7.2）*/}
      {!atBottom && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-6 right-6 z-20 bg-black text-white text-xs px-3 py-2 rounded-full shadow-lg hover:bg-gray-800 transition-colors"
          data-testid="latest-button"
        >
          ↓ Latest
        </button>
      )}
    </div>
  );
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function IterationGroup({
  group,
  reducedMotion,
  terminalRef,
}: {
  group: { iteration: number; entries: AgentReasoningEntry[] };
  reducedMotion: boolean;
  terminalRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      {/* Iteration 分隔线（Req 6.6）*/}
      <div className="col-span-3 text-xs font-mono text-gray-400 flex items-center gap-2 my-4">
        <div className="flex-1 h-px bg-gray-200" />
        <span data-testid="iteration-separator">#{group.iteration}</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {group.entries.map((entry) => {
        if (entry.phase === "error" || entry.phase === "completed") {
          return (
            <ReasoningBanner
              key={entry.id}
              entry={entry}
              reducedMotion={reducedMotion}
              ref={terminalRef}
            />
          );
        }
        const column =
          entry.phase === "thinking" ? "left" : "right";
        return (
          <ReasoningCard
            key={entry.id}
            entry={entry}
            column={column}
            reducedMotion={reducedMotion}
          />
        );
      })}
    </>
  );
}

/** Think/Act/Observe 卡片（Req 6.2 / 6.6 / 7.3）*/
function ReasoningCard({
  entry,
  column,
  reducedMotion,
}: {
  entry: AgentReasoningEntry;
  column: "left" | "right";
  reducedMotion: boolean;
}) {
  const gridColumn = column === "left" ? "1" : "3";
  const badgeClass = getBadgeClass(entry.phase);

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : 0.4,
        ease: [0.165, 0.84, 0.44, 1],
      }}
      style={{ gridColumn }}
      className="rounded border border-gray-200 p-4 bg-white shadow-sm"
      data-testid={`reasoning-card-${entry.phase}`}
      data-column={column}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${badgeClass}`}>
          {entry.phase}
        </span>
        <span className="text-[10px] text-gray-400 font-mono">
          {entry.iterationLabel}
        </span>
      </div>

      {entry.thought && (
        <p className="text-sm text-gray-700 leading-relaxed">{entry.thought}</p>
      )}
      {entry.actionToolId && (
        <p className="text-sm text-gray-600">
          <span className="font-mono text-xs bg-gray-100 px-1 rounded">
            {entry.actionToolId}
          </span>
        </p>
      )}
      {entry.observationSuccess !== undefined && (
        <p className="text-sm text-gray-600">
          {entry.observationSuccess ? "✓ 成功" : "✗ 失败"}
          {entry.observationSummary && (
            <span className="ml-2 text-gray-500">{entry.observationSummary}</span>
          )}
        </p>
      )}

      <div className="mt-2 text-[10px] text-gray-300 font-mono text-right">
        {entry.timestamp}
      </div>
    </motion.div>
  );
}

import { forwardRef } from "react";

/** Error / Completed 横幅（Req 6.6 / 8.5）*/
const ReasoningBanner = forwardRef<
  HTMLDivElement,
  { entry: AgentReasoningEntry; reducedMotion: boolean }
>(function ReasoningBanner({ entry, reducedMotion }, ref) {
  const isError = entry.phase === "error";
  const bannerClass = isError
    ? "border-red-400 bg-red-50 text-red-700"
    : "border-green-500 bg-green-50 text-green-700";

  return (
    <motion.div
      ref={ref}
      initial={reducedMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : 0.4,
        ease: [0.165, 0.84, 0.44, 1],
      }}
      style={{ gridColumn: "1 / -1" }}
      className={`rounded border p-4 text-center ${bannerClass}`}
      data-testid={`reasoning-banner-${entry.phase}`}
    >
      <div className="font-semibold text-sm mb-1">
        {isError ? "⚠ " : "✓ "}
        {entry.reason ?? (isError ? "执行异常" : "任务完成")}
      </div>
      {entry.error && (
        <p className="text-xs opacity-75">{entry.error}</p>
      )}
      {entry.degraded && (
        <span className="inline-block mt-1 text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded">
          降级
        </span>
      )}
    </motion.div>
  );
});

/** pulse-ring 等待占位（Req 6.4 / MiroFish pattern）*/
function PulseRingPlaceholder({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none"
      data-testid="pulse-ring-placeholder"
    >
      <div
        className={`agent-reasoning-pulse-ring ${reducedMotion ? "reasoning-ripple-disable" : ""}`}
      />
      <span className="text-sm text-gray-400">等待第一条思考...</span>
    </div>
  );
}

// ─── 辅助 ────────────────────────────────────────────────────────────────────

/** phase → badge 视觉 class（Req 6.2 monochrome 映射）*/
function getBadgeClass(phase: string): string {
  switch (phase) {
    case "thinking":
      return "border border-dashed border-gray-400 text-gray-500";
    case "acting":
      return "bg-gray-100 text-gray-700 border border-gray-200";
    case "observing":
      return "bg-white text-gray-500 border border-gray-200";
    case "error":
      return "bg-red-50 text-red-600 border border-red-300";
    case "completed":
      return "bg-green-600 text-white";
    default:
      return "bg-gray-50 text-gray-400 opacity-50";
  }
}

export default AgentReasoningTimeline;
