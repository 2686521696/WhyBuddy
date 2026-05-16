#!/usr/bin/env node
/**
 * Debug helper: subscribe to a blueprint:${jobId} room and dump every event
 * received via socket.io. Used to verify whether stage-progress-emitter calls
 * actually reach the front-end via the relay.
 *
 * Usage:
 *   node scripts/debug-socket-trace.mjs <intakeId> [serverUrl]
 *
 * serverUrl defaults to http://127.0.0.1:3000 (Vite dev) so it tests the
 * proxy path the real browser uses; pass http://127.0.0.1:3001 to test the
 * direct API path.
 */
import { io } from "socket.io-client";

const intakeId = process.argv[2];
const SERVER_URL = process.argv[3] ?? "http://127.0.0.1:3000";
if (!intakeId) {
  console.error("Usage: node scripts/debug-socket-trace.mjs <intakeId> [serverUrl]");
  process.exit(1);
}

console.log(`[trace] connecting to ${SERVER_URL}...`);

const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  reconnection: false,
});

socket.on("connect", () => {
  console.log(`[trace] connected (sid=${socket.id})`);
  console.log(`[trace] subscribing blueprint:${intakeId}`);
  socket.emit("blueprint:subscribe", { jobId: intakeId });
});

socket.on("connect_error", (err) => {
  console.log(`[trace] connect_error: ${err.message}`);
});

socket.on("disconnect", (reason) => {
  console.log(`[trace] disconnected: ${reason}`);
});

socket.on("blueprint:event", (data) => {
  console.log(`[event] ${JSON.stringify(data, null, 2)}`);
});

socket.on("blueprint:batch", (batch) => {
  console.log(`[batch] ${JSON.stringify(batch, null, 2)}`);
});

socket.onAny((eventName, ...args) => {
  if (
    eventName !== "blueprint:event" &&
    eventName !== "blueprint:batch" &&
    !eventName.startsWith("connect") &&
    !eventName.startsWith("disconnect")
  ) {
    console.log(`[any] ${eventName} ${JSON.stringify(args).slice(0, 500)}`);
  }
});

setTimeout(() => {
  console.log("[trace] timeout 90s, exiting");
  socket.close();
  process.exit(0);
}, 90000);
