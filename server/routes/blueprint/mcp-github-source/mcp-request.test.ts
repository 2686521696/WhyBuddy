import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";
import type { McpGithubCapabilityBridgeInput } from "./bridge.js";
import { buildMcpToolRequest } from "./mcp-request.js";
import { createDefaultMcpGithubCapabilityPolicy } from "./policy.js";

function buildCapability(): BlueprintRuntimeCapability {
  return {
    id: "mcp-github-source",
    label: "MCP GitHub source",
    kind: "mcp",
    purpose: "Inspect GitHub repository metadata during route generation.",
    description: "Real repository metadata inspection via MCP tool or HTTP REST.",
    tags: ["github", "source"],
    securityLevel: "readonly",
    status: "available",
    adapter: "blueprint.runtime.mcp.github.simulated",
    inputSchema: "BlueprintGenerationRequest",
    outputTypes: ["evidence"],
    supportedStages: ["route_generation"],
    requiresApproval: false,
    projectScoped: false,
  };
}

function buildRoute(id = "route-primary"): BlueprintRouteCandidate {
  return {
    id,
    kind: "primary",
    title: "Primary route",
    summary: "Primary route summary.",
    rationale: "Rationale.",
    riskLevel: "low",
    costLevel: "low",
    complexity: "balanced",
    estimatedEffort: "1d",
    capabilities: [],
    steps: [],
    outputs: [],
  };
}

function buildRequest(): BlueprintGenerationRequest {
  return {
    projectId: "project-1",
    sourceId: "source-1",
    targetText: "Analyze the release dashboard repo.",
    githubUrls: ["https://github.com/example/dashboard"],
  };
}

function buildRouteSet(
  route: BlueprintRouteCandidate,
): BlueprintRouteSet {
  return {
    id: "route-set-1",
    requestId: "request-1",
    createdAt: "2026-05-08T00:00:00.000Z",
    primaryRouteId: route.id,
    routes: [route],
    nextAsset: {
      type: "spec_tree",
      menu: "deduction",
      description: "Proceed to SPEC tree.",
    },
    provenance: {
      projectId: "project-1",
      sourceId: "source-1",
      targetText: "Analyze the release dashboard repo.",
      githubUrls: ["https://github.com/example/dashboard"],
    },
  };
}

function buildBridgeInput(
  overrides: Partial<McpGithubCapabilityBridgeInput> = {},
): McpGithubCapabilityBridgeInput {
  const capability = buildCapability();
  const route = buildRoute();
  const routeSet = buildRouteSet(route);
  return {
    capability,
    route,
    jobId: "job-123",
    request: buildRequest(),
    routeSet,
    createdAt: "2026-05-08T00:00:00.000Z",
    invocationId: "invocation-abc",
    roleId: "role-runtime-executor",
    ...overrides,
  };
}

describe("buildMcpToolRequest", () => {
  it("fills serverId, toolName and arguments from policy + ownerRepo only", () => {
    const policy = createDefaultMcpGithubCapabilityPolicy();
    const bridgeInput = buildBridgeInput();
    const request = buildMcpToolRequest({
      bridgeInput,
      policy,
      ownerRepo: { owner: "example", repo: "dashboard" },
      remainingTimeoutMs: 30_000,
    });
    expect(request.serverId).toBe(policy.mcpServerId);
    expect(request.toolName).toBe(policy.mcpToolName);
    expect(request.arguments).toEqual({
      owner: "example",
      repo: "dashboard",
    });
    expect(request.arguments).not.toHaveProperty("token");
    expect(request.token).toBeUndefined();
  });

  it("clamps timeoutMs to min(remainingTimeoutMs, 30_000)", () => {
    const policy = createDefaultMcpGithubCapabilityPolicy();
    const bridgeInput = buildBridgeInput();
    const clamped = buildMcpToolRequest({
      bridgeInput,
      policy,
      ownerRepo: { owner: "example", repo: "dashboard" },
      remainingTimeoutMs: 45_000,
    });
    expect(clamped.timeoutMs).toBe(30_000);

    const tight = buildMcpToolRequest({
      bridgeInput,
      policy,
      ownerRepo: { owner: "example", repo: "dashboard" },
      remainingTimeoutMs: 5_000,
    });
    expect(tight.timeoutMs).toBe(5_000);
  });

  it("threads agentId / invocation metadata from the bridge input", () => {
    const policy = createDefaultMcpGithubCapabilityPolicy();
    const bridgeInput = buildBridgeInput();
    const request = buildMcpToolRequest({
      bridgeInput,
      policy,
      ownerRepo: { owner: "example", repo: "dashboard" },
      remainingTimeoutMs: 30_000,
    });
    expect(request.agentId).toBe("role-runtime-executor");
    expect(request.metadata).toEqual({
      bridge: "blueprint-mcp-github-capability-bridge",
      invocationId: "invocation-abc",
      jobId: "job-123",
      routeId: "route-primary",
    });
    expect(request.stage).toBe("route_generation");
    expect(request.requireApproval).toBe(false);
    expect(request.context).toEqual([]);
    expect(request.workflowId).toBeUndefined();
    expect(request.input).toContain("example/dashboard");
    expect(request.input).toContain("route-primary");
  });
});
