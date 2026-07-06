/**
 * Node -> Python thin proxy for the audit runtime surfaces served by
 * slide-rule-python routes/audit.py (sink / retention-export /
 * evidence/classify), behind AUDIT_PYTHON_PROXY (security-sensitive,
 * default OFF — explicit "true" opts in).
 *
 * These endpoints have no Node business implementation: flag off keeps the
 * existing Node surface (404 on these paths, the real hash-chained audit
 * store untouched); infra failures surface as an explicit 502
 * python_unavailable.
 */

import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuditRouter, type AuditRouterDeps } from "../audit.js";

const PYTHON_BASE = "http://python-audit.test";
const INTERNAL_KEY = "internal-audit";

function makeDeps(): AuditRouterDeps {
  return {
    chain: {
      getEntry: vi.fn(),
      getEntryCount: vi.fn(() => 0),
      getEntries: vi.fn(() => []),
    } as unknown as AuditRouterDeps["chain"],
    query: {} as AuditRouterDeps["query"],
    verifier: {} as AuditRouterDeps["verifier"],
    anomalyDetector: {} as AuditRouterDeps["anomalyDetector"],
    complianceMapper: {} as AuditRouterDeps["complianceMapper"],
    auditExport: {} as AuditRouterDeps["auditExport"],
    auditRetention: {} as AuditRouterDeps["auditRetention"],
    collector: {} as AuditRouterDeps["collector"],
  };
}

async function withServer(handler: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/audit", createAuditRouter(makeDeps()));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  const address = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function stubPythonFetch(
  reply: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1:")) {
      return originalFetch(input as RequestInfo, init);
    }
    return reply(url, init as RequestInit);
  });
}

function pythonCalls(fetchSpy: ReturnType<typeof stubPythonFetch>) {
  return fetchSpy.mock.calls.filter(
    ([url]) => !String(url instanceof Request ? url.url : url).startsWith("http://127.0.0.1:"),
  );
}

describe("audit Python thin proxy (AUDIT_PYTHON_PROXY)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates sink / retention-export / evidence classify to Python when enabled", async () => {
    vi.stubEnv("AUDIT_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", `${PYTHON_BASE}/`);
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", INTERNAL_KEY);
    const replies: Record<string, unknown> = {
      [`${PYTHON_BASE}/api/audit/sink`]: {
        ok: true,
        status: "written",
        provenance: "python-audit-sink",
        externalEmit: false,
      },
      [`${PYTHON_BASE}/api/audit/retention-export`]: {
        ok: true,
        status: "exported",
        provenance: "python-audit-retention-export",
        manifest: { entries: 2 },
      },
      [`${PYTHON_BASE}/api/audit/evidence/classify`]: {
        ok: true,
        classification: "retain",
        provenance: "python-audit-evidence-slice",
      },
    };
    const fetchSpy = stubPythonFetch(async (url) => {
      const body = replies[url];
      if (!body) throw new Error(`unexpected python call: ${url}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await withServer(async (baseUrl) => {
      const sinkResponse = await fetch(`${baseUrl}/api/audit/sink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: { eventType: "data_accessed" } }),
      });
      expect(sinkResponse.status).toBe(200);
      expect(((await sinkResponse.json()) as Record<string, any>).provenance).toBe(
        "python-audit-sink",
      );

      const retentionResponse = await fetch(`${baseUrl}/api/audit/retention-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export" }),
      });
      expect(retentionResponse.status).toBe(200);
      expect(((await retentionResponse.json()) as Record<string, any>).manifest).toEqual({
        entries: 2,
      });

      const classifyResponse = await fetch(`${baseUrl}/api/audit/evidence/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidence: [] }),
      });
      expect(classifyResponse.status).toBe(200);
      expect(((await classifyResponse.json()) as Record<string, any>).classification).toBe(
        "retain",
      );
    });

    const calls = pythonCalls(fetchSpy);
    expect(calls).toHaveLength(3);
    const [sinkUrl, sinkInit] = calls[0];
    expect(String(sinkUrl)).toBe(`${PYTHON_BASE}/api/audit/sink`);
    expect((sinkInit as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": INTERNAL_KEY,
    });
    expect(JSON.parse(String((sinkInit as RequestInit).body))).toEqual({
      event: { eventType: "data_accessed" },
    });
  });

  it("passes Python business 400 responses through verbatim", async () => {
    vi.stubEnv("AUDIT_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    stubPythonFetch(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            status: "invalid_payload",
            error: { code: "invalid_payload", message: "event is required" },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    );

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/audit/sink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false,
        status: "invalid_payload",
        error: { code: "invalid_payload", message: "event is required" },
      });
    });
  });

  it("returns an explicit 502 python_unavailable on infra failure (no Node business exists)", async () => {
    vi.stubEnv("AUDIT_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    stubPythonFetch(
      async () =>
        new Response(JSON.stringify({ detail: "boom" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/audit/retention-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export" }),
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "python_unavailable",
        backend: "python",
        endpoint: "/api/audit/retention-export",
      });
    });
  });

  it("keeps the existing Node surface when the flag is off (default)", async () => {
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    const fetchSpy = stubPythonFetch(async () => {
      throw new Error("python must not be called when AUDIT_PYTHON_PROXY is off");
    });

    await withServer(async (baseUrl) => {
      // Delegated paths fall through to the existing Node surface: 404.
      const sinkResponse = await fetch(`${baseUrl}/api/audit/sink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: {} }),
      });
      expect(sinkResponse.status).toBe(404);

      // Node-owned audit surface keeps working untouched.
      const statsResponse = await fetch(`${baseUrl}/api/audit/stats`);
      expect(statsResponse.status).toBe(200);
      expect(((await statsResponse.json()) as Record<string, any>).totalEntries).toBe(0);
    });
    expect(pythonCalls(fetchSpy)).toHaveLength(0);
  });
});
