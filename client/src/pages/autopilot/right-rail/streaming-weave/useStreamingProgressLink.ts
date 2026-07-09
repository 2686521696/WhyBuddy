/**
 * 流式进度联动 Hook — useStreamingProgressLink
 *
 * 将 `useStreamingWeave` 的流式状态映射为 `StageProgressIndicator` 可消费的
 * props 增强。当流式活跃时覆盖进度条行为：
 * - 流式进行中：使用 streaming 模式（渐变填充 + 微弱脉冲）
 * - 暂停超过 3s：切换为不确定态动画
 * - 阶段跨越：平滑过渡到下一阶段进度
 *
 * 本 hook 不直接修改 `StageProgressIndicator` 的 props，而是返回一组增强字段，
 * 由上层（Wave 3 task 5.1 的 AutopilotRightRail 接线）决定是否覆盖原始进度。
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-lifecycle-weave/`
 * - 需求 1.2：流式 token 持续到达时更新进度条填充比例
 * - 需求 1.3：流式输出跨越阶段边界时平滑过渡
 * - 需求 1.4：暂停超过 3s 切换为不确定态
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { StreamingWeaveState } from "./types";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 暂停超过此时长（ms）切换为不确定态 */
const PAUSE_THRESHOLD_MS = 3000;

/** 检测间隔（ms） */
const CHECK_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// 返回值接口
// ---------------------------------------------------------------------------

/**
 * useStreamingProgressLink 返回的进度增强字段。
 *
 * 上层可选择性地将这些字段覆盖到 StageProgressIndicator 的 props 上。
 */
export interface StreamingProgressLinkState {
  /** 是否处于流式模式（流式活跃且未超时） */
  isStreamingMode: boolean;
  /** 是否因暂停超过 3s 而切换为不确定态 */
  isPausedIndeterminate: boolean;
  /** 流式进度值（0-100），基于 streaming weave 的 getProgress() */
  streamingProgress: number;
  /** 是否正在跨阶段过渡 */
  isCrossingStage: boolean;
}

// ---------------------------------------------------------------------------
// Hook 实现
// ---------------------------------------------------------------------------

/**
 * 将流式协调层状态映射为进度条增强 props。
 *
 * @param state - 来自 useStreamingWeave 的流式状态
 * @param getProgress - 来自 useStreamingWeave 的进度查询函数
 * @returns StreamingProgressLinkState — 进度条增强字段
 */
export function useStreamingProgressLink(
  state: StreamingWeaveState,
  getProgress: () => number
): StreamingProgressLinkState {
  const [isPausedIndeterminate, setIsPausedIndeterminate] = useState(false);
  const [isCrossingStage, setIsCrossingStage] = useState(false);

  // 记录上一次的 stageIndex，用于检测阶段跨越
  const prevStageIndexRef = useRef<number>(state.currentStageIndex);

  // 定时检测暂停超时
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // 暂停超时检测
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!state.isStreaming) {
      // 非流式状态，清除定时器并重置
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsPausedIndeterminate(false);
      return;
    }

    // 流式活跃时启动定时检测
    timerRef.current = setInterval(() => {
      if (state.lastTokenAt === 0) return;
      const elapsed = Date.now() - state.lastTokenAt;
      setIsPausedIndeterminate(elapsed >= PAUSE_THRESHOLD_MS);
    }, CHECK_INTERVAL_MS);

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state.isStreaming, state.lastTokenAt]);

  // ---------------------------------------------------------------------------
  // 阶段跨越检测
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (state.currentStageIndex !== prevStageIndexRef.current) {
      setIsCrossingStage(true);
      prevStageIndexRef.current = state.currentStageIndex;

      // 过渡动画持续 300ms 后清除标记
      const timeout = setTimeout(() => {
        setIsCrossingStage(false);
      }, 300);

      return () => clearTimeout(timeout);
    }
  }, [state.currentStageIndex]);

  // ---------------------------------------------------------------------------
  // 收到新 token 时重置暂停状态
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (state.isStreaming && state.tokenCount > 0) {
      setIsPausedIndeterminate(false);
    }
  }, [state.tokenCount, state.isStreaming]);

  // ---------------------------------------------------------------------------
  // 计算当前流式进度
  // ---------------------------------------------------------------------------

  const streamingProgress = getProgress();

  return {
    isStreamingMode: state.isStreaming && !state.isInterrupted && !state.isReconnecting,
    isPausedIndeterminate,
    streamingProgress,
    isCrossingStage,
  };
}
