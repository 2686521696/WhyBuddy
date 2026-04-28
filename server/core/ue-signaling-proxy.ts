/**
 * UE5 Pixel Streaming Signaling Proxy
 *
 * Bridges browser WebRTC clients with UE5's Pixel Streaming plugin
 * by routing WebSocket-based signaling messages between them.
 *
 * Architecture:
 *   Browser ──ws──▶ /client  ──▶  SignalingProxy  ──▶  /streamer ──ws──▶ UE5
 *
 * The proxy:
 * - Accepts a single streamer (UE5) connection on the `/streamer` path
 * - Accepts multiple browser client connections on the `/client` path
 * - Assigns each client a unique ID and manages independent sessions
 * - Forwards signaling messages (offer, answer, iceCandidate, etc.)
 * - Cleans up sessions on disconnect and emits lifecycle events
 */

import { EventEmitter } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";

// Use ws from socket.io's transitive dependency
// eslint-disable-next-line @typescript-eslint/no-require-imports
import WebSocket, { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";

// ── Types ───────────────────────────────────────────────────────

export interface SignalingProxyOptions {
  /** Path for the UE5 streamer to connect. Defaults to "/streamer". */
  streamerPath?: string;
  /** Path for browser clients to connect. Defaults to "/client". */
  clientPath?: string;
}

interface SignalingMessage {
  type: string;
  playerId?: string;
  [key: string]: unknown;
}

// ── SignalingProxy ──────────────────────────────────────────────

export class SignalingProxy extends EventEmitter {
  private httpServer: HttpServer;
  private wss: WebSocketServer;
  private streamer: WebSocket | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private streamerPath: string;
  private clientPath: string;
  private listening = false;

  constructor(options: SignalingProxyOptions = {}) {
    super();
    this.streamerPath = options.streamerPath ?? "/streamer";
    this.clientPath = options.clientPath ?? "/client";

    this.httpServer = createServer((_req, res) => {
      res.writeHead(404);
      res.end("Not Found");
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on("upgrade", (request, socket, head) => {
      const pathname = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`,
      ).pathname;

      if (pathname === this.streamerPath) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.handleStreamerConnection(ws);
        });
      } else if (pathname === this.clientPath) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.handleClientConnection(ws);
        });
      } else {
        socket.destroy();
      }
    });
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Start listening on the given port.
   */
  listen(port: number): void {
    if (this.listening) return;
    this.listening = true;
    this.httpServer.listen(port);
  }

  /**
   * Returns the number of currently connected browser clients.
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Register a callback for when a browser client connects.
   */
  onClientConnected(callback: (clientId: string) => void): void {
    this.on("clientConnected", callback);
  }

  /**
   * Register a callback for when a browser client disconnects.
   */
  onClientDisconnected(callback: (clientId: string) => void): void {
    this.on("clientDisconnected", callback);
  }

  /**
   * Returns whether the UE5 streamer is currently connected.
   */
  isStreamerConnected(): boolean {
    return (
      this.streamer !== null && this.streamer.readyState === WebSocket.OPEN
    );
  }

  /**
   * Returns a snapshot of all connected client IDs.
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Gracefully close the proxy: disconnect all clients, the streamer,
   * and shut down the HTTP server.
   */
  async close(): Promise<void> {
    // Close all client connections
    for (const [clientId, ws] of this.clients) {
      ws.close(1001, "Server shutting down");
      this.clients.delete(clientId);
    }

    // Close streamer connection
    if (this.streamer) {
      this.streamer.close(1001, "Server shutting down");
      this.streamer = null;
    }

    // Close WebSocket server
    this.wss.close();

    // Close HTTP server
    return new Promise<void>((resolve) => {
      if (!this.listening) {
        resolve();
        return;
      }
      this.httpServer.close(() => {
        this.listening = false;
        resolve();
      });
    });
  }

  // ── Internal: Streamer handling ─────────────────────────────

  private handleStreamerConnection(ws: WebSocket): void {
    // Only allow one streamer at a time
    if (this.streamer && this.streamer.readyState === WebSocket.OPEN) {
      // Remove listeners from old streamer before closing to prevent
      // the close handler from nullifying the new streamer reference
      this.streamer.removeAllListeners();
      this.streamer.close(1000, "New streamer connected");
    }

    this.streamer = ws;
    this.emit("streamerConnected");

    // Notify the streamer about all currently connected clients
    for (const clientId of this.clients.keys()) {
      this.sendToStreamer({
        type: "playerConnected",
        playerId: clientId,
      });
    }

    ws.on("message", (data) => {
      this.handleStreamerMessage(data);
    });

    ws.on("close", () => {
      this.streamer = null;
      this.emit("streamerDisconnected");
    });

    ws.on("error", () => {
      // Error will be followed by close event
    });
  }

  // ── Internal: Client handling ───────────────────────────────

  private handleClientConnection(ws: WebSocket): void {
    const clientId = randomUUID();
    this.clients.set(clientId, ws);

    this.emit("clientConnected", clientId);

    // Notify the streamer that a new player connected
    this.sendToStreamer({
      type: "playerConnected",
      playerId: clientId,
    });

    // Send the client its assigned ID
    this.sendToClient(clientId, {
      type: "config",
      peerConnectionOptions: {},
      playerId: clientId,
    });

    ws.on("message", (data) => {
      this.handleClientMessage(clientId, data);
    });

    ws.on("close", () => {
      this.cleanupClient(clientId);
    });

    ws.on("error", () => {
      // Error will be followed by close event
    });
  }

  // ── Internal: Message routing ───────────────────────────────

  private handleStreamerMessage(data: WebSocket.RawData): void {
    let msg: SignalingMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // Ignore malformed messages
    }

    const targetId = msg.playerId;
    if (!targetId) return;

    // Forward the message to the specific client
    this.sendToClient(targetId, msg);
  }

  private handleClientMessage(
    clientId: string,
    data: WebSocket.RawData,
  ): void {
    let msg: SignalingMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // Ignore malformed messages
    }

    // Handle reconnect messages: attempt to restore a previous session
    if (msg.type === "reconnect") {
      this.handleReconnectMessage(clientId, msg);
      return;
    }

    // Tag the message with the client's ID and forward to streamer
    msg.playerId = clientId;
    this.sendToStreamer(msg);
  }

  /**
   * Handle a reconnect message from a client.
   *
   * When a client sends `{ type: "reconnect", previousPlayerId: "..." }`,
   * the proxy checks if the previous player ID still exists in its session map:
   * - If it does, the new connection takes over the old player ID (session continuity)
   * - If it doesn't (session expired), the client keeps its new player ID
   *
   * In both cases, the client receives a `reconnectResult` message.
   */
  private handleReconnectMessage(
    currentClientId: string,
    msg: SignalingMessage,
  ): void {
    const previousPlayerId = msg.previousPlayerId as string | undefined;

    if (previousPlayerId && this.clients.has(previousPlayerId)) {
      // Previous session still exists — close the old socket and reuse the ID
      const oldWs = this.clients.get(previousPlayerId)!;
      // Remove old socket without triggering cleanup (we're taking over)
      this.clients.delete(previousPlayerId);
      oldWs.removeAllListeners();
      oldWs.close(1000, "Session taken over by reconnect");

      // Move the current connection to the old player ID
      const currentWs = this.clients.get(currentClientId)!;
      this.clients.delete(currentClientId);
      this.clients.set(previousPlayerId, currentWs);

      // Re-bind the message handler to use the restored player ID
      currentWs.removeAllListeners("message");
      currentWs.on("message", (data) => {
        this.handleClientMessage(previousPlayerId, data);
      });
      currentWs.removeAllListeners("close");
      currentWs.on("close", () => {
        this.cleanupClient(previousPlayerId);
      });

      // Notify the client about successful session restoration
      this.sendToClient(previousPlayerId, {
        type: "reconnectResult",
        success: true,
        playerId: previousPlayerId,
      });

      this.emit("clientReconnected", previousPlayerId);
    } else {
      // Previous session not found — keep the new player ID
      this.sendToClient(currentClientId, {
        type: "reconnectResult",
        success: false,
        playerId: currentClientId,
        reason: "previous_session_not_found",
      });
    }
  }

  // ── Internal: Send helpers ──────────────────────────────────

  private sendToStreamer(msg: SignalingMessage): void {
    if (this.streamer && this.streamer.readyState === WebSocket.OPEN) {
      this.streamer.send(JSON.stringify(msg));
    }
  }

  private sendToClient(clientId: string, msg: SignalingMessage): void {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // ── Internal: Cleanup ───────────────────────────────────────

  private cleanupClient(clientId: string): void {
    this.clients.delete(clientId);

    // Notify the streamer that this player disconnected
    this.sendToStreamer({
      type: "playerDisconnected",
      playerId: clientId,
    });

    this.emit("clientDisconnected", clientId);
  }
}
