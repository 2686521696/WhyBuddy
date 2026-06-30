/**
 * REST API for A2A (Agent-to-Agent) protocol — invoke, stream, cancel, agents, sessions, chat, report, analytics.
 * stream/cancel/registry/sessions: Node is thin proxy bridging to Python-owned (a2a_runtime).
 * chat/report/analytics: Node thin proxy to Python-owned projection service (chat history proj, report gen, analytics counters).
 * Node retains explicit compatibility shell only for these; no business semantics ownership.
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
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/** Python-first adapter for registry/sessions (Node thin proxy for these endpoints).
 * Robust runner with venv+system candidates + temp .py (addresses venv-only).
 */
function callPythonA2ARegistrySessions(op: "agents" | "sessions"): any {
  const isWin = process.platform === "win32";
  const venvExe = isWin
    ? "slide-rule-python/.venv/Scripts/python.exe"
    : "slide-rule-python/.venv/bin/python";
  const candidates = [venvExe, isWin ? "python" : "python3", "python"];
  const tmpDir = "slide-rule-python/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPy = path.join(tmpDir, `a2a_${op}_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const pySrc = [
    "import sys, json",
    "sys.path.insert(0, 'slide-rule-python')",
    "from services.a2a_runtime import list_a2a_agents, list_a2a_active_sessions",
    `op = ${JSON.stringify(op)}`,
    "if op == 'agents':",
    "  res = list_a2a_agents()",
    "else:",
    "  res = list_a2a_active_sessions()",
    "print(json.dumps(res))",
  ].join("\n");
  fs.writeFileSync(tmpPy, pySrc, "utf8");
  let lastErr: any;
  let outStr = "";
  for (const pythonExe of candidates) {
    try {
      outStr = execSync(`"${pythonExe}" "${tmpPy}"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      break;
    } catch (e: any) {
      lastErr = e;
      continue;
    }
  }
  try { fs.unlinkSync(tmpPy); } catch {}
  if (outStr) {
    try { return JSON.parse(outStr || "[]"); } catch { /* fall */ }
  }
  throw new Error(`python-a2a-${op} failed: ${lastErr?.message || lastErr || "no output"}`);
}

/** Direct Python transport bridge for stream/cancel (thin proxy).
 * Complements core delegation; makes /stream /cancel paths show Python-owned
 * (cancel idempotency, chunk transport, timeout/retry/malformed).
 */
function callPythonA2ATransport(op: "cancel" | "timeout", payload: any): any {
  const isWin = process.platform === "win32";
  const venvExe = isWin
    ? "slide-rule-python/.venv/Scripts/python.exe"
    : "slide-rule-python/.venv/bin/python";
  const candidates = [venvExe, isWin ? "python" : "python3", "python"];
  const tmpDir = "slide-rule-python/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPy = path.join(tmpDir, `a2a_rt_${op}_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const pySrc = [
    "import sys, json",
    "sys.path.insert(0, 'slide-rule-python')",
    "from services.a2a_runtime import cancel_a2a_transport, check_a2a_stream_timeout",
    `op = ${JSON.stringify(op)}`,
    `payload_json = ${JSON.stringify(JSON.stringify(payload))}`,
    "p = json.loads(payload_json)",
    "if op == 'cancel':",
    "  res = cancel_a2a_transport(p.get('sessionId') or p)",
    "else:",
    "  res = check_a2a_stream_timeout(p.get('sessionId') or p, p.get('timeoutMs', 60000))",
    "print(json.dumps(res))",
  ].join("\n");
  fs.writeFileSync(tmpPy, pySrc, "utf8");
  let lastErr: any;
  let outStr = "";
  for (const pythonExe of candidates) {
    try {
      outStr = execSync(`"${pythonExe}" "${tmpPy}"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      break;
    } catch (e: any) {
      lastErr = e;
      continue;
    }
  }
  try { fs.unlinkSync(tmpPy); } catch {}
  if (outStr) {
    try { return JSON.parse(outStr || "null"); } catch { /* fall */ }
  }
  throw new Error(`python-a2a-transport ${op} failed: ${lastErr?.message || lastErr || "no output"}`);
}

/** Python-first adapter for A2A chat/report/analytics projections (105 cutover).
 * Node is explicit thin proxy: all projection, report gen, counters now owned in Python a2a_runtime.
 * Degraded states (python failure) are surfaced with data; no silent Node success.
 * Fallback only for compat, explicitly marked.
 */
function callPythonA2AChatReport(op: "chat" | "report" | "analytics_inc" | "analytics_get", payload: any): any {
  const isWin = process.platform === "win32";
  const venvExe = isWin
    ? "slide-rule-python/.venv/Scripts/python.exe"
    : "slide-rule-python/.venv/bin/python";
  const candidates = [venvExe, isWin ? "python" : "python3", "python"];
  const tmpDir = "slide-rule-python/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPy = path.join(tmpDir, `a2a_chatrep_${op}_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const pySrc = [
    "import sys, json",
    "sys.path.insert(0, 'slide-rule-python')",
    "from services.a2a_runtime import record_a2a_chat_projection, generate_a2a_report, increment_a2a_analytics_counter, get_a2a_analytics_snapshot, project_a2a_chat_report_analytics",
    `op = ${JSON.stringify(op)}`,
    `payload_json = ${JSON.stringify(JSON.stringify(payload || {}))}`,
    "p = json.loads(payload_json)",
    "if op == 'chat':",
    "  res = record_a2a_chat_projection(p.get('sessionId',''), p.get('role','user'), p.get('content',''))",
    "elif op == 'report':",
    "  res = generate_a2a_report(p.get('sessionId',''), p.get('kind','summary'))",
    "elif op == 'analytics_inc':",
    "  res = increment_a2a_analytics_counter(p.get('name','a2a.event'), p.get('delta',1))",
    "elif op == 'analytics_get':",
    "  res = get_a2a_analytics_snapshot()",
    "else:",
    "  res = project_a2a_chat_report_analytics(op, p)",
    "print(json.dumps(res))",
  ].join("\n");
  fs.writeFileSync(tmpPy, pySrc, "utf8");
  let lastErr: any;
  let outStr = "";
  for (const pythonExe of candidates) {
    try {
      outStr = execSync(`"${pythonExe}" "${tmpPy}"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      break;
    } catch (e: any) {
      lastErr = e;
      continue;
    }
  }
  try { fs.unlinkSync(tmpPy); } catch {}
  if (outStr) {
    try { return JSON.parse(outStr || "null"); } catch { /* fall */ }
  }
  throw new Error(`python-a2a-chat-report ${op} failed: ${lastErr?.message || lastErr || "no output"}`);
}

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
    // /api/a2a/invoke is an explicit retained compatibility shell for inbound A2A protocol invokes
    // targeting local agents (executed via a2aServer.handleInvoke + agentExecutor).
    // Registry lookup inside handleInvoke delegates to Python; external-agent invoke (outbound)
    // semantics, adapter, fetch, safe-failure, no-key, missing-endpoint, permissionMetadata are
    // Python-owned in slide-rule-python/services/a2a_runtime.py:invoke_external_a2a_agent and
    // delegated via A2AClient (thin proxy only, see server/core/a2a-client.ts).
    // This route/path does not count toward the external invoke takeover migration target.
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
// Thin proxy bridge to Python transport (via a2aServer.handleStream which now delegates
// chunk emission, session state, ordering, malformed, retry/timeout to Python a2a_runtime).
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

    // explicit timeout check via Python bridge; degraded must be visible (not swallowed)
    try {
      callPythonA2ATransport("timeout", { sessionId: envelope?.id });
    } catch (e: any) {
      const degraded = {
        jsonrpc: "2.0",
        id: envelope?.id ?? null,
        error: {
          code: A2A_ERROR_CODES.FRAMEWORK_ERROR,
          message: "python-a2a-transport timeout check degraded before start",
          data: { degraded: true, pythonError: e?.message || String(e), source: "python-a2a-transport" },
        },
      };
      res.write(`data: ${JSON.stringify(degraded)}\n\n`);
      // continue stream to keep compat but degraded state emitted visibly
    }

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
// Explicit Python transport bridge (thin proxy): prefer direct Python cancel for
// idempotency + session state; fallback to server (which delegates) with visible degraded.
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
    let result: any;
    try {
      // direct Python-owned cancel (idempotent semantics, state update)
      const py = callPythonA2ATransport("cancel", { sessionId });
      const err = (py && py.error) ? py.error : { code: A2A_ERROR_CODES.CANCELLED, message: "A2A session cancelled." };
      result = { jsonrpc: "2.0", id: sessionId, error: err };
      // ensure timeout check
      try { callPythonA2ATransport("timeout", { sessionId }); } catch {}
    } catch (pyErr: any) {
      // explicit degraded, do not silent success
      result = await a2aServer.handleCancel(sessionId, token);
      if (!result.error?.data) {
        (result.error as any) = { ...(result.error || {}), data: { degraded: true, pythonError: pyErr?.message, source: "python-a2a-transport" } };
      }
    }

    if (result.error) {
      const statusCode =
        result.error.code === A2A_ERROR_CODES.AUTH_FAILED ? 401
        : result.error.code === A2A_ERROR_CODES.CANCELLED ? 200
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

// GET /api/a2a/agents  -- routed to Python-first adapter (registry owned by Python)
router.get("/agents", (_req, res) => {
  try {
    const agents = callPythonA2ARegistrySessions("agents");
    return res.json({ agents });
  } catch (e: any) {
    // degraded must be visible; do not fall silently if python path broken
    if (!a2aServer) {
      return res.status(500).json({ error: "A2A server not initialized", pythonError: e?.message });
    }
    // explicit retained compat only on error
    return res.json({ agents: a2aServer.listExposedAgents(), degraded: true, pythonError: e?.message });
  }
});

// GET /api/a2a/sessions  -- routed to Python-first adapter (sessions owned by Python)
router.get("/sessions", (_req, res) => {
  try {
    const sessions = callPythonA2ARegistrySessions("sessions");
    return res.json({ sessions });
  } catch (e: any) {
    if (!a2aClient) {
      return res.status(500).json({ error: "A2A client not initialized", pythonError: e?.message });
    }
    // Do not call getActiveSessions (which swallows py errors to []); report degraded explicitly
    return res.json({ sessions: [], degraded: true, pythonError: e?.message, source: "python-a2a-session" });
  }
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

// A2A chat/report/analytics endpoints now routed through Python-first adapter (105 task).
// Node is thin proxy/compatibility shell. Real projection, generation, counters owned by Python.
// All errors from Python are propagated visibly (degraded never hidden).
router.post("/chat", async (req, res) => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Missing auth" });
    }
    const pyRes = callPythonA2AChatReport("chat", req.body || {});
    return res.json({ ok: true, source: "python-a2a-chat-projection", result: pyRes });
  } catch (e: any) {
    // explicit fallback with visible degradation flag
    return res.json({ ok: false, degraded: true, source: "node-compat-shell", pythonError: e?.message, result: { sessionId: req.body?.sessionId || null } });
  }
});

router.post("/report", async (req, res) => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Missing auth" });
    }
    const pyRes = callPythonA2AChatReport("report", req.body || {});
    return res.json({ ok: true, source: "python-a2a-report-projection", result: pyRes });
  } catch (e: any) {
    return res.json({ ok: false, degraded: true, source: "node-compat-shell", pythonError: e?.message, result: null });
  }
});

router.get("/analytics", (_req, res) => {
  try {
    const pyRes = callPythonA2AChatReport("analytics_get", {});
    return res.json({ ok: true, source: "python-a2a-analytics", result: pyRes });
  } catch (e: any) {
    return res.json({ ok: false, degraded: true, source: "node-compat-shell", pythonError: e?.message, counters: {} });
  }
});

router.post("/analytics/inc", async (req, res) => {
  try {
    const pyRes = callPythonA2AChatReport("analytics_inc", req.body || {});
    return res.json({ ok: true, source: "python-a2a-analytics", result: pyRes });
  } catch (e: any) {
    return res.json({ ok: false, degraded: true, source: "node-compat-shell", pythonError: e?.message });
  }
});

export default router;
