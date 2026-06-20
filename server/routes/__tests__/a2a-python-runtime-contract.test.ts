import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import {
  A2A_ERROR_CODES,
  A2A_PYTHON_RUNTIME_CONTRACT_VERSION,
  type A2AEnvelope,
  isA2APythonRuntimeResult,
} from "../../../shared/a2a-protocol.js";
import { A2AClient } from "../../core/a2a-client.js";
import { A2AServer, type AgentExecutor } from "../../core/a2a-server.js";
import a2aRouter, { initA2ARoutes } from "../a2a.js";

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
        expect(cancelBody.result.output).toBe("cancelled");

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
});
