/**
 * 共享 Token 注册表 — SharedTokenRegistry
 *
 * 纯 class 实现，不依赖 React。维护多个消费端的 token 数据共享引用，
 * 确保每次 RAF flush 只触发一次批量更新，避免多个消费端各自独立
 * 累积 token 导致的重复渲染。
 *
 * 核心职责：
 * - 维护 `Map<consumerId, ConsumerEntry>` 注册表
 * - `getOrCreate(consumerId)` 获取或创建消费端条目
 * - `appendToAll(tokens)` 将 token 追加到所有已注册消费端的 ref
 * - `getContent(consumerId)` 获取指定消费端的累积文本
 * - `reset(consumerId)` 重置指定消费端的累积文本
 * - `remove(consumerId)` 移除消费端注册
 *
 * 使用方式：
 * ```ts
 * const registry = new SharedTokenRegistry();
 * registry.getOrCreate("reasoning-timeline");
 * registry.getOrCreate("mirofish-card");
 * registry.appendToAll(["Hello", " ", "World"]);
 * registry.getContent("reasoning-timeline"); // "Hello World"
 * ```
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-lifecycle-weave/`
 * - 需求 4.3：多个消费端通过共享 ref 避免重复 re-render
 * - 需求 4.1：仅在 RAF flush 时触发一次批量更新
 */

// ---------------------------------------------------------------------------
// 消费端条目接口
// ---------------------------------------------------------------------------

/**
 * 单个消费端在注册表中的条目。
 */
export interface ConsumerEntry {
  /** 累积的 token 文本（共享 ref 语义，直接修改） */
  ref: string;
  /** 上一次 flush 的时间戳（ms） */
  lastFlush: number;
}

// ---------------------------------------------------------------------------
// SharedTokenRegistry 实现
// ---------------------------------------------------------------------------

/**
 * 共享 Token 注册表。
 *
 * 多个消费端通过同一个 registry 实例共享 token 数据，
 * 每次 RAF flush 时由协调层调用 `appendToAll` 一次性追加，
 * 消费端通过 `getContent` 读取最新累积文本，避免各自独立
 * 维护 state 导致的多次 re-render。
 */
export class SharedTokenRegistry {
  private consumers: Map<string, ConsumerEntry> = new Map();

  /**
   * 当前已注册的消费端数量。
   */
  get size(): number {
    return this.consumers.size;
  }

  /**
   * 获取或创建消费端条目。
   *
   * 若消费端已存在则直接返回，否则创建空条目。
   *
   * @param consumerId - 消费端唯一标识
   * @returns 消费端条目引用
   */
  getOrCreate(consumerId: string): ConsumerEntry {
    let entry = this.consumers.get(consumerId);
    if (!entry) {
      entry = { ref: "", lastFlush: 0 };
      this.consumers.set(consumerId, entry);
    }
    return entry;
  }

  /**
   * 将 token 追加到所有已注册消费端。
   *
   * 设计为在每次 RAF flush 时由协调层调用一次，
   * 确保所有消费端在同一帧内收到相同的 token 批次。
   *
   * @param tokens - 本次 flush 的 token 数组
   */
  appendToAll(tokens: string[]): void {
    if (tokens.length === 0) return;

    const joined = tokens.join("");
    const now = Date.now();

    this.consumers.forEach((entry) => {
      entry.ref += joined;
      entry.lastFlush = now;
    });
  }

  /**
   * 获取指定消费端的累积文本。
   *
   * @param consumerId - 消费端唯一标识
   * @returns 累积文本，若消费端不存在则返回空字符串
   */
  getContent(consumerId: string): string {
    const entry = this.consumers.get(consumerId);
    return entry ? entry.ref : "";
  }

  /**
   * 重置指定消费端的累积文本。
   *
   * 在阶段切换或流式结束时调用，清空已累积的 token。
   *
   * @param consumerId - 消费端唯一标识
   */
  reset(consumerId: string): void {
    const entry = this.consumers.get(consumerId);
    if (entry) {
      entry.ref = "";
      entry.lastFlush = 0;
    }
  }

  /**
   * 移除消费端注册。
   *
   * 在消费端组件卸载时调用。
   *
   * @param consumerId - 消费端唯一标识
   */
  remove(consumerId: string): void {
    this.consumers.delete(consumerId);
  }

  /**
   * 清空所有消费端注册。
   *
   * 在流式协调层销毁时调用。
   */
  clear(): void {
    this.consumers.clear();
  }
}
