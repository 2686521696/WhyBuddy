/**
 * Vitest for Node thin proxy to Python AgentLoop dashboard (105).
 * Proves:
 * - Node is thin proxy (delegates to Python target)
 * - Python-owned paths exercised (health, overview, settings, run detail)
 * - Failures from Python surface as error (no silent success)
 * - Not hiding degraded Python behind Node ok.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// import the proxy creator (Node route under server/routes)
import createAgentLoopRouter from "../agent-loop.js";

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

describe("agent-loop python proxy (105 thin proxy)", () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("proxies health to Python and surfaces backend provenance", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok", backend: "sliderule-python", mode: "bridge" }), { status: 200 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => app.use("/api/agent-loop", createAgentLoopRouter()),
      async (base) => {
        const res = await fetch(`${base}/api/agent-loop/health`);
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.backend).toBe("sliderule-python");
        expect(fakeFetch).toHaveBeenCalledWith(expect.stringContaining("/api/agent-loop/health"), expect.anything());
      }
    );
    delete (globalThis as any).__TEST_FETCH_OVERRIDE;
  });

  it("proxies runs/overview and queue/overview for dashboard", async () => {
    const fakeFetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("runs/overview")) return new Response(JSON.stringify([{ runId: "r1" }]), { status: 200 });
      return new Response(JSON.stringify({ queueRunning: false, tasks: [] }), { status: 200 });
    }) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => app.use("/api/agent-loop", createAgentLoopRouter()),
      async (base) => {
        const ro = await fetch(`${base}/api/agent-loop/runs/overview`);
        expect(ro.status).toBe(200);
        const roBody = await ro.json();
        expect(Array.isArray(roBody)).toBe(true);

        const qo = await fetch(`${base}/api/agent-loop/queue/overview`);
        expect(qo.status).toBe(200);
      }
    );
    delete (globalThis as any).__TEST_FETCH_OVERRIDE;
  });

  it("proxies settings and provider-health", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ effective: { fixAgent: "grok" }, keys: { grokApiKey: "configured" } }), { status: 200 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => app.use("/api/agent-loop", createAgentLoopRouter()),
      async (base) => {
        const s = await fetch(`${base}/api/agent-loop/settings`);
        expect(s.status).toBe(200);
        const sj = await s.json();
        expect(sj.effective || sj).toBeTruthy();

        const ph = await fetch(`${base}/api/agent-loop/provider-health`);
        expect(ph.status).toBe(200);
      }
    );
    delete (globalThis as any).__TEST_FETCH_OVERRIDE;
  });

  it("proxies run detail", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ runId: "rid", status: "DONE" }), { status: 200 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => app.use("/api/agent-loop", createAgentLoopRouter()),
      async (base) => {
        const d = await fetch(`${base}/api/agent-loop/runs/rid`);
        expect(d.status).toBe(200);
        const dj = await d.json();
        expect(dj.runId).toBe("rid");
      }
    );
    delete (globalThis as any).__TEST_FETCH_OVERRIDE;
  });

  it("Node is explicit thin proxy + retained compat shell: surfaces Python 502/timeout/degraded without silent success (105)", async () => {
    const fakeFail = vi.fn(async () =>
      new Response(JSON.stringify({ error: "planner_timeout", degraded: true }), { status: 504 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFail;

    await withApp(
      (app) => app.use("/api/agent-loop", createAgentLoopRouter()),
      async (base) => {
        const bad = await fetch(`${base}/api/agent-loop/runs/bad`);
        // proxy must forward the failure status + envelope so frontend can normalize/retry
        expect(bad.status).toBe(504);
        const bj = await bad.json().catch(() => ({}));
        expect(bj.degraded || String(bj.error || "")).toBeTruthy();
      }
    );
    delete (globalThis as any).__TEST_FETCH_OVERRIDE;
  });

  it("surfaces Python errors as 502 without silent Node success (no hide failure)", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error("python connection refused");
    }) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => app.use("/api/agent-loop", createAgentLoopRouter()),
      async (base) => {
        const res = await fetch(`${base}/api/agent-loop/health`);
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(String(body.error || "")).toMatch(/python-agent-loop|failed/);
        expect(body.ok).not.toBe(true);
        expect(body.detail).toBeTruthy();
      }
    );
    delete (globalThis as any).__TEST_FETCH_OVERRIDE;
  });

  it("Node remains thin proxy: delegates POST control (no own semantics)", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "queued", id: "x" }), { status: 200 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => app.use("/api/agent-loop", createAgentLoopRouter()),
      async (base) => {
        const r = await fetch(`${base}/api/agent-loop/queue/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: "agent-loop/tasks/dummy-105.md", mode: "dry-run" }),
        });
        expect(r.status).toBe(200);
        expect(fakeFetch).toHaveBeenCalled();
      }
    );
    delete (globalThis as any).__TEST_FETCH_OVERRIDE;
  });

  it("frontend python happy path: Node thin proxy for submit goal, surfaces Python result (no retained ownership) 105", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok", source: "python", result: { goal: "ok", envelope: "python-backed" } }), { status: 200 })
    ) as any;
    (globalThis as any).__TEST_FETCH_OVERRIDE = fakeFetch;

    await withApp(
      (app) => app.use("/api/agent-loop", createAgentLoopRouter()),
      async (base) => {
        const r = await fetch(`${base}/api/agent-loop/task/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: "agent-loop/tasks/frontend-python-happy-path-browser-smoke-105.md", dryRun: true }),
        });
        expect(r.status).toBe(200);
        const body = await r.json();
        expect(body.source || body.result?.envelope).toMatch(/python/);
        expect(fakeFetch).toHaveBeenCalledWith(expect.stringContaining("/api/agent-loop/task/run"), expect.anything());
        // Node did not own the result semantics (thin proxy)
      }
    );
    delete (globalThis as any).__TEST_FETCH_OVERRIDE;
  });
});
