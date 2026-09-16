import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import WebSocket, { type RawData } from "ws";

/**
 * Based on ws/lib/stream.js backpressure and chisel/share/cio/pipe.go half-close
 * contracts (MIT), implemented here for our protocol. ws.createWebSocketStream
 * closes the entire WS in _final(); raw TCP needs one direction to end while
 * the other continues. Binary frames carry bytes; FIN ends only one direction.
 * There is one WS per TCP stream, so no application multiplexing queue exists.
 */
export class TunnelStream extends Duplex {
  private readFinished = false;
  private writeFinished = false;

  constructor(private readonly ws: WebSocket, private readonly frameBytes: number,
    highWaterMark: number) {
    super({ allowHalfOpen: true, highWaterMark });
    ws.on("message", (data: RawData, binary: boolean) => {
      if (this.destroyed) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (binary) {
        if (this.readFinished || bytes.length > this.frameBytes) {
          this.destroy(new Error("invalid_tunnel_data"));
          return;
        }
        if (!this.push(bytes)) ws.pause();
        return;
      }
      if (bytes.toString() !== "FIN" || this.readFinished) {
        this.destroy(new Error("invalid_tunnel_control"));
        return;
      }
      this.readFinished = true;
      this.push(null);
      this.finishTransport();
    });
    ws.on("error", () => this.destroy(new Error("tunnel_transport_failed")));
    ws.on("close", () => {
      if (!this.readFinished || !this.writeFinished) {
        this.destroy(new Error("tunnel_disconnected"));
      }
    });
  }

  override _read(): void { this.ws.resume(); }

  override _write(chunk: Buffer, _encoding: BufferEncoding,
    callback: (error?: Error | null) => void): void {
    let offset = 0;
    const next = (error?: Error) => {
      if (error) return callback(new Error("tunnel_write_failed"));
      if (offset >= chunk.length) return callback();
      if (this.ws.readyState !== WebSocket.OPEN) return callback(new Error("tunnel_closed"));
      const end = Math.min(offset + this.frameBytes, chunk.length);
      const part = chunk.subarray(offset, end);
      offset = end;
      this.ws.send(part, { binary: true }, next);
    };
    next();
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.ws.readyState !== WebSocket.OPEN) return callback(new Error("tunnel_closed"));
    this.ws.send("FIN", error => {
      if (error) return callback(new Error("tunnel_finish_failed"));
      this.writeFinished = true;
      callback();
      this.finishTransport();
    });
  }

  private finishTransport(): void {
    if (this.readFinished && this.writeFinished && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000);
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (error || !this.readFinished || !this.writeFinished) this.ws.terminate();
    else this.finishTransport();
    callback(error);
  }
}

export function bridgeTunnel(socket: Socket, ws: WebSocket,
  limits: { maxFrameBytes: number; highWaterMark: number; idleTimeoutMs: number }): TunnelStream {
  const stream = new TunnelStream(ws, limits.maxFrameBytes, limits.highWaterMark);
  socket.setTimeout(limits.idleTimeoutMs, () => socket.destroy(new Error("tunnel_idle_timeout")));
  socket.on("error", () => stream.destroy(new Error("local_stream_failed")));
  stream.on("error", () => socket.destroy());
  socket.on("close", () => { if (!stream.destroyed) stream.destroy(); });
  stream.on("close", () => { if (!socket.destroyed) socket.destroy(); });
  socket.pipe(stream).pipe(socket);
  socket.resume();
  return stream;
}
