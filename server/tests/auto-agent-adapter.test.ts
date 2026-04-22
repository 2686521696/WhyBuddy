import { describe, expect, it, vi } from "vitest";
import type { AgentHandle } from "../../shared/workflow-runtime.js";
import type { SkillBinding, SkillExecutionMetrics } from "../../shared/skill-contracts.js";
import type { WorkflowMcpBinding } from "../../shared/organization-schema.js";
import { AutoAgentExecutor } from "../tool/api/auto-agent-adapter.js";

function makeAgent(
  id: string,
  role: AgentHandle["config"]["role"],
  name = id,
  invokeImpl?: (prompt: string) => Promise<string>
): AgentHandle {
  return {
    config: {
      id,
      name,
      department: "engineering",
      role,
      managerId: role === "ceo" ? null : "ceo",
      model: "test-model",
      soulMd: "You are a helpful test agent.",
    },
    invoke: vi.fn(
      invokeImpl ?? (async (prompt: string) => `handled by ${id}: ${prompt}`)
    ),
    invokeJson: vi.fn(),
  };
}

function makeAuditLogger() {
  return {
    entries: [] as Array<Record<string, unknown>>,
    log(entry: Record<string, unknown>) {
      this.entries.push(entry);
    },
  };
}

describe("AutoAgentExecutor", () => {
  it("executes a resident agent target directly", async () => {
    const resident = makeAgent("agent-1", "worker", "Resident Agent");
    const auditLogger = makeAuditLogger();
    const executor = new AutoAgentExecutor({
      directory: {
        get: (id: string) => (id === resident.config.id ? resident : undefined),
        getCEO: () => resident,
        isGuest: () => false,
      },
      skills: {
        resolveSkills: () => [],
        resolveMcpForSkill: () => [],
      },
      skillMonitor: { recordMetrics: vi.fn() },
      auditLogger,
    });

    const result = await executor.execute({
      kind: "agent",
      targetId: "agent-1",
      input: "Ship the adapter patch",
      context: ["Prefer a thin integration layer."],
      workflowId: "wf-1",
      metadata: {
        agentId: "operator-1",
        sessionId: "session-1",
      },
    });

    expect(result.kind).toBe("agent");
    expect(result.targetId).toBe("agent-1");
    expect(result.delegatedTo.agentId).toBe("agent-1");
    expect(result.output).toContain("handled by agent-1");
    expect(vi.mocked(resident.invoke)).toHaveBeenCalledWith(
      "Ship the adapter patch",
      ["Prefer a thin integration layer."],
      expect.objectContaining({
        workflowId: "wf-1",
        stage: "auto_agent",
      }),
    );
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      agentId: "operator-1",
      operation: "auto_agent",
      resourceType: "api",
      action: "call",
      resource: "auto_agent:agent:agent-1",
      result: "allowed",
      metadata: expect.objectContaining({
        targetKind: "agent",
        targetId: "agent-1",
        workflowId: "wf-1",
        sessionId: "session-1",
        delegatedAgentId: "agent-1",
        delegatedAgentKind: "agent",
        targetLabel: "Resident Agent",
      }),
    });
  });

  it("executes a skill via delegate agent and records metrics", async () => {
    const delegate = makeAgent("ceo", "ceo", "CEO");
    const monitorCalls: SkillExecutionMetrics[] = [];
    const auditLogger = makeAuditLogger();
    const mcpBinding: WorkflowMcpBinding = {
      id: "workflow-memory",
      name: "Workflow Memory",
      server: "internal.memory",
      description: "Memory lookup",
      connection: {
        transport: "internal",
        endpoint: "memory://ceo?workflow=wf-1",
      },
      tools: ["recent_memory"],
    };
    const skillBinding: SkillBinding = {
      skillId: "tooling-integration",
      version: "1.0.0",
      resolvedSkill: {
        id: "tooling-integration",
        name: "Tooling Integration",
        category: "code",
        summary: "Reason about tools.",
        prompt: "Given the context: {context}\n\nUse tools carefully.\n\nInput: {input}",
        requiredMcp: ["workflow-memory"],
        version: "1.0.0",
        tags: ["tooling"],
        enabled: true,
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z",
      },
      mcpBindings: [],
      enabled: true,
      config: { priority: 10 },
    };

    const executor = new AutoAgentExecutor({
      directory: {
        get: (id: string) => (id === delegate.config.id ? delegate : undefined),
        getCEO: () => delegate,
        isGuest: () => false,
      },
      skills: {
        resolveSkills: () => [skillBinding],
        resolveMcpForSkill: () => [mcpBinding],
      },
      skillMonitor: {
        recordMetrics: (metrics: SkillExecutionMetrics) => {
          monitorCalls.push(metrics);
        },
      },
      auditLogger,
    });

    const result = await executor.execute({
      kind: "skill",
      targetId: "tooling-integration",
      input: "Design an internal API adapter",
      context: ["We only need the first thin slice."],
      workflowId: "wf-1",
    });

    expect(result.kind).toBe("skill");
    expect(result.delegatedTo.agentId).toBe("ceo");
    expect(result.metadata.skillIds).toEqual(["tooling-integration"]);
    expect(result.metadata.mcpBindings).toEqual([mcpBinding]);
    expect(monitorCalls).toHaveLength(1);
    expect(monitorCalls[0].skillId).toBe("tooling-integration");
    expect(vi.mocked(delegate.invoke)).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(delegate.invoke).mock.calls[0][0];
    expect(prompt).toContain("Active Skills");
    expect(prompt).toContain("Design an internal API adapter");
    expect(prompt).toContain("Use tools carefully.");
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      agentId: "ceo",
      operation: "auto_agent",
      resourceType: "api",
      action: "call",
      resource: "auto_agent:skill:tooling-integration",
      result: "allowed",
      metadata: expect.objectContaining({
        targetKind: "skill",
        targetId: "tooling-integration",
        delegatedAgentId: "ceo",
        targetLabel: "Tooling Integration",
        mcpBindingCount: 1,
      }),
    });
  });

  it("executes an internal api target via the internal adapter", async () => {
    const auditLogger = makeAuditLogger();
    const executeInternalApi = vi.fn(async () => ({
      output: '{"ok":true}',
      targetLabel: "工作流图实例快照",
      operation: "workflow.graph_instance_snapshot",
      response: { ok: true },
    }));

    const executor = new AutoAgentExecutor({
      directory: {
        get: () => undefined,
        getCEO: () => undefined,
        isGuest: () => false,
      },
      skills: {
        resolveSkills: () => [],
        resolveMcpForSkill: () => [],
      },
      skillMonitor: { recordMetrics: vi.fn() },
      internalApis: {
        execute: executeInternalApi,
      },
      auditLogger,
    });

    const result = await executor.execute({
      kind: "internal_api",
      targetId: "workflow.graph_instance_snapshot",
      input: "读取工作流图",
      workflowId: "wf-1",
      metadata: {
        workflowId: "wf-1",
      },
    });

    expect(executeInternalApi).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "workflow.graph_instance_snapshot",
        input: "读取工作流图",
        workflowId: "wf-1",
        metadata: { workflowId: "wf-1" },
      }),
    );
    expect(result.kind).toBe("internal_api");
    expect(result.output).toBe('{"ok":true}');
    expect(result.delegatedTo.agentId).toBe("internal_api_executor");
    expect(result.metadata.targetLabel).toBe("工作流图实例快照");
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      agentId: "internal_api_executor",
      operation: "auto_agent",
      resourceType: "api",
      action: "call",
      resource: "auto_agent:internal_api:workflow.graph_instance_snapshot",
      result: "allowed",
      metadata: expect.objectContaining({
        targetKind: "internal_api",
        targetId: "workflow.graph_instance_snapshot",
        workflowId: "wf-1",
        delegatedAgentId: "internal_api_executor",
      }),
    });
  });

  it("executes a passthrough_api target via the passthrough adapter", async () => {
    const auditLogger = makeAuditLogger();
    const executePassthroughApi = vi.fn(async () => ({
      output: '{"ok":true,"status":200}',
      targetLabel: "天气代理",
      operation: "proxy.weather",
      response: { ok: true, status: 200 },
      responseStatus: 200,
    }));

    const executor = new AutoAgentExecutor({
      directory: {
        get: () => undefined,
        getCEO: () => undefined,
        isGuest: () => false,
      },
      skills: {
        resolveSkills: () => [],
        resolveMcpForSkill: () => [],
      },
      skillMonitor: { recordMetrics: vi.fn() },
      passthroughApis: {
        execute: executePassthroughApi,
      },
      auditLogger,
    });

    const result = await executor.execute({
      kind: "passthrough_api",
      targetId: "proxy.weather",
      input: "读取天气代理",
      workflowId: "wf-pass-1",
      metadata: {
        url: "https://api.example.test/weather",
        whitelist: ["https://api.example.test/*"],
      },
    });

    expect(executePassthroughApi).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "proxy.weather",
        input: "读取天气代理",
        workflowId: "wf-pass-1",
        metadata: expect.objectContaining({
          url: "https://api.example.test/weather",
          whitelist: ["https://api.example.test/*"],
        }),
      }),
    );
    expect(result.kind).toBe("passthrough_api");
    expect(result.output).toBe('{"ok":true,"status":200}');
    expect(result.delegatedTo.agentId).toBe("passthrough_api_executor");
    expect(result.metadata.targetLabel).toBe("天气代理");
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      agentId: "passthrough_api_executor",
      operation: "auto_agent",
      resourceType: "api",
      action: "call",
      resource: "auto_agent:passthrough_api:proxy.weather",
      result: "allowed",
      metadata: expect.objectContaining({
        targetKind: "passthrough_api",
        targetId: "proxy.weather",
        workflowId: "wf-pass-1",
        delegatedAgentId: "passthrough_api_executor",
      }),
    });
  });

  it("records an error audit entry when auto_agent execution fails", async () => {
    const auditLogger = makeAuditLogger();
    const executor = new AutoAgentExecutor({
      directory: {
        get: () => undefined,
        getCEO: () => undefined,
        isGuest: () => false,
      },
      skills: {
        resolveSkills: () => [],
        resolveMcpForSkill: () => [],
      },
      skillMonitor: { recordMetrics: vi.fn() },
      auditLogger,
    });

    await expect(
      executor.execute({
        kind: "agent",
        targetId: "missing-agent",
        input: "Ship it",
        workflowId: "wf-error-1",
        metadata: {
          agentId: "operator-2",
          missionId: "mission-err-1",
        },
      }),
    ).rejects.toThrow("Target agent not found: missing-agent");

    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      agentId: "operator-2",
      operation: "auto_agent",
      resourceType: "api",
      action: "call",
      resource: "auto_agent:agent:missing-agent",
      result: "error",
      reason: "Target agent not found: missing-agent",
      metadata: expect.objectContaining({
        targetKind: "agent",
        targetId: "missing-agent",
        workflowId: "wf-error-1",
        missionId: "mission-err-1",
      }),
    });
  });

  it("times out slow execution and records recovery metadata", async () => {
    const slowAgent = makeAgent(
      "slow-agent",
      "worker",
      "Slow Agent",
      async (prompt: string) =>
        await new Promise((resolve) => {
          setTimeout(() => resolve(`handled slowly: ${prompt}`), 40);
        }),
    );
    const auditLogger = makeAuditLogger();
    const executor = new AutoAgentExecutor({
      directory: {
        get: (id: string) => (id === slowAgent.config.id ? slowAgent : undefined),
        getCEO: () => slowAgent,
        isGuest: () => false,
      },
      skills: {
        resolveSkills: () => [],
        resolveMcpForSkill: () => [],
      },
      skillMonitor: { recordMetrics: vi.fn() },
      auditLogger,
    });

    await expect(
      executor.execute({
        kind: "agent",
        targetId: "slow-agent",
        input: "Wait for completion",
        metadata: {
          timeoutMs: 5,
          agentId: "operator-timeout",
        },
      }),
    ).rejects.toThrow("timed out");

    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      result: "error",
      metadata: expect.objectContaining({
        timeoutMs: 5,
        retryCount: 0,
        attemptCount: 1,
        requestedTargetKind: "agent",
        requestedTargetId: "slow-agent",
      }),
    });
  });

  it("retries transient failures before succeeding", async () => {
    const flakyAgent = makeAgent("flaky-agent", "worker", "Flaky Agent");
    let attempts = 0;
    vi.mocked(flakyAgent.invoke).mockImplementation(async (prompt: string) => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("temporary upstream failure");
      }
      return `recovered: ${prompt}`;
    });
    const auditLogger = makeAuditLogger();
    const executor = new AutoAgentExecutor({
      directory: {
        get: (id: string) => (id === flakyAgent.config.id ? flakyAgent : undefined),
        getCEO: () => flakyAgent,
        isGuest: () => false,
      },
      skills: {
        resolveSkills: () => [],
        resolveMcpForSkill: () => [],
      },
      skillMonitor: { recordMetrics: vi.fn() },
      auditLogger,
    });

    const result = await executor.execute({
      kind: "agent",
      targetId: "flaky-agent",
      input: "Retry this",
      metadata: {
        retryCount: 1,
        agentId: "operator-retry",
      },
    });

    expect(attempts).toBe(2);
    expect(result.output).toContain("recovered:");
    expect(result.metadata.recovery).toMatchObject({
      attemptCount: 2,
      retryCount: 1,
      fallbackUsed: false,
    });
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      result: "allowed",
      metadata: expect.objectContaining({
        attemptCount: 2,
        retryCount: 1,
        fallbackUsed: false,
      }),
    });
  });

  it("falls back to a backup target after retries are exhausted", async () => {
    const primary = makeAgent("primary-agent", "worker", "Primary Agent");
    vi.mocked(primary.invoke).mockRejectedValue(new Error("primary unavailable"));
    const backup = makeAgent("backup-agent", "worker", "Backup Agent");
    const auditLogger = makeAuditLogger();
    const executor = new AutoAgentExecutor({
      directory: {
        get: (id: string) => {
          if (id === primary.config.id) return primary;
          if (id === backup.config.id) return backup;
          return undefined;
        },
        getCEO: () => primary,
        isGuest: () => false,
      },
      skills: {
        resolveSkills: () => [],
        resolveMcpForSkill: () => [],
      },
      skillMonitor: { recordMetrics: vi.fn() },
      auditLogger,
    });

    const result = await executor.execute({
      kind: "agent",
      targetId: "primary-agent",
      input: "Need backup",
      metadata: {
        retryCount: 1,
        fallback: {
          kind: "agent",
          targetId: "backup-agent",
        },
      },
    });

    expect(result.delegatedTo.agentId).toBe("backup-agent");
    expect(result.metadata.recovery).toMatchObject({
      attemptCount: 3,
      retryCount: 1,
      fallbackUsed: true,
      fallbackTarget: {
        kind: "agent",
        targetId: "backup-agent",
      },
      requestedTarget: {
        kind: "agent",
        targetId: "primary-agent",
      },
    });
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      result: "allowed",
      metadata: expect.objectContaining({
        fallbackUsed: true,
        fallbackTargetKind: "agent",
        fallbackTargetId: "backup-agent",
        requestedTargetKind: "agent",
        requestedTargetId: "primary-agent",
      }),
    });
  });

  it("surfaces fallback failure after primary retries are exhausted", async () => {
    const primary = makeAgent("primary-agent", "worker", "Primary Agent");
    vi.mocked(primary.invoke).mockRejectedValue(new Error("primary unavailable"));
    const backup = makeAgent("backup-agent", "worker", "Backup Agent");
    vi.mocked(backup.invoke).mockRejectedValue(new Error("backup unavailable"));
    const auditLogger = makeAuditLogger();
    const executor = new AutoAgentExecutor({
      directory: {
        get: (id: string) => {
          if (id === primary.config.id) return primary;
          if (id === backup.config.id) return backup;
          return undefined;
        },
        getCEO: () => primary,
        isGuest: () => false,
      },
      skills: {
        resolveSkills: () => [],
        resolveMcpForSkill: () => [],
      },
      skillMonitor: { recordMetrics: vi.fn() },
      auditLogger,
    });

    await expect(
      executor.execute({
        kind: "agent",
        targetId: "primary-agent",
        input: "Need backup",
        metadata: {
          retryCount: 1,
          fallback: {
            kind: "agent",
            targetId: "backup-agent",
          },
        },
      }),
    ).rejects.toThrow("Fallback agent:backup-agent failed: backup unavailable");

    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      result: "error",
      metadata: expect.objectContaining({
        retryCount: 1,
        fallbackTargetKind: "agent",
        fallbackTargetId: "backup-agent",
      }),
    });
  });
});
