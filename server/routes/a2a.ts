/**
 * REST API for A2A (Agent-to-Agent) protocol — invoke, stream, cancel, agents, sessions.
 */
import { Router } from "express";
import type { A2AEnvelope } from "../../shared/a2a-protocol.js";
import { A2A_ERROR_CODES } from "../../shared/a2a-protocol.js";
import type { A2AServer } from "../core/a2a-server.js";
import type { A2AClient } from "../core/a2a-client.js";
import {
  getAutoAgentExecutor,
  mapAutoAgentErrorToStatusCode,
  normalizeAutoAgentContextInput,
} from "../tool/api/auto-agent-adapter.js";

const router = Router();

// Lazy-initialized singletons
let a2aServer: A2AServer | null = null;
let a2aClient: A2AClient | null = null;

export function initA2ARoutes(server: A2AServer, client: A2AClient): void {
  a2aServer = server;
  a2aClient = client;
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

// POST /api/a2a/invoke
router.post("/invoke", async (req, res) => {
  try {
    if (!a2aServer) {
      return res.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message: "A2A server not initialized" },
      });
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: A2A_ERROR_CODES.AUTH_FAILED, message: "Missing or invalid Authorization header" },
      });
    }

    const envelope = req.body as A2AEnvelope;
    const result = await a2aServer.handleInvoke(envelope, token);

    if (result.error) {
      const statusCode =
        result.error.code === A2A_ERROR_CODES.AUTH_FAILED ? 401
        : result.error.code === A2A_ERROR_CODES.AGENT_NOT_FOUND ? 404
        : result.error.code === A2A_ERROR_CODES.RATE_LIMITED ? 429
        : 500;
      return res.status(statusCode).json(result);
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message: err.message ?? "Internal error" },
    });
  }
});

// POST /api/a2a/stream
router.post("/stream", async (req, res) => {
  try {
    if (!a2aServer) {
      return res.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message: "A2A server not initialized" },
      });
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: A2A_ERROR_CODES.AUTH_FAILED, message: "Missing or invalid Authorization header" },
      });
    }

    const envelope = req.body as A2AEnvelope;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = a2aServer.handleStream(envelope, token);
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if ("error" in chunk && chunk.error) break;
      if ("done" in chunk && chunk.done) break;
    }

    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message: err.message ?? "Internal error" },
      });
    }
  }
});

// POST /api/a2a/cancel
router.post("/cancel", async (req, res) => {
  try {
    if (!a2aServer) {
      return res.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message: "A2A server not initialized" },
      });
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: A2A_ERROR_CODES.AUTH_FAILED, message: "Missing or invalid Authorization header" },
      });
    }

    const { sessionId } = req.body;
    const result = await a2aServer.handleCancel(sessionId, token);

    if (result.error) {
      const statusCode = result.error.code === A2A_ERROR_CODES.AUTH_FAILED ? 401 : 500;
      return res.status(statusCode).json(result);
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message: err.message ?? "Internal error" },
    });
  }
});

// GET /api/a2a/agents
router.get("/agents", (_req, res) => {
  if (!a2aServer) {
    return res.status(500).json({ error: "A2A server not initialized" });
  }
  res.json({ agents: a2aServer.listExposedAgents() });
});

// GET /api/a2a/sessions
router.get("/sessions", (_req, res) => {
  if (!a2aClient) {
    return res.status(500).json({ error: "A2A client not initialized" });
  }
  res.json({ sessions: a2aClient.getActiveSessions() });
});

// POST /api/a2a/auto-agent
router.post("/auto-agent", async (req, res) => {
  try {
    const kind = req.body?.kind;
    if (
      kind !== "agent" &&
      kind !== "guest_agent" &&
      kind !== "skill" &&
      kind !== "internal_api" &&
      kind !== "passthrough_api"
    ) {
      return res.status(400).json({
        error:
          'Missing or invalid field: kind. Expected "agent", "guest_agent", "skill", "internal_api", or "passthrough_api".',
      });
    }

    const executor = getAutoAgentExecutor();
    const result = await executor.execute({
      kind,
      targetId: req.body?.targetId,
      input: req.body?.input,
      context: normalizeAutoAgentContextInput(req.body?.context),
      workflowId: typeof req.body?.workflowId === "string" ? req.body.workflowId : undefined,
      stage: typeof req.body?.stage === "string" ? req.body.stage : "a2a_auto_agent",
      version: typeof req.body?.version === "string" ? req.body.version : undefined,
      delegateAgentId:
        typeof req.body?.delegateAgentId === "string" ? req.body.delegateAgentId : undefined,
      maxSkills: typeof req.body?.maxSkills === "number" ? req.body.maxSkills : undefined,
      metadata:
        req.body?.metadata && typeof req.body.metadata === "object"
          ? req.body.metadata
          : undefined,
    });

    return res.json(result);
  } catch (error) {
    return res.status(mapAutoAgentErrorToStatusCode(error)).json({
      error: error instanceof Error ? error.message : "Auto-agent execution failed",
    });
  }
});

export default router;
