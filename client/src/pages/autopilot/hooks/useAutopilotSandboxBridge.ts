/**
 * useAutopilotSandboxBridge — 把蓝图实时事件桥接到 3D 场景的墙面终端 / 浏览器卡片。
 *
 * 背景（用户反馈 2026-05-16）：
 * - `/autopilot` 页面右栏已经能消费 `agentReasoning.entries` / `capabilityStatuses` /
 *   `effectPreviews` 这些蓝图实时切片，但中间 3D 场景的 `<SandboxMonitor />`
 *   后墙三分区（终端 / 任务摘要 / 浏览器画面）只订阅 `useSandboxStore`，
 *   而 `useSandboxStore` 只识别 mission-first 任务壳的 `mission_log` /
 *   `mission_screen` socket 事件，**完全不感知蓝图 jobId**。
 * - 因此从用户视角看："蓝图驾驶舱里 3D 场景跟右栏时间线、HUD 是脱钩的"。
 *
 * 这个 hook 在蓝图页 active 时把：
 * 1) `agentReasoning.entries`（thinking / acting / observing / completed / error）
 *    转成 `LogLine` 推到 `useSandboxStore.appendLog`，让墙面终端流式显示
 *    蓝图执行过程；
 * 2) `effectPreviews[0].runtimeProjection.logTimeline`（来自 effect-preview
 *    LLM 派生的高层日志）也转成 `LogLine` 推到同一终端，但用单独 stepIndex
 *    避免与 agentReasoning 混淆；
 * 3) 设置 `useSandboxStore.setActiveMission(jobId ?? intakeId)`，让墙面终端
 *    自身的 socket 过滤器把这个流认成"当前焦点"，避免被普通 mission 流冲掉。
 *
 * 设计原则：
 * - **只读派生**：不调真实 socket、不写 blueprint store；只把蓝图切片镜像到 sandbox。
 * - **幂等**：内部维护 lastSeenIndex，只 appendLog "新增"的 entry，避免重渲染时重放历史。
 * - **可清理**：组件 unmount 时调 `setActiveMission(null)` 并 `reset()`，
 *   避免污染之后切回普通任务页的 wall 终端。
 *
 * 不做的事（明确边界）：
 * - 不修改 `<MissionWallTaskPanel>`（中区任务卡片）的真相源——它继续消费
 *   mission-first 的 mission/detail，避免把蓝图 job 伪装成 mission 引发 store 冲突。
 * - 不下发 `updateScreenshot`——蓝图 effectPreview.browserPreview 只有 url / title，
 *   没有 imageData，无法构造合法 ScreenshotFrame；浏览器卡片如何对接放到下一阶段。
 *
 * @see autopilot-streaming-experience integration-gap-2026-05-16
 */

import { useEffect, useRef } from "react";

import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import { useSandboxStore, type LogLine } from "@/lib/sandbox-store";
import type { BlueprintEffectPreviewSnapshot } from "@/lib/blueprint-api";

interface UseAutopilotSandboxBridgeArgs {
  /**
   * 当前蓝图 job id。优先级最高；为空字符串时回退到 intakeId。
   */
  jobId: string | null;
  /**
   * 当前 intake id，订阅 stream 时也会作为兜底 stream key
   * （clarification / route_generation 阶段 emitter stream key === intake.id）。
   */
  intakeId: string | null;
  /**
   * 蓝图 effect preview 列表（来自 `readAutopilotEffectPreviews(latestJob)`）；
   * 数组首元素的 `runtimeProjection.logTimeline` 会被镜像到墙面终端。
   */
  effectPreviews: BlueprintEffectPreviewSnapshot[];
}

/**
 * agent reasoning 条目转成 LogLine。phase / iterationLabel / actionToolId /
 * observationSummary 全部拼成单行 `[PHASE iter] message` 文本，便于在 1:1 终端
 * 行级渲染中直接读出。
 */
function entryToLogLine(
  entry: {
    id: string;
    iteration: number;
    iterationLabel: string;
    phase: string;
    thought?: string;
    actionToolId?: string;
    observationSuccess?: boolean;
    observationSummary?: string;
    reason?: string;
    error?: string;
    timestamp: string;
  }
): LogLine {
  // 不同 phase 走不同 stream + 文案：
  // - thinking / acting / observing 都是 stdout
  // - error 走 stderr，让墙面终端用 ANSI 红色渲染
  const isError = entry.phase === "error";
  const phaseLabel = entry.phase.toUpperCase();
  const iterTag = entry.iterationLabel ? `[${entry.iterationLabel}] ` : "";

  let body = "";
  if (entry.thought) body = entry.thought;
  else if (entry.actionToolId) body = `→ ${entry.actionToolId}`;
  else if (entry.observationSummary) {
    body = `${entry.observationSuccess === false ? "✗" : "✓"} ${entry.observationSummary}`;
  } else if (entry.reason) body = entry.reason;
  else if (entry.error) body = entry.error;

  return {
    stepIndex: 0,
    stream: isError ? "stderr" : "stdout",
    data: `${iterTag}${phaseLabel} ${body}`,
    timestamp: entry.timestamp,
  };
}

/**
 * effectPreview.runtimeProjection.logTimeline 条目转 LogLine。
 * level === "warning" → stderr；其它 → stdout。
 */
function logTimelineEntryToLogLine(entry: {
  id: string;
  level: "info" | "warning" | "success";
  message: string;
  occurredAt: string;
}): LogLine {
  return {
    stepIndex: 1,
    stream: entry.level === "warning" ? "stderr" : "stdout",
    data: `[runtime] ${entry.message}`,
    timestamp: entry.occurredAt,
  };
}

/**
 * 主 hook：在蓝图页主组件挂载时调用一次。
 *
 * 内部维护两个 ref：
 * - `seenReasoningIds` — 已经 appendLog 过的 agentReasoning entry id 集合
 * - `seenLogTimelineIds` — 已经 appendLog 过的 effectPreview log timeline id 集合
 *
 * 这两个集合保证了"只有新增 entry 才推到 sandbox"，避免组件重渲染时把同一段
 * 历史重复推回墙面终端。
 *
 * jobId / intakeId 任一变化时清空两个集合并 `reset()` sandbox，让新一段任务
 * 从干净状态开始流式。
 */
export function useAutopilotSandboxBridge({
  jobId,
  intakeId,
  effectPreviews,
}: UseAutopilotSandboxBridgeArgs): void {
  const reasoningEntries = useBlueprintRealtimeStore(
    s => s.agentReasoning.entries
  );

  const seenReasoningIds = useRef<Set<string>>(new Set());
  const seenLogTimelineIds = useRef<Set<string>>(new Set());

  // 流标识切换：jobId 优先，其次 intakeId。空时不接管 wall。
  const streamKey = jobId || intakeId || null;

  // 1) 流标识切换时重置 wall 与本地缓存。
  useEffect(() => {
    if (!streamKey) {
      // 离开蓝图上下文：让墙面终端回归 mission-first 默认行为
      const sandbox = useSandboxStore.getState();
      if (sandbox.activeMissionId !== null) {
        sandbox.setActiveMission(null);
      }
      seenReasoningIds.current = new Set();
      seenLogTimelineIds.current = new Set();
      return;
    }

    const sandbox = useSandboxStore.getState();
    if (sandbox.activeMissionId !== streamKey) {
      // setActiveMission 会清空 logLines / screenshots，与 reset() 等价
      sandbox.setActiveMission(streamKey);
      seenReasoningIds.current = new Set();
      seenLogTimelineIds.current = new Set();
    }
  }, [streamKey]);

  // 2) agentReasoning.entries 增量 → wall 终端。
  useEffect(() => {
    if (!streamKey) return;
    if (!Array.isArray(reasoningEntries) || reasoningEntries.length === 0) return;

    const sandbox = useSandboxStore.getState();
    if (sandbox.activeMissionId !== streamKey) return;

    for (const entry of reasoningEntries) {
      // 过滤掉 iteration_started / iteration_completed 这种纯结构标记
      if (
        entry.phase === "iteration_started" ||
        entry.phase === "iteration_completed"
      ) {
        continue;
      }
      if (seenReasoningIds.current.has(entry.id)) continue;
      seenReasoningIds.current.add(entry.id);
      sandbox.appendLog(entryToLogLine(entry));
    }
  }, [reasoningEntries, streamKey]);

  // 3) effectPreview runtime projection logTimeline → wall 终端。
  useEffect(() => {
    if (!streamKey) return;
    const preview = effectPreviews[0];
    const timeline = preview?.runtimeProjection?.logTimeline;
    if (!Array.isArray(timeline) || timeline.length === 0) return;

    const sandbox = useSandboxStore.getState();
    if (sandbox.activeMissionId !== streamKey) return;

    for (const entry of timeline) {
      if (seenLogTimelineIds.current.has(entry.id)) continue;
      seenLogTimelineIds.current.add(entry.id);
      sandbox.appendLog(logTimelineEntryToLogLine(entry));
    }
  }, [effectPreviews, streamKey]);

  // 4) unmount cleanup：把 wall 还回 mission-first 默认状态。
  useEffect(() => {
    return () => {
      const sandbox = useSandboxStore.getState();
      if (sandbox.activeMissionId !== null) {
        sandbox.setActiveMission(null);
      }
    };
  }, []);
}

export default useAutopilotSandboxBridge;

// ─── 测试导出 ─────────────────────────────────────────────────────────────
// 仓库约定不集成 `@testing-library/react` / `jsdom` / `happy-dom`，因此
// hook 内部的 useEffect 行为无法在测试中真实跑起来。取而代之的策略是把
// hook 的核心数据变换 helpers 暴露给 `__testing__`，让单测直接覆盖
// "agent reasoning entry → LogLine" / "logTimeline entry → LogLine" 两条
// 纯函数链路；hook 内部的 useEffect 副作用由后续手动验证 + 既有 SSR 集成
// 测试间接覆盖（与本仓 `use-autopilot-right-rail-data.test.ts` 等其它
// hook 测试保持一致）。
export const __testing__ = {
  entryToLogLine,
  logTimelineEntryToLogLine,
};
