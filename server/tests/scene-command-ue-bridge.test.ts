/**
 * UE 侧指令执行桥测试 — 覆盖连接管理、指令执行映射与结果回传
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  UEBridge,
  CommandRouter,
  createEchoHandler,
  createDefaultHandlerMap,
} from "../scene-command/index.ts";
import {
  type SceneCommand,
  type SceneCommandResult,
  SCENE_COMMAND_METHODS,
  SCENE_ERROR_CODES,
  createCommand,
  createSuccessResult,
  createErrorResult,
} from "../../shared/scene-command/index.ts";

// ─── 辅助函数 ───────────────────────────────────────────────────────

function makeCommand(
  method: string = "character.moveTo",
  id?: string,
): SceneCommand {
  return createCommand(
    method,
    { characterId: "hero", x: 1, y: 2, z: 3 },
    id ?? `req-${Math.random().toString(36).slice(2, 8)}`,
  );
}

// ─── 测试套件 ───────────────────────────────────────────────────────

describe("UEBridge", () => {
  // ═══════════════════════════════════════════════════════════════
  // 5.1 WebSocket 客户端连接（桥连接管理）
  // ═══════════════════════════════════════════════════════════════

  describe("连接管理", () => {
    it("初始状态应为 disconnected", () => {
      const bridge = new UEBridge();
      expect(bridge.getConnectionState()).toBe("disconnected");
    });

    it("connect 后状态应变为 connected", () => {
      const bridge = new UEBridge();
      const router = new CommandRouter();

      bridge.connect(router);

      expect(bridge.getConnectionState()).toBe("connected");
    });

    it("disconnect 后状态应变为 disconnected", () => {
      const bridge = new UEBridge();
      const router = new CommandRouter();

      bridge.connect(router);
      bridge.disconnect();

      expect(bridge.getConnectionState()).toBe("disconnected");
    });

    it("connect 应将处理器注册到路由器", () => {
      const bridge = new UEBridge();
      const router = new CommandRouter();

      bridge.connect(router);

      // 默认处理器应覆盖所有已知方法
      for (const method of SCENE_COMMAND_METHODS) {
        expect(router.hasHandler(method)).toBe(true);
      }
    });

    it("disconnect 应从路由器注销所有处理器", () => {
      const bridge = new UEBridge();
      const router = new CommandRouter();

      bridge.connect(router);
      bridge.disconnect();

      for (const method of SCENE_COMMAND_METHODS) {
        expect(router.hasHandler(method)).toBe(false);
      }
    });

    it("重复 connect 应为幂等操作", () => {
      const bridge = new UEBridge();
      const router = new CommandRouter();

      bridge.connect(router);
      bridge.connect(router); // 不应抛出

      expect(bridge.getConnectionState()).toBe("connected");
    });

    it("重复 disconnect 应为幂等操作", () => {
      const bridge = new UEBridge();
      const router = new CommandRouter();

      bridge.connect(router);
      bridge.disconnect();
      bridge.disconnect(); // 不应抛出

      expect(bridge.getConnectionState()).toBe("disconnected");
    });

    it("未连接时 disconnect 不应报错", () => {
      const bridge = new UEBridge();
      expect(() => bridge.disconnect()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5.2 指令解析与蓝图函数调用映射
  // ═══════════════════════════════════════════════════════════════

  describe("指令解析与处理器映射", () => {
    it("默认构造应为所有已知方法注册 echo 处理器", () => {
      const bridge = new UEBridge();

      for (const method of SCENE_COMMAND_METHODS) {
        expect(bridge.hasHandler(method)).toBe(true);
      }
    });

    it("可使用自定义处理器映射构造", () => {
      const customHandler = (cmd: SceneCommand) =>
        createSuccessResult(cmd.id, { success: true, duration: 42 });

      const bridge = new UEBridge({
        "character.moveTo": customHandler,
      });

      expect(bridge.hasHandler("character.moveTo")).toBe(true);
      expect(bridge.hasHandler("camera.setPreset")).toBe(false);
    });

    it("registerHandler 应添加新处理器", () => {
      const bridge = new UEBridge({});
      expect(bridge.hasHandler("custom.doSomething")).toBe(false);

      bridge.registerHandler("custom.doSomething", (cmd) =>
        createSuccessResult(cmd.id),
      );

      expect(bridge.hasHandler("custom.doSomething")).toBe(true);
    });

    it("registerHandler 在已连接时应同步注册到路由器", () => {
      const bridge = new UEBridge({});
      const router = new CommandRouter();
      bridge.connect(router);

      bridge.registerHandler("custom.test", (cmd) =>
        createSuccessResult(cmd.id),
      );

      expect(router.hasHandler("custom.test")).toBe(true);
    });

    it("unregisterHandler 应移除处理器", () => {
      const bridge = new UEBridge();
      expect(bridge.hasHandler("character.moveTo")).toBe(true);

      const removed = bridge.unregisterHandler("character.moveTo");

      expect(removed).toBe(true);
      expect(bridge.hasHandler("character.moveTo")).toBe(false);
    });

    it("unregisterHandler 在已连接时应同步从路由器注销", () => {
      const bridge = new UEBridge();
      const router = new CommandRouter();
      bridge.connect(router);

      bridge.unregisterHandler("character.moveTo");

      expect(router.hasHandler("character.moveTo")).toBe(false);
    });

    it("unregisterHandler 对不存在的方法应返回 false", () => {
      const bridge = new UEBridge({});
      expect(bridge.unregisterHandler("nonexistent")).toBe(false);
    });

    it("getRegisteredMethods 应返回所有已注册方法名", () => {
      const bridge = new UEBridge({
        "character.moveTo": createEchoHandler(0),
        "camera.setPreset": createEchoHandler(0),
      });

      const methods = bridge.getRegisteredMethods();
      expect(methods).toContain("character.moveTo");
      expect(methods).toContain("camera.setPreset");
      expect(methods).toHaveLength(2);
    });

    it("通过路由器 dispatch 应调用桥中对应的处理器", async () => {
      const handlerFn = vi.fn((cmd: SceneCommand) =>
        createSuccessResult(cmd.id, { success: true, duration: 10 }),
      );

      const bridge = new UEBridge({
        "character.moveTo": handlerFn,
      });
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("character.moveTo", "req-1");
      await router.dispatch(cmd);

      expect(handlerFn).toHaveBeenCalledOnce();
      expect(handlerFn).toHaveBeenCalledWith(cmd);
    });

    it("未注册方法的 dispatch 应返回 METHOD_NOT_FOUND", async () => {
      const bridge = new UEBridge({
        "character.moveTo": createEchoHandler(0),
      });
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("camera.setPreset", "req-1");
      const result = await router.dispatch(cmd);

      expect(result.error?.code).toBe(SCENE_ERROR_CODES.METHOD_NOT_FOUND);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5.3 执行结果回传
  // ═══════════════════════════════════════════════════════════════

  describe("执行结果回传", () => {
    it("echo 处理器应返回成功结果", async () => {
      const bridge = new UEBridge(createDefaultHandlerMap(0));
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("character.moveTo", "req-1");
      const result = await router.dispatch(cmd);

      expect(result.id).toBe("req-1");
      expect(result.result?.success).toBe(true);
      expect(result.result?.duration).toBeTypeOf("number");
    });

    it("成功结果应包含执行时长", async () => {
      const bridge = new UEBridge(createDefaultHandlerMap(0));
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("effect.play", "req-2");
      const result = await router.dispatch(cmd);

      expect(result.result?.duration).toBeGreaterThanOrEqual(0);
    });

    it("处理器返回的结果中已有 duration 时不应覆盖", async () => {
      const bridge = new UEBridge({
        "character.moveTo": (cmd) =>
          createSuccessResult(cmd.id, { success: true, duration: 999 }),
      });
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("character.moveTo", "req-1");
      const result = await router.dispatch(cmd);

      expect(result.result?.duration).toBe(999);
    });

    it("处理器返回的成功结果中无 duration 时应自动补充", async () => {
      const bridge = new UEBridge({
        "character.moveTo": (cmd) =>
          createSuccessResult(cmd.id, { success: true }),
      });
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("character.moveTo", "req-1");
      const result = await router.dispatch(cmd);

      expect(result.result?.success).toBe(true);
      expect(result.result?.duration).toBeTypeOf("number");
      expect(result.result!.duration!).toBeGreaterThanOrEqual(0);
    });

    it("异步处理器应正确返回结果", async () => {
      const bridge = new UEBridge({
        "scene.setState": async (cmd) => {
          await new Promise((r) => setTimeout(r, 10));
          return createSuccessResult(cmd.id, { success: true, duration: 10 });
        },
      });
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("scene.setState", "req-async");
      const result = await router.dispatch(cmd);

      expect(result.id).toBe("req-async");
      expect(result.result?.success).toBe(true);
    });

    it("处理器抛出异常时应返回 EXECUTION_FAILED", async () => {
      const bridge = new UEBridge({
        "character.moveTo": () => {
          throw new Error("Blueprint function crashed");
        },
      });
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("character.moveTo", "req-err");
      const result = await router.dispatch(cmd);

      expect(result.id).toBe("req-err");
      expect(result.error?.code).toBe(SCENE_ERROR_CODES.EXECUTION_FAILED);
      expect(result.error?.message).toContain("Blueprint function crashed");
    });

    it("处理器抛出非 Error 对象时应返回通用错误消息", async () => {
      const bridge = new UEBridge({
        "character.moveTo": () => {
          throw "string error";
        },
      });
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("character.moveTo", "req-err2");
      const result = await router.dispatch(cmd);

      expect(result.error?.code).toBe(SCENE_ERROR_CODES.EXECUTION_FAILED);
      expect(result.error?.message).toContain("Unknown UE execution error");
    });

    it("处理器返回错误结果时应原样传递", async () => {
      const bridge = new UEBridge({
        "character.moveTo": (cmd) =>
          createErrorResult(
            cmd.id,
            SCENE_ERROR_CODES.EXECUTION_FAILED,
            "Character not found",
          ),
      });
      const router = new CommandRouter();
      bridge.connect(router);

      const cmd = makeCommand("character.moveTo", "req-fail");
      const result = await router.dispatch(cmd);

      expect(result.id).toBe("req-fail");
      expect(result.error?.code).toBe(SCENE_ERROR_CODES.EXECUTION_FAILED);
      expect(result.error?.message).toBe("Character not found");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 断开连接行为
  // ═══════════════════════════════════════════════════════════════

  describe("断开连接后的行为", () => {
    it("断开后通过路由器 dispatch 应返回 METHOD_NOT_FOUND（处理器已注销）", async () => {
      const bridge = new UEBridge(createDefaultHandlerMap(0));
      const router = new CommandRouter();
      bridge.connect(router);
      bridge.disconnect();

      const cmd = makeCommand("character.moveTo", "req-disc");
      const result = await router.dispatch(cmd);

      // 处理器已注销，路由器找不到处理器
      expect(result.error?.code).toBe(SCENE_ERROR_CODES.METHOD_NOT_FOUND);
    });

    it("断开后重新连接应恢复处理器注册", async () => {
      const bridge = new UEBridge(createDefaultHandlerMap(0));
      const router = new CommandRouter();

      bridge.connect(router);
      bridge.disconnect();
      bridge.connect(router);

      const cmd = makeCommand("character.moveTo", "req-reconn");
      const result = await router.dispatch(cmd);

      expect(result.result?.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 工厂函数
  // ═══════════════════════════════════════════════════════════════

  describe("工厂函数", () => {
    it("createEchoHandler 应返回成功结果", async () => {
      const handler = createEchoHandler(0);
      const cmd = makeCommand("character.moveTo", "req-echo");
      const result = await handler(cmd);

      expect(result.result?.success).toBe(true);
      expect(result.result?.duration).toBeTypeOf("number");
    });

    it("createDefaultHandlerMap 应覆盖所有已知方法", () => {
      const map = createDefaultHandlerMap(0);

      for (const method of SCENE_COMMAND_METHODS) {
        expect(map[method]).toBeTypeOf("function");
      }
    });

    it("createDefaultHandlerMap 应使用指定延迟", async () => {
      const map = createDefaultHandlerMap(0);
      const handler = map["character.moveTo"]!;
      const cmd = makeCommand("character.moveTo", "req-delay");
      const result = await handler(cmd);

      expect(result.result?.success).toBe(true);
      // 0ms 延迟，duration 应很小
      expect(result.result?.duration).toBeLessThan(100);
    });
  });
});
