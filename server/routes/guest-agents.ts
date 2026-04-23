/**
 * REST API routes for guest agent management.
 *
 * POST   /api/agents/guest      — Create a guest agent
 * GET    /api/agents/guest      — List active guest agents
 * DELETE /api/agents/guest/:id  — Remove a guest agent
 *
 * @see Requirements 2.1, 2.2, 2.3, 2.7
 */
import { Router, type Request, type Response } from "express";
import { registry, MAX_GUESTS } from "../core/registry.js";
import { GuestAgent } from "../core/guest-agent.js";
import { guestLifecycleManager } from "../core/guest-lifecycle.js";
import { generateGuestId, sanitizeGuestConfig } from "../../shared/guest-agent-utils.js";
import { ensureAgentWorkspace } from "../memory/workspace.js";
import type { GuestAgentConfig, GuestAgentNode } from "../../shared/organization-schema.js";
import {
  getAutoAgentExecutor,
  mapAutoAgentErrorToStatusCode,
  normalizeAutoAgentContextInput,
} from "../tool/api/auto-agent-adapter.js";

const router = Router();

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringFromRecord(record: JsonRecord | undefined, key: string): string | undefined {
  return record ? readString(record[key]) : undefined;
}

function compactRecord(record: JsonRecord): JsonRecord | undefined {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

interface GuestAgentExecutionGovernance {
  requestId?: string;
  traceId?: string;
  sessionId?: string;
  workflowId?: string;
  stage: string;
  links?: JsonRecord;
}

function normalizeGuestAgentExecutionEnvelope(body: unknown): {
  body: JsonRecord;
  workflowId?: string;
  stage: string;
  metadata?: JsonRecord;
  governance: GuestAgentExecutionGovernance;
} {
  const candidate = isRecord(body) ? body : {};
  const providedMetadata = isRecord(candidate.metadata) ? { ...candidate.metadata } : undefined;
  const providedLinks = isRecord(providedMetadata?.links) ? { ...providedMetadata.links } : undefined;

  const workflowId =
    readString(candidate.workflowId) ??
    readStringFromRecord(providedMetadata, "workflowId") ??
    readStringFromRecord(providedLinks, "workflowId");
  const sessionId =
    readString(candidate.sessionId) ??
    readStringFromRecord(providedMetadata, "sessionId") ??
    readStringFromRecord(providedLinks, "sessionId");
  const requestId =
    readString(candidate.requestId) ??
    readStringFromRecord(providedMetadata, "requestId");
  const traceId =
    readString(candidate.traceId) ??
    readStringFromRecord(providedMetadata, "traceId");
  const stage =
    readString(candidate.stage) ??
    readStringFromRecord(providedMetadata, "stage") ??
    "guest_agent_execute";

  const links = compactRecord({
    ...(providedLinks ?? {}),
    workflowId:
      workflowId ?? readStringFromRecord(providedLinks, "workflowId"),
    sessionId:
      sessionId ?? readStringFromRecord(providedLinks, "sessionId"),
    sourceApp:
      readStringFromRecord(providedLinks, "sourceApp") ??
      readStringFromRecord(providedMetadata, "sourceApp"),
  });

  const metadata = compactRecord({
    ...(providedMetadata ?? {}),
    ...(requestId ? { requestId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(workflowId ? { workflowId } : {}),
    stage,
    ...(links ? { links } : {}),
  });

  return {
    body: candidate,
    workflowId,
    stage,
    metadata,
    governance: {
      ...(requestId ? { requestId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(workflowId ? { workflowId } : {}),
      stage,
      ...(links ? { links } : {}),
    },
  };
}

function enrichGuestAgentExecutionResult(
  result: Record<string, unknown>,
  governance: GuestAgentExecutionGovernance,
): Record<string, unknown> {
  const metadata = isRecord(result.metadata) ? { ...result.metadata } : {};
  const requestMetadata = isRecord(metadata.requestMetadata)
    ? { ...metadata.requestMetadata }
    : {};
  const responseLinks = isRecord(metadata.links) ? { ...metadata.links } : undefined;
  const requestLinks = isRecord(requestMetadata.links) ? { ...requestMetadata.links } : undefined;
  const links = compactRecord({
    ...(governance.links ?? {}),
    ...(requestLinks ?? {}),
    ...(responseLinks ?? {}),
    workflowId:
      readStringFromRecord(responseLinks, "workflowId") ??
      readStringFromRecord(requestLinks, "workflowId") ??
      governance.workflowId,
    sessionId:
      readStringFromRecord(responseLinks, "sessionId") ??
      readStringFromRecord(requestLinks, "sessionId") ??
      governance.sessionId,
    sourceApp:
      readStringFromRecord(responseLinks, "sourceApp") ??
      readStringFromRecord(requestLinks, "sourceApp"),
  });

  const workflowId =
    readStringFromRecord(metadata, "workflowId") ??
    readStringFromRecord(requestMetadata, "workflowId") ??
    governance.workflowId;
  const stage =
    readStringFromRecord(metadata, "stage") ??
    readStringFromRecord(requestMetadata, "stage") ??
    governance.stage;
  const requestId =
    readStringFromRecord(metadata, "requestId") ??
    readStringFromRecord(requestMetadata, "requestId") ??
    governance.requestId;
  const traceId =
    readStringFromRecord(metadata, "traceId") ??
    readStringFromRecord(requestMetadata, "traceId") ??
    governance.traceId;
  const sessionId =
    readStringFromRecord(metadata, "sessionId") ??
    readStringFromRecord(requestMetadata, "sessionId") ??
    governance.sessionId;

  return {
    ...result,
    metadata: {
      ...metadata,
      ...(workflowId ? { workflowId } : {}),
      stage,
      ...(requestId ? { requestId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(links ? { links } : {}),
      requestMetadata: {
        ...requestMetadata,
        ...(workflowId ? { workflowId } : {}),
        stage,
        ...(requestId ? { requestId } : {}),
        ...(traceId ? { traceId } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(links ? { links } : {}),
      },
    },
  };
}

/**
 * POST /api/agents/guest — Create a guest agent.
 * @see Requirements 2.1, 2.7
 */
router.post("/", (req: Request, res: Response) => {
  const { name, config, departmentId, managerId } = req.body ?? {};

  // Validate required fields
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Missing required field: name" });
  }
  if (!config || typeof config !== "object") {
    return res.status(400).json({ error: "Missing required field: config" });
  }
  const cfg = config as Partial<GuestAgentConfig>;
  if (!cfg.model || typeof cfg.model !== "string") {
    return res.status(400).json({ error: "Missing required field: config.model" });
  }
  if (!cfg.baseUrl || typeof cfg.baseUrl !== "string") {
    return res.status(400).json({ error: "Missing required field: config.baseUrl" });
  }

  // Build a complete GuestAgentConfig with defaults
  const guestConfig: GuestAgentConfig = {
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    skills: Array.isArray(cfg.skills) ? cfg.skills : [],
    mcp: Array.isArray(cfg.mcp) ? cfg.mcp : [],
    avatarHint: typeof cfg.avatarHint === "string" ? cfg.avatarHint : "cat",
  };

  const id = generateGuestId();
  const dept = typeof departmentId === "string" && departmentId.trim() ? departmentId.trim() : "engineering";
  const mgr = typeof managerId === "string" && managerId.trim() ? managerId.trim() : "mgr-eng";

  const orgNode: GuestAgentNode = {
    id,
    agentId: id,
    parentId: mgr,
    departmentId: dept,
    departmentLabel: dept.charAt(0).toUpperCase() + dept.slice(1),
    name: name.trim(),
    title: "Guest Worker",
    role: "worker",
    responsibility: "Assist with tasks as a guest agent",
    responsibilities: ["Assist with assigned tasks"],
    goals: ["Complete assigned work"],
    summaryFocus: [],
    skills: [],
    mcp: [],
    model: { model: guestConfig.model, temperature: 0.7, maxTokens: 3000 },
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
    invitedBy: "api",
    source: "manual",
    expiresAt: Date.now() + 3600_000,
    guestConfig,
  };

  // Attempt registration (may throw if limit reached)
  try {
    const agent = new GuestAgent(id, guestConfig, orgNode);
    registry.registerGuest(id, agent);
  } catch (err: any) {
    if (err.message?.includes("Maximum guest agent limit reached")) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  // Create workspace directory
  ensureAgentWorkspace(id);

  return res.status(201).json({
    id,
    name: name.trim(),
    config: sanitizeGuestConfig(guestConfig),
    createdAt: new Date().toISOString(),
  });
});

/**
 * GET /api/agents/guest — List active guest agents (apiKey hidden).
 * @see Requirements 2.2
 */
router.get("/", (_req: Request, res: Response) => {
  const guests = registry.getGuestAgents().map((agent) => ({
    id: agent.config.id,
    name: agent.config.name,
    department: agent.config.department,
    role: agent.config.role,
    managerId: agent.config.managerId,
    config: sanitizeGuestConfig(agent.guestConfig),
  }));
  return res.json({ guests });
});

/**
 * POST /api/agents/guest/:id/execute — 调用 guest agent 的最小闭环入口。
 */
router.post("/:id/execute", async (req: Request, res: Response) => {
  try {
    const normalized = normalizeGuestAgentExecutionEnvelope(req.body);
    const executor = getAutoAgentExecutor();
    const result = await executor.execute({
      kind: "guest_agent",
      targetId: req.params.id,
      input: normalized.body.input,
      context: normalizeAutoAgentContextInput(normalized.body.context),
      workflowId: normalized.workflowId,
      stage: normalized.stage,
      version:
        typeof normalized.body.version === "string" ? normalized.body.version : undefined,
      delegateAgentId:
        typeof normalized.body.delegateAgentId === "string"
          ? normalized.body.delegateAgentId
          : undefined,
      maxSkills:
        typeof normalized.body.maxSkills === "number" ? normalized.body.maxSkills : undefined,
      metadata: normalized.metadata,
    });

    return res.json(enrichGuestAgentExecutionResult(result, normalized.governance));
  } catch (error) {
    return res.status(mapAutoAgentErrorToStatusCode(error)).json({
      error: error instanceof Error ? error.message : "Guest agent execution failed",
    });
  }
});

/**
 * DELETE /api/agents/guest/:id — Remove a guest agent.
 * @see Requirements 2.3
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!registry.isGuest(id)) {
    return res.status(404).json({ error: `Guest agent not found: ${id}` });
  }
  await guestLifecycleManager.leaveOffice(id);
  return res.status(204).send();
});

export default router;
