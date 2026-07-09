/**
 * ReAct 循环状态管理 Hook。
 *
 * 对应 `.kiro/specs/autopilot-llm-react-loop-inline` Task 1.1。
 *
 * 消费 `useBlueprintRealtimeStore.agentReasoning.entries`，
 * 将 `AgentReasoningEntry` 解析为 `ReActPhase` 对象，
 * 按 `loopIndex`（即 entry.iteration）分组为 `ReActLoop[]`，
 * 并追踪当前流式阶段与 `isStreaming` 状态。
 *
 * 映射规则（从 AgentReasoningEntry.phase）：
 * - entry.phase === 'thinking'        → ReActPhaseType 'thinking'
 * - entry.phase === 'acting' && entry.actionToolId → 'tool-selecting'（首次）然后 'executing'
 * - entry.phase === 'observing'       → 'observing'
 * - entry.phase === 'completed'       → 'next-step'
 */

import { useMemo } from "react";

import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import type { AgentReasoningEntry } from "@/lib/blueprint-realtime-store";

import type {
  ReActLoop,
  ReActPhase,
  ReActPhaseType,
  UseReActLoopStateReturn,
} from "./types";

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/**
 * 将单个 AgentReasoningEntry 映射为一个或多个 ReActPhase。
 *
 * 对于 `acting` 阶段且存在 `actionToolId` 的 entry，
 * 会生成两个 phase：`tool-selecting` 和 `executing`。
 */
function mapEntryToPhases(
  entry: AgentReasoningEntry,
  isLast: boolean,
  streamingStatus: string
): ReActPhase[] {
  const timestamp = new Date(entry.timestamp).getTime();
  // loopIndex 基于 iteration（从 1 开始），转为从 0 开始
  const loopIndex = Math.max(0, entry.iteration - 1);
  const isCurrentlyStreaming = isLast && streamingStatus === "streaming";

  const phases: ReActPhase[] = [];

  switch (entry.phase) {
    case "thinking": {
      phases.push({
        id: `${entry.id}:thinking`,
        type: "thinking",
        content: entry.thought ?? "",
        isStreaming: isCurrentlyStreaming,
        loopIndex,
        timestamp,
      });
      break;
    }

    case "acting": {
      if (entry.actionToolId) {
        // tool-selecting 阶段：显示工具选择
        phases.push({
          id: `${entry.id}:tool-selecting`,
          type: "tool-selecting",
          content: `选择工具: ${entry.actionToolId}`,
          isStreaming: false,
          toolName: entry.actionToolId,
          loopIndex,
          timestamp,
        });
        // executing 阶段：显示执行中
        phases.push({
          id: `${entry.id}:executing`,
          type: "executing",
          content: `执行 ${entry.actionToolId}`,
          isStreaming: isCurrentlyStreaming,
          toolName: entry.actionToolId,
          loopIndex,
          timestamp,
        });
      } else {
        // 没有 actionToolId 时仅作为 executing
        phases.push({
          id: `${entry.id}:executing`,
          type: "executing",
          content: entry.thought ?? "执行中...",
          isStreaming: isCurrentlyStreaming,
          loopIndex,
          timestamp,
        });
      }
      break;
    }

    case "observing": {
      const content =
        entry.observationSummary ??
        (entry.observationSuccess ? "观察成功" : "观察失败");
      phases.push({
        id: `${entry.id}:observing`,
        type: "observing",
        content,
        isStreaming: isCurrentlyStreaming,
        loopIndex,
        timestamp,
      });
      break;
    }

    case "completed": {
      phases.push({
        id: `${entry.id}:next-step`,
        type: "next-step",
        content: entry.reason ?? "循环完成",
        isStreaming: false,
        loopIndex,
        timestamp,
      });
      break;
    }

    // iteration_started / iteration_completed / error 等不直接映射为可见阶段块
    default:
      break;
  }

  return phases;
}

/**
 * 将 ReActPhase[] 按 loopIndex 分组为 ReActLoop[]。
 */
function groupPhasesIntoLoops(phases: ReActPhase[]): ReActLoop[] {
  const loopMap = new Map<number, ReActPhase[]>();

  for (const phase of phases) {
    const existing = loopMap.get(phase.loopIndex);
    if (existing) {
      existing.push(phase);
    } else {
      loopMap.set(phase.loopIndex, [phase]);
    }
  }

  const loops: ReActLoop[] = [];
  for (const [index, loopPhases] of loopMap) {
    // 判断循环是否完成：存在 next-step 阶段即视为完成
    const isComplete = loopPhases.some((p) => p.type === "next-step");
    loops.push({ index, phases: loopPhases, isComplete });
  }

  // 按 index 排序
  loops.sort((a, b) => a.index - b.index);
  return loops;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * 消费 `useBlueprintRealtimeStore.agentReasoning.entries`，
 * 解析为 ReAct 循环结构化数据。
 *
 * @returns UseReActLoopStateReturn
 */
export function useReActLoopState(): UseReActLoopStateReturn {
  const entries = useBlueprintRealtimeStore(
    (s) => s.agentReasoning.entries
  );
  const status = useBlueprintRealtimeStore(
    (s) => s.agentReasoning.status
  );

  return useMemo(() => {
    if (entries.length === 0) {
      return {
        loops: [],
        currentPhase: null,
        isStreaming: false,
        totalLoops: 0,
      };
    }

    // 将所有 entries 映射为 phases
    const allPhases: ReActPhase[] = [];
    for (let i = 0; i < entries.length; i++) {
      const isLast = i === entries.length - 1;
      const phases = mapEntryToPhases(entries[i], isLast, status);
      allPhases.push(...phases);
    }

    // 分组为 loops
    const loops = groupPhasesIntoLoops(allPhases);

    // 确定当前流式阶段
    const streamingPhases = allPhases.filter((p) => p.isStreaming);
    const currentPhase =
      streamingPhases.length > 0
        ? streamingPhases[streamingPhases.length - 1]
        : null;

    const isStreaming = status === "streaming";

    return {
      loops,
      currentPhase,
      isStreaming,
      totalLoops: loops.length,
    };
  }, [entries, status]);
}
