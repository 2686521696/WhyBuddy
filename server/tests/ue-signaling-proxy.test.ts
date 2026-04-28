import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { SignalingProxy } from "../core/ue-signaling-proxy.js";

// ── Helpers ─────────────────────────────────────────────────────

/** Find an available port by letting the OS assign one. */
function getTestPort(): number {
  // Use a random high port to avoid collisions in parallel test runs
  return 30000 + Math.floor(Math.random() * 20000);
}

/** Wait for a WebSocket to reach OPEN state. */
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

/** Collect messages from a WebSocket into a buffer for reliable consumption. */
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

/** Wait for the next message on a WebSocket (simple one-shot). */
function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

/** Wait for a WebSocket close event. */
function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.on("close", () => resolve());
  });
}

/** Small delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tests ───────────────────────────────────────────────────────

describe("SignalingProxy", () => {
  let proxy: SignalingProxy;
  let port: number;
  const openSockets: WebSocket[] = [];

  function createWs(path: string): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    openSockets.push(ws);
    return ws;
  }

  beforeEach(() => {
    port = getTestPort();
    proxy = new SignalingProxy();
    proxy.listen(port);
  });

  afterEach(async () => {
    // Close all test sockets
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    openSockets.length = 0;
    await proxy.close();
  });

  // ── 2.1 WebSocket signaling service ─────────────────────────

  describe("2.1 WebSocket signaling service", () => {
    it("accepts a streamer connection on /streamer", async () => {
      const streamer = createWs("/streamer");
      await waitForOpen(streamer);

      expect(proxy.isStreamerConnected()).toBe(true);
    });

    it("accepts a client connection on /client", async () => {
      const client = createWs("/client");
      await waitForOpen(client);

      expect(proxy.getConnectionCount()).toBe(1);
    });

    it("sends config message with playerId to newly connected client", async () => {
      const client = createWs("/client");
      const msg = await waitForMessage(client);

      expect(msg.type).toBe("config");
      expect(msg.playerId).toBeDefined();
      expect(typeof msg.playerId).toBe("string");
    });

    it("forwards client offer to streamer with playerId", async () => {
      const streamer = createWs("/streamer");
      await waitForOpen(streamer);

      const client = createWs("/client");
      const configMsg = await waitForMessage(client);
      const clientId = configMsg.playerId as string;

      // Streamer receives playerConnected first
      const playerConnectedMsg = await waitForMessage(streamer);
      expect(playerConnectedMsg.type).toBe("playerConnected");

      // Client sends an offer
      const offer = { type: "offer", sdp: "test-sdp" };
      client.send(JSON.stringify(offer));

      const received = await waitForMessage(streamer);
      expect(received.type).toBe("offer");
      expect(received.sdp).toBe("test-sdp");
      expect(received.playerId).toBe(clientId);
    });

    it("forwards streamer answer to the correct client", async () => {
      const streamer = createWs("/streamer");
      await waitForOpen(streamer);

      const client = createWs("/client");
      const configMsg = await waitForMessage(client);
      const clientId = configMsg.playerId as string;

      // Consume the playerConnected message on streamer
      await waitForMessage(streamer);

      // Streamer sends an answer targeted at the client
      const answer = { type: "answer", sdp: "answer-sdp", playerId: clientId };
      streamer.send(JSON.stringify(answer));

      const received = await waitForMessage(client);
      expect(received.type).toBe("answer");
      expect(received.sdp).toBe("answer-sdp");
    });

    it("forwards iceCandidate messages bidirectionally", async () => {
      const streamer = createWs("/streamer");
      await waitForOpen(streamer);

      const client = createWs("/client");
      const configMsg = await waitForMessage(client);
      const clientId = configMsg.playerId as string;

      // Consume playerConnected
      await waitForMessage(streamer);

      // Client -> Streamer
      client.send(JSON.stringify({ type: "iceCandidate", candidate: "client-ice" }));
      const fromClient = await waitForMessage(streamer);
      expect(fromClient.type).toBe("iceCandidate");
      expect(fromClient.candidate).toBe("client-ice");
      expect(fromClient.playerId).toBe(clientId);

      // Streamer -> Client
      streamer.send(
        JSON.stringify({
          type: "iceCandidate",
          candidate: "streamer-ice",
          playerId: clientId,
        }),
      );
      const fromStreamer = await waitForMessage(client);
      expect(fromStreamer.type).toBe("iceCandidate");
      expect(fromStreamer.candidate).toBe("streamer-ice");
    });

    it("rejects connections on unknown paths", async () => {
      const ws = createWs("/unknown");
      await expect(waitForOpen(ws)).rejects.toThrow();
    });

    it("ignores malformed JSON messages from clients", async () => {
      const streamer = createWs("/streamer");
      await waitForOpen(streamer);

      const client = createWs("/client");
      await waitForMessage(client); // config

      // Consume playerConnected
      await waitForMessage(streamer);

      // Send malformed data — should not crash
      client.send("not-json{{{");

      // Send a valid message after — should still work
      client.send(JSON.stringify({ type: "offer", sdp: "valid" }));
      const received = await waitForMessage(streamer);
      expect(received.type).toBe("offer");
    });
  });

  // ── 2.2 Multi-client concurrent connections ─────────────────

  describe("2.2 Multi-client concurrent connections", () => {
    it("supports multiple concurrent client connections", async () => {
      const streamer = createWs("/streamer");
      await waitForOpen(streamer);

      const client1 = createWs("/client");
      const config1 = await waitForMessage(client1);

      const client2 = createWs("/client");
      const config2 = await waitForMessage(client2);

      const client3 = createWs("/client");
      const config3 = await waitForMessage(client3);

      expect(proxy.getConnectionCount()).toBe(3);
      expect(config1.playerId).not.toBe(config2.playerId);
      expect(config2.playerId).not.toBe(config3.playerId);
      expect(config1.playerId).not.toBe(config3.playerId);
    });

    it("assigns unique IDs to each client", async () => {
      const client1 = createWs("/client");
      const config1 = await waitForMessage(client1);

      const client2 = createWs("/client");
      const config2 = await waitForMessage(client2);

      expect(config1.playerId).not.toBe(config2.playerId);
    });

    it("routes messages to the correct client based on playerId", async () => {
      const streamer = createWs("/streamer");
      const streamerMsgs = createMessageCollector(streamer);
      await waitForOpen(streamer);

      const client1 = createWs("/client");
      const client1Msgs = createMessageCollector(client1);
      const config1 = await client1Msgs.next();
      const id1 = config1.playerId as string;

      const client2 = createWs("/client");
      const client2Msgs = createMessageCollector(client2);
      const config2 = await client2Msgs.next();
      const id2 = config2.playerId as string;

      // Consume playerConnected messages
      await streamerMsgs.next();
      await streamerMsgs.next();

      // Streamer sends answer to client2 only
      streamer.send(
        JSON.stringify({ type: "answer", sdp: "for-client2", playerId: id2 }),
      );

      const msg2 = await client2Msgs.next();
      expect(msg2.type).toBe("answer");
      expect(msg2.sdp).toBe("for-client2");

      // client1 should NOT receive this message — verify by sending
      // another message to client1 and checking it arrives correctly
      streamer.send(
        JSON.stringify({ type: "answer", sdp: "for-client1", playerId: id1 }),
      );
      const msg1 = await client1Msgs.next();
      expect(msg1.type).toBe("answer");
      expect(msg1.sdp).toBe("for-client1");
    });

    it("getClientIds returns all connected client IDs", async () => {
      const client1 = createWs("/client");
      await waitForMessage(client1);

      const client2 = createWs("/client");
      await waitForMessage(client2);

      const ids = proxy.getClientIds();
      expect(ids).toHaveLength(2);
    });

    it("notifies streamer about existing clients when streamer connects late", async () => {
      // Connect clients first
      const client1 = createWs("/client");
      const config1 = await waitForMessage(client1);
      const id1 = config1.playerId as string;

      const client2 = createWs("/client");
      const config2 = await waitForMessage(client2);
      const id2 = config2.playerId as string;

      // Now connect streamer — attach collector BEFORE open so we don't miss messages
      const streamer = createWs("/streamer");
      const streamerMsgs = createMessageCollector(streamer);
      await waitForOpen(streamer);

      // Streamer should receive playerConnected for both existing clients
      const msg1 = await streamerMsgs.next();
      const msg2 = await streamerMsgs.next();

      const receivedIds = [msg1.playerId, msg2.playerId].sort();
      const expectedIds = [id1, id2].sort();

      expect(msg1.type).toBe("playerConnected");
      expect(msg2.type).toBe("playerConnected");
      expect(receivedIds).toEqual(expectedIds);
    });
  });

  // ── 2.3 Disconnect detection & cleanup ──────────────────────

  describe("2.3 Disconnect detection & cleanup", () => {
    it("emits clientConnected event when a client connects", async () => {
      const connectedIds: string[] = [];
      proxy.onClientConnected((id) => connectedIds.push(id));

      const client = createWs("/client");
      await waitForMessage(client); // config

      expect(connectedIds).toHaveLength(1);
      expect(typeof connectedIds[0]).toBe("string");
    });

    it("emits clientDisconnected event when a client disconnects", async () => {
      const disconnectedIds: string[] = [];
      proxy.onClientDisconnected((id) => disconnectedIds.push(id));

      const client = createWs("/client");
      const config = await waitForMessage(client);
      const clientId = config.playerId as string;

      client.close();
      await waitForClose(client);
      // Small delay to let the event propagate
      await delay(50);

      expect(disconnectedIds).toHaveLength(1);
      expect(disconnectedIds[0]).toBe(clientId);
    });

    it("removes client from session map on disconnect", async () => {
      const client = createWs("/client");
      await waitForMessage(client);

      expect(proxy.getConnectionCount()).toBe(1);

      client.close();
      await waitForClose(client);
      await delay(50);

      expect(proxy.getConnectionCount()).toBe(0);
    });

    it("notifies streamer when a client disconnects", async () => {
      const streamer = createWs("/streamer");
      await waitForOpen(streamer);

      const client = createWs("/client");
      const config = await waitForMessage(client);
      const clientId = config.playerId as string;

      // Consume playerConnected
      await waitForMessage(streamer);

      // Disconnect the client
      client.close();

      const disconnectMsg = await waitForMessage(streamer);
      expect(disconnectMsg.type).toBe("playerDisconnected");
      expect(disconnectMsg.playerId).toBe(clientId);
    });

    it("single client disconnect does not affect other clients (connection isolation)", async () => {
      const streamer = createWs("/streamer");
      const streamerMsgs = createMessageCollector(streamer);
      await waitForOpen(streamer);

      const client1 = createWs("/client");
      const config1 = await waitForMessage(client1);
      const id1 = config1.playerId as string;

      const client2 = createWs("/client");
      const config2 = await waitForMessage(client2);
      const id2 = config2.playerId as string;

      // Consume playerConnected messages
      await streamerMsgs.next();
      await streamerMsgs.next();

      expect(proxy.getConnectionCount()).toBe(2);

      // Disconnect client1
      client1.close();
      await waitForClose(client1);

      // Consume playerDisconnected for client1
      const disconnectMsg = await streamerMsgs.next();
      expect(disconnectMsg.type).toBe("playerDisconnected");
      expect(disconnectMsg.playerId).toBe(id1);

      // client2 should still be connected and functional
      expect(proxy.getConnectionCount()).toBe(1);
      expect(client2.readyState).toBe(WebSocket.OPEN);

      // Verify client2 can still exchange messages
      client2.send(JSON.stringify({ type: "offer", sdp: "still-alive" }));
      const received = await streamerMsgs.next();
      expect(received.type).toBe("offer");
      expect(received.playerId).toBe(id2);
    });

    it("handles streamer disconnect gracefully", async () => {
      const streamer = createWs("/streamer");
      await waitForOpen(streamer);

      expect(proxy.isStreamerConnected()).toBe(true);

      streamer.close();
      await waitForClose(streamer);
      await delay(50);

      expect(proxy.isStreamerConnected()).toBe(false);
    });

    it("cleans up all clients on server close", async () => {
      const client1 = createWs("/client");
      await waitForMessage(client1);

      const client2 = createWs("/client");
      await waitForMessage(client2);

      expect(proxy.getConnectionCount()).toBe(2);

      await proxy.close();

      // After close, connection count should be 0
      expect(proxy.getConnectionCount()).toBe(0);
    });

    it("replaces old streamer when a new one connects", async () => {
      const streamer1 = createWs("/streamer");
      await waitForOpen(streamer1);

      expect(proxy.isStreamerConnected()).toBe(true);

      const streamer2 = createWs("/streamer");
      await waitForOpen(streamer2);

      // Old streamer should be closed
      await waitForClose(streamer1);

      // New streamer should be active
      expect(proxy.isStreamerConnected()).toBe(true);
    });
  });
});
