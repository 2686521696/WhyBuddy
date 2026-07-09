/**
 * SceneCommandClient 单元测试
 *
 * 覆盖：类型安全方法调用、Promise 解析、超时拒绝、断连清理、批量请求
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SceneCommandClient,
  type IClientTransport,
} from "../scene-command-client";
import { SCENE_ERROR_CODES } from "@shared/scene-command";

// ─── Mock Transport ─────────────────────────────────────────────────

function createMockTransport(): IClientTransport & {
  sentMessages: string[];
  messageHandler: ((data: string) => void) | null;
} {
  const transport = {
    sentMessages: [] as string[],
    messageHandler: null as ((data: string) => void) | null,
    send(data: string) {
      transport.sentMessages.push(data);
    },
    onMessage(handler: (data: string) => void) {
      transport.messageHandler = handler;
    },
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  };
  return transport;
}

/** 模拟服务端响应 */
function simulateResponse(
  transport: ReturnType<typeof createMockTransport>,
  id: string,
  opts?: { error?: boolean }
) {
  const result = opts?.error
    ? {
        jsonrpc: "2.0" as const,
        error: {
          code: SCENE_ERROR_CODES.EXECUTION_FAILED,
          message: "Execution failed",
        },
        id,
      }
    : {
        jsonrpc: "2.0" as const,
        result: { success: true, duration: 100 },
        id,
      };
  transport.messageHandler?.(JSON.stringify(result));
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("SceneCommandClient", () => {
  let transport: ReturnType<typeof createMockTransport>;
  let client: SceneCommandClient;

  beforeEach(async () => {
    transport = createMockTransport();
    client = new SceneCommandClient(transport, { timeout: 500 });
    await client.connect();
  });

  // ─── 连接管理 ─────────────────────────────────────────────────

  describe("connection management", () => {
    it("should call transport.connect on connect()", async () => {
      expect(transport.connect).toHaveBeenCalled();
      expect(client.isConnected()).toBe(true);
    });

    it("should reject send when not connected", async () => {
      const disconnectedTransport = createMockTransport();
      const disconnectedClient = new SceneCommandClient(disconnectedTransport);
      // Not calling connect()

      await expect(
        disconnectedClient.send("character.moveTo", {
          characterId: "a",
          x: 0,
          y: 0,
          z: 0,
        })
      ).rejects.toThrow("Not connected");
    });

    it("should reject sendBatch when not connected", async () => {
      const disconnectedTransport = createMockTransport();
      const disconnectedClient = new SceneCommandClient(disconnectedTransport);

      await expect(disconnectedClient.sendBatch([])).rejects.toThrow(
        "Not connected"
      );
    });
  });

  // ─── 类型安全方法 ─────────────────────────────────────────────

  describe("typed methods", () => {
    it("moveTo sends character.moveTo command", async () => {
      const promise = client.moveTo({
        characterId: "hero",
        x: 1,
        y: 2,
        z: 3,
        speed: 5,
      });

      const sent = JSON.parse(transport.sentMessages[0]);
      expect(sent.jsonrpc).toBe("2.0");
      expect(sent.method).toBe("character.moveTo");
      expect(sent.params).toEqual({
        characterId: "hero",
        x: 1,
        y: 2,
        z: 3,
        speed: 5,
      });
      expect(sent.id).toBeTruthy();

      simulateResponse(transport, sent.id);
      const result = await promise;
      expect(result.result?.success).toBe(true);
    });

    it("playAnimation sends character.playAnimation command", async () => {
      const promise = client.playAnimation({
        characterId: "hero",
        animationName: "wave",
        loop: true,
      });

      const sent = JSON.parse(transport.sentMessages[0]);
      expect(sent.method).toBe("character.playAnimation");
      expect(sent.params.animationName).toBe("wave");

      simulateResponse(transport, sent.id);
      const result = await promise;
      expect(result.result?.success).toBe(true);
    });

    it("setCamera sends camera.setPreset command", async () => {
      const promise = client.setCamera({ presetName: "closeup" });

      const sent = JSON.parse(transport.sentMessages[0]);
      expect(sent.method).toBe("camera.setPreset");
      expect(sent.params.presetName).toBe("closeup");

      simulateResponse(transport, sent.id);
      await expect(promise).resolves.toBeDefined();
    });

    it("transitionCamera sends camera.transition command", async () => {
      const promise = client.transitionCamera({
        targetPosition: { x: 10, y: 20, z: 30 },
        duration: 2,
        easing: "ease-in-out",
      });

      const sent = JSON.parse(transport.sentMessages[0]);
      expect(sent.method).toBe("camera.transition");
      expect(sent.params.targetPosition).toEqual({ x: 10, y: 20, z: 30 });

      simulateResponse(transport, sent.id);
      await expect(promise).resolves.toBeDefined();
    });

    it("setSceneState sends scene.setState command", async () => {
      const promise = client.setSceneState({ key: "weather", value: "rain" });

      const sent = JSON.parse(transport.sentMessages[0]);
      expect(sent.method).toBe("scene.setState");
      expect(sent.params.key).toBe("weather");

      simulateResponse(transport, sent.id);
      await expect(promise).resolves.toBeDefined();
    });

    it("playEffect sends effect.play command", async () => {
      const promise = client.playEffect({
        effectId: "explosion",
        position: { x: 0, y: 0, z: 0 },
        scale: 2,
      });

      const sent = JSON.parse(transport.sentMessages[0]);
      expect(sent.method).toBe("effect.play");
      expect(sent.params.effectId).toBe("explosion");

      simulateResponse(transport, sent.id);
      await expect(promise).resolves.toBeDefined();
    });

    it("stopEffect sends effect.stop command", async () => {
      const promise = client.stopEffect({
        effectId: "explosion",
        fadeOut: 0.5,
      });

      const sent = JSON.parse(transport.sentMessages[0]);
      expect(sent.method).toBe("effect.stop");
      expect(sent.params.fadeOut).toBe(0.5);

      simulateResponse(transport, sent.id);
      await expect(promise).resolves.toBeDefined();
    });
  });

  // ─── 通用 send 方法 ──────────────────────────────────────────

  describe("generic send", () => {
    it("supports custom extension commands", async () => {
      const promise = client.send("custom.doSomething", { foo: "bar" });

      const sent = JSON.parse(transport.sentMessages[0]);
      expect(sent.method).toBe("custom.doSomething");
      expect(sent.params.foo).toBe("bar");

      simulateResponse(transport, sent.id);
      await expect(promise).resolves.toBeDefined();
    });

    it("generates unique request IDs", async () => {
      const p1 = client.send("test.a", {});
      const p2 = client.send("test.b", {});

      const id1 = JSON.parse(transport.sentMessages[0]).id;
      const id2 = JSON.parse(transport.sentMessages[1]).id;
      expect(id1).not.toBe(id2);

      simulateResponse(transport, id1);
      simulateResponse(transport, id2);
      await Promise.all([p1, p2]);
    });
  });

  // ─── Promise 解析 ─────────────────────────────────────────────

  describe("Promise resolution", () => {
    it("resolves with success result when response arrives", async () => {
      const promise = client.send("test.method", {});
      const sent = JSON.parse(transport.sentMessages[0]);

      transport.messageHandler?.(
        JSON.stringify({
          jsonrpc: "2.0",
          result: { success: true, duration: 42 },
          id: sent.id,
        })
      );

      const result = await promise;
      expect(result.jsonrpc).toBe("2.0");
      expect(result.result?.success).toBe(true);
      expect(result.result?.duration).toBe(42);
      expect(result.id).toBe(sent.id);
    });

    it("resolves with error result (does not reject)", async () => {
      const promise = client.send("test.method", {});
      const sent = JSON.parse(transport.sentMessages[0]);

      simulateResponse(transport, sent.id, { error: true });

      const result = await promise;
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe(SCENE_ERROR_CODES.EXECUTION_FAILED);
    });

    it("ignores responses for unknown request IDs", async () => {
      const promise = client.send("test.method", {});
      const sent = JSON.parse(transport.sentMessages[0]);

      // Send response with wrong ID — should be ignored
      transport.messageHandler?.(
        JSON.stringify({
          jsonrpc: "2.0",
          result: { success: true },
          id: "unknown-id",
        })
      );

      // Send correct response
      simulateResponse(transport, sent.id);
      await expect(promise).resolves.toBeDefined();
    });

    it("ignores malformed JSON messages", async () => {
      const promise = client.send("test.method", {});
      const sent = JSON.parse(transport.sentMessages[0]);

      // Send invalid JSON — should be silently ignored
      transport.messageHandler?.("not valid json {{{");

      simulateResponse(transport, sent.id);
      await expect(promise).resolves.toBeDefined();
    });
  });

  // ─── 超时 ─────────────────────────────────────────────────────

  describe("timeout", () => {
    it("rejects with timeout error when no response arrives", async () => {
      vi.useFakeTimers();

      const promise = client.send("test.slow", {});

      vi.advanceTimersByTime(500);

      await expect(promise).rejects.toThrow("timed out");

      vi.useRealTimers();
    });

    it("includes TIMEOUT error code in rejection message", async () => {
      vi.useFakeTimers();

      const promise = client.send("test.slow", {});
      vi.advanceTimersByTime(500);

      await expect(promise).rejects.toThrow(String(SCENE_ERROR_CODES.TIMEOUT));

      vi.useRealTimers();
    });

    it("cleans up pending request on timeout", async () => {
      vi.useFakeTimers();

      const promise = client.send("test.slow", {});
      const sent = JSON.parse(transport.sentMessages[0]);

      vi.advanceTimersByTime(500);
      await expect(promise).rejects.toThrow("timed out");

      // Late response should not cause issues
      transport.messageHandler?.(
        JSON.stringify({
          jsonrpc: "2.0",
          result: { success: true },
          id: sent.id,
        })
      );

      vi.useRealTimers();
    });
  });

  // ─── 断连清理 ──────────────────────────────────────────────────

  describe("disconnect cleanup", () => {
    it("rejects all pending requests on disconnect", async () => {
      const p1 = client.send("test.a", {});
      const p2 = client.send("test.b", {});

      client.disconnect();

      await expect(p1).rejects.toThrow("Disconnected");
      await expect(p2).rejects.toThrow("Disconnected");
    });

    it("includes NOT_CONNECTED error code in disconnect rejection", async () => {
      const promise = client.send("test.method", {});

      client.disconnect();

      await expect(promise).rejects.toThrow(
        String(SCENE_ERROR_CODES.NOT_CONNECTED)
      );
    });

    it("calls transport.disconnect", () => {
      client.disconnect();
      expect(transport.disconnect).toHaveBeenCalled();
    });

    it("sets connected to false after disconnect", () => {
      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  // ─── 批量请求 ──────────────────────────────────────────────────

  describe("batch requests", () => {
    it("sends batch as JSON array", async () => {
      const commands = [
        {
          jsonrpc: "2.0" as const,
          method: "character.moveTo",
          params: { characterId: "a", x: 0, y: 0, z: 0 },
          id: "batch-1",
        },
        {
          jsonrpc: "2.0" as const,
          method: "effect.play",
          params: { effectId: "fire" },
          id: "batch-2",
        },
      ];

      const promise = client.sendBatch(commands);

      const sent = JSON.parse(transport.sentMessages[0]);
      expect(Array.isArray(sent)).toBe(true);
      expect(sent).toHaveLength(2);

      // Simulate batch response
      transport.messageHandler?.(
        JSON.stringify([
          { jsonrpc: "2.0", result: { success: true }, id: "batch-1" },
          { jsonrpc: "2.0", result: { success: true }, id: "batch-2" },
        ])
      );

      const results = await promise;
      expect(results).toHaveLength(2);
      expect(results[0].result?.success).toBe(true);
      expect(results[1].result?.success).toBe(true);
    });

    it("resolves empty array for empty batch", async () => {
      // Need a connected client for this
      const connectedTransport = createMockTransport();
      const connectedClient = new SceneCommandClient(connectedTransport);
      await connectedClient.connect();

      const results = await connectedClient.sendBatch([]);
      expect(results).toEqual([]);
    });

    it("handles individual batch item timeout", async () => {
      vi.useFakeTimers();

      const commands = [
        { jsonrpc: "2.0" as const, method: "test.a", params: {}, id: "b-1" },
        { jsonrpc: "2.0" as const, method: "test.b", params: {}, id: "b-2" },
      ];

      const promise = client.sendBatch(commands);

      // Only respond to first command
      transport.messageHandler?.(
        JSON.stringify({ jsonrpc: "2.0", result: { success: true }, id: "b-1" })
      );

      // Second command times out
      vi.advanceTimersByTime(500);

      await expect(promise).rejects.toThrow("timed out");

      vi.useRealTimers();
    });
  });
});
