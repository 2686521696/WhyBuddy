import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";
import type {
  McpToolExecutionRequest,
  McpToolExecutionResult,
} from "../../../tool/api/mcp-tool-adapter.js";
import { buildBlueprintServiceContext } from "../context.js";
import {
  createMcpGithubCapabilityBridge,
  type McpGithubCapabilityBridgeInput,
} from "./bridge.js";
import {
  McpGithubFetcherError,
  type BlueprintHttpFetcher,
  type BlueprintHttpResponse,
} from "./http-fetcher.js";

const ENABLED_ENV = "BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED";

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

function buildRequest(
  overrides: Partial<BlueprintGenerationRequest> = {},
): BlueprintGenerationRequest {
  return {
    projectId: "project-1",
    sourceId: "source-1",
    targetText: "Analyze the release dashboard repo.",
    githubUrls: ["https://github.com/example/dashboard"],
    ...overrides,
  };
}

function buildRouteSet(
  route: BlueprintRouteCandidate,
  request: BlueprintGenerationRequest,
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
      projectId: request.projectId,
      sourceId: request.sourceId,
      targetText: request.targetText,
      githubUrls: request.githubUrls ?? [],
    },
  };
}

function buildBridgeInput(
  overrides: Partial<McpGithubCapabilityBridgeInput> = {},
): McpGithubCapabilityBridgeInput {
  const capability = overrides.capability ?? buildCapability();
  const route = overrides.route ?? buildRoute();
  const request = overrides.request ?? buildRequest();
  const routeSet = overrides.routeSet ?? buildRouteSet(route, request);
  return {
    capability,
    route,
    jobId: "job-123",
    request,
    routeSet,
    createdAt: "2026-05-08T00:00:00.000Z",
    invocationId: "invocation-abc",
    roleId: "role-runtime-executor",
    ...overrides,
  };
}

function completedMcpResult(
  response: Record<string, unknown>,
): McpToolExecutionResult {
  return {
    ok: true,
    status: "completed",
    targetLabel: "github/get_repository",
    operation: "mcp_tool",
    resource: "mcp:github/get_repository",
    output: JSON.stringify(response),
    response,
    governance: {
      approval: { required: false, status: "not_required", source: "none" },
    },
    metadata: {
      serverId: "github",
      toolName: "github.get_repository",
      timeoutMs: 30_000,
      fallbackUsed: false,
    },
  };
}

function buildHttpResponse(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): BlueprintHttpResponse {
  return {
    status: 200,
    statusText: "OK",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
    body: JSON.stringify(body),
    finalUrl: "https://api.github.com/repos/example/dashboard",
  };
}

beforeEach(() => {
  vi.stubEnv(ENABLED_ENV, "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createMcpGithubCapabilityBridge — real MCP path", () => {
  it("returns a real invocation when the mcp adapter completes successfully", async () => {
    const execute = vi.fn<
      (request: McpToolExecutionRequest) => Promise<McpToolExecutionResult>
    >((request) => {
      expect(request.serverId).toBe("github");
      expect(request.toolName).toBe("github.get_repository");
      return Promise.resolve(
        completedMcpResult({
          name: "dashboard",
          full_name: "example/dashboard",
          language: "TypeScript",
          default_branch: "main",
          stargazers_count: 42,
          pushed_at: "2026-04-01T00:00:00Z",
          html_url: "https://github.com/example/dashboard",
          visibility: "public",
          commit_sha: "abc123def456",
        }),
      );
    });

    let now = 0;
    const ctx = buildBlueprintServiceContext({
      mcpToolAdapter: { execute },
      now: () => {
        now += 250;
        return new Date(1_700_000_000_000 + now);
      },
    });
    const bridge = createMcpGithubCapabilityBridge(ctx);
    const output = await bridge(buildBridgeInput());

    expect(output.executionPath).toBe("mcp");
    expect(output.invocation.provenance.executionMode).toBe("real");
    expect(output.invocation.provenance.executionPath).toBe("mcp");
    expect(output.invocation.provenance.mcpToolName).toBe(
      "github.get_repository",
    );
    expect(output.invocation.provenance.repoUrl).toBe(
      "https://github.com/example/dashboard",
    );
    expect(output.invocation.provenance.commitSha).toBe("abc123def456");
    expect(output.invocation.provenance.defaultBranch).toBe("main");
    expect(output.invocation.provenance.error).toBeUndefined();
    expect(output.invocation.durationMs).toBeGreaterThan(0);
    expect(output.invocation.outputSummary).toContain("example/dashboard");
    expect(output.invocation.outputSummary).toContain("TypeScript");
    expect(output.invocation.requestedBy).toBe(
      "mcp-github-capability-bridge",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("createMcpGithubCapabilityBridge — real HTTP path", () => {
  it("returns a real invocation when only the fetcher is injected", async () => {
    const fetchImpl = vi.fn<BlueprintHttpFetcher["fetch"]>(async () =>
      buildHttpResponse(
        {
          name: "dashboard",
          full_name: "example/dashboard",
          language: "TypeScript",
          default_branch: "main",
          stargazers_count: 42,
          pushed_at: "2026-04-01T00:00:00Z",
          html_url: "https://github.com/example/dashboard",
          visibility: "public",
        },
        { etag: 'W/"abc123def4567890abc123def456789012345678"' },
      ),
    );

    let now = 0;
    const ctx = buildBlueprintServiceContext({
      httpFetcher: { fetch: fetchImpl },
      now: () => {
        now += 100;
        return new Date(1_700_000_000_000 + now);
      },
    });
    const bridge = createMcpGithubCapabilityBridge(ctx);
    const output = await bridge(buildBridgeInput());

    expect(output.executionPath).toBe("http");
    expect(output.invocation.provenance.executionMode).toBe("real");
    expect(output.invocation.provenance.executionPath).toBe("http");
    expect(output.invocation.provenance.repoUrl).toBe(
      "https://github.com/example/dashboard",
    );
    expect(output.invocation.provenance.apiResponseDigest).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(output.invocation.provenance.commitSha).toBe(
      "abc123def4567890abc123def456789012345678",
    );
    expect(output.invocation.provenance.defaultBranch).toBe("main");
    expect(output.invocation.provenance.mcpToolName).toBeUndefined();
    expect(output.invocation.provenance.error).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/example/dashboard",
    );
  });
});

describe("createMcpGithubCapabilityBridge — MCP fails, HTTP succeeds", () => {
  it("takes the HTTP path silently without noisy error in provenance", async () => {
    const execute = vi.fn<McpToolExecutionResult["ok"] extends never ? never : any>(async () => {
      throw new Error("mcp unavailable");
    });
    const fetchImpl = vi.fn<BlueprintHttpFetcher["fetch"]>(async () =>
      buildHttpResponse({
        name: "dashboard",
        full_name: "example/dashboard",
        default_branch: "main",
      }),
    );
    const debug = vi.fn();
    const warn = vi.fn();
    const ctx = buildBlueprintServiceContext({
      mcpToolAdapter: { execute },
      httpFetcher: { fetch: fetchImpl },
      logger: {
        debug,
        info: vi.fn(),
        warn,
        error: vi.fn(),
      },
    });
    const bridge = createMcpGithubCapabilityBridge(ctx);
    const output = await bridge(buildBridgeInput());

    expect(output.executionPath).toBe("http");
    expect(output.invocation.provenance.executionMode).toBe("real");
    expect(output.invocation.provenance.error).toBeUndefined();
    expect(debug).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createMcpGithubCapabilityBridge — both paths fail → fallback", () => {
  it("emits a simulated_fallback invocation that merges mcp+http error reasons", async () => {
    const execute = vi.fn(async () => {
      throw new Error("mcp unavailable");
    });
    const fetchImpl = vi.fn<BlueprintHttpFetcher["fetch"]>(async () => {
      throw new McpGithubFetcherError("upstream timed out", "timeout");
    });
    const warn = vi.fn();
    const ctx = buildBlueprintServiceContext({
      mcpToolAdapter: { execute },
      httpFetcher: { fetch: fetchImpl },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn,
        error: vi.fn(),
      },
    });
    const bridge = createMcpGithubCapabilityBridge(ctx);
    const input = buildBridgeInput();
    const output = await bridge(input);

    expect(output.executionPath).toBeUndefined();
    expect(output.invocation.provenance.executionMode).toBe(
      "simulated_fallback",
    );
    expect(output.invocation.provenance.executionPath).toBeUndefined();
    expect(output.invocation.provenance.error).toBeDefined();
    expect(output.invocation.provenance.error).toMatch(/http:/);
    expect(output.invocation.provenance.error).toMatch(/mcp:/);

    // fallback shape must equal simulated produce from the shared helpers
    expect(output.invocation.requestedBy).toBe(
      "route-generation-sandbox-derivation",
    );
    expect(output.invocation.outputSummary).toMatch(/simulated mcp execution/);
    expect(output.invocation.logs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /adapter=blueprint\.runtime\.mcp\.github\.simulated/,
        ),
      ]),
    );
    expect(warn).toHaveBeenCalled();
  });
});

describe("createMcpGithubCapabilityBridge — unreachable / missing configurations", () => {
  it("fallbacks with 'bridge not configured' when nothing is injected", async () => {
    const ctx = buildBlueprintServiceContext();
    const bridge = createMcpGithubCapabilityBridge(ctx);
    const output = await bridge(buildBridgeInput());
    expect(output.invocation.provenance.executionMode).toBe(
      "simulated_fallback",
    );
    expect(output.invocation.provenance.error).toBe("bridge not configured");
  });

  it("fallbacks with 'no github url' when githubUrls is empty", async () => {
    const fetchImpl = vi.fn<BlueprintHttpFetcher["fetch"]>();
    const ctx = buildBlueprintServiceContext({
      httpFetcher: { fetch: fetchImpl },
    });
    const bridge = createMcpGithubCapabilityBridge(ctx);
    const output = await bridge(
      buildBridgeInput({
        request: buildRequest({ githubUrls: [] }),
      }),
    );
    expect(output.invocation.provenance.error).toBe("no github url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fallbacks with 'no github url' for non-github hosts", async () => {
    const fetchImpl = vi.fn<BlueprintHttpFetcher["fetch"]>();
    const ctx = buildBlueprintServiceContext({
      httpFetcher: { fetch: fetchImpl },
    });
    const bridge = createMcpGithubCapabilityBridge(ctx);
    const output = await bridge(
      buildBridgeInput({
        request: buildRequest({
          githubUrls: ["https://evil.example/owner/repo"],
        }),
      }),
    );
    expect(output.invocation.provenance.error).toBe("no github url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fallbacks with 'bridge not configured' when ENABLED is off", async () => {
    vi.stubEnv(ENABLED_ENV, "false");
    const fetchImpl = vi.fn<BlueprintHttpFetcher["fetch"]>();
    const ctx = buildBlueprintServiceContext({
      httpFetcher: { fetch: fetchImpl },
    });
    const bridge = createMcpGithubCapabilityBridge(ctx);
    const output = await bridge(buildBridgeInput());
    expect(output.invocation.provenance.executionMode).toBe(
      "simulated_fallback",
    );
    expect(output.invocation.provenance.error).toBe("bridge not configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
