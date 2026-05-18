/**
 * 流式 Token 缓冲队列
 *
 * 纯 class 实现，不依赖 React。负责高频 token 的缓冲与批量合并分发。
 *
 * 核心行为：
 * - `push(token)` 将 token 入队；若队列超过 `maxBufferSize` 则丢弃最旧 token
 * - `flush()` 取出最多 `maxBatchSize` 个 token 并清空已取出部分
 * - `clear()` 清空整个缓冲区
 * - `size` 返回当前缓冲区中的 token 数量
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-lifecycle-weave/`
 * - 需求 4.1：token 到达频率超过 60/s 时批量合并更新
 * - 需求 4.2：缓冲区溢出时丢弃最旧 token
 */

import type { StreamTokenBufferConfig } from "./types";

/** 默认缓冲配置 */
const DEFAULT_CONFIG: StreamTokenBufferConfig = {
  maxBatchSize: 10,
  flushIntervalMs: 16,
  maxBufferSize: 100,
};

/**
 * 流式 Token 缓冲队列。
 *
 * 设计为纯数据结构，不包含定时器或 RAF 调度逻辑。
 * 调度由外层 `useStreamingWeave` hook 通过 requestAnimationFrame 驱动。
 */
export class StreamTokenBuffer {
  private queue: string[] = [];
  private readonly config: StreamTokenBufferConfig;

  constructor(config?: Partial<StreamTokenBufferConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 当前缓冲区中的 token 数量。
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * 获取 flush 间隔配置（ms）。
   *
   * 供外层调度器读取以决定 RAF 节流频率。
   */
  get flushIntervalMs(): number {
    return this.config.flushIntervalMs;
  }

  /**
   * 获取最大批量大小配置。
   */
  get maxBatchSize(): number {
    return this.config.maxBatchSize;
  }

  /**
   * 将 token 推入缓冲区。
   *
   * 若缓冲区已满（达到 `maxBufferSize`），则丢弃最旧的 token 以腾出空间。
   *
   * @param token - 待缓冲的 token 字符串
   */
  push(token: string): void {
    if (this.queue.length >= this.config.maxBufferSize) {
      // 丢弃最旧 token（队首）
      this.queue.shift();
    }
    this.queue.push(token);
  }

  /**
   * 从缓冲区取出一批 token。
   *
   * 最多取出 `maxBatchSize` 个 token，取出后从缓冲区移除。
   * 若缓冲区为空则返回空数组。
   *
   * @returns 本次 flush 取出的 token 数组
   */
  flush(): string[] {
    if (this.queue.length === 0) {
      return [];
    }
    const batch = this.queue.splice(0, this.config.maxBatchSize);
    return batch;
  }

  /**
   * 清空整个缓冲区。
   *
   * 用于流中断恢复或组件卸载时的清理。
   */
  clear(): void {
    this.queue = [];
  }
}
