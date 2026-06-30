import type { PermissionCheckResult } from "../../../shared/permission/contracts.js";
import { AuditEventType } from "../../../shared/audit/contracts.js";
import type {
  OrchestrationRecognitionJumpNodeExecutionRequest,
  OrchestrationRecognitionJumpNodeExecutionResult,
  OrchestrationRecognitionJumpNodeInput,
  OrchestrationRecognitionJumpNodeType,
  WebAigcOrchestrationRecognitionJumpCandidate,
  WebAigcOrchestrationRecognitionJumpRecognizedTarget,
} from "../../../shared/web-aigc-orchestration-recognition-jump.js";

export interface OrchestrationRecognitionJumpPermissionEngine {
  checkPermission(
    agentId: string,
    resourceType: "api",
    action: "call",
    resource: string,
    token: string,
  ): PermissionCheckResult;
}

export interface OrchestrationRecognitionJumpAuditCollector {
  record(input: {
    eventType: AuditEventType;
    actor: {
      type: "user" | "agent" | "system";
      id: string;
      name?: string;
    };
    action: string;
    resource: {
      type: string;
      id: string;
      name?: string;
    };
    result: "success" | "failure" | "denied" | "error";
    context?: {
      sessionId?: string;
      requestId?: string;
      sourceIp?: string;
      userAgent?: string;
      organizationId?: string;
    };
    metadata?: Record<string, unknown>;
    lineageId?: string;
  }): void;
}

export interface OrchestrationRecognitionJumpAuditLogger {
  log(entry: {
    agentId: string;
    operation: string;
    resourceType: "api";
    action: "call";
    resource: string;
    result: "allowed" | "denied" | "error";
    reason?: string;
    governance?: PermissionCheckResult["governance"];
    metadata?: Record<string, unknown>;
  }): void;
}

export interface OrchestrationRecognitionJumpNodeAdapterDeps {
  permissionEngine?: OrchestrationRecognitionJumpPermissionEngine;
  auditCollector?: OrchestrationRecognitionJumpAuditCollector;
  auditLogger?: OrchestrationRecognitionJumpAuditLogger;
  // 105 longtail: python owned runtime; this Node adapter is thin proxy or explicit retained compat shell
  executePythonRuntime?: (input: any) => Promise<any>;
}

type ScoredCandidate = {
  candidate: WebAigcOrchestrationRecognitionJumpCandidate;
  confidence: number;
  matchedTerms: string[];
};

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function ensureString(value: unknown, field: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`Orchestration recognition jump input requires ${field}.`);
  }
  return normalized;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map(item => item.trim())
    .filter(Boolean);
}

function isCandidate(value: unknown): value is WebAigcOrchestrationRecognitionJumpCandidate {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      normalizeString((value as Record<string, unknown>).orchestrationId) &&
      normalizeString((value as Record<string, unknown>).entryNodeId) &&
      (
        normalizeString((value as Record<string, unknown>).label) ||
        normalizeString((value as Record<string, unknown>).orchestrationName)
      ),
  );
}

function normalizeCandidates(
  value: unknown,
): WebAigcOrchestrationRecognitionJumpCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isCandidate)
    .map(candidate => ({
      orchestrationId: ensureString(candidate.orchestrationId, "candidates[].orchestrationId"),
      ...(normalizeString(candidate.orchestrationCode)
        ? { orchestrationCode: normalizeString(candidate.orchestrationCode) }
        : {}),
      entryNodeId: ensureString(candidate.entryNodeId, "candidates[].entryNodeId"),
      label:
        normalizeString(candidate.label) ||
        ensureString(candidate.orchestrationName, "candidates[].label"),
      ...(normalizeString(candidate.orchestrationName)
        ? { orchestrationName: normalizeString(candidate.orchestrationName) }
        : {}),
      ...(normalizeString(candidate.description)
        ? { description: normalizeString(candidate.description) }
        : {}),
      ...(normalizeStringArray(candidate.keywords).length > 0
        ? { keywords: normalizeStringArray(candidate.keywords) }
        : {}),
      ...(normalizeStringArray(candidate.aliases).length > 0
        ? { aliases: normalizeStringArray(candidate.aliases) }
        : {}),
      ...(normalizeStringArray(candidate.inheritContextKeys).length > 0
        ? { inheritContextKeys: normalizeStringArray(candidate.inheritContextKeys) }
        : {}),
      ...(normalizeString(candidate.permissionResource)
        ? { permissionResource: normalizeString(candidate.permissionResource) }
        : {}),
      ...(candidate.metadata &&
      typeof candidate.metadata === "object" &&
      !Array.isArray(candidate.metadata)
        ? { metadata: { ...candidate.metadata } }
        : {}),
    }));
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s,.;:!?/\\|()\[\]{}<>"'`~@#$%^&*+=-]+/g)
    .map(item => item.trim())
    .filter(Boolean);
}

function buildCandidateSearchTerms(
  candidate: WebAigcOrchestrationRecognitionJumpCandidate,
): string[] {
  return [
    candidate.label,
    candidate.description,
    candidate.orchestrationId,
    candidate.orchestrationCode,
    candidate.orchestrationName,
    candidate.entryNodeId,
    ...normalizeStringArray(candidate.keywords),
    ...normalizeStringArray(candidate.aliases),
  ]
    .map(value => normalizeString(value))
    .filter((value): value is string => Boolean(value));
}

function scoreCandidate(
  query: string,
  candidate: WebAigcOrchestrationRecognitionJumpCandidate,
): ScoredCandidate {
  const queryTokens = tokenize(query);
  const searchTerms = buildCandidateSearchTerms(candidate);
  const matchedTerms = new Set<string>();
  let score = 0;

  for (const token of queryTokens) {
    for (const term of searchTerms) {
      const normalizedTerm = term.toLowerCase();
      if (normalizedTerm === token) {
        score += 3;
        matchedTerms.add(term);
        continue;
      }
      if (normalizedTerm.includes(token) || token.includes(normalizedTerm)) {
        score += 1;
        matchedTerms.add(term);
      }
    }
  }

  if (queryTokens.length === 0) {
    return {
      candidate,
      confidence: 0,
      matchedTerms: [],
    };
  }

  const confidence = Math.max(
    0,
    Math.min(1, score / Math.max(3, queryTokens.length * 3)),
  );

  return {
    candidate,
    confidence,
    matchedTerms: [...matchedTerms].slice(0, 6),
  };
}

function buildPermissionResource(
  candidate: Pick<
    WebAigcOrchestrationRecognitionJumpCandidate,
    "orchestrationId" | "entryNodeId" | "permissionResource"
  >,
): string {
  return (
    normalizeString(candidate.permissionResource) ||
    `POST /api/orchestration-recognition-jump/nodes/execute:${candidate.orchestrationId}:${candidate.entryNodeId}`
  );
}

function buildJumpReason(
  target: Pick<
    WebAigcOrchestrationRecognitionJumpRecognizedTarget,
    "orchestrationId" | "orchestrationCode"
  >,
): string {
  return `orchestration:${target.orchestrationCode || target.orchestrationId}`;
}

function checkPermission(
  input: OrchestrationRecognitionJumpNodeInput,
  resource: string,
  deps: OrchestrationRecognitionJumpNodeAdapterDeps,
): PermissionCheckResult | undefined {
  if (!deps.permissionEngine) {
    return undefined;
  }

  return deps.permissionEngine.checkPermission(
    ensureString(input.agentId, "agentId"),
    "api",
    "call",
    resource,
    ensureString(input.token, "token"),
  );
}

function buildPermissionSummary(
  permission: PermissionCheckResult | undefined,
): OrchestrationRecognitionJumpNodeExecutionResult["output"]["governance"]["permission"] | undefined {
  if (!permission) {
    return undefined;
  }

  return {
    allowed: permission.allowed,
    reason: permission.reason,
    suggestion: permission.suggestion,
  };
}

function pickInheritedContext(
  baseContext: Record<string, unknown>,
  inheritContextKeys: string[] | undefined,
  inheritContext: boolean,
): Record<string, unknown> {
  if (!inheritContext) {
    return {};
  }
  if (!inheritContextKeys || inheritContextKeys.length === 0) {
    return { ...baseContext };
  }

  const picked = Object.fromEntries(
    inheritContextKeys
      .filter(key => key in baseContext)
      .map(key => [key, baseContext[key]]),
  );
  return picked;
}

function buildRecognizedTarget(
  scored: ScoredCandidate,
): WebAigcOrchestrationRecognitionJumpRecognizedTarget {
  const { candidate, confidence, matchedTerms } = scored;
  return {
    orchestrationId: candidate.orchestrationId,
    ...(candidate.orchestrationCode
      ? { orchestrationCode: candidate.orchestrationCode }
      : {}),
    entryNodeId: candidate.entryNodeId,
    label: candidate.label,
    ...(candidate.orchestrationName
      ? { orchestrationName: candidate.orchestrationName }
      : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    confidence,
    matchedTerms,
    source: "candidate",
    ...(candidate.inheritContextKeys
      ? { inheritContextKeys: [...candidate.inheritContextKeys] }
      : {}),
    permissionResource: buildPermissionResource(candidate),
    ...(candidate.metadata ? { metadata: { ...candidate.metadata } } : {}),
  };
}

function buildFallbackTarget(
  input: OrchestrationRecognitionJumpNodeInput,
): WebAigcOrchestrationRecognitionJumpRecognizedTarget | undefined {
  const fallback = input.fallbackTarget;
  if (!fallback) {
    return undefined;
  }

  const orchestrationId = normalizeString(fallback.orchestrationId);
  const entryNodeId = normalizeString(fallback.entryNodeId);
  if (!orchestrationId || !entryNodeId) {
    return undefined;
  }

  const reason = normalizeString(fallback.reason) || "fallback_target";
  const permissionResource = buildPermissionResource({
    orchestrationId,
    entryNodeId,
  });

  return {
    orchestrationId,
    entryNodeId,
    label: orchestrationId,
    orchestrationName: orchestrationId,
    confidence: 0.25,
    matchedTerms: [reason],
    source: "fallback",
    permissionResource,
  };
}

function recordAudit(
  deps: OrchestrationRecognitionJumpNodeAdapterDeps,
  input: {
    eventType: AuditEventType;
    action: string;
    resourceId: string;
    resource: string;
    agentId?: string;
    result: "success" | "denied" | "failure" | "error";
    permission?: PermissionCheckResult;
    reason?: string;
    metadata: Record<string, unknown>;
    sessionId?: string;
  },
): void {
  deps.auditCollector?.record({
    eventType: input.eventType,
    actor: {
      type: "system",
      id: "orchestration-recognition-jump-node",
    },
    action: input.action,
    resource: {
      type: "workflow-node",
      id: input.resourceId,
      name: "orchestration_recognition_jump",
    },
    result: input.result,
    context: {
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    },
    metadata: input.metadata,
  });

  if (!deps.auditLogger || !input.agentId) {
    return;
  }

  deps.auditLogger.log({
    agentId: input.agentId,
    operation: "orchestration_recognition_jump",
    resourceType: "api",
    action: "call",
    resource: input.resource,
    result:
      input.result === "success"
        ? "allowed"
        : input.result === "denied"
          ? "denied"
          : "error",
    reason: input.reason,
    governance: input.permission?.governance,
    metadata: input.metadata,
  });
}

export function isOrchestrationRecognitionJumpNodeType(
  value: unknown,
): value is OrchestrationRecognitionJumpNodeType {
  return value === "orchestration_recognition_jump";
}

export async function executeOrchestrationRecognitionJumpNode(
  request: OrchestrationRecognitionJumpNodeExecutionRequest,
  deps: OrchestrationRecognitionJumpNodeAdapterDeps = {},
): Promise<OrchestrationRecognitionJumpNodeExecutionResult> {
  if (!isOrchestrationRecognitionJumpNodeType(request.nodeType)) {
    throw new Error("Unsupported orchestration_recognition_jump node type.");
  }

  const input = request.input ?? {};
  // Python thin proxy first (105 cutover): Node no longer owns recognition semantics when wired
  if (deps.executePythonRuntime) {
    try {
      const py = await deps.executePythonRuntime(input);
      // return py shaped or minimal mapped
      return {
        ok: py?.ok !== false,
        nodeType: "orchestration_recognition_jump",
        output: {
          status: py?.status || "completed",
          jumpTargetNodeId: py?.target?.entryNodeId || py?.recognized?.target?.entryNodeId || "py-orch-jump",
          jumpReason: "python-facade-orchestration",
          jumpValidated: true,
          jump: { nextNodeId: "py", jumpReason: "python", jumpValidated: true },
          contextBridge: {},
          recognizedTarget: py?.recognized || py?.target || { orchestrationId: "py", entryNodeId: "py", label: "python", confidence: 1, matchedTerms: [], source: "python" },
          context: normalizeObject(input.context),
          governance: py?.governance || { permission: { allowed: true } },
          warnings: py?.warnings || ["via python orchestration adapter"],
        },
      } as any;
    } catch (error: any) {
      return {
        ok: true,
        nodeType: "orchestration_recognition_jump",
        output: {
          status: "degraded",
          jumpTargetNodeId: "",
          jumpReason: "python-failed-visible",
          jumpValidated: false,
          context: normalizeObject(input.context),
          warnings: [`python orchestration failed (no silent success): ${error?.message || error}`],
        },
      } as any;
    }
  }

  const query = normalizeString(input.query) || normalizeString(input.text);
  const candidates = normalizeCandidates(input.candidates);
  const baseContext = normalizeObject(input.context);
  const metadata = normalizeObject(input.metadata);
  const inheritContext = input.inheritContext !== false;
  const requestedContextKeys = normalizeStringArray(input.contextKeys);

  if (!query && candidates.length === 0) {
    throw new Error(
      "Orchestration recognition jump input requires query or candidates.",
    );
  }

  const bestCandidate = query
    ? candidates
        .map(candidate => scoreCandidate(query, candidate))
        .sort((left, right) => right.confidence - left.confidence)[0]
    : undefined;

  const recognizedTarget =
    (bestCandidate && bestCandidate.confidence > 0
      ? buildRecognizedTarget(bestCandidate)
      : undefined) || buildFallbackTarget(input);

  if (!recognizedTarget) {
    throw new Error(
      "Orchestration recognition jump could not resolve a target candidate.",
    );
  }

  const context = {
    ...baseContext,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    orchestrationRecognitionJump: {
      query: query ?? "",
      recognizedTarget: {
        orchestrationId: recognizedTarget.orchestrationId,
        entryNodeId: recognizedTarget.entryNodeId,
        label: recognizedTarget.label,
        confidence: recognizedTarget.confidence,
        matchedTerms: [...recognizedTarget.matchedTerms],
        source: recognizedTarget.source,
      },
    },
    contextBridge: {
      inheritContext,
      ...(requestedContextKeys.length > 0
        ? { inheritedKeys: [...requestedContextKeys] }
        : recognizedTarget.inheritContextKeys
          ? { inheritedKeys: [...recognizedTarget.inheritContextKeys] }
          : {}),
    },
    inheritedContext: pickInheritedContext(
      baseContext,
      requestedContextKeys.length > 0
        ? requestedContextKeys
        : recognizedTarget.inheritContextKeys,
      inheritContext,
    ),
  };

  const permission = checkPermission(input, recognizedTarget.permissionResource, deps);
  const agentId = normalizeString(input.agentId);

  if (permission && !permission.allowed) {
    recordAudit(deps, {
      eventType: AuditEventType.DECISION_MADE,
      action:
        `Orchestration recognition jump denied: ${recognizedTarget.orchestrationId}:${recognizedTarget.entryNodeId}`,
      resourceId: recognizedTarget.entryNodeId,
      resource: recognizedTarget.permissionResource,
      ...(agentId ? { agentId } : {}),
      result: "denied",
      permission,
      reason: permission.reason,
      sessionId:
        normalizeString(baseContext.sessionId) ||
        normalizeString(baseContext.workflowId),
      metadata: {
        eventKey: "orchestration.denied",
        query,
        resource: recognizedTarget.permissionResource,
        matchedTerms: recognizedTarget.matchedTerms,
        confidence: recognizedTarget.confidence,
        permissionReason: permission.reason,
      },
    });

    return {
      ok: false,
      nodeType: "orchestration_recognition_jump",
      output: {
        status: "denied",
        jumpReason: buildJumpReason(recognizedTarget),
        jumpValidated: false,
        jump: {
          nextNodeId: recognizedTarget.entryNodeId,
          jumpReason: buildJumpReason(recognizedTarget),
          jumpValidated: false,
        },
        contextBridge: context.contextBridge,
        recognizedTarget,
        context,
        governance: {
          permission: buildPermissionSummary(permission),
        },
        audit: {
          eventKey: "orchestration.denied",
          resource: recognizedTarget.permissionResource,
          matchedTerms: [...recognizedTarget.matchedTerms],
        },
        observability: {
          eventKey: "orchestration.recognition_jump",
          nodeType: "orchestration_recognition_jump",
          candidateCount: candidates.length,
          matchedTerms: [...recognizedTarget.matchedTerms],
          confidence: recognizedTarget.confidence,
          source: recognizedTarget.source,
        },
        error: permission.reason ?? "Permission denied",
      },
    };
  }

  recordAudit(deps, {
    eventType: AuditEventType.DECISION_MADE,
    action:
      `Orchestration recognition jump selected: ${recognizedTarget.orchestrationId}:${recognizedTarget.entryNodeId}`,
    resourceId: recognizedTarget.entryNodeId,
    resource: recognizedTarget.permissionResource,
    ...(agentId ? { agentId } : {}),
    result: "success",
    permission,
    sessionId:
      normalizeString(baseContext.sessionId) ||
      normalizeString(baseContext.workflowId),
    metadata: {
      eventKey: "orchestration.recognized",
      query,
      resource: recognizedTarget.permissionResource,
      matchedTerms: recognizedTarget.matchedTerms,
      confidence: recognizedTarget.confidence,
      source: recognizedTarget.source,
    },
  });

  return {
    ok: true,
    nodeType: "orchestration_recognition_jump",
    output: {
      status: "completed",
      jumpTargetNodeId: recognizedTarget.entryNodeId,
      jumpReason: buildJumpReason(recognizedTarget),
      jumpValidated: true,
      jump: {
        nextNodeId: recognizedTarget.entryNodeId,
        jumpReason: buildJumpReason(recognizedTarget),
        jumpValidated: true,
      },
      contextBridge: context.contextBridge,
      recognizedTarget,
      context,
      governance: {
        permission: buildPermissionSummary(permission),
      },
      audit: {
        eventKey: "orchestration.recognized",
        resource: recognizedTarget.permissionResource,
        matchedTerms: [...recognizedTarget.matchedTerms],
      },
      observability: {
        eventKey: "orchestration.recognition_jump",
        nodeType: "orchestration_recognition_jump",
        candidateCount: candidates.length,
        matchedTerms: [...recognizedTarget.matchedTerms],
        confidence: recognizedTarget.confidence,
        source: recognizedTarget.source,
      },
    },
  };
}
