import type {
  BlueprintClarificationSession,
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";
import type { AigcSpecNodeCapabilityBridgeInput } from "../aigc-spec-node/bridge.js";
import type { BlueprintServiceContext } from "../context.js";
import type { AigcNodeInvoker } from "./aigc-orchestrator.js";

export type LiteAgentAigcNodeInvoker = (
  nodeId: string,
  input: unknown,
) => Promise<{ success: boolean; result?: unknown; error?: string }>;

function stringifyInput(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRequest(value: unknown): value is BlueprintGenerationRequest {
  return Boolean(value && typeof value === "object");
}

function isRoute(value: unknown): value is BlueprintRouteCandidate {
  const record = asRecord(value);
  return Boolean(record && typeof record.id === "string");
}

function isRouteSet(value: unknown): value is BlueprintRouteSet {
  const record = asRecord(value);
  return Boolean(record && typeof record.id === "string" && Array.isArray(record.routes));
}

function isClarificationSession(
  value: unknown,
): value is BlueprintClarificationSession {
  const record = asRecord(value);
  return Boolean(
    record &&
      typeof record.id === "string" &&
      typeof record.intakeId === "string" &&
      Array.isArray(record.questions) &&
      Array.isArray(record.answers) &&
      record.readiness &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string",
  );
}

function buildFallbackRoute(nodeId: string): BlueprintRouteCandidate {
  return {
    id: `role-aigc-${nodeId}`,
    kind: "primary",
    title: `AIGC node ${nodeId}`,
    summary: `On-demand role AIGC node ${nodeId}`,
    rationale: "Role container requested an on-demand AIGC node without a selected route context.",
    riskLevel: "medium",
    costLevel: "medium",
    complexity: "balanced",
    estimatedEffort: "on-demand role pass",
    capabilities: [
      {
        id: nodeId,
        label: nodeId,
        kind: "aigc_node",
        purpose: "On-demand role reasoning",
      },
    ],
    steps: [],
    outputs: ["aigc-node-output"],
  };
}

function buildFallbackCapability(
  nodeId: string,
  route: BlueprintRouteCandidate,
): BlueprintRuntimeCapability {
  return {
    id: nodeId,
    label: nodeId,
    kind: "aigc_node",
    purpose: "On-demand role reasoning",
    description: `AIGC node ${nodeId} invoked by a role runtime context.`,
    tags: ["role-container", "aigc"],
    securityLevel: "sandboxed",
    status: "available",
    adapter: "aigc-spec-node",
    inputSchema: "role-container/aigc-node-input",
    outputTypes: ["json", "summary"],
    supportedStages: ["runtime_capability", "spec_tree", "spec_docs"],
    requiresApproval: route.riskLevel === "high",
    projectScoped: false,
  };
}

function buildBridgeInput(
  ctx: BlueprintServiceContext,
  nodeId: string,
  input: unknown,
): AigcSpecNodeCapabilityBridgeInput {
  const record = asRecord(input);
  const jobId = readString(record?.jobId) ?? "role-aigc-on-demand";
  const job = ctx.jobStore.get(jobId);
  const request = isRequest(record?.request)
    ? record.request
    : job?.request ?? { targetText: stringifyInput(input) };
  const route = isRoute(record?.route)
    ? record.route
    : isRouteSet(record?.routeSet) && record.routeSet.routes[0]
      ? record.routeSet.routes[0]
      : buildFallbackRoute(nodeId);
  const routeSet = isRouteSet(record?.routeSet)
    ? record.routeSet
    : {
        id: readString(record?.routeSetId) ?? `role-aigc-routeset-${nodeId}`,
        requestId: request.intakeId ?? "role-aigc-request",
        createdAt: ctx.now().toISOString(),
        primaryRouteId: route.id,
        routes: [route],
        nextAsset: {
          type: "spec_tree" as const,
          menu: "deduction" as const,
          description: "Synthetic route set for on-demand role AIGC node invocation.",
        },
        provenance: {
          projectId: request.projectId,
          sourceId: request.sourceId,
          targetText: request.targetText,
          githubUrls: request.githubUrls ?? [],
          clarificationSessionId: request.clarificationSessionId,
        },
      };
  return {
    capability: buildFallbackCapability(nodeId, route),
    route,
    jobId,
    request,
    routeSet,
    clarificationSession: isClarificationSession(record?.clarificationSession)
      ? record.clarificationSession
      : undefined,
    createdAt: ctx.now().toISOString(),
    invocationId: readString(record?.invocationId) ?? `role-aigc-${nodeId}-${ctx.now().getTime()}`,
    roleId: readString(record?.roleId) ?? "role-runtime-executor",
  };
}

export function createRoleContainerAigcNodeInvoker(
  ctx: BlueprintServiceContext,
): AigcNodeInvoker | undefined {
  const bridge = ctx.aigcSpecNodeCapabilityBridge;
  if (!bridge) return undefined;
  return async (nodeId, input) => {
    try {
      const output = await bridge(buildBridgeInput(ctx, nodeId, input));
      return {
        success: output.invocation.status === "completed",
        executionMode: output.executionMode,
        output: {
          invocation: output.invocation,
          additionalEvents: output.additionalEvents,
          outputSummary: output.invocation.outputSummary,
        },
        error:
          output.invocation.status === "completed"
            ? undefined
            : output.invocation.outputSummary,
      };
    } catch (err) {
      return {
        success: false,
        executionMode: "simulated_fallback",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

export function createLiteAgentAigcNodeInvoker(
  ctx: BlueprintServiceContext,
): LiteAgentAigcNodeInvoker | undefined {
  const invoker = createRoleContainerAigcNodeInvoker(ctx);
  if (!invoker) return undefined;
  return async (nodeId, input) => {
    const result = await invoker(nodeId, input);
    return {
      success: result.success,
      result: result.output,
      error: result.error,
    };
  };
}
