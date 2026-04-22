import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type http from "node:http";
import a2aRouter from "../routes/a2a.js";
import skillsRouter from "../routes/skills.js";
import guestAgentsRouter from "../routes/guest-agents.js";
import {
  resetAutoAgentExecutor,
  setAutoAgentExecutor,
  type AutoAgentExecutionRequest,
  type AutoAgentExecutionResult,
} from "../tool/api/auto-agent-adapter.js";

class FakeAutoAgentExecutor {
  readonly calls: AutoAgentExecutionRequest[] = [];

  async execute(request: AutoAgentExecutionRequest): Promise<AutoAgentExecutionResult> {
    this.calls.push(request);
    return {
      kind: request.kind,
      targetId: request.targetId,
      output: `ok:${request.kind}:${request.targetId}`,
      delegatedTo: {
        agentId: request.delegateAgentId ?? (request.kind === "skill" ? "ceo" : request.targetId),
        agentName: "Test Delegate",
        role: "worker",
        kind: request.kind === "guest_agent" ? "guest_agent" : "agent",
      },
      metadata: {
        source: "auto_agent",
        invokedAt: "2026-04-22T00:00:00.000Z",
        workflowId: request.workflowId,
        stage: request.stage,
        requestMetadata: request.metadata,
      },
    };
  }
}

async function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server address is unavailable");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

describe("auto-agent routes", () => {
  let server: http.Server;
  let fakeExecutor: FakeAutoAgentExecutor;

  beforeAll(async () => {
    fakeExecutor = new FakeAutoAgentExecutor();
    setAutoAgentExecutor(fakeExecutor);

    const app = express();
    app.use(express.json());
    app.use("/api/a2a", a2aRouter);
    app.use("/api/skills", skillsRouter);
    app.use("/api/agents/guest", guestAgentsRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
  });

  afterAll(async () => {
    resetAutoAgentExecutor();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("POST /api/a2a/auto-agent dispatches to unified executor", async () => {
    const response = await request(server, "POST", "/api/a2a/auto-agent", {
      kind: "agent",
      targetId: "agent-1",
      input: "Call the worker",
      context: ["thin slice only"],
      workflowId: "wf-1",
      metadata: { source: "test" },
    });

    expect(response.status).toBe(200);
    expect(response.body.output).toBe("ok:agent:agent-1");
    expect(fakeExecutor.calls.at(-1)).toEqual(
      expect.objectContaining({
        kind: "agent",
        targetId: "agent-1",
        input: "Call the worker",
        context: ["thin slice only"],
        workflowId: "wf-1",
      }),
    );
  });

  it("POST /api/skills/:id/execute dispatches a skill execution", async () => {
    const response = await request(server, "POST", "/api/skills/tooling-integration/execute", {
      input: "Build an adapter",
      context: "Use existing route surfaces",
      delegateAgentId: "ceo",
      workflowId: "wf-2",
    });

    expect(response.status).toBe(200);
    expect(response.body.output).toBe("ok:skill:tooling-integration");
    expect(fakeExecutor.calls.at(-1)).toEqual(
      expect.objectContaining({
        kind: "skill",
        targetId: "tooling-integration",
        input: "Build an adapter",
        context: ["Use existing route surfaces"],
        delegateAgentId: "ceo",
      }),
    );
  });

  it("POST /api/agents/guest/:id/execute dispatches a guest agent execution", async () => {
    const response = await request(server, "POST", "/api/agents/guest/guest_00000001/execute", {
      input: "Review the guest task",
      context: ["Keep it brief"],
    });

    expect(response.status).toBe(200);
    expect(response.body.output).toBe("ok:guest_agent:guest_00000001");
    expect(fakeExecutor.calls.at(-1)).toEqual(
      expect.objectContaining({
        kind: "guest_agent",
        targetId: "guest_00000001",
        input: "Review the guest task",
        context: ["Keep it brief"],
      }),
    );
  });

  it("POST /api/a2a/auto-agent accepts an internal_api target", async () => {
    const response = await request(server, "POST", "/api/a2a/auto-agent", {
      kind: "internal_api",
      targetId: "workflow.graph_instance_snapshot",
      input: "读取快照",
      workflowId: "wf-internal-1",
      metadata: {
        workflowId: "wf-internal-1",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.output).toBe("ok:internal_api:workflow.graph_instance_snapshot");
    expect(fakeExecutor.calls.at(-1)).toEqual(
      expect.objectContaining({
        kind: "internal_api",
        targetId: "workflow.graph_instance_snapshot",
        input: "读取快照",
        workflowId: "wf-internal-1",
      }),
    );
  });

  it("POST /api/a2a/auto-agent accepts a passthrough_api target", async () => {
    const response = await request(server, "POST", "/api/a2a/auto-agent", {
      kind: "passthrough_api",
      targetId: "proxy.weather",
      input: "读取天气代理",
      workflowId: "wf-pass-1",
      metadata: {
        url: "https://api.example.test/weather",
        whitelist: ["https://api.example.test/*"],
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.output).toBe("ok:passthrough_api:proxy.weather");
    expect(fakeExecutor.calls.at(-1)).toEqual(
      expect.objectContaining({
        kind: "passthrough_api",
        targetId: "proxy.weather",
        input: "读取天气代理",
        workflowId: "wf-pass-1",
      }),
    );
  });

  it("POST /api/a2a/auto-agent rejects an unknown kind", async () => {
    const response = await request(server, "POST", "/api/a2a/auto-agent", {
      kind: "unknown_kind",
      targetId: "svc-1",
      input: "ping",
    });

    expect(response.status).toBe(400);
    expect(String(response.body.error)).toContain("kind");
  });
});
