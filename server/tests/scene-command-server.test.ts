/**
 * 场景指令服务端测试 — 覆盖校验中间件、指令路由器与服务端消息解析
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fc } from "@fast-check/vitest";
import {
  SceneCommandServer,
  CommandValidator,
  CommandRouter,
  type ITransport,
  type ConnectionId,
  type CommandHandler,
} from "../scene-command/index.ts";
import {
  type SceneCommand,
  type SceneCommandResult,
  SCENE_ERROR_CODES,
  SCENE_COMMAND_METHODS,
  createCommand,
  createSuccessResult,
  createErrorResult,
} from "../../shared/scene-command/index.ts";

// ─── 测试用 Mock Transport ─────────────────────────────────────────

function createMockTransport() {
  let messageHandler: ((id: ConnectionId, data: string) => void) | null = null;
  let connectHandler: ((id: ConnectionId) => void) | null = null;
  let disconnectHandler: ((id: ConnectionId) => void) | null = null;

  const sent: Array<{ connectionId: string; data: string }> = [];

  const transport: ITransport = {
    send(connectionId, data) {
      sent.push({ connectionId, data });
    },
    onMessage(handler) {
      messageHandler = handler;
    },
    onConnect(handler) {
      connectHandler = handler;
    },
    onDisconnect(handler) {
      disconnectHandler = handler;
    },
  };

  return {
    transport,
    sent,
    simulateConnect(id: string) {
      connectHandler?.(id);
    },
    simulateDisconnect(id: string) {
      disconnectHandler?.(id);
    },
    simulateMessage(id: string, data: string) {
      messageHandler?.(id, data);
    },
  };
}

// ─── 辅助函数 ───────────────────────────────────────────────────────

function validMoveToCommand(id = "req-1"): SceneCommand {
  return {
    jsonrpc: "2.0",
    method: "character.moveTo",
    params: { characterId: "hero", x: 1, y: 2, z: 3 },
    id,
  };
}

function validPlayAnimCommand(id = "req-2"): SceneCommand {
  return {
    jsonrpc: "2.0",
    method: "character.playAnimation",
    params: { characterId: "hero", animationName: "wave" },
    id,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CommandValidator 测试
// ═══════════════════════════════════════════════════════════════════

describe("CommandValidator", () => {
  let validator: CommandValidator;

  beforeEach(() => {
    validator = new CommandValidator();
  });

  describe("基础格式校验", () => {
    it("应通过合法的 JSON-RPC 请求", () => {
      const result = validator.validate(validMoveToCommand());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.method).toBe("character.moveTo");
      }
    });

    it("应拒绝缺少 jsonrpc 字段的请求", () => {
      const result = validator.validate({
        method: "character.moveTo",
        params: { characterId: "hero", x: 1, y: 2, z: 3 },
        id: "req-1",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error?.code).toBe(
          SCENE_ERROR_CODES.INVALID_REQUEST,
        );
      }
    });

    it("应拒绝 jsonrpc 不为 2.0 的请求", () => {
      const result = validator.validate({
        jsonrpc: "1.0",
        method: "character.moveTo",
        params: { characterId: "hero", x: 1, y: 2, z: 3 },
        id: "req-1",
      });
      expect(result.success).toBe(false);
    });

    it("应拒绝缺少 method 的请求", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        params: {},
        id: "req-1",
      });
      expect(result.success).toBe(false);
    });

    it("应拒绝缺少 id 的请求", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        method: "character.moveTo",
        params: { characterId: "hero", x: 1, y: 2, z: 3 },
      });
      expect(result.success).toBe(false);
    });

    it("应拒绝空 method 的请求", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        method: "",
        params: {},
        id: "req-1",
      });
      expect(result.success).toBe(false);
    });

    it("应在格式错误时尝试提取 id", () => {
      const result = validator.validate({
        jsonrpc: "1.0",
        method: "test",
        params: {},
        id: "my-id",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.id).toBe("my-id");
      }
    });

    it("应在无法提取 id 时使用空字符串", () => {
      const result = validator.validate("not an object");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.id).toBe("");
      }
    });
  });

  describe("参数校验", () => {
    it("应拒绝 character.moveTo 缺少 characterId", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        method: "character.moveTo",
        params: { x: 1, y: 2, z: 3 },
        id: "req-1",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error?.code).toBe(
          SCENE_ERROR_CODES.INVALID_PARAMS,
        );
      }
    });

    it("应拒绝 character.moveTo 坐标为非数字", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        method: "character.moveTo",
        params: { characterId: "hero", x: "abc", y: 2, z: 3 },
        id: "req-1",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error?.code).toBe(
          SCENE_ERROR_CODES.INVALID_PARAMS,
        );
      }
    });

    it("应通过 camera.setPreset 合法参数", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        method: "camera.setPreset",
        params: { presetName: "closeup" },
        id: "req-1",
      });
      expect(result.success).toBe(true);
    });

    it("应拒绝 camera.transition 缺少 duration", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        method: "camera.transition",
        params: { targetPosition: { x: 0, y: 0, z: 0 } },
        id: "req-1",
      });
      expect(result.success).toBe(false);
    });

    it("应通过自定义扩展方法（跳过参数校验）", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        method: "custom.doSomething",
        params: { anything: true },
        id: "req-1",
      });
      expect(result.success).toBe(true);
    });

    it("应通过 effect.play 合法参数", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        method: "effect.play",
        params: { effectId: "explosion" },
        id: "req-1",
      });
      expect(result.success).toBe(true);
    });

    it("应拒绝 effect.stop 缺少 effectId", () => {
      const result = validator.validate({
        jsonrpc: "2.0",
        method: "effect.stop",
        params: {},
        id: "req-1",
      });
      expect(result.success).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// CommandRouter 测试
// ═══════════════════════════════════════════════════════════════════

describe("CommandRouter", () => {
  let router: CommandRouter;

  beforeEach(() => {
    router = new CommandRouter();
  });

  it("应将指令分发到已注册的处理器", async () => {
    const handler = vi.fn(() =>
      createSuccessResult("req-1", { success: true, duration: 100 }),
    );
    router.register("character.moveTo", handler);

    const cmd = validMoveToCommand();
    const result = await router.dispatch(cmd);

    expect(handler).toHaveBeenCalledWith(cmd);
    expect(result.result?.success).toBe(true);
    expect(result.result?.duration).toBe(100);
  });

  it("应对未注册的内置方法返回 METHOD_NOT_FOUND", async () => {
    const cmd = validMoveToCommand();
    const result = await router.dispatch(cmd);

    expect(result.error?.code).toBe(SCENE_ERROR_CODES.METHOD_NOT_FOUND);
    expect(result.id).toBe("req-1");
  });

  it("应对未注册的自定义方法返回 METHOD_NOT_FOUND", async () => {
    const cmd: SceneCommand = {
      jsonrpc: "2.0",
      method: "custom.unknown",
      params: {},
      id: "req-1",
    };
    const result = await router.dispatch(cmd);

    expect(result.error?.code).toBe(SCENE_ERROR_CODES.METHOD_NOT_FOUND);
  });

  it("应支持注册自定义扩展方法", async () => {
    router.register("custom.greet", (cmd) =>
      createSuccessResult(cmd.id, { success: true }),
    );

    const cmd: SceneCommand = {
      jsonrpc: "2.0",
      method: "custom.greet",
      params: { name: "world" },
      id: "req-1",
    };
    const result = await router.dispatch(cmd);

    expect(result.result?.success).toBe(true);
  });

  it("应支持异步处理器", async () => {
    router.register("character.moveTo", async (cmd) => {
      await new Promise((r) => setTimeout(r, 1));
      return createSuccessResult(cmd.id, { success: true, duration: 50 });
    });

    const result = await router.dispatch(validMoveToCommand());
    expect(result.result?.duration).toBe(50);
  });

  it("应捕获处理器抛出的异常并返回 EXECUTION_FAILED", async () => {
    router.register("character.moveTo", () => {
      throw new Error("UE connection lost");
    });

    const result = await router.dispatch(validMoveToCommand());
    expect(result.error?.code).toBe(SCENE_ERROR_CODES.EXECUTION_FAILED);
    expect(result.error?.message).toBe("UE connection lost");
  });

  it("应捕获非 Error 异常", async () => {
    router.register("character.moveTo", () => {
      throw "string error";
    });

    const result = await router.dispatch(validMoveToCommand());
    expect(result.error?.code).toBe(SCENE_ERROR_CODES.EXECUTION_FAILED);
    expect(result.error?.message).toBe("Unknown execution error");
  });

  it("应支持注销处理器", () => {
    router.register("character.moveTo", () =>
      createSuccessResult("x", { success: true }),
    );
    expect(router.hasHandler("character.moveTo")).toBe(true);

    const removed = router.unregister("character.moveTo");
    expect(removed).toBe(true);
    expect(router.hasHandler("character.moveTo")).toBe(false);
  });

  it("注销不存在的处理器应返回 false", () => {
    expect(router.unregister("nonexistent")).toBe(false);
  });

  it("应返回所有已注册方法名", () => {
    router.register("character.moveTo", () =>
      createSuccessResult("x", { success: true }),
    );
    router.register("camera.setPreset", () =>
      createSuccessResult("x", { success: true }),
    );

    const methods = router.getRegisteredMethods();
    expect(methods).toContain("character.moveTo");
    expect(methods).toContain("camera.setPreset");
    expect(methods).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SceneCommandServer 测试
// ═══════════════════════════════════════════════════════════════════

describe("SceneCommandServer", () => {
  let mock: ReturnType<typeof createMockTransport>;
  let server: SceneCommandServer;

  beforeEach(() => {
    mock = createMockTransport();
    server = new SceneCommandServer(mock.transport);
  });

  describe("连接管理", () => {
    it("应追踪连接建立", () => {
      mock.simulateConnect("conn-1");
      expect(server.getConnectionCount()).toBe(1);
      expect(server.hasConnection("conn-1")).toBe(true);
    });

    it("应追踪连接断开", () => {
      mock.simulateConnect("conn-1");
      mock.simulateDisconnect("conn-1");
      expect(server.getConnectionCount()).toBe(0);
      expect(server.hasConnection("conn-1")).toBe(false);
    });

    it("应支持多个并发连接", () => {
      mock.simulateConnect("conn-1");
      mock.simulateConnect("conn-2");
      expect(server.getConnectionCount()).toBe(2);
    });
  });

  describe("JSON 解析", () => {
    it("应对非法 JSON 返回 INVALID_REQUEST", async () => {
      mock.simulateConnect("conn-1");
      mock.simulateMessage("conn-1", "not json{{{");

      // 等待异步处理
      await vi.waitFor(() => expect(mock.sent.length).toBe(1));

      const response = JSON.parse(mock.sent[0].data) as SceneCommandResult;
      expect(response.error?.code).toBe(SCENE_ERROR_CODES.INVALID_REQUEST);
      expect(response.error?.message).toContain("Parse error");
    });
  });

  describe("单条请求处理", () => {
    it("应对合法请求返回成功响应", async () => {
      const router = server.getRouter();
      router.register("character.moveTo", (cmd) =>
        createSuccessResult(cmd.id, { success: true, duration: 200 }),
      );

      mock.simulateConnect("conn-1");
      mock.simulateMessage(
        "conn-1",
        JSON.stringify(validMoveToCommand("req-42")),
      );

      await vi.waitFor(() => expect(mock.sent.length).toBe(1));

      const response = JSON.parse(mock.sent[0].data) as SceneCommandResult;
      expect(response.id).toBe("req-42");
      expect(response.result?.success).toBe(true);
      expect(response.result?.duration).toBe(200);
    });

    it("应对格式错误的请求返回 INVALID_REQUEST", async () => {
      mock.simulateConnect("conn-1");
      mock.simulateMessage(
        "conn-1",
        JSON.stringify({ jsonrpc: "1.0", method: "test", params: {}, id: "x" }),
      );

      await vi.waitFor(() => expect(mock.sent.length).toBe(1));

      const response = JSON.parse(mock.sent[0].data) as SceneCommandResult;
      expect(response.error?.code).toBe(SCENE_ERROR_CODES.INVALID_REQUEST);
    });

    it("应对参数错误的请求返回 INVALID_PARAMS", async () => {
      mock.simulateConnect("conn-1");
      mock.simulateMessage(
        "conn-1",
        JSON.stringify({
          jsonrpc: "2.0",
          method: "character.moveTo",
          params: { characterId: "hero" }, // 缺少 x, y, z
          id: "req-1",
        }),
      );

      await vi.waitFor(() => expect(mock.sent.length).toBe(1));

      const response = JSON.parse(mock.sent[0].data) as SceneCommandResult;
      expect(response.error?.code).toBe(SCENE_ERROR_CODES.INVALID_PARAMS);
    });

    it("应对未注册方法返回 METHOD_NOT_FOUND", async () => {
      mock.simulateConnect("conn-1");
      mock.simulateMessage(
        "conn-1",
        JSON.stringify(validMoveToCommand()),
      );

      await vi.waitFor(() => expect(mock.sent.length).toBe(1));

      const response = JSON.parse(mock.sent[0].data) as SceneCommandResult;
      expect(response.error?.code).toBe(SCENE_ERROR_CODES.METHOD_NOT_FOUND);
    });
  });

  describe("批量请求处理", () => {
    it("应处理合法的批量请求并返回数组响应", async () => {
      const router = server.getRouter();
      router.register("character.moveTo", (cmd) =>
        createSuccessResult(cmd.id, { success: true }),
      );
      router.register("character.playAnimation", (cmd) =>
        createSuccessResult(cmd.id, { success: true }),
      );

      mock.simulateConnect("conn-1");
      mock.simulateMessage(
        "conn-1",
        JSON.stringify([
          validMoveToCommand("batch-1"),
          validPlayAnimCommand("batch-2"),
        ]),
      );

      await vi.waitFor(() => expect(mock.sent.length).toBe(1));

      const responses = JSON.parse(mock.sent[0].data) as SceneCommandResult[];
      expect(responses).toHaveLength(2);
      expect(responses[0].id).toBe("batch-1");
      expect(responses[0].result?.success).toBe(true);
      expect(responses[1].id).toBe("batch-2");
      expect(responses[1].result?.success).toBe(true);
    });

    it("应对空数组返回 INVALID_REQUEST", async () => {
      mock.simulateConnect("conn-1");
      mock.simulateMessage("conn-1", JSON.stringify([]));

      await vi.waitFor(() => expect(mock.sent.length).toBe(1));

      const response = JSON.parse(mock.sent[0].data) as SceneCommandResult;
      expect(response.error?.code).toBe(SCENE_ERROR_CODES.INVALID_REQUEST);
      expect(response.error?.message).toContain("empty array");
    });

    it("应在批量请求中允许部分失败", async () => {
      const router = server.getRouter();
      router.register("character.moveTo", (cmd) =>
        createSuccessResult(cmd.id, { success: true }),
      );

      mock.simulateConnect("conn-1");
      // 第一条合法，第二条格式错误（缺少 jsonrpc）
      mock.simulateMessage(
        "conn-1",
        JSON.stringify([
          validMoveToCommand("ok-1"),
          { method: "test", params: {}, id: "bad-1" },
        ]),
      );

      await vi.waitFor(() => expect(mock.sent.length).toBe(1));

      const responses = JSON.parse(mock.sent[0].data) as SceneCommandResult[];
      expect(responses).toHaveLength(2);
      // 第一条成功
      expect(responses[0].result?.success).toBe(true);
      // 第二条失败
      expect(responses[1].error?.code).toBe(SCENE_ERROR_CODES.INVALID_REQUEST);
    });
  });

  describe("路由器集成", () => {
    it("应暴露路由器实例用于注册处理器", () => {
      const router = server.getRouter();
      expect(router).toBeInstanceOf(CommandRouter);
    });

    it("应支持注入自定义路由器", () => {
      const customRouter = new CommandRouter();
      customRouter.register("custom.test", (cmd) =>
        createSuccessResult(cmd.id, { success: true }),
      );

      const customMock = createMockTransport();
      const customServer = new SceneCommandServer(
        customMock.transport,
        customRouter,
      );

      expect(customServer.getRouter().hasHandler("custom.test")).toBe(true);
    });
  });
});
