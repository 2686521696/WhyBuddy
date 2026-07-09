/**
 * 流式输出协调 Hook — useStreamingWeave
 *
 * 统一的流式输出协调层，将 Socket.IO 推送的 streaming token 分发到多个消费端。
 * 通过 `useBlueprintRealtimeStore` 订阅实时事件，使用 requestAnimationFrame
 * 批量合并高频 token 更新，并维护全局流式状态。
 *
 * 核心职责：
 * - 订阅 Socket.IO streaming token 事件
 * - 维护 `StreamingWeaveState` 状态
 * - 实现 `subscribe(consumerId, callback)` 发布-订阅模式
 * - 实现 `getProgress()` 基于 token 计数的进度估算
 * - 使用 requestAnimationFrame 批量合并 token 分发
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-lifecycle-weave/`
 * - 需求 1.1, 1.2：跨阶段流式进度展示
 * - 需求 2.1-2.4：多组件流式协调
 * - 需求 4.1：requestAnimationFrame 节流
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";

import { StreamTokenBuffer } from "./StreamTokenBuffer";
import type {
  StreamingWeaveState,
  StreamTokenCallback,
  Unsubscribe,
  UseStreamingWeaveReturn,
} from "./types";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 预估的 token 总量上限，用于进度计算 */
const ESTIMATED_TOTAL_TOKENS = 2000;

/** 进度最大值 */
const MAX_PROGRESS = 100;

// ---------------------------------------------------------------------------
// 初始状态
// ---------------------------------------------------------------------------

const INITIAL_STATE: StreamingWeaveState = {
  isStreaming: false,
  isInterrupted: false,
  isReconnecting: false,
  currentStageIndex: 0,
  tokenCount: 0,
  lastTokenAt: 0,
  bufferSize: 0,
};

// ---------------------------------------------------------------------------
// Hook 实现
// ---------------------------------------------------------------------------

/**
 * 流式输出协调 Hook。
 *
 * 订阅 `useBlueprintRealtimeStore` 的 agentReasoning 状态变化，
 * 将流式 token 通过 pub-sub 模式分发到多个消费端组件。
 *
 * @returns UseStreamingWeaveReturn — 状态、订阅、进度与中断时长查询
 */
export function useStreamingWeave(): UseStreamingWeaveReturn {
  const [state, setState] = useState<StreamingWeaveState>(INITIAL_STATE);

  // 消费端订阅表：consumerId → callback
  const subscribersRef = useRef<Map<string, StreamTokenCallback>>(new Map());

  // Token 缓冲队列实例
  const bufferRef = useRef<StreamTokenBuffer>(new StreamTokenBuffer());

  // RAF handle
  const rafRef = useRef<number | null>(null);

  // 上一次 flush 的时间戳
  const lastFlushRef = useRef<number>(0);

  // 上一次处理的 entries 长度（用于增量检测新 token）
  const lastEntriesLenRef = useRef<number>(0);

  // 流式开始时间（用于进度估算）
  const streamStartRef = useRef<number>(0);

  // ---------------------------------------------------------------------------
  // 从 realtime store 订阅 agentReasoning 状态
  // ---------------------------------------------------------------------------

  const reasoningStatus = useBlueprintRealtimeStore(
    (s) => s.agentReasoning.status
  );
  const reasoningEntries = useBlueprintRealtimeStore(
    (s) => s.agentReasoning.entries
  );

  // ---------------------------------------------------------------------------
  // RAF 调度：批量 flush 并分发给消费端
  // ---------------------------------------------------------------------------

  const flushAndDispatch = useCallback(() => {
    const buffer = bufferRef.current;
    const tokens = buffer.flush();

    if (tokens.length > 0) {
      // 分发给所有已注册的消费端
      subscribersRef.current.forEach((callback) => {
        try {
          callback(tokens);
        } catch {
          // 消费端回调异常不应阻断其他消费端
        }
      });
    }

    // 更新 bufferSize 状态
    setState((prev) => ({
      ...prev,
      bufferSize: buffer.size,
    }));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;

    rafRef.current = requestAnimationFrame((timestamp) => {
      rafRef.current = null;
      const elapsed = timestamp - lastFlushRef.current;

      if (elapsed >= bufferRef.current.flushIntervalMs) {
        lastFlushRef.current = timestamp;
        flushAndDispatch();
      }

      // 如果缓冲区仍有数据，继续调度
      if (bufferRef.current.size > 0) {
        scheduleFlush();
      }
    });
  }, [flushAndDispatch]);

  // ---------------------------------------------------------------------------
  // 监听 agentReasoning entries 变化，提取新 token 并入队
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const currentLen = reasoningEntries.length;
    const prevLen = lastEntriesLenRef.current;

    if (currentLen > prevLen) {
      // 有新的 entries 到达
      const newEntries = reasoningEntries.slice(prevLen);
      const now = Date.now();

      for (const entry of newEntries) {
        // 将 entry 的文本内容作为 token 推入缓冲区
        const tokenText =
          (entry as { content?: string }).content ||
          (entry as { message?: string }).message ||
          "";
        if (tokenText) {
          bufferRef.current.push(tokenText);
        }
      }

      // 更新状态
      setState((prev) => ({
        ...prev,
        isStreaming: true,
        isInterrupted: false,
        isReconnecting: false,
        tokenCount: prev.tokenCount + newEntries.length,
        lastTokenAt: now,
        bufferSize: bufferRef.current.size,
      }));

      // 记录流式开始时间
      if (streamStartRef.current === 0) {
        streamStartRef.current = now;
      }

      // 触发 RAF 调度
      scheduleFlush();
    }

    lastEntriesLenRef.current = currentLen;
  }, [reasoningEntries, scheduleFlush]);

  // ---------------------------------------------------------------------------
  // 监听 reasoning status 变化
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (reasoningStatus === "streaming") {
      setState((prev) => ({
        ...prev,
        isStreaming: true,
        isInterrupted: false,
        isReconnecting: false,
      }));
    } else if (
      reasoningStatus === "completed" ||
      reasoningStatus === "failed" ||
      reasoningStatus === "aborted"
    ) {
      setState((prev) => ({
        ...prev,
        isStreaming: false,
      }));
      // 流结束时 flush 剩余 token
      flushAndDispatch();
    }
  }, [reasoningStatus, flushAndDispatch]);

  // ---------------------------------------------------------------------------
  // 清理 RAF
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // subscribe：注册消费端
  // ---------------------------------------------------------------------------

  const subscribe = useCallback(
    (consumerId: string, callback: StreamTokenCallback): Unsubscribe => {
      subscribersRef.current.set(consumerId, callback);
      return () => {
        subscribersRef.current.delete(consumerId);
      };
    },
    []
  );

  // ---------------------------------------------------------------------------
  // getProgress：基于 token 计数的进度估算
  // ---------------------------------------------------------------------------

  const getProgress = useCallback((): number => {
    if (!state.isStreaming && state.tokenCount === 0) return 0;
    if (!state.isStreaming && state.tokenCount > 0) return MAX_PROGRESS;

    const progress = Math.min(
      (state.tokenCount / ESTIMATED_TOTAL_TOKENS) * MAX_PROGRESS,
      MAX_PROGRESS - 1 // 流式进行中不到 100%
    );
    return Math.round(progress);
  }, [state.isStreaming, state.tokenCount]);

  // ---------------------------------------------------------------------------
  // getInterruptionDuration：获取中断持续时长
  // ---------------------------------------------------------------------------

  const getInterruptionDuration = useCallback((): number => {
    if (!state.isInterrupted && !state.isReconnecting) return 0;
    if (state.lastTokenAt === 0) return 0;
    return Date.now() - state.lastTokenAt;
  }, [state.isInterrupted, state.isReconnecting, state.lastTokenAt]);

  // ---------------------------------------------------------------------------
  // 返回值
  // ---------------------------------------------------------------------------

  return {
    state,
    subscribe,
    getProgress,
    getInterruptionDuration,
  };
}
