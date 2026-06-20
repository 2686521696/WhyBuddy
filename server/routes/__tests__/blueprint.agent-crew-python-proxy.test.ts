import { describe, expect, it } from "vitest";

import type {
  BlueprintAgentCrew,
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
} from "../../../shared/blueprint/index.js";
import { createMemoryBlueprintJobStore } from "../blueprint.js";
import { buildBlueprintServiceContext } from "../blueprint/context.js";
import { createAgentCrewService } from "../blueprint/agent-crew/service.js";

function artifact(
  id: string,
  type: BlueprintGenerationArtifact["type"],
  payload: unknown,
): BlueprintGenerationArtifact {
  return {
    id,
    type,
    title: id,
    summary: "",
    createdAt: "2026-06-20T00:00:00.000Z",
    payload,
  };
}

function makeJob(artifacts: BlueprintGenerationArtifact[]): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: {
      targetText: "Build a payment approval workflow",
      githubUrls: [],
    },
    status: "reviewing",
    stage: "runtime_capability",
    version: "v1",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    artifacts,
    events: [],
  };
}

function makeCrew(): BlueprintAgentCrew {
  return {
    id: "crew-1",
    jobId: "job-1",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    stage: "runtime_capability",
    roles: [],
    capabilityMatrix: [],
    activationPolicies: [],
    presence: [],
    sourceIds: {},
  };
}

describe("Blueprint agent-crew Python proxy contract", () => {
  it("maps plan/assign/result/error artifacts into role timelines without dropping role, budget, or error", () => {
    const budget = {
      maxIterations: 4,
      maxTokens: 12000,
      timeoutMs: 300000,
      remainingIterations: 3,
      remainingTokens: 8000,
    };
    const proxyEvents = [
      {
        contractVersion: "blueprint.agent-crew.proxy.v1",
        kind: "plan",
        id: "proxy-plan-1",
        jobId: "job-1",
        crewId: "crew-1",
        roleId: "role-architecture-planner",
        stage: "runtime_capability",
        occurredAt: "2026-06-20T00:00:01.000Z",
        summary: "Architecture planner prepared a runtime plan.",
        budget,
        payload: {
          planId: "plan-1",
        },
      },
      {
        contractVersion: "blueprint.agent-crew.proxy.v1",
        kind: "assign",
        id: "proxy-assign-1",
        jobId: "job-1",
        crewId: "crew-1",
        roleId: "role-architecture-planner",
        stage: "runtime_capability",
        occurredAt: "2026-06-20T00:00:02.000Z",
        summary: "Architecture planner received a capability assignment.",
        budget,
        payload: {
          assignmentId: "assignment-1",
          capabilityId: "role-system-architecture",
          nodeId: "node-1",
        },
      },
      {
        contractVersion: "blueprint.agent-crew.proxy.v1",
        kind: "result",
        id: "proxy-result-1",
        jobId: "job-1",
        crewId: "crew-1",
        roleId: "role-architecture-planner",
        stage: "runtime_capability",
        occurredAt: "2026-06-20T00:00:03.000Z",
        summary: "Architecture planner completed the assignment.",
        budget,
        payload: {
          assignmentId: "assignment-1",
          status: "completed",
          artifactIds: ["artifact-1"],
          evidenceIds: ["evidence-1"],
        },
      },
      {
        contractVersion: "blueprint.agent-crew.proxy.v1",
        kind: "error",
        id: "proxy-error-1",
        jobId: "job-1",
        crewId: "crew-1",
        roleId: "role-architecture-planner",
        stage: "runtime_capability",
        occurredAt: "2026-06-20T00:00:04.000Z",
        summary: "Architecture planner exceeded timeout budget.",
        budget,
        payload: {
          assignmentId: "assignment-1",
          error: {
            code: "agent_timeout",
            message: "Role agent exceeded timeout budget.",
            retryable: true,
          },
        },
      },
    ];
    const job = makeJob([
      artifact("crew-artifact", "agent_crew", makeCrew()),
      artifact("proxy-events", "role_timeline", {
        source: "python-agent-crew-proxy",
        events: proxyEvents,
      }),
    ]);
    const jobStore = createMemoryBlueprintJobStore([job]);
    const service = createAgentCrewService(buildBlueprintServiceContext({ jobStore }));

    const timelines = service.listRoleTimelines("job-1");
    const entries = timelines.flatMap(timeline => timeline.entries);

    expect(entries.map(entry => entry.type)).toEqual([
      "role.agent.plan",
      "role.agent.assign",
      "role.agent.result",
      "role.agent.error",
    ]);
    expect(entries.every(entry => entry.roleId === "role-architecture-planner")).toBe(true);
    expect(entries[0].payload).toMatchObject({
      budget: {
        maxIterations: 4,
        remainingTokens: 8000,
      },
    });
    expect(entries[1]).toMatchObject({
      capabilityId: "role-system-architecture",
      nodeId: "node-1",
    });
    expect(entries[2]).toMatchObject({
      artifactId: "artifact-1",
      evidenceId: "evidence-1",
    });
    expect(entries[3]).toMatchObject({
      error: "Role agent exceeded timeout budget.",
      payload: {
        error: {
          code: "agent_timeout",
          retryable: true,
        },
      },
    });
  });
});
