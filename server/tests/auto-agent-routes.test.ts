import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type http from "node:http";
import a2aRouter from "../routes/a2a.js";
import skillsRouter from "../routes/skills.js";
import guestAgentsRouter from "../routes/guest-agents.js";
import {
  AutoAgentExecutor,
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
        requestContext: request.context,
        requestVersion: request.version,
        requestDelegateAgentId: request.delegateAgentId,
        requestMaxSkills: request.maxSkills,
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

  it("POST /api/a2a/auto-agent forwards metadata and control fields to unified executor", async () => {
    const response = await request(server, "POST", "/api/a2a/auto-agent", {
      kind: "skill",
      targetId: "agent-routing",
      input: "Call the worker",
      context: ["thin slice only", "preserve route metadata"],
      workflowId: "wf-1",
      stage: "tools_and_agents_entry",
      version: "v2026.04.23",
      delegateAgentId: "ceo",
      maxSkills: 4,
      metadata: {
        source: "test",
        sessionId: "session-a2a-1",
        traceId: "trace-a2a-1",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.output).toBe("ok:skill:agent-routing");
    expect(response.body.metadata).toEqual(
      expect.objectContaining({
        workflowId: "wf-1",
        stage: "tools_and_agents_entry",
        requestContext: ["thin slice only", "preserve route metadata"],
        requestVersion: "v2026.04.23",
        requestDelegateAgentId: "ceo",
        requestMaxSkills: 4,
        requestMetadata: {
          source: "test",
          sessionId: "session-a2a-1",
          traceId: "trace-a2a-1",
        },
      }),
    );
    expect(response.body.delegatedTo.agentId).toBe("ceo");
    expect(fakeExecutor.calls.at(-1)).toEqual(
      expect.objectContaining({
        kind: "skill",
        targetId: "agent-routing",
        input: "Call the worker",
        context: ["thin slice only", "preserve route metadata"],
        workflowId: "wf-1",
        stage: "tools_and_agents_entry",
        version: "v2026.04.23",
        delegateAgentId: "ceo",
        maxSkills: 4,
        metadata: {
          source: "test",
          sessionId: "session-a2a-1",
          traceId: "trace-a2a-1",
        },
      }),
    );
  });

  it("POST /api/skills/:id/execute forwards metadata and control fields", async () => {
    const response = await request(server, "POST", "/api/skills/tooling-integration/execute", {
      input: "Build an adapter",
      context: ["Use existing route surfaces", "Keep the response small"],
      delegateAgentId: "ceo",
      workflowId: "wf-2",
      stage: "skills_execute_lane_3",
      version: "skill-v2",
      maxSkills: 2,
      metadata: {
        requestedBy: "lane-3",
        traceId: "trace-skill-1",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.output).toBe("ok:skill:tooling-integration");
    expect(response.body.metadata).toEqual(
      expect.objectContaining({
        workflowId: "wf-2",
        stage: "skills_execute_lane_3",
        requestContext: ["Use existing route surfaces", "Keep the response small"],
        requestVersion: "skill-v2",
        requestDelegateAgentId: "ceo",
        requestMaxSkills: 2,
        requestMetadata: {
          requestedBy: "lane-3",
          traceId: "trace-skill-1",
        },
      }),
    );
    expect(fakeExecutor.calls.at(-1)).toEqual(
      expect.objectContaining({
        kind: "skill",
        targetId: "tooling-integration",
        input: "Build an adapter",
        context: ["Use existing route surfaces", "Keep the response small"],
        workflowId: "wf-2",
        stage: "skills_execute_lane_3",
        version: "skill-v2",
        delegateAgentId: "ceo",
        maxSkills: 2,
        metadata: {
          requestedBy: "lane-3",
          traceId: "trace-skill-1",
        },
      }),
    );
  });

  it("POST /api/agents/guest/:id/execute forwards metadata and control fields", async () => {
    const response = await request(server, "POST", "/api/agents/guest/guest_00000001/execute", {
      input: "Review the guest task",
      context: ["Keep it brief", "Stay inside the route contract"],
      sessionId: "session-guest-1",
      requestId: "req-guest-1",
      traceId: "trace-guest-1",
      stage: "guest_agents_execute_lane_3",
      version: "guest-v3",
      delegateAgentId: "guest-manager-1",
      maxSkills: 1,
      metadata: {
        requestedBy: "lane-3",
        links: {
          workflowId: "wf-guest-1",
          sourceApp: "tools-and-agents",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.output).toBe("ok:guest_agent:guest_00000001");
    expect(response.body.metadata).toEqual(
      expect.objectContaining({
        workflowId: "wf-guest-1",
        stage: "guest_agents_execute_lane_3",
        requestId: "req-guest-1",
        traceId: "trace-guest-1",
        sessionId: "session-guest-1",
        links: {
          workflowId: "wf-guest-1",
          sessionId: "session-guest-1",
          sourceApp: "tools-and-agents",
        },
        requestContext: ["Keep it brief", "Stay inside the route contract"],
        requestVersion: "guest-v3",
        requestDelegateAgentId: "guest-manager-1",
        requestMaxSkills: 1,
        requestMetadata: {
          requestedBy: "lane-3",
          workflowId: "wf-guest-1",
          stage: "guest_agents_execute_lane_3",
          requestId: "req-guest-1",
          traceId: "trace-guest-1",
          sessionId: "session-guest-1",
          links: {
            workflowId: "wf-guest-1",
            sessionId: "session-guest-1",
            sourceApp: "tools-and-agents",
          },
        },
      }),
    );
    expect(response.body.delegatedTo.agentId).toBe("guest-manager-1");
    expect(fakeExecutor.calls.at(-1)).toEqual(
      expect.objectContaining({
        kind: "guest_agent",
        targetId: "guest_00000001",
        input: "Review the guest task",
        context: ["Keep it brief", "Stay inside the route contract"],
        workflowId: "wf-guest-1",
        stage: "guest_agents_execute_lane_3",
        version: "guest-v3",
        delegateAgentId: "guest-manager-1",
        maxSkills: 1,
        metadata: {
          requestedBy: "lane-3",
          workflowId: "wf-guest-1",
          stage: "guest_agents_execute_lane_3",
          requestId: "req-guest-1",
          traceId: "trace-guest-1",
          sessionId: "session-guest-1",
          links: {
            workflowId: "wf-guest-1",
            sessionId: "session-guest-1",
            sourceApp: "tools-and-agents",
          },
        },
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

describe("AutoAgentExecutor governance fallback", () => {
  it("reads workflow and session governance from metadata.links for guest agents", async () => {
    const guestAgent = {
      config: {
        id: "guest-audit-1",
        name: "Guest Audit Agent",
        department: "ops",
        role: "worker",
        managerId: "mgr-ops",
        model: "test-model",
        soulMd: "Test guest agent",
      },
      invoke: vi.fn(async (prompt: string) => `handled:${prompt}`),
      invokeJson: vi.fn(),
    };
    const auditEntries: Array<Record<string, unknown>> = [];
    const executor = new AutoAgentExecutor({
      directory: {
        get: (id: string) => (id === "guest-audit-1" ? (guestAgent as any) : undefined),
        getCEO: () => undefined,
        isGuest: (id: string) => id === "guest-audit-1",
      },
      skills: {
        resolveSkills: () => [],
        resolveMcpForSkill: () => [],
      },
      skillMonitor: {
        recordMetrics: vi.fn(),
      },
      auditLogger: {
        log(entry: Record<string, unknown>) {
          auditEntries.push(entry);
        },
      } as any,
    });

    const result = await executor.execute({
      kind: "guest_agent",
      targetId: "guest-audit-1",
      input: "Audit the governance chain",
      stage: "guest_agent_governance_audit",
      metadata: {
        requestId: "req-guest-audit-1",
        traceId: "trace-guest-audit-1",
        links: {
          workflowId: "wf-guest-audit-1",
          sessionId: "session-guest-audit-1",
          sourceApp: "tools-and-agents",
        },
      },
    });

    expect(result.output).toBe("handled:Audit the governance chain");
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      resource: "auto_agent:guest_agent:guest-audit-1",
      result: "allowed",
      metadata: expect.objectContaining({
        workflowId: "wf-guest-audit-1",
        sessionId: "session-guest-audit-1",
        requestId: "req-guest-audit-1",
        traceId: "trace-guest-audit-1",
        sourceApp: "tools-and-agents",
        stage: "guest_agent_governance_audit",
      }),
    });
  });
});
