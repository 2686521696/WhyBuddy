/**
 * MCP GitHub capability bridge — MCP tool request builder.
 *
 * Pure module. Produces a {@link McpToolExecutionRequest} the bridge can hand
 * to `ctx.mcpToolAdapter.execute()`. No runtime dependency on the mcp-tool-adapter
 * implementation — only `import type` is allowed here.
 *
 * See design §4.5 and §2.D9 for field-by-field derivation rules.
 */

import type { McpToolExecutionRequest } from "../../../tool/api/mcp-tool-adapter.js";
import type { McpGithubCapabilityBridgeInput } from "./bridge.js";
import type { McpGithubCapabilityPolicy } from "./policy.js";

/** Hard upper bound on the MCP request `timeoutMs` (design §2.D5). */
const MCP_REQUEST_MAX_TIMEOUT_MS = 30_000;

/**
 * Inputs to {@link buildMcpToolRequest}. `remainingTimeoutMs` is the wall-clock
 * budget the caller has left for the MCP attempt (policy total minus elapsed).
 */
export interface BuildMcpToolRequestInput {
  readonly bridgeInput: McpGithubCapabilityBridgeInput;
  readonly policy: McpGithubCapabilityPolicy;
  readonly ownerRepo: { owner: string; repo: string };
  readonly remainingTimeoutMs: number;
}

/**
 * Build the {@link McpToolExecutionRequest} the bridge hands to
 * `ctx.mcpToolAdapter.execute(...)`.
 *
 * Field sourcing (design §2.D9):
 * - `serverId` / `toolName` come from policy defaults (`github` / `github.get_repository`).
 * - `arguments` are the minimum payload `{owner, repo}` — no token field.
 * - `agentId` mirrors the orchestrator-resolved `roleId`, so the mainline
 *   `McpToolAdapter` can attribute permission / audit decisions correctly.
 * - `token` is intentionally `undefined`; anonymous access to public repos
 *   is the V1 contract. Private-repo support should be added via the
 *   mainline credential manager, not via bridge-level parameter passing.
 * - `timeoutMs` is `min(remainingTimeoutMs, 30_000)`, never above the hard
 *   spec ceiling; the mainline `McpToolAdapter` will additionally clamp into
 *   `[1, 120_000]`.
 * - `requireApproval` is `false`; if the mainline permission engine returns
 *   `approval_required`, the bridge treats that as a failure and degrades to
 *   the HTTP path (design §2.D3).
 */
export function buildMcpToolRequest(
  input: BuildMcpToolRequestInput,
): McpToolExecutionRequest {
  const { bridgeInput, policy, ownerRepo, remainingTimeoutMs } = input;
  const clampedRemaining = Number.isFinite(remainingTimeoutMs)
    ? Math.max(0, Math.floor(remainingTimeoutMs))
    : 0;
  const timeoutMs = Math.min(
    MCP_REQUEST_MAX_TIMEOUT_MS,
    clampedRemaining > 0 ? clampedRemaining : MCP_REQUEST_MAX_TIMEOUT_MS,
  );

  return {
    serverId: policy.mcpServerId,
    toolName: policy.mcpToolName,
    input: `Inspect GitHub repository ${ownerRepo.owner}/${ownerRepo.repo} for route ${bridgeInput.route.id}.`,
    arguments: {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
    },
    context: [],
    workflowId: undefined,
    stage: "route_generation",
    metadata: {
      bridge: "blueprint-mcp-github-capability-bridge",
      invocationId: bridgeInput.invocationId,
      jobId: bridgeInput.jobId,
      routeId: bridgeInput.route.id,
    },
    agentId: bridgeInput.roleId,
    token: undefined,
    timeoutMs,
    requireApproval: false,
  };
}
