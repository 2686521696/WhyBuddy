/**
 * WebSocket signaling client for Pixel Streaming signaling proxy.
 *
 * Handles the WebSocket lifecycle and message serialization/deserialization
 * for the signaling channel used during WebRTC negotiation.
 */

import type { SignalingMessage } from './types';

export interface SignalingClientOptions {
  /** Called when a signaling message is received from the server. */
  onMessage: (message: SignalingMessage) => void;
  /** Called when the WebSocket connection opens. */
  onOpen?: () => void;
  /** Called when the WebSocket connection closes. */
  onClose?: (event: CloseEvent) => void;
  /** Called when a WebSocket error occurs. */
  onError?: (event: Event) => void;
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private readonly options: SignalingClientOptions;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  /** Interval in ms between keep-alive pings. */
  private static readonly PING_INTERVAL_MS = 10_000;

  constructor(options: SignalingClientOptions) {
    this.options = options;
  }

  /**
   * Open a WebSocket connection to the signaling proxy.
   * Resolves when the connection is open, rejects on error or timeout.
   */
  connect(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(
          new Error(
            `Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`
          )
        );
        return;
      }

      const timeout = setTimeout(() => {
        this.close();
        reject(new Error('Signaling WebSocket connection timed out'));
      }, 5_000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.startPing();
        this.options.onOpen?.();
        resolve();
      };

      this.ws.onerror = (event) => {
        clearTimeout(timeout);
        this.options.onError?.(event);
        reject(new Error('Signaling WebSocket connection failed'));
      };

      this.ws.onclose = (event) => {
        this.stopPing();
        this.options.onClose?.(event);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as SignalingMessage;
          // Respond to server pings automatically.
          if (message.type === 'ping') {
            this.send({ type: 'pong' });
            return;
          }
          this.options.onMessage(message);
        } catch {
          // Ignore malformed messages.
        }
      };
    });
  }

  /** Send a signaling message to the server. */
  send(message: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /** Close the WebSocket connection and clean up resources. */
  close(): void {
    this.stopPing();
    if (this.ws) {
      // Remove handlers to prevent callbacks after intentional close.
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  /** Whether the underlying WebSocket is currently open. */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ---------------------------------------------------------------------------
  // Keep-alive
  // ---------------------------------------------------------------------------

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, SignalingClient.PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
