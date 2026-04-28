import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  UEReconnectHandler,
  UE_RECONNECT_DEFAULTS,
  type UEReconnectConfig,
} from "../../shared/ue/reconnect.js";
import { SignalingProxy } from "../core/ue-signaling-proxy.js";
import WebSocket from "ws";

// ── Helpers ─────────────────────────────────────────────────────

/** Small delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a UEReconnectHandler with short backoff intervals for testing.
 * Uses 10ms intervals instead of real 1s/3s/5s to keep tests fast.
 */
function createTestHandler(
  overrides: Partial<UEReconnectConfig> & { connect: () => Promise<boolean> },
): UEReconnectHandler {
  return new UEReconnectHandler({
    maxRetries: overrides.maxRetries ?? UE_RECONNECT_DEFAULTS.maxRetries,
    backoffIntervals: overrides.backoffIntervals ?? [10, 20, 30],
    onAttempt: overrides.onAttempt,
    onReconnected: overrides.onReconnected,
    onDegraded: overrides.onDegraded,
    connect: overrides.connect,
  });
}

// ── UEReconnectHandler Tests ────────────────────────────────────

describe("UEReconnectHandler", () => {
  // ── 5.1 Reconnect handshake protocol ────────────────────────

  describe("5.1 Reconnect handshake protocol", () => {
    it("starts in idle state", () => {
      const handler = createTestHandler({
        connect: () => Promise.resolve(true),
      });
      expect(handler.getState()).toBe("idle");
    });

    it("transitions to reconnecting state when attemptReconnect is called", async () => {
      let resolveConnect: (value: boolean) => void;
      const connectPromise = new Promise<boolean>((resolve) => {
        resolveConnect = resolve;
      });

      const handler = createTestHandler({
        connect: () => connectPromise,
      });

      const reconnectPromise = handler.attemptReconnect();

      // Give time for the first backoff delay to complete
      await delay(50);

      expect(handler.getState()).toBe("reconnecting");

      // Resolve to clean up
      resolveConnect!(true);
      await reconnectPromise;
    });

    it("calls connect function on each attempt", async () => {
      const connectFn = vi.fn().mockResolvedValue(false);

      const handler = createTestHandler({
        maxRetries: 2,
        connect: connectFn,
      });

      await handler.attemptReconnect();

      expect(connectFn).toHaveBeenCalledTimes(2);
    });

    it("returns true and transitions to idle on successful reconnection", async () => {
      const handler = createTestHandler({
        connect: () => Promise.resolve(true),
      });

      const result = await handler.attemptReconnect();

      expect(result).toBe(true);
      expect(handler.getState()).toBe("idle");
    });

    it("calls onReconnected callback on success", async () => {
      const onReconnected = vi.fn();

      const handler = createTestHandler({
        connect: () => Promise.resolve(true),
        onReconnected,
      });

      await handler.attemptReconnect();

      expect(onReconnected).toHaveBeenCalledTimes(1);
    });

    it("succeeds on a later attempt after initial failures", async () => {
      let attempt = 0;
      const handler = createTestHandler({
        maxRetries: 3,
        connect: async () => {
          attempt++;
          return attempt === 3; // Succeed on 3rd attempt
        },
      });

      const result = await handler.attemptReconnect();

      expect(result).toBe(true);
      expect(handler.getState()).toBe("idle");
    });

    it("resets attempt counter after successful reconnection", async () => {
      const onAttempt = vi.fn();
      let callCount = 0;

      const handler = createTestHandler({
        maxRetries: 3,
        connect: async () => {
          callCount++;
          return callCount === 1; // Succeed on first attempt
        },
        onAttempt,
      });

      // First reconnect — succeeds
      await handler.attemptReconnect();
      expect(handler.getState()).toBe("idle");

      // Second reconnect — should start from attempt 1 again
      callCount = 0;
      await handler.attemptReconnect();
      expect(onAttempt).toHaveBeenCalledWith(1, expect.any(Number));
    });
  });

  // ── 5.2 Retry limits and incremental backoff ────────────────

  describe("5.2 Retry limits and incremental backoff", () => {
    it("respects maxRetries limit", async () => {
      const connectFn = vi.fn().mockResolvedValue(false);

      const handler = createTestHandler({
        maxRetries: 3,
        connect: connectFn,
      });

      await handler.attemptReconnect();

      expect(connectFn).toHaveBeenCalledTimes(3);
    });

    it("calls onAttempt with correct attempt number and delay", async () => {
      const onAttempt = vi.fn();
      const intervals = [10, 20, 30];

      const handler = createTestHandler({
        maxRetries: 3,
        backoffIntervals: intervals,
        connect: () => Promise.resolve(false),
        onAttempt,
      });

      await handler.attemptReconnect();

      expect(onAttempt).toHaveBeenCalledTimes(3);
      expect(onAttempt).toHaveBeenNthCalledWith(1, 1, 10);
      expect(onAttempt).toHaveBeenNthCalledWith(2, 2, 20);
      expect(onAttempt).toHaveBeenNthCalledWith(3, 3, 30);
    });

    it("reuses last interval when retries exceed intervals array length", async () => {
      const onAttempt = vi.fn();

      const handler = createTestHandler({
        maxRetries: 5,
        backoffIntervals: [10, 20],
        connect: () => Promise.resolve(false),
        onAttempt,
      });

      await handler.attemptReconnect();

      expect(onAttempt).toHaveBeenCalledTimes(5);
      // First two use their own intervals
      expect(onAttempt).toHaveBeenNthCalledWith(1, 1, 10);
      expect(onAttempt).toHaveBeenNthCalledWith(2, 2, 20);
      // Remaining reuse the last interval
      expect(onAttempt).toHaveBeenNthCalledWith(3, 3, 20);
      expect(onAttempt).toHaveBeenNthCalledWith(4, 4, 20);
      expect(onAttempt).toHaveBeenNthCalledWith(5, 5, 20);
    });

    it("applies backoff delay before each attempt", async () => {
      const timestamps: number[] = [];

      const handler = createTestHandler({
        maxRetries: 2,
        backoffIntervals: [50, 50],
        connect: async () => {
          timestamps.push(Date.now());
          return false;
        },
      });

      const start = Date.now();
      await handler.attemptReconnect();

      // Each attempt should be delayed by at least the backoff interval
      expect(timestamps.length).toBe(2);
      // First attempt should be at least ~50ms after start
      expect(timestamps[0]! - start).toBeGreaterThanOrEqual(40);
    });

    it("handles connect function throwing errors gracefully", async () => {
      const connectFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValueOnce(false);

      const handler = createTestHandler({
        maxRetries: 3,
        connect: connectFn,
      });

      const result = await handler.attemptReconnect();

      expect(result).toBe(false);
      expect(connectFn).toHaveBeenCalledTimes(3);
    });
  });

  // ── 5.3 Degradation notification ────────────────────────────

  describe("5.3 Degradation notification", () => {
    it("transitions to degraded state when all retries fail", async () => {
      const handler = createTestHandler({
        maxRetries: 3,
        connect: () => Promise.resolve(false),
      });

      await handler.attemptReconnect();

      expect(handler.getState()).toBe("degraded");
    });

    it("calls onDegraded callback when all retries are exhausted", async () => {
      const onDegraded = vi.fn();

      const handler = createTestHandler({
        maxRetries: 2,
        connect: () => Promise.resolve(false),
        onDegraded,
      });

      await handler.attemptReconnect();

      expect(onDegraded).toHaveBeenCalledTimes(1);
    });

    it("returns false when all retries fail", async () => {
      const handler = createTestHandler({
        maxRetries: 2,
        connect: () => Promise.resolve(false),
      });

      const result = await handler.attemptReconnect();

      expect(result).toBe(false);
    });

    it("returns false when attempting to reconnect from degraded state", async () => {
      const handler = createTestHandler({
        maxRetries: 1,
        connect: () => Promise.resolve(false),
      });

      await handler.attemptReconnect();
      expect(handler.getState()).toBe("degraded");

      const result = await handler.attemptReconnect();
      expect(result).toBe(false);
    });

    it("can reconnect after reset from degraded state", async () => {
      let shouldSucceed = false;

      const handler = createTestHandler({
        maxRetries: 1,
        connect: () => Promise.resolve(shouldSucceed),
      });

      // First attempt — fails, enters degraded
      await handler.attemptReconnect();
      expect(handler.getState()).toBe("degraded");

      // Reset and try again
      handler.reset();
      expect(handler.getState()).toBe("idle");

      shouldSucceed = true;
      const result = await handler.attemptReconnect();
      expect(result).toBe(true);
      expect(handler.getState()).toBe("idle");
    });
  });

  // ── Cancellation ────────────────────────────────────────────

  describe("Cancellation", () => {
    it("cancel stops pending reconnection and resets to idle", async () => {
      let connectCalled = 0;

      const handler = createTestHandler({
        maxRetries: 3,
        backoffIntervals: [200, 200, 200],
        connect: async () => {
          connectCalled++;
          return false;
        },
      });

      const promise = handler.attemptReconnect();

      // Cancel after a short delay (before all retries complete)
      await delay(50);
      handler.cancel();

      await promise;

      expect(handler.getState()).toBe("idle");
      // Should have been cancelled before all 3 attempts
      expect(connectCalled).toBeLessThan(3);
    });

    it("cancel during backoff delay prevents next attempt", async () => {
      const connectFn = vi.fn().mockResolvedValue(false);

      const handler = createTestHandler({
        maxRetries: 3,
        backoffIntervals: [500, 500, 500],
        connect: connectFn,
      });

      const promise = handler.attemptReconnect();

      // Cancel immediately — before even the first backoff completes
      await delay(10);
      handler.cancel();

      await promise;

      expect(handler.getState()).toBe("idle");
      expect(connectFn).toHaveBeenCalledTimes(0);
    });
  });

  // ── Idempotency ─────────────────────────────────────────────

  describe("Idempotency", () => {
    it("returns the same promise when called while already reconnecting", async () => {
      const handler = createTestHandler({
        maxRetries: 1,
        backoffIntervals: [100],
        connect: () => Promise.resolve(true),
      });

      const promise1 = handler.attemptReconnect();
      const promise2 = handler.attemptReconnect();

      expect(promise1).toBe(promise2);

      await promise1;
    });

    it("does not restart the reconnection sequence on duplicate calls", async () => {
      const connectFn = vi.fn().mockResolvedValue(true);

      const handler = createTestHandler({
        maxRetries: 3,
        backoffIntervals: [50],
        connect: connectFn,
      });

      const promise1 = handler.attemptReconnect();
      handler.attemptReconnect(); // duplicate call

      await promise1;

      // connect should only be called once (first attempt succeeds)
      expect(connectFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Reset ───────────────────────────────────────────────────

  describe("Reset", () => {
    it("reset returns handler to idle state", () => {
      const handler = createTestHandler({
        connect: () => Promise.resolve(true),
      });

      handler.reset();
      expect(handler.getState()).toBe("idle");
    });

    it("reset clears any pending reconnection", async () => {
      const connectFn = vi.fn().mockResolvedValue(false);

      const handler = createTestHandler({
        maxRetries: 3,
        backoffIntervals: [500, 500, 500],
        connect: connectFn,
      });

      const promise = handler.attemptReconnect();
      await delay(10);
      handler.reset();

      // The promise should resolve (cancelled internally)
      // Give it time to settle
      await delay(50);

      expect(handler.getState()).toBe("idle");
    });
  });
});

// ── SignalingProxy Reconnect Message Tests ───────────────────────

describe("SignalingProxy reconnect message handling", () => {
  let proxy: SignalingProxy;
  let port: number;
  const openSockets: WebSocket[] = [];

  function getTestPort(): number {
    return 30000 + Math.floor(Math.random() * 20000);
  }

  function createWs(path: string): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    openSockets.push(ws);
    return ws;
  }

  function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      ws.on("open", resolve);
      ws.on("error", reject);
    });
  }

  function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  function waitForClose(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      ws.on("close", () => resolve());
    });
  }

  beforeEach(() => {
    port = getTestPort();
    proxy = new SignalingProxy();
    proxy.listen(port);
  });

  afterEach(async () => {
    for (const ws of openSockets) {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    }
    openSockets.length = 0;
    await proxy.close();
  });

  it("assigns a new player ID when previousPlayerId is not found", async () => {
    const client = createWs("/client");
    const config = await waitForMessage(client);
    const currentId = config.playerId as string;

    // Send reconnect with a non-existent previous ID
    client.send(
      JSON.stringify({
        type: "reconnect",
        previousPlayerId: "non-existent-id",
      }),
    );

    const result = await waitForMessage(client);
    expect(result.type).toBe("reconnectResult");
    expect(result.success).toBe(false);
    expect(result.playerId).toBe(currentId);
    expect(result.reason).toBe("previous_session_not_found");
  });

  it("restores previous player ID when session still exists", async () => {
    // Connect first client
    const client1 = createWs("/client");
    const config1 = await waitForMessage(client1);
    const originalId = config1.playerId as string;

    // Connect second client (simulating a reconnecting browser)
    const client2 = createWs("/client");
    const config2 = await waitForMessage(client2);
    const newId = config2.playerId as string;

    expect(originalId).not.toBe(newId);

    // Send reconnect message from client2 claiming to be client1
    client2.send(
      JSON.stringify({
        type: "reconnect",
        previousPlayerId: originalId,
      }),
    );

    const result = await waitForMessage(client2);
    expect(result.type).toBe("reconnectResult");
    expect(result.success).toBe(true);
    expect(result.playerId).toBe(originalId);
  });

  it("closes the old socket when session is taken over", async () => {
    const client1 = createWs("/client");
    const config1 = await waitForMessage(client1);
    const originalId = config1.playerId as string;

    const client2 = createWs("/client");
    await waitForMessage(client2);

    // Reconnect: client2 takes over client1's session
    client2.send(
      JSON.stringify({
        type: "reconnect",
        previousPlayerId: originalId,
      }),
    );

    await waitForMessage(client2); // reconnectResult

    // client1's socket should be closed
    await waitForClose(client1);
    expect(
      client1.readyState === WebSocket.CLOSED ||
        client1.readyState === WebSocket.CLOSING,
    ).toBe(true);
  });

  it("reconnected client can exchange messages using restored player ID", async () => {
    const streamer = createWs("/streamer");
    await waitForOpen(streamer);

    const client1 = createWs("/client");
    const config1 = await waitForMessage(client1);
    const originalId = config1.playerId as string;

    // Consume playerConnected for client1
    await waitForMessage(streamer);

    const client2 = createWs("/client");
    await waitForMessage(client2);

    // Consume playerConnected for client2
    await waitForMessage(streamer);

    // Reconnect: client2 takes over client1's session
    client2.send(
      JSON.stringify({
        type: "reconnect",
        previousPlayerId: originalId,
      }),
    );

    await waitForMessage(client2); // reconnectResult

    // Now client2 sends a message — it should be tagged with the original ID
    client2.send(JSON.stringify({ type: "offer", sdp: "reconnected-sdp" }));

    // Consume playerDisconnected for old client2 ID if any, then get the offer
    let msg = await waitForMessage(streamer);
    // Skip any playerDisconnected messages
    while (msg.type === "playerDisconnected" || msg.type === "playerConnected") {
      msg = await waitForMessage(streamer);
    }

    expect(msg.type).toBe("offer");
    expect(msg.playerId).toBe(originalId);
    expect(msg.sdp).toBe("reconnected-sdp");
  });

  it("emits clientReconnected event on successful reconnect", async () => {
    const reconnectedIds: string[] = [];
    proxy.on("clientReconnected", (id: string) => reconnectedIds.push(id));

    const client1 = createWs("/client");
    const config1 = await waitForMessage(client1);
    const originalId = config1.playerId as string;

    const client2 = createWs("/client");
    await waitForMessage(client2);

    client2.send(
      JSON.stringify({
        type: "reconnect",
        previousPlayerId: originalId,
      }),
    );

    await waitForMessage(client2); // reconnectResult
    await delay(50);

    expect(reconnectedIds).toContain(originalId);
  });
});
