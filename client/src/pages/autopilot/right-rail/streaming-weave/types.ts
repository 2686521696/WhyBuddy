/**
 * 流式输出贯穿全生命周期 — 类型契约
 *
 * 本文件是纯类型模块，定义 streaming-weave 协调层所需的全部接口与配置类型。
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-lifecycle-weave/`
 * - 需求 1.1：跨阶段流式进度展示
 * - 需求 2.1-2.4：多组件流式协调
 * - 需求 3.1-3.4：流中断与恢复
 * - 需求 4.1-4.3：流式性能优化
 */

// ---------------------------------------------------------------------------
// 流式协调层状态
// ---------------------------------------------------------------------------

/**
 * 流式协调层的核心状态。
 *
 * 由 `useStreamingWeave` hook 维护，描述当前流式输出的全局状态。
 */
export interface StreamingWeaveState {
  /** 是否正在接收流式 token */
  isStreaming: boolean;
  /** 是否处于中断状态（500ms 无 token） */
  isInterrupted: boolean;
  /** 是否处于重连状态（10s 无 token） */
  isReconnecting: boolean;
  /** 当前所处阶段索引（0-based） */
  currentStageIndex: number;
  /** 已接收的 token 总数 */
  tokenCount: number;
  /** 最后一次收到 token 的时间戳（ms） */
  lastTokenAt: number;
  /** 当前缓冲区中待分发的 token 数量 */
  bufferSize: number;
}

// ---------------------------------------------------------------------------
// Token 缓冲配置
// ---------------------------------------------------------------------------

/**
 * Token 缓冲队列配置。
 *
 * 控制批量合并策略与溢出行为。
 */
export interface StreamTokenBufferConfig {
  /** 每次 flush 的最大 token 数量，默认 10 */
  maxBatchSize: number;
  /** flush 间隔（ms），默认 16（约 1 帧） */
  flushIntervalMs: number;
  /** 缓冲区最大容量，超出时丢弃最旧 token，默认 100 */
  maxBufferSize: number;
}

// ---------------------------------------------------------------------------
// 中断检测配置
// ---------------------------------------------------------------------------

/**
 * 流中断检测配置。
 *
 * 控制中断判定阈值与重连策略。
 */
export interface InterruptionConfig {
  /** 中断警告阈值（ms），超过此时间无 token 则标记为中断，默认 500 */
  warningThresholdMs: number;
  /** 重连阈值（ms），超过此时间无 token 则标记为重连中，默认 10000 */
  reconnectThresholdMs: number;
  /** 最大重试次数，默认 3 */
  maxRetries: number;
}

// ---------------------------------------------------------------------------
// 消费端订阅回调
// ---------------------------------------------------------------------------

/**
 * 流式 token 消费端的订阅回调类型。
 *
 * 每次 RAF flush 时，协调层会将批量合并后的 token 数组分发给所有已注册的消费端。
 */
export type StreamTokenCallback = (tokens: string[]) => void;

/**
 * 取消订阅函数类型。
 *
 * 调用后移除对应消费端的订阅。
 */
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// useStreamingWeave 返回值
// ---------------------------------------------------------------------------

/**
 * `useStreamingWeave` hook 的返回值接口。
 *
 * 提供流式状态、订阅机制、进度查询与中断时长查询。
 */
export interface UseStreamingWeaveReturn {
  /** 当前流式协调层状态 */
  state: StreamingWeaveState;
  /**
   * 订阅流式 token 分发。
   *
   * @param consumerId - 消费端唯一标识（如 "mirofish-card"、"reasoning-timeline"）
   * @param callback - 每次 flush 时接收批量 token 的回调
   * @returns 取消订阅函数
   */
  subscribe: (consumerId: string, callback: StreamTokenCallback) => Unsubscribe;
  /**
   * 获取当前流式进度（0-100）。
   *
   * 基于 token 计数的估算值。
   */
  getProgress: () => number;
  /**
   * 获取当前中断持续时长（ms）。
   *
   * 未中断时返回 0。
   */
  getInterruptionDuration: () => number;
}
