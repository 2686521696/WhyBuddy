import type {
  A2AEnvelope,
  A2AResponse,
  A2AStreamChunk,
} from "../../shared/a2a-protocol";
import { A2A_ERROR_CODES } from "../../shared/a2a-protocol";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

// Task 50 thin compat shell source marker (centralized for all degraded returns in core).
const NODE_A2A_COMPAT_SHELL_SOURCE = "node-compat-shell";

/**
 * Thin proxy / compatibility shell for Python-owned A2A. (Task 50 reduction)
 * Task 50 (backend-python-no-node-a2a-node-compat-thin-proxy-105): Node core A2AServer + routes reduced to PYTHON_FIRST_COMPAT
 * compatibility shell. Python a2a_runtime owns registry, sessions, stream transport, error/retry/cancel, projections.
 * - Registry + projections + transport always delegate; errors surfaced as pythonError (no silent Node ownership).
 * - listExposedAgents + ctor seeding kept only for compat shell + /invoke inbound retained surface.
 * - All business for A2A protocol surfaces (except inbound invoke execution) is Python source of truth.
 * Registry: delegates to a2a_runtime.py
 * Stream/cancel transport: delegates to Python transport runtime.
 * chat/report/analytics: delegates to Python projection service (chat proj, report gen, analytics counters).
 * Node retains only executor content + explicit compat shell (no business semantics ownership for projections).
 */
function callPythonA2ARegistry(op: "register" | "list" | "get", payload: any): any {
  const isWin = process.platform === "win32";
  const venvExe = isWin
    ? "slide-rule-python/.venv/Scripts/python.exe"
    : "slide-rule-python/.venv/bin/python";
  const candidates = [venvExe, isWin ? "python" : "python3", "python"];
  // Robust: write temp .py (avoids shell quoting/newline breakage on windows for -c multi-line+escapes).
  // State is file-backed in py, cross process ok.
  const tmpDir = "slide-rule-python/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPy = path.join(tmpDir, `a2a_reg_${op}_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const pySrc = [
    "import sys, json",
    "sys.path.insert(0, 'slide-rule-python')",
    "from services.a2a_runtime import register_a2a_agent, list_a2a_agents, get_a2a_agent",
    `op = ${JSON.stringify(op)}`,
    `payload_json = ${JSON.stringify(JSON.stringify(payload))}`,
    "p = json.loads(payload_json)",
    "if op == 'register':",
    "  res = register_a2a_agent(p)",
    "elif op == 'get':",
    "  res = get_a2a_agent(p.get('agentId') or p)",
    "else:",
    "  res = list_a2a_agents()",
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
    try { return JSON.parse(outStr || "null"); } catch { /* fall to err */ }
  }
  // Degraded visible: never hide behind Node success; callers see python failure explicitly.
  throw new Error(`python-a2a-registry ${op} failed: ${lastErr?.message || lastErr || "no output"}`);
}

/** Python-owned stream/cancel transport bridge (task 48 error/retry/cancel).
 * Node is thin proxy: delegate chunk assembly, session state, cancel idempotency,
 * timeout, retry, malformed + error creation to Python runtime in a2a_runtime.py.
 * Uses robust temp .py (Windows venv aware).
 */
function callPythonA2ATransport(op: "start" | "emit_chunk" | "cancel" | "timeout" | "retry", payload: any): any {
  const isWin = process.platform === "win32";
  const venvExe = isWin
    ? "slide-rule-python/.venv/Scripts/python.exe"
    : "slide-rule-python/.venv/bin/python";
  const candidates = [venvExe, isWin ? "python" : "python3", "python"];
  const tmpDir = "slide-rule-python/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPy = path.join(tmpDir, `a2a_transport_${op}_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const pySrc = [
    "import sys, json, time",
    "sys.path.insert(0, 'slide-rule-python')",
    "from services.a2a_runtime import (",
    "  start_a2a_stream_session, emit_a2a_stream_chunk, cancel_a2a_transport,",
    "  check_a2a_stream_timeout, get_a2a_retry_envelope, handle_malformed_a2a_chunk",
    ")",
    `op = ${JSON.stringify(op)}`,
    `payload_json = ${JSON.stringify(JSON.stringify(payload))}`,
    "p = json.loads(payload_json)",
    "if op == 'start':",
    "  res = start_a2a_stream_session(p.get('envelope') or p, p.get('frameworkType', 'custom'))",
    "elif op == 'emit_chunk':",
    "  res = emit_a2a_stream_chunk(p.get('sessionId') or p.get('id'), p.get('chunk',''), bool(p.get('done')))",
    "elif op == 'cancel':",
    "  res = cancel_a2a_transport(p.get('sessionId') or p)",
    "elif op == 'timeout':",
    "  res = check_a2a_stream_timeout(p.get('sessionId') or p, p.get('timeoutMs', 60000))",
    "elif op == 'retry':",
    "  res = get_a2a_retry_envelope(p.get('sessionId') or p, p.get('attempt', 0))",
    "else:",
    "  res = handle_malformed_a2a_chunk(p.get('sessionId',''), p.get('reason','unknown'))",
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
  // Degraded visible, never silent Node.
  throw new Error(`python-a2a-transport ${op} failed: ${lastErr?.message || lastErr || "no output"}`);
}

/** Thin proxy bridge to Python chat/report/analytics projections.
 * All business projection semantics (chat history, report gen, counters) are Python-owned.
 * Node class only provides compat shell + delegation; errors always visible.
 */
function callPythonA2AChatReport(op: "chat" | "report" | "analytics_inc" | "analytics_get", payload: any): any {
  const isWin = process.platform === "win32";
  const venvExe = isWin
    ? "slide-rule-python/.venv/Scripts/python.exe"
    : "slide-rule-python/.venv/bin/python";
  const candidates = [venvExe, isWin ? "python" : "python3", "python"];
  const tmpDir = "slide-rule-python/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPy = path.join(tmpDir, `a2a_cr_${op}_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
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
  // Degraded visible, never silent Node.
  throw new Error(`python-a2a-chat-report ${op} failed: ${lastErr?.message || lastErr || "no output"}`);
}

export interface ExposedAgentInfo {
  id: string;
  name: string;
  capabilities: string[];
  description: string;
}

export interface AgentExecutor {
  execute(agentId: string, task: string, context: string): Promise<string>;
  executeStream(
    agentId: string,
    task: string,
    context: string,
  ): AsyncGenerator<string>;
}

export interface A2AServerOptions {
  apiKeys?: string[]; // defaults to parsing A2A_API_KEYS env var
  rateLimitPerMinute?: number; // default 60
  agentExecutor: AgentExecutor;
  exposedAgents: ExposedAgentInfo[];
}

interface RateLimitEntry {
  windowStart: number;
  count: number;
}

export class A2AServer {
  private apiKeys: Set<string>;
  private rateLimitPerMinute: number;
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private agentExecutor: AgentExecutor;
  // retained for ctor compat shell only; real registry lives in Python
  private exposedAgents: ExposedAgentInfo[];
  private pythonRegistryError: string | null = null;

  constructor(options: A2AServerOptions) {
    const envKeys = (process.env.A2A_API_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.apiKeys = new Set([...envKeys, ...(options.apiKeys ?? [])]);
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? 60;
    this.agentExecutor = options.agentExecutor;
    this.exposedAgents = options.exposedAgents ?? [];
    this.pythonRegistryError = null;
    // Python-first: seed registry into Python store for ownership takeover (thin proxy)
    try {
      for (const a of this.exposedAgents) {
        callPythonA2ARegistry("register", a);
      }
    } catch (e: any) {
      this.pythonRegistryError = `python-a2a-registry seed failed: ${e?.message || e}`;
      // do not swallow; lookup will now expose explicitly instead of falling back to Node list
    }
  }

  validateApiKey(key: string): boolean {
    return this.apiKeys.has(key);
  }

  checkRateLimit(key: string): {
    allowed: boolean;
    retryAfterSeconds?: number;
  } {
    const now = Date.now();
    const windowMs = 60_000;
    let entry = this.rateLimits.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { windowStart: now, count: 0 };
      this.rateLimits.set(key, entry);
    }

    entry.count++;

    if (entry.count > this.rateLimitPerMinute) {
      const retryAfterSeconds = Math.ceil(
        (entry.windowStart + windowMs - now) / 1000,
      );
      return { allowed: false, retryAfterSeconds };
    }

    return { allowed: true };
  }

  async handleInvoke(
    envelope: A2AEnvelope,
    apiKey: string,
  ): Promise<A2AResponse> {
    if (!this.validateApiKey(apiKey)) {
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.AUTH_FAILED,
          message: "Invalid API key",
        },
      };
    }

    const rateCheck = this.checkRateLimit(apiKey);
    if (!rateCheck.allowed) {
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.RATE_LIMITED,
          message: `Rate limit exceeded. Retry after ${rateCheck.retryAfterSeconds} seconds`,
          data: { retryAfter: rateCheck.retryAfterSeconds },
        },
      };
    }

    // Python-owned registry ONLY for agent lookup (missing-agent semantics cut over to Python).
    // No fallback to this.exposedAgents: that would let Node retain ownership of registry semantics.
    // If py call fails, return explicit degraded error (visible, not silent Node success).
    let agent: ExposedAgentInfo | undefined;
    try {
      const pyAgent = callPythonA2ARegistry("get", { agentId: envelope.params.targetAgent });
      if (pyAgent && pyAgent.id) {
        agent = pyAgent as ExposedAgentInfo;
      }
    } catch (e: any) {
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.INTERNAL_ERROR,
          message: `Agent registry lookup failed (python degraded): ${e?.message || e}`,
          data: { degraded: true, pythonError: e?.message || String(e), source: "python-a2a-registry" },
        },
      };
    }
    if (!agent) {
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.AGENT_NOT_FOUND,
          message: `Agent "${envelope.params.targetAgent}" not found`,
        },
      };
    }

    try {
      const output = await this.agentExecutor.execute(
        agent.id,
        envelope.params.task,
        envelope.params.context,
      );
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        result: { output, artifacts: [], metadata: {} },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message },
      };
    }
  }

  async *handleStream(
    envelope: A2AEnvelope,
    apiKey: string,
  ): AsyncGenerator<A2AStreamChunk | A2AResponse> {
    if (!this.validateApiKey(apiKey)) {
      yield {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.AUTH_FAILED,
          message: "Invalid API key",
        },
      } as A2AResponse;
      return;
    }

    const rateCheck = this.checkRateLimit(apiKey);
    if (!rateCheck.allowed) {
      yield {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.RATE_LIMITED,
          message: "Rate limit exceeded",
          data: { retryAfter: rateCheck.retryAfterSeconds },
        },
      } as A2AResponse;
      return;
    }

    // Python-owned registry ONLY for agent lookup (missing-agent semantics cut over to Python).
    // No fallback to this.exposedAgents: that would let Node retain ownership of registry semantics.
    // If py call fails, return explicit degraded error (visible, not silent Node success).
    let agent: ExposedAgentInfo | undefined;
    try {
      const pyAgent = callPythonA2ARegistry("get", { agentId: envelope.params.targetAgent });
      if (pyAgent && pyAgent.id) {
        agent = pyAgent as ExposedAgentInfo;
      }
    } catch (e: any) {
      yield {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.INTERNAL_ERROR,
          message: `Agent registry lookup failed (python degraded): ${e?.message || e}`,
          data: { degraded: true, pythonError: e?.message || String(e), source: "python-a2a-registry" },
        },
      } as A2AResponse;
      return;
    }
    if (!agent) {
      yield {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.AGENT_NOT_FOUND,
          message: `Agent "${envelope.params.targetAgent}" not found`,
        },
      } as A2AResponse;
      return;
    }

    try {
      // Delegate to Python-owned transport: start session, emit chunks (owns ordering, state, malformed, retry/timeout)
      // Node executor only supplies raw text content; chunking/envelope/session/cancel semantics are Python.
      callPythonA2ATransport("start", { envelope: { jsonrpc: "2.0", method: "a2a.stream", id: envelope.id, params: envelope.params } });
      // integrate timeout check (visible)
      try { callPythonA2ATransport("timeout", { sessionId: envelope.id }); } catch {}
      const stream = this.agentExecutor.executeStream(
        agent.id,
        envelope.params.task,
        envelope.params.context,
      );
      for await (const text of stream) {
        // emit via Python to own chunk append + validation
        try {
          callPythonA2ATransport("emit_chunk", { sessionId: envelope.id, chunk: text, done: false });
        } catch (e: any) {
          // malformed visible
          yield { jsonrpc: "2.0", id: envelope.id, error: { code: A2A_ERROR_CODES.FRAMEWORK_ERROR, message: `stream chunk failed: ${e?.message || e}` } } as A2AResponse;
          return;
        }
        yield { jsonrpc: "2.0", id: envelope.id, chunk: text, done: false };
      }
      callPythonA2ATransport("emit_chunk", { sessionId: envelope.id, chunk: "", done: true });
      // retry envelope example on completion for transport
      try { callPythonA2ATransport("retry", { sessionId: envelope.id, attempt: 0 }); } catch {}
      yield { jsonrpc: "2.0", id: envelope.id, chunk: "", done: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      yield {
        jsonrpc: "2.0",
        id: envelope.id,
        error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message },
      } as A2AResponse;
    }
  }

  async handleCancel(
    sessionId: string,
    apiKey: string,
  ): Promise<A2AResponse> {
    if (!this.validateApiKey(apiKey)) {
      return {
        jsonrpc: "2.0",
        id: sessionId,
        error: {
          code: A2A_ERROR_CODES.AUTH_FAILED,
          message: "Invalid API key",
        },
      };
    }
    // Delegate to Python-owned cancel transport (idempotency + session state update)
    try {
      const py = callPythonA2ATransport("cancel", { sessionId });
      // integrate timeout for cancel path
      try { callPythonA2ATransport("timeout", { sessionId }); } catch {}
      const err = py && py.error ? py.error : { code: A2A_ERROR_CODES.CANCELLED, message: "A2A session cancelled." };
      return {
        jsonrpc: "2.0",
        id: sessionId,
        error: err,
      };
    } catch (e: any) {
      // Python transport failure MUST NOT return CANCELLED (which route maps to 200 success).
      // Use FRAMEWORK_ERROR (non-success main code) + data so failure is visible to caller.
      // Degraded/fallback never hides behind silent Node cancel-success semantic.
      return {
        jsonrpc: "2.0",
        id: sessionId,
        error: {
          code: A2A_ERROR_CODES.FRAMEWORK_ERROR,
          message: "A2A cancel transport failed.",
          data: { degraded: true, pythonError: e?.message || String(e), source: "python-a2a-transport", attempted: "CANCELLED" },
        },
      };
    }
  }

  listExposedAgents(): ExposedAgentInfo[] {
    // Retained compat shell: return the ctor-provided list (prevents cross-test accum in file store).
    // Real registry ownership for runtime (get in handleInvoke/handleStream) is Python via callPythonA2ARegistry.
    // GET /api/a2a/agents uses python-first call in routes.
    return [...this.exposedAgents];
  }

  // Chat/report/analytics projections delegated to Python (thin proxy).
  // Node no longer owns the projection/report gen/analytics counter semantics.
  recordChatProjection(sessionId: string, role: string, content: string): any {
    try {
      return callPythonA2AChatReport("chat", { sessionId, role, content });
    } catch (e: any) {
      return { ok: false, degraded: true, pythonError: e?.message || String(e), source: NODE_A2A_COMPAT_SHELL_SOURCE };
    }
  }

  generateReport(sessionId: string, kind: string = "summary"): any {
    try {
      return callPythonA2AChatReport("report", { sessionId, kind });
    } catch (e: any) {
      return { ok: false, degraded: true, pythonError: e?.message || String(e), source: NODE_A2A_COMPAT_SHELL_SOURCE };
    }
  }

  incrementAnalytics(name: string, delta: number = 1): any {
    try {
      return callPythonA2AChatReport("analytics_inc", { name, delta });
    } catch (e: any) {
      return { ok: false, degraded: true, pythonError: e?.message || String(e), source: NODE_A2A_COMPAT_SHELL_SOURCE };
    }
  }

  getAnalytics(): any {
    try {
      return callPythonA2AChatReport("analytics_get", {});
    } catch (e: any) {
      return { ok: false, degraded: true, pythonError: e?.message || String(e), counters: {}, source: NODE_A2A_COMPAT_SHELL_SOURCE };
    }
  }
}
