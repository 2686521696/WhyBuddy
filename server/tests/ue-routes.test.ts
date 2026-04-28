import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  UEDebugService,
  type UEDebugMetrics,
} from "../core/ue-debug-service.js";
import { createUERouter } from "../routes/ue.js";
import type { UEProcessManager } from "../core/ue-process-manager.js";
import type { SignalingProxy } from "../core/ue-signaling-proxy.js";
import type { UEProcessStatus } from "../../shared/ue/contracts.js";

// ── Helpers ─────────────────────────────────────────────────────

function createMockProcessManager(
  overrides: Partial<{
    status: UEProcessStatus;
    uptime: number;
  }> = {},
) {
  return {
    getStatus: vi.fn(() => overrides.status ?? "running"),
    getUptime: vi.fn(() => overrides.uptime ?? 5000),
    getPid: vi.fn(() => 12345),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    onCrash: vi.fn(),
  } as unknown as UEProcessManager;
}

function createMockSignalingProxy(connectionCount = 2) {
  return {
    getConnectionCount: vi.fn(() => connectionCount),
    listen: vi.fn(),
    close: vi.fn(),
    onClientConnected: vi.fn(),
    onClientDisconnected: vi.fn(),
    isStreamerConnected: vi.fn(() => true),
    getClientIds: vi.fn(() => []),
  } as unknown as SignalingProxy;
}

async function withServer(
  debugService: UEDebugService,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/ue", createUERouter({ debugService }));
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

// ── UEDebugService unit tests ──────────────────────────────────

describe("UEDebugService", () => {
  let processManager: UEProcessManager;
  let signalingProxy: SignalingProxy;
  let service: UEDebugService;

  beforeEach(() => {
    vi.useFakeTimers();
    processManager = createMockProcessManager();
    signalingProxy = createMockSignalingProxy(3);
    service = new UEDebugService(processManager, signalingProxy, {
      intervalMs: 100,
    });
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  it("starts with debug disabled", () => {
    expect(service.isEnabled()).toBe(false);
    expect(service.getDebugState()).toEqual({
      enabled: false,
      intervalMs: 100,
    });
  });

  it("toggle(true) enables debug mode", () => {
    service.toggle(true);
    expect(service.isEnabled()).toBe(true);
  });

  it("toggle(false) disables debug mode", () => {
    service.toggle(true);
    service.toggle(false);
    expect(service.isEnabled()).toBe(false);
  });

  it("toggle() without argument flips the state", () => {
    service.toggle();
    expect(service.isEnabled()).toBe(true);
    service.toggle();
    expect(service.isEnabled()).toBe(false);
  });

  it("toggle is idempotent for same value", () => {
    service.toggle(true);
    service.toggle(true);
    expect(service.isEnabled()).toBe(true);
  });

  it("getHealth returns real status and connectedClients", () => {
    const health = service.getHealth();
    expect(health.status).toBe("running");
    expect(health.connectedClients).toBe(3);
    expect(health.uptime).toBe(5000);
    expect(typeof health.fps).toBe("number");
    expect(typeof health.gpuUsage).toBe("number");
    expect(typeof health.vramUsage).toBe("number");
  });

  it("getHealth returns zero metrics when process is not running", () => {
    const stoppedManager = createMockProcessManager({
      status: "stopped",
      uptime: 0,
    });
    const stoppedService = new UEDebugService(stoppedManager, signalingProxy);
    const health = stoppedService.getHealth();

    expect(health.status).toBe("stopped");
    expect(health.fps).toBe(0);
    expect(health.gpuUsage).toBe(0);
    expect(health.vramUsage).toBe(0);
    expect(health.uptime).toBe(0);

    stoppedService.dispose();
  });

  it("pushes metrics periodically when debug is enabled", () => {
    const pushSpy = vi.fn();
    service.onMetrics(pushSpy);
    service.toggle(true);

    expect(pushSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(pushSpy).toHaveBeenCalledTimes(1);

    const metrics: UEDebugMetrics = pushSpy.mock.calls[0][0];
    expect(metrics).toHaveProperty("fps");
    expect(metrics).toHaveProperty("gpuUsage");
    expect(metrics).toHaveProperty("vramUsage");
    expect(metrics).toHaveProperty("latency");
    expect(metrics).toHaveProperty("connectedClients");
    expect(metrics).toHaveProperty("timestamp");

    vi.advanceTimersByTime(100);
    expect(pushSpy).toHaveBeenCalledTimes(2);
  });

  it("stops pushing metrics when debug is disabled", () => {
    const pushSpy = vi.fn();
    service.onMetrics(pushSpy);
    service.toggle(true);

    vi.advanceTimersByTime(100);
    expect(pushSpy).toHaveBeenCalledTimes(1);

    service.toggle(false);

    vi.advanceTimersByTime(300);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it("dispose stops the timer", () => {
    const pushSpy = vi.fn();
    service.onMetrics(pushSpy);
    service.toggle(true);

    service.dispose();

    vi.advanceTimersByTime(500);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

// ── Route integration tests ────────────────────────────────────

describe("UE Routes", () => {
  // ── GET /api/ue/health ────────────────────────────────────

  describe("GET /api/ue/health", () => {
    it("returns 200 with health response", async () => {
      const pm = createMockProcessManager();
      const sp = createMockSignalingProxy(2);
      const ds = new UEDebugService(pm, sp);

      await withServer(ds, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ue/health`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.status).toBe("running");
        expect(body.connectedClients).toBe(2);
        expect(body.uptime).toBe(5000);
        expect(typeof body.fps).toBe("number");
        expect(typeof body.gpuUsage).toBe("number");
        expect(typeof body.vramUsage).toBe("number");
      });

      ds.dispose();
    });

    it("reflects stopped status when UE is not running", async () => {
      const pm = createMockProcessManager({ status: "stopped", uptime: 0 });
      const sp = createMockSignalingProxy(0);
      const ds = new UEDebugService(pm, sp);

      await withServer(ds, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ue/health`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.status).toBe("stopped");
        expect(body.fps).toBe(0);
        expect(body.uptime).toBe(0);
      });

      ds.dispose();
    });
  });

  // ── GET /api/ue/debug ─────────────────────────────────────

  describe("GET /api/ue/debug", () => {
    it("returns current debug state (disabled by default)", async () => {
      const pm = createMockProcessManager();
      const sp = createMockSignalingProxy();
      const ds = new UEDebugService(pm, sp);

      await withServer(ds, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ue/debug`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toEqual({
          enabled: false,
          intervalMs: 1000,
        });
      });

      ds.dispose();
    });

    it("reflects enabled state after toggle", async () => {
      const pm = createMockProcessManager();
      const sp = createMockSignalingProxy();
      const ds = new UEDebugService(pm, sp);
      ds.toggle(true);

      await withServer(ds, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ue/debug`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.enabled).toBe(true);
      });

      ds.dispose();
    });
  });

  // ── POST /api/ue/debug ────────────────────────────────────

  describe("POST /api/ue/debug", () => {
    it("enables debug mode", async () => {
      const pm = createMockProcessManager();
      const sp = createMockSignalingProxy();
      const ds = new UEDebugService(pm, sp);

      await withServer(ds, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ue/debug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.enabled).toBe(true);
      });

      expect(ds.isEnabled()).toBe(true);
      ds.dispose();
    });

    it("disables debug mode", async () => {
      const pm = createMockProcessManager();
      const sp = createMockSignalingProxy();
      const ds = new UEDebugService(pm, sp);
      ds.toggle(true);

      await withServer(ds, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ue/debug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.enabled).toBe(false);
      });

      expect(ds.isEnabled()).toBe(false);
      ds.dispose();
    });

    it("returns 400 when enabled is not a boolean", async () => {
      const pm = createMockProcessManager();
      const sp = createMockSignalingProxy();
      const ds = new UEDebugService(pm, sp);

      await withServer(ds, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ue/debug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: "yes" }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });

      ds.dispose();
    });

    it("returns 400 when body is empty", async () => {
      const pm = createMockProcessManager();
      const sp = createMockSignalingProxy();
      const ds = new UEDebugService(pm, sp);

      await withServer(ds, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ue/debug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });

      ds.dispose();
    });
  });
});
