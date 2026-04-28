/**
 * UE5 Local Streaming Runtime — End-to-End Smoke Tests
 *
 * Verifies the full pipeline integration between:
 * - UEProcessManager (mocked child_process)
 * - SignalingProxy (real WebSocket server)
 * - UEDebugService
 * - UE Routes (Express)
 * - UEReconnectHandler
 *
 * These tests do NOT require a real UE5 instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { EventEmitter } from "node:events";

import { UEProcessManager } from "../core/ue-process-manager.js";
import { SignalingProxy } from "../core/ue-signaling-proxy.js";
import { UEDebugService } from "../core/ue-debug-service.js";
import { createUERouter } from "../routes/ue.js";
import { UEReconnectHandler } from "../../shared/ue/reconnect.js";
import type { UEProcessConfig } from "../../shared/ue/contracts.js";

// ── Helpers ─────────────────────────────────────────────────────

function getTestPort(): number {
  return 30000 + Math.floor(Math.random() * 20000);
}

function makeConfig(): UEProcessConfig {
  return {
    ueEditorPath: "/opt/ue5/Engine/Binaries/Linux/UnrealEditor",
    projectPath: "/home/user/MyProject/MyProject.uproject",
    mapName: "/Game/Maps/MainLevel",
    resolution: { width: 1920, height: 1080 },
    pixelStreamingPort: 8888,
  };
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

function createMessageCollector(ws: WebSocket): {
  next: () => Promise<Record<string, unknown>>;
} {
  const buffer: Record<string, unknown>[] = [];
  const waiters: Array<(msg: Record<string, unknown>) => void> = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) {
      waiter(msg);
    } else {
      buffer.push(msg);
    }
  });

  return {
    next(): Promise<Record<string, unknown>> {
      const buffered = buffer.shift();
      if (buffered) return Promise.resolve(buffered);
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a fake ChildProcess-like EventEmitter with a mock stdout stream.
 */
function createFakeChild(): EventEmitter & {
  stdout: EventEmitter;
  pid: number;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.pid = 99999;
  child.killed = false;
  child.kill = vi.fn((signal?: string) => {
    child.killed = true;
    setTimeout(() => child.emit("exit", 0, signal ?? null), 5);
    return true;
  });
  return child;
}

// ── Mock child_process.spawn ────────────────────────────────────

let latestFakeChild: ReturnType<typeof createFakeChild>;

vi.mock("node:child_process", () => ({
  spawn: vi.fn((..._args: unknown[]) => {
    latestFakeChild = createFakeChild();
    return latestFakeChild;
  }),
}));

// ── 6.1 Full Pipeline Smoke Test ────────────────────────────────

describe("6.1 Full pipeline: start → UE ready → browser connect → signaling exchange", () => {
  let processManager: UEProcessManager;
  let signalingProxy: SignalingProxy;
  let debugService: UEDebugService;
  let app: ReturnType<typeof express>;
  let httpServer: HttpServer;
  let signalingPort: number;
  let apiPort: number;
  const openSockets: WebSocket[] = [];

  function createWs(path: string): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${signalingPort}${path}`);
    openSockets.push(ws);
    return ws;
  }

  beforeEach(async () => {
    signalingPort = getTestPort();
    apiPort = getTestPort();

    // 1. Create UEProcessManager with mocked spawn
    processManager = new UEProcessManager({
      startupTimeoutMs: 5000,
      stopTimeoutMs: 3000,
    });

    // 2. Create SignalingProxy on a random port
    signalingProxy = new SignalingProxy();
    signalingProxy.listen(signalingPort);

    // 3. Create UEDebugService wired to both
    debugService = new UEDebugService(processManager, signalingProxy);

    // 4. Create Express app with UE routes
    app = express();
    app.use(express.json());
    app.use("/api/ue", createUERouter({ debugService }));

    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(apiPort, "127.0.0.1", () => resolve());
    });
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

    debugService.dispose();
    await signalingProxy.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  it("completes the full start → health → connect → signaling → health pipeline", async () => {
    const baseUrl = `http://127.0.0.1:${apiPort}`;

    // ── Step a: Start the UE process (mock spawn emits stdout to trigger "running")
    const startPromise = processManager.start(makeConfig());
    latestFakeChild.stdout.emit("data", Buffer.from("LogInit: Display ready"));
    await startPromise;

    expect(processManager.getStatus()).toBe("running");

    // ── Step b: Verify health endpoint returns "running" status
    const healthRes1 = await fetch(`${baseUrl}/api/ue/health`);
    expect(healthRes1.status).toBe(200);
    const health1 = await healthRes1.json();
    expect(health1.status).toBe("running");
    expect(health1.connectedClients).toBe(0);

    // ── Step c: Connect a mock streamer WebSocket to /streamer
    const streamer = createWs("/streamer");
    const streamerMsgs = createMessageCollector(streamer);
    await waitForOpen(streamer);

    expect(signalingProxy.isStreamerConnected()).toBe(true);

    // ── Step d: Connect a mock client WebSocket to /client
    const client = createWs("/client");
    const clientMsgs = createMessageCollector(client);

    // ── Step e: Verify the client receives a config message with playerId
    const configMsg = await clientMsgs.next();
    expect(configMsg.type).toBe("config");
    expect(configMsg.playerId).toBeDefined();
    expect(typeof configMsg.playerId).toBe("string");
    const clientId = configMsg.playerId as string;

    // Consume the playerConnected message on the streamer side
    const playerConnectedMsg = await streamerMsgs.next();
    expect(playerConnectedMsg.type).toBe("playerConnected");
    expect(playerConnectedMsg.playerId).toBe(clientId);

    // ── Step f: Simulate signaling exchange
    // Client sends offer → streamer receives it
    client.send(JSON.stringify({ type: "offer", sdp: "client-offer-sdp" }));
    const offerOnStreamer = await streamerMsgs.next();
    expect(offerOnStreamer.type).toBe("offer");
    expect(offerOnStreamer.sdp).toBe("client-offer-sdp");
    expect(offerOnStreamer.playerId).toBe(clientId);

    // Streamer sends answer → client receives it
    streamer.send(
      JSON.stringify({
        type: "answer",
        sdp: "streamer-answer-sdp",
        playerId: clientId,
      }),
    );
    const answerOnClient = await clientMsgs.next();
    expect(answerOnClient.type).toBe("answer");
    expect(answerOnClient.sdp).toBe("streamer-answer-sdp");

    // ── Step g: Verify health endpoint shows 1 connected client
    const healthRes2 = await fetch(`${baseUrl}/api/ue/health`);
    expect(healthRes2.status).toBe(200);
    const health2 = await healthRes2.json();
    expect(health2.status).toBe("running");
    expect(health2.connectedClients).toBe(1);

    // ── Step h: Clean up is handled by afterEach
  });
});

// ── 6.2 Reconnection & Degradation Smoke Tests ─────────────────

describe("6.2 Reconnection and degradation paths", () => {
  let signalingProxy: SignalingProxy;
  let signalingPort: number;
  const openSockets: WebSocket[] = [];

  function createWs(path: string): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${signalingPort}${path}`);
    openSockets.push(ws);
    return ws;
  }

  beforeEach(() => {
    signalingPort = getTestPort();
    signalingProxy = new SignalingProxy();
    signalingProxy.listen(signalingPort);
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
    await signalingProxy.close();
  });

  // ── Successful reconnection path ────────────────────────────

  it("restores session on reconnect and continues signaling exchange", async () => {
    const streamer = createWs("/streamer");
    const streamerMsgs = createMessageCollector(streamer);
    await waitForOpen(streamer);

    // a. Connect a client, get its playerId
    const client1 = createWs("/client");
    const config1 = await waitForMessage(client1);
    const originalPlayerId = config1.playerId as string;

    // Consume playerConnected on streamer
    await streamerMsgs.next();

    // b. Disconnect the client
    client1.close();
    await waitForClose(client1);

    // Consume playerDisconnected on streamer
    await streamerMsgs.next();

    // c. Connect a new client
    const client2 = createWs("/client");
    const client2Msgs = createMessageCollector(client2);
    const config2 = await client2Msgs.next();
    const newPlayerId = config2.playerId as string;
    expect(newPlayerId).not.toBe(originalPlayerId);

    // Consume playerConnected for client2 on streamer
    await streamerMsgs.next();

    // d. Send a reconnect message with the previous playerId
    // Note: The old session was cleaned up on disconnect, so this will fail
    // because the proxy removes the session on close. This is expected behavior.
    // For a successful reconnect, the old session must still exist (e.g., two
    // concurrent connections where one takes over the other).

    // Let's test the successful path: connect client3 while client2 is still alive,
    // then have client3 reconnect as client2's original session.
    // First, we need a scenario where the old session still exists.

    // Actually, let's set up the proper scenario:
    // Connect clientA, keep it alive, connect clientB, have clientB reconnect as clientA
    const clientA = createWs("/client");
    const clientAMsgs = createMessageCollector(clientA);
    const configA = await clientAMsgs.next();
    const playerIdA = configA.playerId as string;

    // Consume playerConnected for clientA
    await streamerMsgs.next();

    const clientB = createWs("/client");
    const clientBMsgs = createMessageCollector(clientB);
    await clientBMsgs.next(); // config

    // Consume playerConnected for clientB
    await streamerMsgs.next();

    // e. clientB sends reconnect claiming to be clientA
    clientB.send(
      JSON.stringify({
        type: "reconnect",
        previousPlayerId: playerIdA,
      }),
    );

    const reconnectResult = await clientBMsgs.next();
    expect(reconnectResult.type).toBe("reconnectResult");
    expect(reconnectResult.success).toBe(true);
    expect(reconnectResult.playerId).toBe(playerIdA);

    // clientA's socket should be closed (taken over)
    await waitForClose(clientA);

    // f. Verify the client can still exchange messages with the streamer
    clientB.send(JSON.stringify({ type: "offer", sdp: "reconnected-offer" }));

    // Skip any playerDisconnected/playerConnected messages
    let msg = await streamerMsgs.next();
    while (msg.type === "playerDisconnected" || msg.type === "playerConnected") {
      msg = await streamerMsgs.next();
    }

    expect(msg.type).toBe("offer");
    expect(msg.playerId).toBe(playerIdA);
    expect(msg.sdp).toBe("reconnected-offer");

    // Streamer can send back to the reconnected client
    streamer.send(
      JSON.stringify({
        type: "answer",
        sdp: "answer-for-reconnected",
        playerId: playerIdA,
      }),
    );

    const answerMsg = await clientBMsgs.next();
    expect(answerMsg.type).toBe("answer");
    expect(answerMsg.sdp).toBe("answer-for-reconnected");
  });

  // ── Degradation path ────────────────────────────────────────

  it("transitions through reconnecting → degraded when connect always fails", async () => {
    const states: string[] = [];
    const onDegraded = vi.fn();
    const onAttempt = vi.fn();

    // a. Create a UEReconnectHandler with a connect function that always fails
    const handler = new UEReconnectHandler({
      maxRetries: 3,
      backoffIntervals: [10, 10, 10],
      connect: () => Promise.resolve(false),
      onAttempt: (attempt, delayMs) => {
        states.push(`attempt-${attempt}`);
        onAttempt(attempt, delayMs);
      },
      onDegraded: () => {
        states.push("degraded");
        onDegraded();
      },
    });

    // b. Call attemptReconnect()
    expect(handler.getState()).toBe("idle");
    const resultPromise = handler.attemptReconnect();

    // c. Verify it transitions through reconnecting → degraded
    expect(handler.getState()).toBe("reconnecting");

    const result = await resultPromise;

    expect(handler.getState()).toBe("degraded");

    // d. Verify onDegraded callback is fired
    expect(onDegraded).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledTimes(3);

    // e. Verify the handler returns false
    expect(result).toBe(false);

    // Verify the state progression
    expect(states).toEqual([
      "attempt-1",
      "attempt-2",
      "attempt-3",
      "degraded",
    ]);
  });

  // ── Reconnection with expired session ───────────────────────

  it("returns reconnectResult success=false when session has expired", async () => {
    // a. Connect a client, get its playerId
    const client1 = createWs("/client");
    const config1 = await waitForMessage(client1);
    const originalPlayerId = config1.playerId as string;

    // b. Disconnect the client
    client1.close();
    await waitForClose(client1);

    // c. Wait for cleanup
    await delay(50);

    // Verify the session is gone
    expect(signalingProxy.getConnectionCount()).toBe(0);

    // d. Connect a new client
    const client2 = createWs("/client");
    const client2Msgs = createMessageCollector(client2);
    const config2 = await client2Msgs.next();
    expect(config2.type).toBe("config");

    // e. Send a reconnect message with the old playerId
    client2.send(
      JSON.stringify({
        type: "reconnect",
        previousPlayerId: originalPlayerId,
      }),
    );

    // f. Verify reconnectResult success=false (session expired)
    const result = await client2Msgs.next();
    expect(result.type).toBe("reconnectResult");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("previous_session_not_found");
    // Client keeps its new playerId
    expect(result.playerId).toBe(config2.playerId);
  });
});
