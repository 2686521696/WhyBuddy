import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkPythonSlideRuleHealth,
  resolvePythonSlideRuleRuntimeConfig,
} from "../../sliderule/python-delegation.js";

const INTERNAL_KEY = "dev-slide-rule-internal";

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function startFakePythonService(): Promise<{
  server: Server;
  baseUrl: string;
  calls: unknown[];
}> {
  const calls: unknown[] = [];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", backend: "fake-python-sliderule" });
  });
  app.post("/api/sliderule/execute-capability", (request, response) => {
    if (request.header("X-Internal-Key") !== INTERNAL_KEY) {
      response.status(403).json({ error: "invalid internal key" });
      return;
    }
    calls.push(request.body);
    response.json({
      title: "Deployment live smoke",
      summary: "Python boundary smoke",
      content: "Python deployment boundary returned a fake report without calling Node LLM.",
      provenance: "python-llm",
      model: "fake-python-deployment-smoke",
      usage: { total_tokens: 7 },
    });
  });
  return { ...(await listen(app)), calls };
}

async function startNodeSlideruleRouter(pythonBaseUrl: string): Promise<{
  server: Server;
  baseUrl: string;
}> {
  vi.stubEnv("SLIDERULE_V5_BACKEND", "python");
  vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", pythonBaseUrl);
  vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", INTERNAL_KEY);
  vi.stubEnv("PYTHON_SLIDE_RULE_TIMEOUT_MS", "5000");

  const { default: slideruleRouter } = await import("../sliderule.js");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/sliderule", slideruleRouter);
  return listen(app);
}

function makeAbortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

describe("Python deployment live-smoke boundary", () => {
  let fakePython: { server: Server; baseUrl: string; calls: unknown[] } | undefined;
  let nodeRouter: { server: Server; baseUrl: string } | undefined;

  afterEach(async () => {
    await closeServer(nodeRouter?.server);
    await closeServer(fakePython?.server);
    nodeRouter = undefined;
    fakePython = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("resolves the deployment runtime config from env", () => {
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://127.0.0.1:9719///");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "deployment-key");
    vi.stubEnv("PYTHON_SLIDE_RULE_TIMEOUT_MS", "2345");

    expect(resolvePythonSlideRuleRuntimeConfig()).toEqual({
      baseUrl: "http://127.0.0.1:9719",
      internalKey: "deployment-key",
      timeoutMs: 2345,
      healthPath: "/health",
      proxyMode: "node-fetch-env",
    });
  });

  it("classifies healthy, unhealthy, timeout, and misconfigured health checks visibly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", backend: "fake-python-sliderule" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "unhealthy", reason: "database unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchSpy.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(makeAbortError()));
        }),
    );
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to parse URL from not-a-url/health"));

    const healthy = await checkPythonSlideRuleHealth({
      baseUrl: "http://python.test",
      internalKey: INTERNAL_KEY,
      timeoutMs: 5000,
      healthPath: "/health",
      proxyMode: "node-fetch-env",
    });
    const unhealthy = await checkPythonSlideRuleHealth({
      baseUrl: "http://python.test",
      internalKey: INTERNAL_KEY,
      timeoutMs: 5000,
      healthPath: "/health",
      proxyMode: "node-fetch-env",
    });
    const timeout = await checkPythonSlideRuleHealth({
      baseUrl: "http://python.test",
      internalKey: INTERNAL_KEY,
      timeoutMs: 1,
      healthPath: "/health",
      proxyMode: "node-fetch-env",
    });
    const misconfigured = await checkPythonSlideRuleHealth({
      baseUrl: "not-a-url",
      internalKey: INTERNAL_KEY,
      timeoutMs: 5000,
      healthPath: "/health",
      proxyMode: "node-fetch-env",
    });

    expect(healthy).toMatchObject({
      ok: true,
      status: 200,
      backend: "fake-python-sliderule",
    });
    expect(unhealthy.ok).toBe(false);
    expect(unhealthy.error).toContain("http 503");
    expect(unhealthy.error).toContain("database unavailable");
    expect(timeout.ok).toBe(false);
    expect(timeout.error).toContain("timed out after 1ms");
    expect(misconfigured.ok).toBe(false);
    expect(misconfigured.error).toContain("Failed to parse URL");
  });

  it("runs the Node Python-mode route through a local Python-shaped service only", async () => {
    fakePython = await startFakePythonService();
    nodeRouter = await startNodeSlideruleRouter(fakePython.baseUrl);

    const llmClient = await import("../../core/llm-client.js");
    const poolJsonLlm = await import("../../sliderule/pool-json-llm.js");
    const primarySpy = vi.spyOn(llmClient as any, "callLLMJsonWithUsage");
    const poolSpy = vi.spyOn(poolJsonLlm as any, "callPoolJsonLlm");

    const response = await fetch(`${nodeRouter.baseUrl}/api/sliderule/execute-capability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilityId: "report.write",
        state: {
          sessionId: "deployment-node-route",
          goal: { text: "write deployment live smoke report" },
          artifacts: [],
        },
        inputArtifactIds: [],
        roleId: "agent",
        turnId: "deployment-node-route",
        userText: "write deployment live smoke report",
      }),
    });

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provenance: "python-llm",
      model: "fake-python-deployment-smoke",
    });
    expect(fakePython.calls).toEqual([
      expect.objectContaining({
        capabilityId: "report.write",
        userText: "write deployment live smoke report",
      }),
    ]);
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
  });
});
