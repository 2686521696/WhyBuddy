/**
 * 指令执行器测试 — 覆盖超时控制、成功清除计时器与连接断开清理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CommandExecutor,
  CommandRouter,
  CommandQueue,
  type ResultCallback,
} from "../scene-command/index.ts";
import {
  type SceneCommand,
  type SceneCommandResult,
  SCENE_ERROR_CODES,
  createCommand,
  createSuccessResult,
} from "../../shared/scene-command/index.ts";

// ─── 辅助函数 ───────────────────────────────────────────────────────

function makeCommand(id?: string): SceneCommand {
  return createCommand("character.moveTo", {
    characterId: "hero",
    x: 1,
    y: 2,
    z: 3,
  }, id ?? `req-${Math.random().toString(36).slice(2, 8)}`);
}

// ─── 测试套件 ───────────────────────────────────────────────────────

describe("CommandExecutor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════════════
  // 4.1 为每条指令绑定超时计时器
  // ═══════════════════════════════════════════════════════════════

  describe("超时计时器绑定", () => {
    it("提交指令后应跟踪为待处理状态", () => {
      const router = new CommandRouter();
      // 注册一个永不完成的处理器
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const executor = new CommandExecutor({ router, timeoutMs: 5000 });
      const cmd = makeCommand("req-1");

      executor.submit(cmd, "conn-1");

      expect(executor.getPendingCount()).toBe(1);
    });

    it("应使用自定义超时时间", () => {
      const router = new CommandRouter();
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const results: SceneCommandResult[] = [];
      const executor = new CommandExecutor({ router, timeoutMs: 3000 });
      executor.onResult((_connId, result) => results.push(result));

      executor.submit(makeCommand("req-1"), "conn-1");

      // 3 秒前不应超时
      vi.advanceTimersByTime(2999);
      expect(results).toHaveLength(0);

      // 3 秒时应超时
      vi.advanceTimersByTime(1);
      expect(results).toHaveLength(1);
      expect(results[0].error?.code).toBe(SCENE_ERROR_CODES.TIMEOUT);
    });

    it("应使用默认 10 秒超时", () => {
      const router = new CommandRouter();
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const results: SceneCommandResult[] = [];
      const executor = new CommandExecutor({ router });
      executor.onResult((_connId, result) => results.push(result));

      executor.submit(makeCommand("req-1"), "conn-1");

      vi.advanceTimersByTime(9999);
      expect(results).toHaveLength(0);

      vi.advanceTimersByTime(1);
      expect(results).toHaveLength(1);
      expect(results[0].error?.code).toBe(SCENE_ERROR_CODES.TIMEOUT);
    });

    it("应为多条指令分别绑定独立计时器", () => {
      const router = new CommandRouter();
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const results: SceneCommandResult[] = [];
      const executor = new CommandExecutor({ router, timeoutMs: 5000 });
      executor.onResult((_connId, result) => results.push(result));

      executor.submit(makeCommand("req-1"), "conn-1");

      // 2 秒后提交第二条
      vi.advanceTimersByTime(2000);
      executor.submit(makeCommand("req-2"), "conn-1");

      // 再过 3 秒，第一条超时（总共 5 秒），第二条还没超时
      vi.advanceTimersByTime(3000);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("req-1");

      // 再过 2 秒，第二条也超时
      vi.advanceTimersByTime(2000);
      expect(results).toHaveLength(2);
      expect(results[1].id).toBe("req-2");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 4.2 超时后自动取消并返回错误响应
  // ═══════════════════════════════════════════════════════════════

  describe("超时自动取消", () => {
    it("超时应返回 TIMEOUT 错误码", () => {
      const router = new CommandRouter();
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const results: Array<{ connId: string; result: SceneCommandResult }> = [];
      const executor = new CommandExecutor({ router, timeoutMs: 5000 });
      executor.onResult((connId, result) => results.push({ connId, result }));

      executor.submit(makeCommand("req-1"), "conn-1");

      vi.advanceTimersByTime(5000);

      expect(results).toHaveLength(1);
      expect(results[0].connId).toBe("conn-1");
      expect(results[0].result.id).toBe("req-1");
      expect(results[0].result.error?.code).toBe(SCENE_ERROR_CODES.TIMEOUT);
      expect(results[0].result.error?.message).toContain("timed out");
      expect(results[0].result.error?.retryable).toBe(true);
    });

    it("超时后应从待处理列表移除", () => {
      const router = new CommandRouter();
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const executor = new CommandExecutor({ router, timeoutMs: 5000 });
      executor.onResult(() => {});

      executor.submit(makeCommand("req-1"), "conn-1");
      expect(executor.getPendingCount()).toBe(1);

      vi.advanceTimersByTime(5000);
      expect(executor.getPendingCount()).toBe(0);
    });

    it("成功完成的指令应清除超时计时器", async () => {
      const router = new CommandRouter();
      router.register("character.moveTo", (cmd) =>
        createSuccessResult(cmd.id, { success: true, duration: 100 }),
      );

      const results: SceneCommandResult[] = [];
      const executor = new CommandExecutor({ router, timeoutMs: 5000 });
      executor.onResult((_connId, result) => results.push(result));

      executor.submit(makeCommand("req-1"), "conn-1");

      // 让微任务执行（路由器同步返回结果）
      await vi.advanceTimersByTimeAsync(0);

      // 应收到成功结果
      expect(results).toHaveLength(1);
      expect(results[0].result?.success).toBe(true);
      expect(results[0].id).toBe("req-1");
      expect(executor.getPendingCount()).toBe(0);

      // 超时后不应再收到额外结果
      vi.advanceTimersByTime(5000);
      expect(results).toHaveLength(1);
    });

    it("队列满时应立即返回 QUEUE_FULL 错误", () => {
      // 使用一个不注册处理器的路由器，这样 dequeue 后 dispatch 会返回 METHOD_NOT_FOUND
      // 但关键是队列容量为 1，且第一条入队后立即出队执行
      // 所以我们需要用容量为 0 的队列来测试 QUEUE_FULL
      const queue = new CommandQueue(0);
      const router = new CommandRouter();

      const results: SceneCommandResult[] = [];
      const executor = new CommandExecutor({ queue, router, timeoutMs: 5000 });
      executor.onResult((_connId, result) => results.push(result));

      // 队列容量为 0，任何指令都会被拒绝
      executor.submit(makeCommand("req-1"), "conn-1");
      expect(results).toHaveLength(1);
      expect(results[0].error?.code).toBe(SCENE_ERROR_CODES.QUEUE_FULL);
      expect(results[0].id).toBe("req-1");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 4.3 连接断开时的队列清理与通知
  // ═══════════════════════════════════════════════════════════════

  describe("连接断开清理", () => {
    it("断开连接应取消该连接的所有待处理指令", () => {
      const router = new CommandRouter();
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const results: Array<{ connId: string; result: SceneCommandResult }> = [];
      const executor = new CommandExecutor({ router, timeoutMs: 10000 });
      executor.onResult((connId, result) => results.push({ connId, result }));

      executor.submit(makeCommand("req-1"), "conn-1");
      executor.submit(makeCommand("req-2"), "conn-1");
      expect(executor.getPendingCount()).toBe(2);

      executor.handleDisconnect("conn-1");

      // 应收到两条 NOT_CONNECTED 错误
      expect(results).toHaveLength(2);
      expect(results[0].result.error?.code).toBe(SCENE_ERROR_CODES.NOT_CONNECTED);
      expect(results[0].result.error?.message).toContain("disconnected");
      expect(results[0].connId).toBe("conn-1");
      expect(results[1].result.error?.code).toBe(SCENE_ERROR_CODES.NOT_CONNECTED);
      expect(results[1].connId).toBe("conn-1");

      // 待处理列表应清空
      expect(executor.getPendingCount()).toBe(0);
    });

    it("断开连接不应影响其他连接的指令", () => {
      const router = new CommandRouter();
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const results: Array<{ connId: string; result: SceneCommandResult }> = [];
      const executor = new CommandExecutor({ router, timeoutMs: 10000 });
      executor.onResult((connId, result) => results.push({ connId, result }));

      executor.submit(makeCommand("req-1"), "conn-1");
      executor.submit(makeCommand("req-2"), "conn-2");
      expect(executor.getPendingCount()).toBe(2);

      executor.handleDisconnect("conn-1");

      // 只有 conn-1 的指令被取消
      expect(results).toHaveLength(1);
      expect(results[0].result.id).toBe("req-1");
      expect(results[0].result.error?.code).toBe(SCENE_ERROR_CODES.NOT_CONNECTED);

      // conn-2 的指令仍在待处理
      expect(executor.getPendingCount()).toBe(1);
    });

    it("断开连接后超时计时器不应再触发", () => {
      const router = new CommandRouter();
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const results: Array<{ connId: string; result: SceneCommandResult }> = [];
      const executor = new CommandExecutor({ router, timeoutMs: 5000 });
      executor.onResult((connId, result) => results.push({ connId, result }));

      executor.submit(makeCommand("req-1"), "conn-1");

      // 断开连接
      executor.handleDisconnect("conn-1");
      expect(results).toHaveLength(1);
      expect(results[0].result.error?.code).toBe(SCENE_ERROR_CODES.NOT_CONNECTED);

      // 超时后不应再收到额外通知
      vi.advanceTimersByTime(5000);
      expect(results).toHaveLength(1);
    });

    it("断开不存在的连接不应报错", () => {
      const executor = new CommandExecutor({ timeoutMs: 5000 });
      // 不应抛出异常
      expect(() => executor.handleDisconnect("nonexistent")).not.toThrow();
    });

    it("每条被取消的指令都应返回 NOT_CONNECTED 并携带正确的 requestId", () => {
      const router = new CommandRouter();
      router.register("character.moveTo", () =>
        new Promise(() => {}),
      );

      const results: SceneCommandResult[] = [];
      const executor = new CommandExecutor({ router, timeoutMs: 10000 });
      executor.onResult((_connId, result) => results.push(result));

      executor.submit(makeCommand("req-a"), "conn-1");
      executor.submit(makeCommand("req-b"), "conn-1");
      executor.submit(makeCommand("req-c"), "conn-1");

      executor.handleDisconnect("conn-1");

      expect(results).toHaveLength(3);
      const ids = results.map((r) => r.id).sort();
      expect(ids).toEqual(["req-a", "req-b", "req-c"]);

      for (const result of results) {
        expect(result.error?.code).toBe(SCENE_ERROR_CODES.NOT_CONNECTED);
        expect(result.error?.retryable).toBe(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 集成场景
  // ═══════════════════════════════════════════════════════════════

  describe("集成场景", () => {
    it("应暴露路由器和队列实例", () => {
      const executor = new CommandExecutor();
      expect(executor.getRouter()).toBeInstanceOf(CommandRouter);
      expect(executor.getQueue()).toBeInstanceOf(CommandQueue);
    });

    it("混合场景：部分成功、部分超时、部分断开", async () => {
      const router = new CommandRouter();

      // 第一条指令立即成功
      let callCount = 0;
      router.register("character.moveTo", (cmd) => {
        callCount++;
        if (callCount === 1) {
          return createSuccessResult(cmd.id, { success: true });
        }
        // 后续指令永不完成
        return new Promise(() => {});
      });

      const results: Array<{ connId: string; result: SceneCommandResult }> = [];
      const executor = new CommandExecutor({ router, timeoutMs: 5000 });
      executor.onResult((connId, result) => results.push({ connId, result }));

      // 提交 3 条指令
      executor.submit(makeCommand("req-success"), "conn-1");
      executor.submit(makeCommand("req-timeout"), "conn-1");
      executor.submit(makeCommand("req-disconnect"), "conn-2");

      // 让第一条指令完成
      await vi.advanceTimersByTimeAsync(0);

      // 第一条应成功
      expect(results.some((r) => r.result.id === "req-success" && r.result.result?.success)).toBe(true);

      // 断开 conn-2
      executor.handleDisconnect("conn-2");
      expect(results.some((r) => r.result.id === "req-disconnect" && r.result.error?.code === SCENE_ERROR_CODES.NOT_CONNECTED)).toBe(true);

      // 等待超时
      vi.advanceTimersByTime(5000);
      expect(results.some((r) => r.result.id === "req-timeout" && r.result.error?.code === SCENE_ERROR_CODES.TIMEOUT)).toBe(true);
    });
  });
});
