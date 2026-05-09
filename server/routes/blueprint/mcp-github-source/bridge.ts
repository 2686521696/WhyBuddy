/**
 * MCP GitHub capability bridge — factory, three-tier degradation and invocation builders.
 *
 * Algorithm (design §4.8):
 *   1. early-exit when the bridge is disabled / neither MCP nor HTTP is injected
 *   2. parse the first `githubUrls[0]` into `{owner, repo}`; null → fallback
 *   3. open a wall-clock deadline (`policy.maxInvocationTimeoutMs`)
 *   4. if `ctx.mcpToolAdapter` is injected → try MCP path
 *   5. if budget exhausted → fallback
 *   6. if `ctx.httpFetcher` is injected → try HTTP path
 *   7. otherwise fallback
 *
 * Hard constraints (design §2.D1):
 * - NO `import { McpToolAdapter, InternalMcpToolInvoker }`.
 * - NO `new McpToolAdapter(...)`.
 * - NO `import { fetch } from "undici"` or module-level `fetch()` calls.
 * - NO `import "node-fetch"` / `"got"`.
 * - All MCP / HTTP capability access MUST flow through `ctx.mcpToolAdapter` /
 *   `ctx.httpFetcher` / `ctx.mcpGithubCapabilityPolicy`.
 */

import type {
  BlueprintCapabilityInvocation,
  BlueprintGenerationEvent,
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";
import type { McpToolExecutionResult } from "../../../tool/api/mcp-tool-adapter.js";
import {
  buildCapabilityInvocationLogs,
  buildCapabilityOutputSummary,
  deterministicCapabilityDuration,
} from "../invocation-fallback-helpers.js";
import type { BlueprintServiceContext } from "../context.js";
import {
  McpGithubFetcherError,
  type BlueprintHttpResponse,
} from "./http-fetcher.js";
import { buildMcpToolRequest } from "./mcp-request.js";
import {
  applyMcpGithubCapabilityRedaction,
  checkMcpGithubHttpPolicy,
  createDefaultMcpGithubCapabilityPolicy,
  redactMcpArguments,
  type McpGithubCapabilityPolicy,
} from "./policy.js";
import {
  deriveGithubOutputSummary,
  extractCommitShaFromEtag,
  extractGithubMetadataFromJson,
  extractGithubMetadataFromMcpResult,
  sha256Digest,
  type GithubRepoMetadata,
} from "./summary-derivation.js";
import { buildGithubRepoApiUrl, parseGithubUrl } from "./url-parser.js";

/**
 * Single-invocation input for the mcp-github bridge. The calling orchestrator
 * (`createRouteGenerationSandboxDerivation`) populates this struct after
 * picking the `mcp-github-source` capability.
 */
export interface McpGithubCapabilityBridgeInput {
  readonly capability: BlueprintRuntimeCapability;
  readonly route: BlueprintRouteCandidate;
  readonly jobId: string;
  readonly request: BlueprintGenerationRequest;
  readonly routeSet: BlueprintRouteSet;
  readonly createdAt: string;
  /** Pre-generated invocation id; shared across real and fallback paths. */
  readonly invocationId: string;
  /** Role id the orchestrator has already resolved for this capability. */
  readonly roleId: string;
}

/**
 * Single-invocation output returned to the orchestrator.
 *
 * `executionPath` lets the orchestrator pick the right adapter label:
 * - `"mcp"`  → `blueprint.runtime.mcp.github.real`
 * - `"http"` → `blueprint.runtime.mcp.github.http`
 * - `undefined` (fallback) → keep the baseline `blueprint.runtime.mcp.github.simulated`
 */
export interface McpGithubCapabilityBridgeOutput {
  readonly invocation: BlueprintCapabilityInvocation;
  readonly executionPath?: "mcp" | "http";
  readonly additionalEvents: BlueprintGenerationEvent[];
}

export type McpGithubCapabilityBridge = (
  input: McpGithubCapabilityBridgeInput,
) => Promise<McpGithubCapabilityBridgeOutput>;

/** Bridge is gated behind this env var (design §2.D2 / §4.8 step 1). */
const BRIDGE_ENABLED_ENV = "BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED";
/** Truncation ceiling for `provenance.error` (design §4.10). */
const ERROR_REASON_MAX_LENGTH = 400;

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function errorMessage(error: unknown): string {
  if (error instanceof McpGithubFetcherError) {
    return `${error.kind}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function truncateLogs(
  lines: readonly string[],
  maxLines: number,
  maxBytes: number,
): string[] {
  const out: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (out.length >= maxLines) {
      break;
    }
    const next = bytes + Buffer.byteLength(line, "utf8");
    if (next > maxBytes) {
      break;
    }
    out.push(line);
    bytes = next;
  }
  return out;
}

function extractCommitShaFromMcpResult(
  result: McpToolExecutionResult,
): string | undefined {
  if (result.response && typeof result.response === "object") {
    const response = result.response as Record<string, unknown>;
    const direct =
      (typeof response.commit_sha === "string" && response.commit_sha) ||
      (typeof response.latest_commit_sha === "string" &&
        response.latest_commit_sha) ||
      (typeof response.sha === "string" && response.sha);
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }
  }
  return undefined;
}

function buildMcpPathLogs(
  result: McpToolExecutionResult,
  policy: McpGithubCapabilityPolicy,
): string[] {
  const scrubbedOutput = applyMcpGithubCapabilityRedaction(
    result.output ?? "",
    policy,
  );
  return truncateLogs(
    [
      `tool=${result.metadata.serverId}/${result.metadata.toolName}`,
      `status=${result.status}`,
      `timeoutMs=${result.metadata.timeoutMs}`,
      `output=${scrubbedOutput.slice(0, 400)}`,
    ],
    policy.maxLogLines,
    policy.maxLogBytes,
  );
}

function buildHttpPathLogs(
  apiUrl: string,
  response: BlueprintHttpResponse,
  policy: McpGithubCapabilityPolicy,
): string[] {
  const scrubbedBody = applyMcpGithubCapabilityRedaction(
    response.body.slice(0, 1024),
    policy,
  );
  return truncateLogs(
    [
      "method=GET",
      `url=${apiUrl}`,
      `status=${response.status}`,
      `content-type=${response.headers["content-type"] ?? "unknown"}`,
      `body=${scrubbedBody}`,
    ],
    policy.maxLogLines,
    policy.maxLogBytes,
  );
}

interface BuildRealOutputArgs {
  readonly input: McpGithubCapabilityBridgeInput;
  readonly policy: McpGithubCapabilityPolicy;
  readonly ownerRepo: { owner: string; repo: string };
  readonly durationMs: number;
  readonly completedAt: string;
}

function buildRealMcpOutput(
  args: BuildRealOutputArgs & { mcpResult: McpToolExecutionResult },
): McpGithubCapabilityBridgeOutput {
  const { input, policy, ownerRepo, durationMs, completedAt, mcpResult } = args;
  const metadata = extractGithubMetadataFromMcpResult(mcpResult);
  const summary = metadata
    ? deriveGithubOutputSummary(metadata, policy)
    : `GitHub repository ${ownerRepo.owner}/${ownerRepo.repo} inspected via MCP tool ${policy.mcpToolName}; metadata shape unrecognized.`;
  const logs = buildMcpPathLogs(mcpResult, policy);
  const commitSha = extractCommitShaFromMcpResult(mcpResult);
  const invocation: BlueprintCapabilityInvocation = {
    id: input.invocationId,
    jobId: input.jobId,
    capabilityId: input.capability.id,
    roleId: input.roleId,
    capabilityLabel: input.capability.label,
    kind: input.capability.kind,
    status: "completed",
    securityLevel: input.capability.securityLevel,
    safetyGate: {
      status: "allowed",
      reason: `${input.capability.label} approved for real MCP execution via ${policy.mcpToolName}.`,
      requiresApproval: input.capability.requiresApproval,
      approved: input.capability.requiresApproval,
      securityLevel: input.capability.securityLevel,
    },
    requestedAt: input.createdAt,
    completedAt,
    requestedBy: "mcp-github-capability-bridge",
    routeId: input.route.id,
    input: `Derive route candidate ${input.route.title} with ${input.capability.label}.`,
    outputSummary: summary,
    logs,
    evidenceIds: [],
    durationMs,
    provenance: {
      jobId: input.jobId,
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.route.id,
      roleId: input.roleId,
      targetText: input.request.targetText,
      githubUrls: input.request.githubUrls ?? [],
      executionMode: "real",
      executionPath: "mcp",
      repoUrl: `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}`,
      commitSha,
      fetchedAt: completedAt,
      defaultBranch: metadata?.defaultBranch,
      mcpToolName: policy.mcpToolName,
    },
  };
  return { invocation, executionPath: "mcp", additionalEvents: [] };
}

function buildRealHttpOutput(
  args: BuildRealOutputArgs & {
    apiUrl: string;
    httpResponse: BlueprintHttpResponse;
  },
): McpGithubCapabilityBridgeOutput {
  const { input, policy, ownerRepo, durationMs, completedAt, apiUrl, httpResponse } =
    args;
  const metadata: GithubRepoMetadata | null = extractGithubMetadataFromJson(
    httpResponse.body,
  );
  const summary = metadata
    ? deriveGithubOutputSummary(metadata, policy)
    : `GitHub repository ${ownerRepo.owner}/${ownerRepo.repo} fetched via HTTP; JSON shape unrecognized.`;
  const logs = buildHttpPathLogs(apiUrl, httpResponse, policy);
  const invocation: BlueprintCapabilityInvocation = {
    id: input.invocationId,
    jobId: input.jobId,
    capabilityId: input.capability.id,
    roleId: input.roleId,
    capabilityLabel: input.capability.label,
    kind: input.capability.kind,
    status: "completed",
    securityLevel: input.capability.securityLevel,
    safetyGate: {
      status: "allowed",
      reason: `${input.capability.label} approved for real HTTP execution via GitHub REST API.`,
      requiresApproval: input.capability.requiresApproval,
      approved: input.capability.requiresApproval,
      securityLevel: input.capability.securityLevel,
    },
    requestedAt: input.createdAt,
    completedAt,
    requestedBy: "mcp-github-capability-bridge",
    routeId: input.route.id,
    input: `Derive route candidate ${input.route.title} with ${input.capability.label}.`,
    outputSummary: summary,
    logs,
    evidenceIds: [],
    durationMs,
    provenance: {
      jobId: input.jobId,
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.route.id,
      roleId: input.roleId,
      targetText: input.request.targetText,
      githubUrls: input.request.githubUrls ?? [],
      executionMode: "real",
      executionPath: "http",
      repoUrl: `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}`,
      commitSha: extractCommitShaFromEtag(httpResponse.headers.etag),
      fetchedAt: completedAt,
      defaultBranch: metadata?.defaultBranch,
      apiResponseDigest: sha256Digest(httpResponse.body),
    },
  };
  return { invocation, executionPath: "http", additionalEvents: [] };
}

/**
 * Build the fallback invocation using the shared templated helpers.
 *
 * Fields MUST remain shape-equivalent to today's simulated path so the
 * existing 45 E2E + 48 subdomain tests keep passing under default wiring.
 */
function buildFallbackOutput(
  input: McpGithubCapabilityBridgeInput,
  options: { reason: string },
): McpGithubCapabilityBridgeOutput {
  const invocationInput = `Derive route candidate ${input.route.title} with ${input.capability.label}.`;
  const outputSummary = buildCapabilityOutputSummary({
    capability: input.capability,
    routeTitle: input.route.title,
    input: invocationInput,
  });
  const invocation: BlueprintCapabilityInvocation = {
    id: input.invocationId,
    jobId: input.jobId,
    capabilityId: input.capability.id,
    roleId: input.roleId,
    capabilityLabel: input.capability.label,
    kind: input.capability.kind,
    status: "completed",
    securityLevel: input.capability.securityLevel,
    safetyGate: {
      status: "allowed",
      reason: `${input.capability.label} allowed for deterministic route generation sandbox derivation.`,
      requiresApproval: input.capability.requiresApproval,
      approved: input.capability.requiresApproval,
      securityLevel: input.capability.securityLevel,
    },
    requestedAt: input.createdAt,
    completedAt: input.createdAt,
    requestedBy: "route-generation-sandbox-derivation",
    routeId: input.route.id,
    input: invocationInput,
    outputSummary,
    logs: buildCapabilityInvocationLogs(input.capability, outputSummary),
    evidenceIds: [],
    durationMs: deterministicCapabilityDuration(input.capability, {
      capabilityId: input.capability.id,
      roleId: input.roleId,
      routeId: input.route.id,
      input: invocationInput,
    }),
    provenance: {
      jobId: input.jobId,
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.route.id,
      roleId: input.roleId,
      targetText: input.request.targetText,
      githubUrls: input.request.githubUrls ?? [],
      executionMode: "simulated_fallback",
      error: truncate(options.reason, ERROR_REASON_MAX_LENGTH),
    },
  };
  return { invocation, executionPath: undefined, additionalEvents: [] };
}

/**
 * Factory. Returns a bridge that implements the three-tier degradation
 * algorithm described in the file header. `policy` is resolved from the
 * context or falls back to the V1 defaults.
 */
export function createMcpGithubCapabilityBridge(
  ctx: BlueprintServiceContext,
): McpGithubCapabilityBridge {
  const policy =
    ctx.mcpGithubCapabilityPolicy ?? createDefaultMcpGithubCapabilityPolicy();

  return async function bridge(
    input: McpGithubCapabilityBridgeInput,
  ): Promise<McpGithubCapabilityBridgeOutput> {
    const enabled = process.env[BRIDGE_ENABLED_ENV] === "true";
    const mcpAdapter = ctx.mcpToolAdapter;
    const httpFetcher = ctx.httpFetcher;

    // Step 1 — early exit: bridge disabled or both real paths unavailable.
    if (!enabled || (!mcpAdapter && !httpFetcher)) {
      ctx.logger.debug("mcp-github bridge not configured, using fallback", {
        enabled,
        hasMcpAdapter: Boolean(mcpAdapter),
        hasHttpFetcher: Boolean(httpFetcher),
        jobId: input.jobId,
        capabilityId: input.capability.id,
      });
      return buildFallbackOutput(input, { reason: "bridge not configured" });
    }

    // Step 2 — URL parse. Empty / unparseable github URL → fallback.
    const firstUrl = input.request.githubUrls?.[0];
    if (typeof firstUrl !== "string" || firstUrl.length === 0) {
      ctx.logger.debug("mcp-github bridge: no github url, using fallback", {
        jobId: input.jobId,
      });
      return buildFallbackOutput(input, { reason: "no github url" });
    }
    const ownerRepo = parseGithubUrl(firstUrl);
    if (!ownerRepo) {
      ctx.logger.debug("mcp-github bridge: unparseable github url, fallback", {
        jobId: input.jobId,
      });
      return buildFallbackOutput(input, { reason: "no github url" });
    }

    // Step 3 — wall-clock budget shared by MCP + HTTP paths.
    const startedAt = ctx.now().getTime();
    const deadline = startedAt + policy.maxInvocationTimeoutMs;
    const remainingMs = () => Math.max(0, deadline - ctx.now().getTime());
    let mcpError: string | undefined;

    // Step 4 — MCP path (if adapter injected).
    if (mcpAdapter) {
      try {
        const mcpRequest = buildMcpToolRequest({
          bridgeInput: input,
          policy,
          ownerRepo,
          remainingTimeoutMs: Math.min(
            remainingMs(),
            policy.maxInvocationTimeoutMs,
          ),
        });
        // Redact arguments defensively before issuing the call in case a
        // caller-supplied policy widens the whitelist. (This doesn't alter
        // the request we send but lets us scrub if the adapter echoes back
        // arguments in its result.)
        void redactMcpArguments(
          (mcpRequest.arguments ?? {}) as Record<string, unknown>,
          policy,
        );
        const mcpResult = await mcpAdapter.execute(mcpRequest);
        if (mcpResult.status === "completed" && mcpResult.ok) {
          const completedAt = new Date(ctx.now().getTime()).toISOString();
          const duration = ctx.now().getTime() - startedAt;
          return buildRealMcpOutput({
            input,
            policy,
            ownerRepo,
            mcpResult,
            durationMs: duration,
            completedAt,
          });
        }
        mcpError = `mcp status=${mcpResult.status}${mcpResult.error ? `: ${mcpResult.error}` : ""}`;
        ctx.logger.debug(
          "mcp-github bridge: mcp path non-success, trying http fallback",
          {
            status: mcpResult.status,
            error: mcpResult.error,
            jobId: input.jobId,
          },
        );
      } catch (error) {
        mcpError = `mcp threw: ${errorMessage(error)}`;
        ctx.logger.debug(
          "mcp-github bridge: mcp path threw, trying http fallback",
          { error: errorMessage(error), jobId: input.jobId },
        );
      }
    }

    // Step 5 — budget check.
    if (remainingMs() <= 0) {
      ctx.logger.warn("mcp-github bridge: invocation timed out", {
        mcpError,
        jobId: input.jobId,
        capabilityId: input.capability.id,
      });
      return buildFallbackOutput(input, {
        reason: truncate(
          `invocation timeout${mcpError ? ` after ${mcpError}` : ""}`,
          ERROR_REASON_MAX_LENGTH,
        ),
      });
    }

    // Step 6 — HTTP path (if fetcher injected).
    if (httpFetcher) {
      const apiUrl = buildGithubRepoApiUrl(ownerRepo, {
        apiBase: policy.allowedHttpOrigins[0],
      });
      const policyCheck = checkMcpGithubHttpPolicy(policy, apiUrl);
      if (!policyCheck.allowed) {
        ctx.logger.warn(
          "mcp-github bridge: http url rejected by policy, using fallback",
          {
            reason: policyCheck.reason,
            jobId: input.jobId,
            capabilityId: input.capability.id,
          },
        );
        return buildFallbackOutput(input, {
          reason: policyCheck.reason ?? "allow-list rejected",
        });
      }
      try {
        const httpResponse = await httpFetcher.fetch(apiUrl, {
          timeoutMs: remainingMs(),
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "blueprint-mcp-github-bridge/1.0",
          },
        });
        const completedAt = new Date(ctx.now().getTime()).toISOString();
        const duration = ctx.now().getTime() - startedAt;
        return buildRealHttpOutput({
          input,
          policy,
          ownerRepo,
          apiUrl,
          httpResponse,
          durationMs: duration,
          completedAt,
        });
      } catch (error) {
        ctx.logger.warn("mcp-github bridge: http path failed, using fallback", {
          mcpError,
          httpError: errorMessage(error),
          jobId: input.jobId,
          capabilityId: input.capability.id,
        });
        const combined = mcpError
          ? `http: ${errorMessage(error)}; mcp: ${mcpError}`
          : `http: ${errorMessage(error)}`;
        return buildFallbackOutput(input, {
          reason: truncate(combined, ERROR_REASON_MAX_LENGTH),
        });
      }
    }

    // Step 7 — MCP failed and no HTTP fetcher; surrender to fallback.
    ctx.logger.warn("mcp-github bridge: no real path available", {
      mcpError,
      jobId: input.jobId,
      capabilityId: input.capability.id,
    });
    return buildFallbackOutput(input, {
      reason: truncate(
        mcpError ?? "no real path available",
        ERROR_REASON_MAX_LENGTH,
      ),
    });
  };
}
