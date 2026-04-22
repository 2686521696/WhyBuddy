import { describe, expect, it, vi } from "vitest";

import { PassthroughApiExecutor } from "../tool/api/passthrough-api-adapter.js";

function makeAuditLogger() {
  return {
    entries: [] as Array<Record<string, unknown>>,
    log(entry: Record<string, unknown>) {
      this.entries.push(entry);
    },
  };
}

function makeJsonResponse(
  body: unknown,
  init: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    url?: string;
  } = {},
): Response {
  const response = new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (init.url) {
    Object.defineProperty(response, "url", {
      value: init.url,
      configurable: true,
    });
  }

  return response;
}

describe("PassthroughApiExecutor", () => {
  it("executes a whitelisted passthrough request and masks sensitive response fields", async () => {
    const auditLogger = makeAuditLogger();
    const fetchImpl = vi.fn(async () =>
      makeJsonResponse(
        {
          ok: true,
          contact: "alice@example.com",
          token: "secret-token",
        },
        {
          url: "https://api.example.test/weather",
        },
      ),
    );
    const executor = new PassthroughApiExecutor({
      fetchImpl,
      auditLogger,
    });

    const result = await executor.execute({
      targetId: "proxy.weather",
      input: "读取天气代理",
      context: [],
      workflowId: "wf-pass-1",
      stage: "execution",
      metadata: {
        agentId: "agent-pass-1",
        url: "https://api.example.test/weather",
        method: "POST",
        whitelist: ["https://api.example.test/*"],
        headers: {
          "x-api-key": "plaintext-secret",
        },
        body: {
          city: "Shanghai",
        },
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/weather",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "plaintext-secret",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ city: "Shanghai" }),
      }),
    );
    expect(result.targetLabel).toBe("proxy.weather");
    expect(result.responseStatus).toBe(200);
    expect(result.output).toContain('"status": 200');
    expect(result.output).toContain("a***e@example.com");
    expect(result.output).toContain('"token": "***"');
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      agentId: "agent-pass-1",
      operation: "passthrough_api",
      resourceType: "api",
      action: "call",
      resource: "passthrough_api:proxy.weather",
      result: "allowed",
      metadata: expect.objectContaining({
        requestUrl: "https://api.example.test/weather",
        method: "POST",
        workflowId: "wf-pass-1",
        stage: "execution",
      }),
    });
  });

  it("blocks requests whose URL is outside the whitelist", async () => {
    const auditLogger = makeAuditLogger();
    const fetchImpl = vi.fn();
    const executor = new PassthroughApiExecutor({
      fetchImpl,
      auditLogger,
    });

    await expect(
      executor.execute({
        targetId: "proxy.weather",
        input: "读取天气代理",
        context: [],
        metadata: {
          agentId: "agent-pass-2",
          url: "https://forbidden.example.test/weather",
          whitelist: ["https://api.example.test/*"],
        },
      }),
    ).rejects.toThrow("whitelist blocked URL");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      result: "denied",
      resource: "passthrough_api:proxy.weather",
    });
  });

  it("maps HTTP failure responses into execution errors", async () => {
    const auditLogger = makeAuditLogger();
    const fetchImpl = vi.fn(async () =>
      makeJsonResponse(
        { error: "rate limited", token: "secret-token" },
        {
          status: 429,
          statusText: "Too Many Requests",
          url: "https://api.example.test/weather",
        },
      ),
    );
    const executor = new PassthroughApiExecutor({
      fetchImpl,
      auditLogger,
    });

    await expect(
      executor.execute({
        targetId: "proxy.weather",
        input: "读取天气代理",
        context: [],
        metadata: {
          agentId: "agent-pass-3",
          url: "https://api.example.test/weather",
          whitelist: ["https://api.example.test/*"],
        },
      }),
    ).rejects.toThrow("HTTP 429");

    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      result: "error",
      metadata: expect.objectContaining({
        statusCode: 429,
      }),
    });
  });

  it("times out slow passthrough requests", async () => {
    const auditLogger = makeAuditLogger();
    const fetchImpl = vi.fn(
      async (_input: string, init?: RequestInit) =>
        await new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
          setTimeout(
            () =>
              resolve(
                makeJsonResponse(
                  { ok: true },
                  {
                    url: "https://api.example.test/weather",
                  },
                ),
              ),
            30,
          );
        }),
    );
    const executor = new PassthroughApiExecutor({
      fetchImpl,
      auditLogger,
    });

    await expect(
      executor.execute({
        targetId: "proxy.weather",
        input: "读取天气代理",
        context: [],
        metadata: {
          agentId: "agent-pass-4",
          url: "https://api.example.test/weather",
          whitelist: ["https://api.example.test/*"],
          timeoutMs: 5,
        },
      }),
    ).rejects.toThrow("timed out");

    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      result: "error",
      metadata: expect.objectContaining({
        timeoutMs: 5,
      }),
    });
  });
});
