import { describe, expect, it } from "vitest";

import type {
  BlueprintAgentCrew,
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";
import { createMemoryBlueprintJobStore } from "../../blueprint.js";

import { buildBlueprintServiceContext } from "../context.js";
import {
  createAgentCrewService,
  mapPythonAgentCrewProxyEvent,
} from "./service.js";

function makeJob(id: string, artifacts: BlueprintGenerationArtifact[]): BlueprintGenerationJob {
  return {
    id,
    request: {},
    status: "pending",
    stage: "input",
    version: "v1",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    artifacts,
    events: [],
  };
}

function artifact(
  id: string,
  type: BlueprintGenerationArtifact["type"],
  payload: unknown
): BlueprintGenerationArtifact {
  return {
    id,
    type,
    title: id,
    summary: "",
    createdAt: "2026-05-07T00:00:00.000Z",
    payload,
  };
}

describe("createAgentCrewService (shell)", () => {
  it("getCrew 取最新 agent_crew artifact 的 payload", () => {
    const crew = { id: "crew-1" } as BlueprintAgentCrew;
    const job = makeJob("job-1", [
      artifact("a-1", "agent_crew", crew),
      artifact("a-2", "agent_crew", { id: "crew-2" }),
    ]);
    const jobStore = createMemoryBlueprintJobStore([job]);
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createAgentCrewService(ctx);
    expect(service.getCrew("job-1")?.id).toBe("crew-2");
    expect(service.getCrew("missing")).toBeNull();
  });

  it("listCapabilities 取 capability_registry 的 capabilities 数组", () => {
    const capability = { id: "cap-1" } as BlueprintRuntimeCapability;
    const job = makeJob("job-1", [
      artifact("a-1", "capability_registry", { capabilities: [capability] }),
    ]);
    const jobStore = createMemoryBlueprintJobStore([job]);
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createAgentCrewService(ctx);
    expect(service.listCapabilities("job-1")).toEqual([capability]);
    expect(service.listCapabilities("missing")).toEqual([]);
  });

  it("listInvocations / listEvidence 聚合所有同类型 artifact payload", () => {
    const inv1 = { id: "inv-1" } as BlueprintCapabilityInvocation;
    const inv2 = { id: "inv-2" } as BlueprintCapabilityInvocation;
    const ev = { id: "ev-1" } as BlueprintCapabilityEvidence;
    const job = makeJob("job-1", [
      artifact("a-1", "capability_invocation", inv1),
      artifact("a-2", "capability_invocation", inv2),
      artifact("a-3", "capability_evidence", ev),
    ]);
    const jobStore = createMemoryBlueprintJobStore([job]);
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createAgentCrewService(ctx);
    expect(service.listInvocations("job-1").map(inv => inv.id)).toEqual([
      "inv-1",
      "inv-2",
    ]);
    expect(service.listEvidence("job-1").map(e => e.id)).toEqual(["ev-1"]);
  });
  it("maps Python proxy plan/assign/result/error events without dropping role or budget", () => {
    const baseEvent = {
      contractVersion: "blueprint.agent-crew.proxy.v1",
      id: "proxy-plan-1",
      jobId: "job-1",
      crewId: "crew-1",
      roleId: "role-architecture-planner",
      stage: "runtime_capability",
      occurredAt: "2026-06-20T00:00:00.000Z",
      summary: "Architecture planner prepared a runtime plan.",
      budget: {
        maxIterations: 4,
        maxTokens: 12000,
        timeoutMs: 300000,
        remainingIterations: 3,
        remainingTokens: 8000,
      },
      payload: {
        planId: "plan-1",
      },
    } as const;

    const plan = mapPythonAgentCrewProxyEvent({
      ...baseEvent,
      kind: "plan",
    });
    const assign = mapPythonAgentCrewProxyEvent({
      ...baseEvent,
      id: "proxy-assign-1",
      kind: "assign",
      payload: {
        assignmentId: "assignment-1",
        capabilityId: "role-system-architecture",
        nodeId: "node-1",
      },
    });
    const result = mapPythonAgentCrewProxyEvent({
      ...baseEvent,
      id: "proxy-result-1",
      kind: "result",
      payload: {
        assignmentId: "assignment-1",
        status: "completed",
        artifactIds: ["artifact-1"],
        evidenceIds: ["evidence-1"],
      },
    });
    const error = mapPythonAgentCrewProxyEvent({
      ...baseEvent,
      id: "proxy-error-1",
      kind: "error",
      summary: "Architecture planner exceeded timeout budget.",
      payload: {
        assignmentId: "assignment-1",
        error: {
          code: "agent_timeout",
          message: "Role agent exceeded timeout budget.",
          retryable: true,
        },
      },
    });

    expect([plan.type, assign.type, result.type, error.type]).toEqual([
      "role.agent.plan",
      "role.agent.assign",
      "role.agent.result",
      "role.agent.error",
    ]);
    expect([plan.roleId, assign.roleId, result.roleId, error.roleId]).toEqual([
      "role-architecture-planner",
      "role-architecture-planner",
      "role-architecture-planner",
      "role-architecture-planner",
    ]);
    expect(plan.payload).toMatchObject({
      budget: {
        maxIterations: 4,
        remainingTokens: 8000,
      },
      proxy: {
        contractVersion: "blueprint.agent-crew.proxy.v1",
        kind: "plan",
      },
    });
    expect(assign.capabilityId).toBe("role-system-architecture");
    expect(assign.nodeId).toBe("node-1");
    expect(result.artifactId).toBe("artifact-1");
    expect(result.evidenceId).toBe("evidence-1");
    expect(error.error).toBe("Role agent exceeded timeout budget.");
    expect(error.payload).toMatchObject({
      error: {
        code: "agent_timeout",
        retryable: true,
      },
      budget: {
        maxTokens: 12000,
      },
    });
  });
});
