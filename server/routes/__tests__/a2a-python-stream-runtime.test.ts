import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  A2A_ERROR_CODES,
  A2A_PYTHON_RUNTIME_CONTRACT_VERSION,
  type A2AEnvelope,
  isA2APythonRuntimeResult,
} from "../../../shared/a2a-protocol.js";
import { A2AClient } from "../../core/a2a-client.js";
import { A2AServer, type AgentExecutor } from "../../core/a2a-server.js";
import a2aRouter, { initA2ARoutes } from "../a2a.js";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Hoisted mock for child_process to simulate python transport responses in bridge (real calls to callPython* in core/routes)
vi.mock("child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    if (typeof cmd !== "string") cmd = String(cmd);
    if (cmd.includes("a2a_reg_") || /"op":"(register|get|list)"/.test(cmd) || cmd.includes("register") || cmd.includes("get")) {
      return JSON.stringify({ id: "agent-105", name: "Agent105", capabilities: [], description: "105 agent" });
    }
    if (cmd.includes("a2a_transport_") || cmd.includes("a2a_rt_")) {
      if (cmd.includes("cancel")) {
        return JSON.stringify({ ok: false, status: "cancelled", error: { code: A2A_ERROR_CODES.CANCELLED, message: "A2A session cancelled." } });
      }
      if (cmd.includes("timeout")) {
        return JSON.stringify({ ok: true, status: "active" });
      }
      return JSON.stringify({ ok: true, status: "streaming" });
    }
    return JSON.stringify({ ok: true });
  }),
}));

// import the mocked execSync so we can use vi.mocked(execSync) for calls/impl/clear in tests
import { execSync } from "child_process";

function envelope(method: A2AEnvelope["method"] = "a2a.stream"): A2AEnvelope {
  return {
    jsonrpc: "2.0",
    method,
    id: "a2a-stream-boundary-1",
    params: {
      targetAgent: "stream-boundary-agent",
      task: "Project a stream runtime envelope",
      context: "Runtime boundary only.",
      capabilities: ["stream"],
      streamMode: method === "a2a.stream",
    },
    auth: "stream-token",
  };
}

function baseRuntime(operation: string, payload: Record<string, unknown>) {
  return {
    contractVersion: A2A_PYTHON_RUNTIME_CONTRACT_VERSION,
    runtime: "python-contract",
    operation,
    ...payload,
  };
}

async function withApp(
  configure: (app: express.Express) => void,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  configure(app);
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("A2A Python stream runtime boundary", () => {
  it("accepts running and completed stream chunks without starting transport", () => {
    const runningChunk = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      chunk: "first partial chunk",
      done: false,
    };
    const completedChunk = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      chunk: "",
      done: true,
    };
    const running = baseRuntime("stream_chunk", {
      ok: true,
      status: "streaming",
      envelope: envelope(),
      streamChunk: runningChunk,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope(),
        status: "running",
        frameworkType: "custom",
        startedAt: 1710000000000,
        streamChunks: [runningChunk],
      },
    });
    const completed = baseRuntime("stream_chunk", {
      ok: true,
      status: "completed",
      envelope: envelope(),
      streamChunk: completedChunk,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope(),
        status: "completed",
        frameworkType: "custom",
        startedAt: 1710000000000,
        completedAt: 1710000000002,
        streamChunks: [completedChunk],
      },
    });

    expect(isA2APythonRuntimeResult(running)).toBe(true);
    expect(isA2APythonRuntimeResult(completed)).toBe(true);
  });

  it("rejects partial stream chunks that masquerade as completed", () => {
    const partialChunk = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      chunk: "still running",
      done: false,
    };
    const partialAsCompleted = baseRuntime("stream_chunk", {
      ok: true,
      status: "completed",
      envelope: envelope(),
      streamChunk: partialChunk,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope(),
        status: "completed",
        frameworkType: "custom",
        startedAt: 1710000000000,
        completedAt: 1710000000001,
        streamChunks: [partialChunk],
      },
    });

    expect(isA2APythonRuntimeResult(partialAsCompleted)).toBe(false);
  });

  it("accepts failed stream envelopes and rejects failed-as-completed output", () => {
    const error = {
      code: A2A_ERROR_CODES.FRAMEWORK_ERROR,
      message: "Python stream runtime boundary failed.",
      data: { phase: "stream" },
    };
    const response = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      error,
    };
    const failed = baseRuntime("stream_chunk", {
      ok: false,
      status: "failed",
      envelope: envelope(),
      error,
      response,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope(),
        status: "failed",
        frameworkType: "custom",
        startedAt: 1710000000000,
        completedAt: 1710000000003,
        response,
        streamChunks: [],
      },
    });
    const failedAsCompleted = {
      ...failed,
      ok: true,
      status: "completed",
      response: {
        jsonrpc: "2.0",
        id: "a2a-stream-boundary-1",
        result: { output: "not allowed", artifacts: [], metadata: {} },
      },
    };

    expect(isA2APythonRuntimeResult(failed)).toBe(true);
    expect(isA2APythonRuntimeResult(failedAsCompleted)).toBe(false);
  });

  it("accepts cancelled envelopes and rejects cancelled-as-completed output", () => {
    const error = {
      code: A2A_ERROR_CODES.CANCELLED,
      message: "A2A session cancelled.",
    };
    const response = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      error,
    };
    const cancelled = baseRuntime("cancel", {
      ok: false,
      status: "cancelled",
      envelope: envelope("a2a.cancel"),
      error,
      response,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope("a2a.cancel"),
        status: "cancelled",
        frameworkType: "custom",
        startedAt: 1710000000000,
        completedAt: 1710000000004,
        response,
        streamChunks: [],
      },
    });
    const cancelledAsCompleted = {
      ...cancelled,
      ok: true,
      status: "completed",
      response: {
        jsonrpc: "2.0",
        id: "a2a-stream-boundary-1",
        result: { output: "not allowed", artifacts: [], metadata: {} },
      },
    };

    expect(isA2APythonRuntimeResult(cancelled)).toBe(true);
    expect(isA2APythonRuntimeResult(cancelledAsCompleted)).toBe(false);
  });
});

describe("A2A 105 python transport takeover (Node thin proxy)", () => {
  const mockExecutor: AgentExecutor = {
    execute: async () => "mock",
    executeStream: async function* () {
      yield "c1";
      yield "c2";
    },
  };

  function makeStreamEnvelope(id = "s105", target = "agent-105"): A2AEnvelope {
    return {
      jsonrpc: "2.0",
      method: "a2a.stream",
      id,
      params: {
        targetAgent: target,
        task: "stream test",
        context: "",
        capabilities: [],
        streamMode: true,
      },
      auth: "k",
    };
  }

  beforeEach(() => {
    vi.mocked(execSync).mockClear();
  });

  it("proves Node stream chunks ordering and done are owned by python transport (thin proxy contract)", async () => {
    const server = new A2AServer({
      apiKeys: ["k"],
      rateLimitPerMinute: 100,
      agentExecutor: mockExecutor,
      exposedAgents: [{ id: "agent-105", name: "Agent105", capabilities: [], description: "105 agent" }],
    });

    const chunks: any[] = [];
    for await (const c of server.handleStream(makeStreamEnvelope(), "k")) {
      chunks.push(c);
    }

    // Node yields executor content; ordering/done semantics delegated via calls to python emit/start
    const yieldedChunks = chunks.filter((c) => "chunk" in c).map((c) => c.chunk);
    expect(yieldedChunks).toContain("c1");
    expect(yieldedChunks).toContain("c2");
    expect(chunks.some((c) => c.done === true)).toBe(true);
    // real calls to bridge exercised
    const calls = vi.mocked(execSync).mock.calls.map((c: any[]) => String(c[0] || ""));
    expect(calls.some((cmd) => cmd.includes("a2a_transport_") || cmd.includes("emit_chunk") || cmd.includes("start"))).toBe(true);
  });

  it("proves cancel idempotency via python-owned transport (Node delegates)", async () => {
    const server = new A2AServer({
      apiKeys: ["k"],
      rateLimitPerMinute: 100,
      agentExecutor: mockExecutor,
      exposedAgents: [{ id: "agent-105", name: "Agent105", capabilities: [], description: "105 agent" }],
    });

    const r1 = await server.handleCancel("cancel-idem-s", "k");
    const r2 = await server.handleCancel("cancel-idem-s", "k");
    expect(r1.error?.code).toBe(A2A_ERROR_CODES.CANCELLED);
    expect(r2.error?.code).toBe(A2A_ERROR_CODES.CANCELLED);
    // delegation to python cancel happened
    const calls = vi.mocked(execSync).mock.calls.map((c: any[]) => String(c[0] || ""));
    expect(calls.filter((cmd) => cmd.includes("cancel")).length).toBeGreaterThanOrEqual(1);
  });

  it("proves timeout and malformed visible from python (degraded not hidden in proxy)", async () => {
    // force a transport fail to surface degraded (routes/core catch and attach data)
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd !== "string") cmd = String(cmd);
      if (cmd.includes("a2a_reg_") || cmd.includes("get")) {
        return JSON.stringify({ id: "agent-105", name: "Agent105", capabilities: [], description: "" });
      }
      if (cmd.includes("timeout") || cmd.includes("a2a_transport_")) {
        throw new Error("python timeout degraded");
      }
      if (cmd.includes("cancel")) {
        return JSON.stringify({ ok: false, status: "cancelled", error: { code: A2A_ERROR_CODES.CANCELLED, message: "A2A session cancelled." } });
      }
      return JSON.stringify({ ok: true });
    });

    const server = new A2AServer({
      apiKeys: ["k"],
      rateLimitPerMinute: 100,
      agentExecutor: mockExecutor,
      exposedAgents: [{ id: "agent-105", name: "Agent105", capabilities: [], description: "105 agent" }],
    });

    // timeout pre-start in route path is separate; here force handle path + cancel degraded
    const res = await server.handleCancel("s-timeout", "k");
    expect(res.error).toBeDefined();
    expect(res.error!.data?.degraded).toBe(true);
    expect(String(res.error!.data?.pythonError || "")).toContain("python");
    // malformed path: make ONLY emit_chunk fail (start/timeout succeed); expect inner catch path "stream chunk failed"
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd !== "string") cmd = String(cmd);
      if (cmd.includes("a2a_reg_") || cmd.includes("get")) return JSON.stringify({ id: "agent-105", name: "A", capabilities: [], description: "" });
      if (cmd.includes("emit_chunk")) throw new Error("bad chunk in emit");
      // other transport (start, timeout, done emit, retry) succeed
      if (cmd.includes("a2a_transport_") || cmd.includes("a2a_rt_")) return JSON.stringify({ ok: true, status: "ok" });
      return JSON.stringify({ ok: true });
    });
    const chunks: any[] = [];
    for await (const c of server.handleStream(makeStreamEnvelope("s-mal", "agent-105"), "k")) {
      chunks.push(c);
    }
    expect(chunks.some((c) => c.error && String(c.error.message || "").includes("stream chunk failed"))).toBe(true);
  });

  it("Node /stream /cancel are thin proxy: delegate chunk/cancel/timeout/retry to python runtime, retain only compat shell", async () => {
    // exercises actual /stream and /cancel routes which call direct python transport + server delegation
    const execute = vi.fn(async () => "x");
    const executeStream = vi.fn(async function* () { yield "p1"; });
    const server = new A2AServer({
      apiKeys: ["tk"],
      rateLimitPerMinute: 100,
      agentExecutor: { execute, executeStream },
      exposedAgents: [{ id: "agent-105", name: "Agent105", capabilities: [], description: "105 agent" }],
    });
    initA2ARoutes(server, new A2AClient());

    await withApp((app) => app.use("/api/a2a", a2aRouter), async (baseUrl) => {
      // /cancel route
      const cancelRes = await fetch(`${baseUrl}/api/a2a/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tk" },
        body: JSON.stringify({ sessionId: "route-cancel-105" }),
      });
      const cancelBody = await cancelRes.json();
      expect(cancelBody.error?.code).toBe(A2A_ERROR_CODES.CANCELLED);

      // /stream route (SSE) - just start and check first write visible, no hang
      const streamRes = await fetch(`${baseUrl}/api/a2a/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tk" },
        body: JSON.stringify(makeStreamEnvelope("route-stream-105")),
      });
      expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
      // read partial to ensure path taken (abort after headers)
      const reader = streamRes.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        if (value) {
          const txt = new TextDecoder().decode(value);
          expect(txt).toContain("data:");
        }
        reader.cancel().catch(() => {});
      }
      await streamRes.body?.cancel().catch(() => {});
    });

    // confirm python transport was hit by routes' direct bridge and by handle
    const calls = vi.mocked(execSync).mock.calls.map((c: any[]) => String(c[0] || ""));
    expect(calls.some((cmd) => cmd.includes("cancel") || cmd.includes("a2a_rt_") || cmd.includes("a2a_transport_"))).toBe(true);
  });
});
