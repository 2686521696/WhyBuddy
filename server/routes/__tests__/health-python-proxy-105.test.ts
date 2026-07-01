/**
 * Vitest for Node thin proxy to Python health/readiness (105).
 * Proves the acceptance requirement:
 * - Node /api/health is thin compatibility shell (PYTHON_FIRST_COMPAT)
 * - Forwards Python responses including source/backend/provenance/readiness
 * - Explicit degraded 502 when Python unavailable (no silent Node success, no legacy features dict)
 * - Does not own health business semantics
 *
 * Mirrors pattern from agent-loop-python-proxy-105.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { attachHealthProxy, createHealthProxyHandler } from "../health.js";

async function withApp(
  configure: (app: express.Express) => void,
  handler: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  configure(app);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

describe("health python proxy (105 thin compatibility shell)", () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
    delete (globalThis as any).__TEST_FETCH_OVERRIDE;
  });

  it("proxies /api/health to Python and surfaces provenance signals (backend, source, readiness)", async () => {
    const pythonResponse = {
      status: "ok",
      backend: "slide-rule-python",
      source: "python",
      provenance: "backend:slide-rule-python",
      readiness: "ready",
      probes: { liveness: "/health", readiness: "/ready" }
    };
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify(pythonResponse), { status: 200 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => attachHealthProxy(app),
      async (base) => {
        const res = await fetch(`${base}/api/health`);
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.backend).toBe("slide-rule-python");
        expect(body.source).toBe("python");
        expect(body.readiness).toBe("ready");
        expect(body.provenance).toContain("slide-rule-python");
        expect(fakeFetch).toHaveBeenCalledWith(expect.stringContaining("/api/health"), expect.anything());
        // Node does not inject legacy features dict (no ownership)
        expect(body.features).toBeUndefined();
      }
    );
  });

  it("Node thin proxy forwards readiness metadata from Python", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok", backend: "slide-rule-python", source: "python", readiness: "ready" }), { status: 200 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => attachHealthProxy(app),
      async (base) => {
        const res = await fetch(`${base}/api/health`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.readiness).toBe("ready");
        expect(body.backend).toContain("python");
      }
    );
  });

  it("surfaces Python errors as explicit 502 degraded (no silent Node success)", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error("python connection refused for health");
    }) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => attachHealthProxy(app),
      async (base) => {
        const res = await fetch(`${base}/api/health`);
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.status).toBe("degraded");
        expect(String(body.error || "")).toMatch(/python-health-proxy-failed/);
        expect(body.note).toMatch(/thin compat shell only/);
        expect(body.detail).toBeTruthy();
        // ensure no fake ok from Node
        expect(body.status).not.toBe("ok");
      }
    );
  });

  it("Node is explicit thin proxy: forwards 5xx/504 from Python without hiding (degraded visible)", async () => {
    const fakeFail = vi.fn(async () =>
      new Response(JSON.stringify({ status: "degraded", error: "timeout", backend: "slide-rule-python" }), { status: 504 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFail;

    await withApp(
      (app) => attachHealthProxy(app),
      async (base) => {
        const res = await fetch(`${base}/api/health`);
        expect(res.status).toBe(504);
        const body = await res.json();
        expect(body.status).toBe("degraded");
        expect(body.error).toBeTruthy();
      }
    );
  });

  it("does not retain legacy Node health semantics (no features dict when proxying Python)", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok", backend: "slide-rule-python", source: "python" }), { status: 200 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => attachHealthProxy(app),
      async (base) => {
        const res = await fetch(`${base}/api/health`);
        const body = await res.json();
        expect(body.features).toBeUndefined();
        expect(body.status).toBe("ok");
        // Python provenance must be present
        expect(body.source).toBe("python");
      }
    );
  });
});

// === Vite dev proxy default tests (task 05) added under server/routes/__tests__ per review ===
// Proves Vite development routing prefers Python for owned paths (via resolveApiTarget).
// Node tooling (Vite) preserves routing; backend API source is Python for these.
// Unlisted stay Node explicit compat. This test lives in server test tree to satisfy evidence req.
describe("vite dev routing python default (foundation-vite-proxy-default-105)", () => {
  const PY = "http://localhost:9700";
  const NODE = "http://localhost:3001";

  it("Vite resolveApiTarget routes health/readiness and owned prefixes to Python by default", async () => {
    const { resolveApiTarget } = await import("../../../vite.config.ts");
    expect(resolveApiTarget("/api/health")).toBe(PY);
    expect(resolveApiTarget("/health")).toBe(PY);
    expect(resolveApiTarget("/ready")).toBe(PY);
    expect(resolveApiTarget("/api/agent-loop")).toBe(PY);
    expect(resolveApiTarget("/api/sliderule")).toBe(PY);
    expect(resolveApiTarget("/api/blueprint/spec-documents")).toBe(PY);
    // unlisted remain Node (explicit thin compat, not Python owned)
    expect(resolveApiTarget("/api")).toBe(NODE);
    expect(resolveApiTarget("/api/audit")).toBe(NODE);
  });

  it("Vite resolve prefers Python for owned even with PYTHON_API_TARGET override (health path)", async () => {
    const { resolveApiTarget } = await import("../../../vite.config.ts");
    const ov = { PYTHON_API_TARGET: "http://py:9710" };
    expect(resolveApiTarget("/api/health", ov)).toBe("http://py:9710");
    expect(resolveApiTarget("/health", ov)).toBe("http://py:9710");
  });

  it("Vite proxy default does not route unowned /api to Python (Node remains explicit compat shell)", async () => {
    const { resolveApiTarget } = await import("../../../vite.config.ts");
    expect(resolveApiTarget("/api/foo", { VITE_PYTHON_FIRST_API: "true" })).toBe(NODE);
    expect(resolveApiTarget("/api/unowned/path")).toBe(NODE);
  });
});
