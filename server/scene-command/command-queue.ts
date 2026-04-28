/**
 * 指令队列 — 基于优先级的指令排队与调度
 *
 * 使用排序数组实现优先级队列：
 * - 高优先级数字 = 高优先级（先执行）
 * - 同优先级 = FIFO 顺序（按入队序号）
 * - 支持容量限制与溢出拒绝（QUEUE_FULL）
 *
 * 队列是独立数据结构，不绑定 WebSocket 或传输层。
 */
import type { SceneCommand } from "../../shared/scene-command/index.ts";

// ─── 队列条目 ──────────────────────────────────────────────────────

/** 队列中的单条指令条目 */
export interface QueueEntry {
  /** 指令本体 */
  command: SceneCommand;
  /** 优先级，数字越大越优先 */
  priority: number;
  /** 入队序号，用于同优先级 FIFO 排序 */
  sequence: number;
  /** 入队时间戳 */
  enqueuedAt: number;
}

// ─── 入队结果类型 ───────────────────────────────────────────────────

/** 入队成功 */
export interface EnqueueSuccess {
  success: true;
  requestId: string;
}

/** 入队失败（队列已满） */
export interface EnqueueFailure {
  success: false;
  code: "QUEUE_FULL";
}

/** 入队结果联合类型 */
export type EnqueueResult = EnqueueSuccess | EnqueueFailure;

// ─── 默认配置 ───────────────────────────────────────────────────────

/** 默认队列最大容量 */
const DEFAULT_MAX_SIZE = 100;

/** 默认优先级 */
const DEFAULT_PRIORITY = 0;

// ─── 指令队列实现 ───────────────────────────────────────────────────

export class CommandQueue {
  /** 内部存储，按优先级降序 + 序号升序排列 */
  private entries: QueueEntry[] = [];
  /** 自增序号，保证同优先级 FIFO */
  private sequenceCounter = 0;
  /** 队列最大容量 */
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  // ─── 入队 ─────────────────────────────────────────────────────

  /**
   * 将指令加入队列
   * @param command 场景指令
   * @param priority 优先级，默认 0，数字越大越优先
   * @returns 入队结果：成功返回 requestId，队列满时返回 QUEUE_FULL
   */
  enqueue(command: SceneCommand, priority: number = DEFAULT_PRIORITY): EnqueueResult {
    if (this.entries.length >= this.maxSize) {
      return { success: false, code: "QUEUE_FULL" };
    }

    const entry: QueueEntry = {
      command,
      priority,
      sequence: this.sequenceCounter++,
      enqueuedAt: Date.now(),
    };

    // 使用二分查找找到插入位置，保持排序
    const insertIndex = this.findInsertIndex(entry);
    this.entries.splice(insertIndex, 0, entry);

    return { success: true, requestId: command.id };
  }

  // ─── 出队 ─────────────────────────────────────────────────────

  /**
   * 移除并返回最高优先级的指令
   * @returns 最高优先级指令，队列为空时返回 null
   */
  dequeue(): SceneCommand | null {
    if (this.entries.length === 0) {
      return null;
    }
    // 队首即为最高优先级（优先级降序，同优先级序号升序）
    const entry = this.entries.shift()!;
    return entry.command;
  }

  // ─── 查看队首 ─────────────────────────────────────────────────

  /**
   * 查看队首指令但不移除
   * @returns 最高优先级指令，队列为空时返回 null
   */
  peek(): SceneCommand | null {
    if (this.entries.length === 0) {
      return null;
    }
    return this.entries[0].command;
  }

  // ─── 取消 ─────────────────────────────────────────────────────

  /**
   * 按 requestId 取消队列中的指令
   * @param requestId 指令的唯一标识
   * @returns 是否成功取消
   */
  cancel(requestId: string): boolean {
    const index = this.entries.findIndex((e) => e.command.id === requestId);
    if (index === -1) {
      return false;
    }
    this.entries.splice(index, 1);
    return true;
  }

  // ─── 清空 ─────────────────────────────────────────────────────

  /** 清空队列中所有指令 */
  clear(): void {
    this.entries = [];
  }

  // ─── 查询 ─────────────────────────────────────────────────────

  /** 返回当前队列中的指令数量 */
  size(): number {
    return this.entries.length;
  }

  /** 返回队列是否已满 */
  isFull(): boolean {
    return this.entries.length >= this.maxSize;
  }

  /** 返回队列最大容量 */
  getMaxSize(): number {
    return this.maxSize;
  }

  // ─── 内部方法 ─────────────────────────────────────────────────

  /**
   * 二分查找插入位置
   * 排序规则：优先级降序，同优先级按序号升序（FIFO）
   */
  private findInsertIndex(newEntry: QueueEntry): number {
    let low = 0;
    let high = this.entries.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const existing = this.entries[mid];

      // 高优先级在前
      if (existing.priority > newEntry.priority) {
        low = mid + 1;
      } else if (existing.priority < newEntry.priority) {
        high = mid;
      } else {
        // 同优先级：序号小的在前（FIFO）
        if (existing.sequence <= newEntry.sequence) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }
    }

    return low;
  }
}
