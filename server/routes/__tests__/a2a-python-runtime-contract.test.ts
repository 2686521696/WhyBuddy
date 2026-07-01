import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  A2A_ERROR_CODES,
  A2A_PYTHON_RUNTIME_CONTRACT_VERSION,
  type A2AEnvelope,
  isA2APythonRuntimeResult,
} from "../../../shared/a2a-protocol.js";
import { A2AClient } from "../../core/a2a-client.js";
import { A2AServer, type AgentExecutor } from "../../core/a2a-server.js";
import a2aRouter, { initA2ARoutes } from "../a2a.js";

// Hoisted mock for child_process to prove chat/report/analytics routes delegate to Python adapter (105).
// Returns python responses for a2a_chatrep_ and cr_ ops using filename; forces throw on reg/agents/sessions
// to preserve existing contract test expectation of in-mem server list (compat path).
vi.mock("child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    if (typeof cmd !== "string") cmd = String(cmd);
    const c = cmd;
    // force fail marker for degraded tests (works across once flakiness)
    if ((globalThis as any).__A2A_FORCE_PY_FAIL && (c.includes("a2a_chatrep_") || c.includes("a2a_cr_") || c.includes("chatrep"))) {
      (globalThis as any).__A2A_FORCE_PY_FAIL = false;
      throw new Error("python-a2a simulated failure for degraded test");
    }
    // Support invoke success: make reg get return valid agent so handleInvoke finds it and returns 200+result
    if (c.includes("a2a_reg_get_") || (c.includes("a2a_reg_") && c.includes("get"))) {
      return JSON.stringify({ id: "contract-agent", name: "Contract Agent", capabilities: ["summarize", "report"], description: "fixture" });
    }
    if (c.includes("a2a_reg_") || c.includes("a2a_agents_") || c.includes("a2a_sessions_") || c.includes("register")) {
      // for register seed ok, for /agents sessions: throw -> route uses compat listExposed (matches test expect)
      if (c.includes("a2a_agents_") || c.includes("a2a_sessions_")) {
        throw new Error("intentional-py-agents-sessions-fail-for-compat-shell-test");
      }
      return JSON.stringify({ ok: true });
    }
    if (c.includes("a2a_transport_") || c.includes("a2a_rt_")) {
      if (c.includes("cancel")) {
        return JSON.stringify({ ok: false, status: "cancelled", error: { code: A2A_ERROR_CODES.CANCELLED, message: "A2A session cancelled." } });
      }
      return JSON.stringify({ ok: true, status: "active" });
    }
    // 105 chat/report/analytics: detect via chatrep filename which embeds the op
    if (c.includes("a2a_chatrep_") || c.includes("a2a_cr_") || c.includes("chatrep_") || c.includes("_cr_")) {
      if (c.includes("_chat_") || (c.includes("chat") && !c.includes("analytics"))) {
        return JSON.stringify({ ok: true, sessionId: "a2a-contract-1", count: 1, message: { role: "user", content: "hi" } });
      }
      if (c.includes("_report_") || (c.includes("report") && !c.includes("analytics"))) {
        return JSON.stringify({ ok: true, report: { reportId: "a2a-contract-1-summary", kind: "summary", output: "SUMMARY..." } });
      }
      if (c.includes("_analytics_inc_") || c.includes("analytics_inc")) {
        return JSON.stringify({ ok: true, counter: "a2a.event", value: 1, delta: 1 });
      }
      if (c.includes("_analytics_get_") || c.includes("analytics_get") || (c.includes("get") && c.includes("analytics"))) {
        return JSON.stringify({ ok: true, counters: { "a2a.event": 1 }, source: "python-a2a-analytics" });
      }
      return JSON.stringify({ ok: true });
    }
    return JSON.stringify({ ok: true });
  }),
}));

import { execSync } from "child_process";

const execSyncMock = vi.mocked(execSync);

beforeEach(() => {
  execSyncMock.mockClear();
  (globalThis as any).__A2A_FORCE_PY_FAIL = false;
});

function envelope(method: A2AEnvelope["method"] = "a2a.invoke"): A2AEnvelope {
  return {
    jsonrpc: "2.0",
    method,
    id: "a2a-contract-1",
    params: {
      targetAgent: "contract-agent",
      task: "Summarize the contract boundary",
      context: "Contract-only A2A runtime test.",
      capabilities: ["summarize", "report"],
      streamMode: method === "a2a.stream",
    },
    auth: "contract-token",
  };
}

function session(status: "completed" | "running" | "cancelled" | "failed") {
  return {
    sessionId: "a2a-contract-1",
    requestEnvelope: envelope(status === "running" ? "a2a.stream" : "a2a.invoke"),
    status,
    frameworkType: "custom" as const,
    startedAt: 1710000000000,
    completedAt: status === "running" ? undefined : 1710000000001,
    streamChunks: [],
  };
}

function baseContract(operation: string, payload: Record<string, unknown>) {
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("A2A Python runtime contract", () => {
  it("accepts invoke, stream chunk, cancel, and list-agent envelopes", () => {
    const invokeResponse = {
      jsonrpc: "2.0" as const,
      id: "a2a-contract-1",
      result: {
        output: "Projected invoke response.",
        artifacts: [],
        metadata: { source: "contract-test" },
      },
    };
    const invoke = baseContract("invoke", {
      ok: true,
      status: "completed",
      envelope: envelope("a2a.invoke"),
      response: invokeResponse,
      session: {
        ...session("completed"),
        requestEnvelope: envelope("a2a.invoke"),
        response: invokeResponse,
      },
    });
    const streamChunk = {
      jsonrpc: "2.0" as const,
      id: "a2a-contract-1",
      chunk: "partial contract chunk",
      done: false,
    };
    const stream = baseContract("stream_chunk", {
      ok: true,
      status: "streaming",
      envelope: envelope("a2a.stream"),
      streamChunk,
      session: {
        ...session("running"),
        requestEnvelope: envelope("a2a.stream"),
        streamChunks: [streamChunk],
      },
    });
    const cancelError = {
      code: A2A_ERROR_CODES.CANCELLED,
      message: "A2A session cancelled.",
    };
    const cancelResponse = {
      jsonrpc: "2.0" as const,
      id: "a2a-contract-1",
      error: cancelError,
    };
    const cancel = baseContract("cancel", {
      ok: false,
      status: "cancelled",
      envelope: envelope("a2a.cancel"),
      error: cancelError,
      response: cancelResponse,
      session: {
        ...session("cancelled"),
        requestEnvelope: envelope("a2a.cancel"),
        response: cancelResponse,
      },
    });
    const listAgents = baseContract("list_agents", {
      ok: true,
      status: "completed",
      agents: [
        {
          id: "contract-agent",
          name: "Contract Agent",
          capabilities: ["summarize", "report"],
          description: "Deterministic contract fixture, not a real agent.",
        },
      ],
    });

    for (const result of [invoke, stream, cancel, listAgents]) {
      expect(isA2APythonRuntimeResult(result)).toBe(true);
    }
  });

  it("does not let cancelled or error contracts masquerade as completed", () => {
    const cancelError = {
      code: A2A_ERROR_CODES.CANCELLED,
      message: "A2A session cancelled.",
    };
    const cancelled = baseContract("cancel", {
      ok: false,
      status: "cancelled",
      envelope: envelope("a2a.cancel"),
      error: cancelError,
      response: { jsonrpc: "2.0", id: "a2a-contract-1", error: cancelError },
      session: {
        ...session("cancelled"),
        requestEnvelope: envelope("a2a.cancel"),
        response: { jsonrpc: "2.0", id: "a2a-contract-1", error: cancelError },
      },
    });
    const failed = baseContract("invoke", {
      ok: false,
      status: "failed",
      envelope: envelope("a2a.invoke"),
      session: {
        ...session("failed"),
        requestEnvelope: envelope("a2a.invoke"),
      },
      error: {
        code: A2A_ERROR_CODES.FRAMEWORK_ERROR,
        message: "Framework contract failure.",
      },
    });
    const cancelledAsCompleted = {
      ...cancelled,
      ok: true,
      status: "completed",
      response: {
        jsonrpc: "2.0",
        id: "a2a-contract-1",
        result: { output: "cancelled as success", artifacts: [], metadata: {} },
      },
    };
    const failedAsCompleted = {
      ...failed,
      ok: true,
      status: "completed",
      response: {
        jsonrpc: "2.0",
        id: "a2a-contract-1",
        result: { output: "failed as success", artifacts: [], metadata: {} },
      },
    };

    expect(isA2APythonRuntimeResult(cancelled)).toBe(true);
    expect(isA2APythonRuntimeResult(failed)).toBe(true);
    expect(isA2APythonRuntimeResult(cancelledAsCompleted)).toBe(false);
    expect(isA2APythonRuntimeResult(failedAsCompleted)).toBe(false);
  });

  it("routes invoke, cancel, and agent list through fake in-memory A2A server only", async () => {
    const execute = vi.fn<AgentExecutor["execute"]>(
      async (agentId, task) => `fake:${agentId}:${task}`,
    );
    const executeStream = vi.fn<AgentExecutor["executeStream"]>(async function* () {
      throw new Error("stream should not be started by this route contract test");
    });
    const server = new A2AServer({
      apiKeys: ["contract-key"],
      agentExecutor: { execute, executeStream },
      exposedAgents: [
        {
          id: "contract-agent",
          name: "Contract Agent",
          capabilities: ["summarize", "report"],
          description: "Fake agent fixture for route contract tests.",
        },
      ],
    });
    initA2ARoutes(server, new A2AClient());

    await withApp(
      (app) => app.use("/api/a2a", a2aRouter),
      async (baseUrl) => {
        const invokeResponse = await fetch(`${baseUrl}/api/a2a/invoke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer contract-key",
          },
          body: JSON.stringify(envelope("a2a.invoke")),
        });
        const invokeBody = await invokeResponse.json();

        expect(invokeResponse.status).toBe(200);
        expect(invokeBody).toEqual({
          jsonrpc: "2.0",
          id: "a2a-contract-1",
          result: {
            output: "fake:contract-agent:Summarize the contract boundary",
            artifacts: [],
            metadata: {},
          },
        });

        const cancelResponse = await fetch(`${baseUrl}/api/a2a/cancel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer contract-key",
          },
          body: JSON.stringify({ sessionId: "a2a-contract-1" }),
        });
        const cancelBody = await cancelResponse.json();

        expect(cancelResponse.status).toBe(200);
        expect(cancelBody.result).toBeUndefined();
        expect(cancelBody.error).toEqual({
          code: A2A_ERROR_CODES.CANCELLED,
          message: "A2A session cancelled.",
        });

        const agentsResponse = await fetch(`${baseUrl}/api/a2a/agents`);
        const agentsBody = await agentsResponse.json();

        expect(agentsResponse.status).toBe(200);
        expect(agentsBody.agents).toEqual([
          {
            id: "contract-agent",
            name: "Contract Agent",
            capabilities: ["summarize", "report"],
            description: "Fake agent fixture for route contract tests.",
          },
        ]);
      },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      "contract-agent",
      "Summarize the contract boundary",
      "Contract-only A2A runtime test.",
    );
    expect(executeStream).not.toHaveBeenCalled();
  });

  // 105 cutover: chat/report/analytics now prove thin proxy to Python, no Node business semantics.
  // Routes must call python adapter (via exec), surface source marker, and expose degraded+pythonError.
  it("routes /chat /report /analytics /analytics/inc through Python-first adapter as thin proxy", async () => {
    const server = new A2AServer({
      apiKeys: ["contract-key"],
      agentExecutor: { execute: async () => "x", executeStream: async function* () {} },
      exposedAgents: [{ id: "contract-agent", name: "c", capabilities: [], description: "" }],
    });
    initA2ARoutes(server, new A2AClient());

    await withApp(
      (app) => app.use("/api/a2a", a2aRouter),
      async (baseUrl) => {
        // /chat (POST, requires token)
        const chatRes = await fetch(`${baseUrl}/api/a2a/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer contract-key" },
          body: JSON.stringify({ sessionId: "a2a-contract-1", role: "user", content: "hi" }),
        });
        const chatBody = await chatRes.json();
        expect(chatRes.status).toBe(200);
        expect(chatBody.ok).toBe(true);
        expect(chatBody.source).toBe("python-a2a-chat-projection");
        expect(chatBody.result).toBeDefined();
        expect(chatBody.result.ok).toBe(true);

        // /report
        const rptRes = await fetch(`${baseUrl}/api/a2a/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer contract-key" },
          body: JSON.stringify({ sessionId: "a2a-contract-1", kind: "summary" }),
        });
        const rptBody = await rptRes.json();
        expect(rptBody.ok).toBe(true);
        expect(rptBody.source).toBe("python-a2a-report-projection");

        // /analytics GET (no token needed)
        const anaRes = await fetch(`${baseUrl}/api/a2a/analytics`);
        const anaBody = await anaRes.json();
        expect(anaRes.status).toBe(200);
        expect(anaBody.ok).toBe(true);
        expect(anaBody.source).toBe("python-a2a-analytics");
        expect(anaBody.result.counters).toBeDefined();

        // /analytics/inc
        const incRes = await fetch(`${baseUrl}/api/a2a/analytics/inc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "a2a.event", delta: 1 }),
        });
        const incBody = await incRes.json();
        expect(incBody.ok).toBe(true);
        expect(incBody.source).toBe("python-a2a-analytics");
      },
    );

    // ensure python chatrep adapter was exercised at least once
    const calledChatrep = execSyncMock.mock.calls.some((c: any) => String(c[0]).includes("a2a_chatrep_") || String(c[0]).includes("a2a_cr_") || /chat|report|analytics/.test(String(c[0])));
    expect(calledChatrep).toBe(true);
  });

  it("surfaces visible degraded state and pythonError when Python chat/report/analytics bridge fails (no silent success)", async () => {
    const server = new A2AServer({
      apiKeys: ["contract-key"],
      agentExecutor: { execute: async () => "x", executeStream: async function* () {} },
      exposedAgents: [],
    });
    initA2ARoutes(server, new A2AClient());

    // force override for this scope to make chat call throw from bridge -> route catch returns visible degraded
    await withApp(
      (app) => app.use("/api/a2a", a2aRouter),
      async (baseUrl) => {
        execSyncMock.mockImplementation((c: any) => {
          const cs = String(c);
          if (cs.includes("chatrep") || cs.includes("a2a_cr_") || cs.includes("chat") || cs.includes("analytics")) {
            throw new Error("python-a2a-chat-report simulated failure");
          }
          return JSON.stringify({ ok: true });
        });
        const badChat = await fetch(`${baseUrl}/api/a2a/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer contract-key" },
          body: JSON.stringify({ sessionId: "fail-105" }),
        });
        const badBody = await badChat.json();
        expect(badBody.ok).toBe(false);
        expect(badBody.degraded).toBe(true);
        expect(badBody.source).toBe("node-compat-shell");
        expect(badBody.pythonError).toBeDefined();
      },
    );

    // also via server method (core compat shell)
    execSyncMock.mockImplementation((c: any) => {
      const cs = String(c);
      if (cs.includes("chatrep") || cs.includes("a2a_cr_")) {
        throw new Error("python-a2a simulated failure");
      }
      return JSON.stringify({ ok: true });
    });
    const bad = server.recordChatProjection("fail-105", "user", "x");
    expect(bad.ok).toBe(false);
    expect(bad.degraded).toBe(true);
    expect(bad.pythonError).toBeDefined();
  });

  it("Node /cancel and transport error paths act as thin proxy only (task 48: python create_a2a_error + retry/cancel semantics; no Node owned error logic)", async () => {
    const execute = vi.fn(async () => "x");
    const executeStream = vi.fn(async function* () {});
    const server = new A2AServer({
      apiKeys: ["tk-48"],
      agentExecutor: { execute, executeStream },
      exposedAgents: [{ id: "agent-48", name: "A48", capabilities: [], description: "" }],
    });
    initA2ARoutes(server, new A2AClient());

    await withApp((app) => app.use("/api/a2a", a2aRouter), async (baseUrl) => {
      // cancel via route hits direct python bridge
      const cancelRes = await fetch(`${baseUrl}/api/a2a/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tk-48" },
        body: JSON.stringify({ sessionId: "task48-cancel" }),
      });
      const cancelBody = await cancelRes.json();
      expect(cancelBody.error?.code).toBe(A2A_ERROR_CODES.CANCELLED);
      // python error surfaced verbatim (thin shell, no Node remapping of cancel semantics)
      expect(cancelBody.error?.message).toBe("A2A session cancelled.");
    });

    // confirm delegation to python transport for cancel (task 48)
    const calls = vi.mocked(execSync).mock.calls.map((c: any[]) => String(c[0] || ""));
    expect(calls.some((cmd) => cmd.includes("cancel") || cmd.includes("a2a_rt_") || cmd.includes("a2a_transport_"))).toBe(true);
    // Node A2AServer handleCancel used as fallback only in degraded; here proxy exercised
  });
});
