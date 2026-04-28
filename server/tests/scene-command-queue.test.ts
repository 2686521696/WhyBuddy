/**
 * 指令队列测试 — 单元测试 + 属性测试
 *
 * 覆盖：
 * - 基本入队、出队、取消、清空操作
 * - 优先级排序与 FIFO 保证
 * - 容量限制与溢出拒绝
 * - 属性测试：随机操作序列下的不变量
 */
import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import {
  CommandQueue,
  type EnqueueResult,
} from "../scene-command/command-queue.ts";
import { createCommand } from "../../shared/scene-command/index.ts";
import type { SceneCommand } from "../../shared/scene-command/index.ts";

// ─── 辅助函数 ───────────────────────────────────────────────────────

/** 创建一条测试用指令 */
function makeCommand(id?: string): SceneCommand {
  return createCommand("character.moveTo", { characterId: "c1", x: 0, y: 0, z: 0 }, id);
}

// ─── 单元测试 ───────────────────────────────────────────────────────

describe("CommandQueue", () => {
  let queue: CommandQueue;

  beforeEach(() => {
    queue = new CommandQueue();
  });

  // ─── 基本操作 ─────────────────────────────────────────────────

  describe("basic operations", () => {
    it("starts empty", () => {
      expect(queue.size()).toBe(0);
      expect(queue.peek()).toBeNull();
      expect(queue.dequeue()).toBeNull();
    });

    it("enqueues and dequeues a single command", () => {
      const cmd = makeCommand("cmd-1");
      const result = queue.enqueue(cmd);

      expect(result).toEqual({ success: true, requestId: "cmd-1" });
      expect(queue.size()).toBe(1);
      expect(queue.peek()).toEqual(cmd);

      const dequeued = queue.dequeue();
      expect(dequeued).toEqual(cmd);
      expect(queue.size()).toBe(0);
    });

    it("enqueues multiple commands in FIFO order (same priority)", () => {
      const cmd1 = makeCommand("cmd-1");
      const cmd2 = makeCommand("cmd-2");
      const cmd3 = makeCommand("cmd-3");

      queue.enqueue(cmd1);
      queue.enqueue(cmd2);
      queue.enqueue(cmd3);

      expect(queue.size()).toBe(3);
      expect(queue.dequeue()!.id).toBe("cmd-1");
      expect(queue.dequeue()!.id).toBe("cmd-2");
      expect(queue.dequeue()!.id).toBe("cmd-3");
    });

    it("peek does not remove the command", () => {
      const cmd = makeCommand("cmd-1");
      queue.enqueue(cmd);

      expect(queue.peek()).toEqual(cmd);
      expect(queue.peek()).toEqual(cmd);
      expect(queue.size()).toBe(1);
    });

    it("uses default priority of 0", () => {
      const cmd = makeCommand("cmd-1");
      const result = queue.enqueue(cmd);
      expect(result.success).toBe(true);
      // Dequeues normally
      expect(queue.dequeue()!.id).toBe("cmd-1");
    });
  });

  // ─── 优先级排序 ───────────────────────────────────────────────

  describe("priority ordering", () => {
    it("higher priority commands dequeue first", () => {
      const low = makeCommand("low");
      const high = makeCommand("high");

      queue.enqueue(low, 0);
      queue.enqueue(high, 10);

      expect(queue.dequeue()!.id).toBe("high");
      expect(queue.dequeue()!.id).toBe("low");
    });

    it("same priority maintains FIFO order", () => {
      const a = makeCommand("a");
      const b = makeCommand("b");
      const c = makeCommand("c");

      queue.enqueue(a, 5);
      queue.enqueue(b, 5);
      queue.enqueue(c, 5);

      expect(queue.dequeue()!.id).toBe("a");
      expect(queue.dequeue()!.id).toBe("b");
      expect(queue.dequeue()!.id).toBe("c");
    });

    it("mixed priorities sort correctly", () => {
      queue.enqueue(makeCommand("low-1"), 1);
      queue.enqueue(makeCommand("high-1"), 10);
      queue.enqueue(makeCommand("mid-1"), 5);
      queue.enqueue(makeCommand("high-2"), 10);
      queue.enqueue(makeCommand("low-2"), 1);

      expect(queue.dequeue()!.id).toBe("high-1");
      expect(queue.dequeue()!.id).toBe("high-2");
      expect(queue.dequeue()!.id).toBe("mid-1");
      expect(queue.dequeue()!.id).toBe("low-1");
      expect(queue.dequeue()!.id).toBe("low-2");
    });
  });

  // ─── 取消操作 ─────────────────────────────────────────────────

  describe("cancel", () => {
    it("cancels an existing command", () => {
      queue.enqueue(makeCommand("cmd-1"));
      queue.enqueue(makeCommand("cmd-2"));
      queue.enqueue(makeCommand("cmd-3"));

      const cancelled = queue.cancel("cmd-2");
      expect(cancelled).toBe(true);
      expect(queue.size()).toBe(2);

      expect(queue.dequeue()!.id).toBe("cmd-1");
      expect(queue.dequeue()!.id).toBe("cmd-3");
    });

    it("returns false for non-existent command", () => {
      queue.enqueue(makeCommand("cmd-1"));
      expect(queue.cancel("non-existent")).toBe(false);
      expect(queue.size()).toBe(1);
    });

    it("returns false on empty queue", () => {
      expect(queue.cancel("any")).toBe(false);
    });
  });

  // ─── 清空操作 ─────────────────────────────────────────────────

  describe("clear", () => {
    it("removes all commands", () => {
      queue.enqueue(makeCommand("cmd-1"));
      queue.enqueue(makeCommand("cmd-2"));
      queue.enqueue(makeCommand("cmd-3"));

      queue.clear();
      expect(queue.size()).toBe(0);
      expect(queue.peek()).toBeNull();
      expect(queue.dequeue()).toBeNull();
    });

    it("is safe to call on empty queue", () => {
      queue.clear();
      expect(queue.size()).toBe(0);
    });
  });

  // ─── 容量限制 ─────────────────────────────────────────────────

  describe("capacity limit", () => {
    it("defaults to maxSize of 100", () => {
      expect(queue.getMaxSize()).toBe(100);
    });

    it("respects custom maxSize", () => {
      const small = new CommandQueue(3);
      expect(small.getMaxSize()).toBe(3);
    });

    it("rejects enqueue when full", () => {
      const small = new CommandQueue(2);
      expect(small.enqueue(makeCommand("cmd-1")).success).toBe(true);
      expect(small.enqueue(makeCommand("cmd-2")).success).toBe(true);

      const result = small.enqueue(makeCommand("cmd-3"));
      expect(result).toEqual({ success: false, code: "QUEUE_FULL" });
      expect(small.size()).toBe(2);
    });

    it("allows enqueue after dequeue frees space", () => {
      const small = new CommandQueue(2);
      small.enqueue(makeCommand("cmd-1"));
      small.enqueue(makeCommand("cmd-2"));

      small.dequeue();
      const result = small.enqueue(makeCommand("cmd-3"));
      expect(result.success).toBe(true);
      expect(small.size()).toBe(2);
    });

    it("allows enqueue after cancel frees space", () => {
      const small = new CommandQueue(2);
      small.enqueue(makeCommand("cmd-1"));
      small.enqueue(makeCommand("cmd-2"));

      small.cancel("cmd-1");
      const result = small.enqueue(makeCommand("cmd-3"));
      expect(result.success).toBe(true);
      expect(small.size()).toBe(2);
    });

    it("isFull returns correct state", () => {
      const small = new CommandQueue(2);
      expect(small.isFull()).toBe(false);

      small.enqueue(makeCommand("cmd-1"));
      expect(small.isFull()).toBe(false);

      small.enqueue(makeCommand("cmd-2"));
      expect(small.isFull()).toBe(true);

      small.dequeue();
      expect(small.isFull()).toBe(false);
    });
  });


  // ─── 属性测试 ─────────────────────────────────────────────────

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * 属性：同优先级指令的出队顺序与入队顺序一致（FIFO）
   */
  describe("property: same-priority FIFO ordering", () => {
    it("dequeues same-priority commands in insertion order", () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 50 }),
          (ids) => {
            const q = new CommandQueue(ids.length + 10);
            const uniqueIds = [...new Set(ids)];

            for (const id of uniqueIds) {
              q.enqueue(makeCommand(id), 5);
            }

            const dequeued: string[] = [];
            let cmd = q.dequeue();
            while (cmd !== null) {
              dequeued.push(cmd.id);
              cmd = q.dequeue();
            }

            expect(dequeued).toEqual(uniqueIds);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * 属性：高优先级指令总是在低优先级指令之前出队
   */
  describe("property: higher priority dequeues first", () => {
    it("commands with higher priority always come before lower priority", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.uuid(),
              priority: fc.integer({ min: 0, max: 100 }),
            }),
            { minLength: 1, maxLength: 50 },
          ),
          (items) => {
            const q = new CommandQueue(items.length + 10);

            for (const item of items) {
              q.enqueue(makeCommand(item.id), item.priority);
            }

            const dequeuedPriorities: number[] = [];
            // We need to track priorities, so we rebuild from items
            const priorityMap = new Map(items.map((i) => [i.id, i.priority]));

            let cmd = q.dequeue();
            while (cmd !== null) {
              dequeuedPriorities.push(priorityMap.get(cmd.id)!);
              cmd = q.dequeue();
            }

            // Verify: priorities are non-increasing
            for (let i = 1; i < dequeuedPriorities.length; i++) {
              expect(dequeuedPriorities[i]).toBeLessThanOrEqual(
                dequeuedPriorities[i - 1],
              );
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * 属性：任意操作序列后，size() 始终准确
   */
  describe("property: queue size is always accurate", () => {
    it("size matches expected count after any sequence of operations", () => {
      // Arbitrary for queue operations
      const enqueueOp = fc.record({
        type: fc.constant("enqueue" as const),
        id: fc.uuid(),
        priority: fc.integer({ min: 0, max: 10 }),
      });
      const dequeueOp = fc.record({
        type: fc.constant("dequeue" as const),
      });
      const cancelOp = fc.record({
        type: fc.constant("cancel" as const),
        id: fc.uuid(),
      });
      const clearOp = fc.record({
        type: fc.constant("clear" as const),
      });

      const operation = fc.oneof(enqueueOp, dequeueOp, cancelOp, clearOp);

      fc.assert(
        fc.property(
          fc.array(operation, { minLength: 0, maxLength: 80 }),
          (ops) => {
            const maxSize = 50;
            const q = new CommandQueue(maxSize);
            let expectedSize = 0;
            const enqueuedIds = new Set<string>();

            for (const op of ops) {
              switch (op.type) {
                case "enqueue": {
                  const result = q.enqueue(makeCommand(op.id), op.priority);
                  if (result.success) {
                    expectedSize++;
                    enqueuedIds.add(op.id);
                  }
                  break;
                }
                case "dequeue": {
                  const cmd = q.dequeue();
                  if (cmd !== null) {
                    expectedSize--;
                    enqueuedIds.delete(cmd.id);
                  }
                  break;
                }
                case "cancel": {
                  if (q.cancel(op.id)) {
                    expectedSize--;
                    enqueuedIds.delete(op.id);
                  }
                  break;
                }
                case "clear": {
                  expectedSize = 0;
                  enqueuedIds.clear();
                  q.clear();
                  break;
                }
              }
            }

            expect(q.size()).toBe(expectedSize);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * 属性：cancel 只移除目标指令，不影响其他指令
   */
  describe("property: cancel removes exactly the targeted command", () => {
    it("only the cancelled command is missing from dequeue results", () => {
      fc.assert(
        fc.property(
          fc.array(fc.uuid(), { minLength: 2, maxLength: 30 }),
          fc.nat(),
          (ids, cancelIndexSeed) => {
            const uniqueIds = [...new Set(ids)];
            if (uniqueIds.length < 2) return; // need at least 2

            const q = new CommandQueue(uniqueIds.length + 10);
            for (const id of uniqueIds) {
              q.enqueue(makeCommand(id), 0);
            }

            // Pick one to cancel
            const cancelIndex = cancelIndexSeed % uniqueIds.length;
            const cancelledId = uniqueIds[cancelIndex];
            const cancelled = q.cancel(cancelledId);
            expect(cancelled).toBe(true);

            // Dequeue all remaining
            const remaining: string[] = [];
            let cmd = q.dequeue();
            while (cmd !== null) {
              remaining.push(cmd.id);
              cmd = q.dequeue();
            }

            // The cancelled ID should not appear
            expect(remaining).not.toContain(cancelledId);
            // All other IDs should appear in order
            const expected = uniqueIds.filter((id) => id !== cancelledId);
            expect(remaining).toEqual(expected);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * 属性：队列大小永远不超过 maxSize
   */
  describe("property: queue never exceeds maxSize", () => {
    it("size is always <= maxSize regardless of operations", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.array(
            fc.oneof(
              fc.record({
                type: fc.constant("enqueue" as const),
                id: fc.uuid(),
                priority: fc.integer({ min: 0, max: 10 }),
              }),
              fc.record({ type: fc.constant("dequeue" as const) }),
            ),
            { minLength: 1, maxLength: 100 },
          ),
          (maxSize, ops) => {
            const q = new CommandQueue(maxSize);

            for (const op of ops) {
              if (op.type === "enqueue") {
                q.enqueue(makeCommand(op.id), op.priority);
              } else {
                q.dequeue();
              }
              // Invariant: size never exceeds maxSize
              expect(q.size()).toBeLessThanOrEqual(maxSize);
              expect(q.size()).toBeGreaterThanOrEqual(0);
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
