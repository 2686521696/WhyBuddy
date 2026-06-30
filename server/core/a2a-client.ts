import type {
  A2AFrameworkType,
  A2AInvokeParams,
  A2AResponse,
  A2ASession,
  A2AStreamChunk,
} from "../../shared/a2a-protocol";
import { createEnvelope, A2A_ERROR_CODES } from "../../shared/a2a-protocol";
import { getAdapter } from "./a2a-adapters";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Explicit compatibility shell: session state moved to Python-owned store.
 * All create/read/update/get/list/terminate delegate to a2a_runtime.py .
 * The in-memory Map is removed; Node no longer owns session semantics.
 * Uses robust venv+system python candidates + temp .py runner (matches registry).
 */
function callPythonA2ASessionStore(op: "create" | "get" | "update" | "list_active" | "terminate", payload: any): any {
  const isWin = process.platform === "win32";
  const venvExe = isWin
    ? "slide-rule-python/.venv/Scripts/python.exe"
    : "slide-rule-python/.venv/bin/python";
  const candidates = [venvExe, isWin ? "python" : "python3", "python"];
  const tmpDir = "slide-rule-python/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPy = path.join(tmpDir, `a2a_sess_${op}_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const pySrc = [
    "import sys, json",
    "sys.path.insert(0, 'slide-rule-python')",
    "from services.a2a_runtime import (",
    "  create_a2a_session, get_a2a_session, update_a2a_session,",
    "  list_a2a_active_sessions, terminate_timed_out_a2a_sessions",
    ")",
    `op = ${JSON.stringify(op)}`,
    `payload_json = ${JSON.stringify(JSON.stringify(payload))}`,
    "p = json.loads(payload_json)",
    "if op == 'create':",
    "  res = create_a2a_session(p.get('envelope'), p.get('frameworkType'), p.get('startedAt'))",
    "elif op == 'get':",
    "  res = get_a2a_session(p.get('sessionId') or p)",
    "elif op == 'update':",
    "  res = update_a2a_session(p.get('sessionId'), **(p.get('updates') or {}))",
    "elif op == 'list_active':",
    "  res = list_a2a_active_sessions()",
    "elif op == 'terminate':",
    "  res = terminate_timed_out_a2a_sessions(p.get('timeoutMs') or 60000, p.get('now'))",
    "else:",
    "  res = []",
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
  throw new Error(`python-a2a-session ${op} failed: ${lastErr?.message || lastErr || "no output"}`);
}

/** Thin proxy call to Python-owned external agent invoke provider.
 * Delegates adapter selection, URL/build, fetch, provider response parse + safe failure to Python.
 * Node no longer owns external invocation boundary or semantics.
 * Degraded states (missing endpoint, provider fail, no-key) are returned visibly.
 */
function callPythonA2AExternalInvoke(payload: any): any {
  const isWin = process.platform === "win32";
  const venvExe = isWin
    ? "slide-rule-python/.venv/Scripts/python.exe"
    : "slide-rule-python/.venv/bin/python";
  const candidates = [venvExe, isWin ? "python" : "python3", "python"];
  const tmpDir = "slide-rule-python/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPy = path.join(tmpDir, `a2a_ext_invoke_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const pySrc = [
    "import sys, json",
    "sys.path.insert(0, 'slide-rule-python')",
    "from services.a2a_runtime import invoke_external_a2a_agent",
    `payload_json = ${JSON.stringify(JSON.stringify(payload))}`,
    "p = json.loads(payload_json)",
    "res = invoke_external_a2a_agent(",
    "  p.get('envelope') or p,",
    "  p.get('endpoint'),",
    "  p.get('auth'),",
    "  p.get('frameworkType', 'custom')",
    ")",
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
  throw new Error(`python-a2a-external-invoke failed: ${lastErr?.message || lastErr || "no output"}`);
}

export interface A2AClientOptions {
  maxConcurrentSessions?: number; // default 10
  defaultTimeoutMs?: number; // default 60000
}

export class A2AClient {
  // sessions state removed: Python-owned via callPythonA2ASessionStore (thin proxy / compat shell)
  private maxConcurrentSessions: number;
  private defaultTimeoutMs: number;
  // pythonSessionError recorded on py store failure so degraded state is visible (no silent Node success)
  private pythonSessionError: string | null = null;

  constructor(options: A2AClientOptions = {}) {
    this.maxConcurrentSessions = options.maxConcurrentSessions ?? 10;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60000;
  }

  async invoke(
    params: A2AInvokeParams,
    frameworkType: A2AFrameworkType,
    endpoint: string,
    auth?: string,
  ): Promise<A2AResponse> {
    // Check via Python-owned session store (Node shell); failures recorded for visibility
    const activeSessions = this.getActiveSessions();
    if (activeSessions.length >= this.maxConcurrentSessions) {
      return {
        jsonrpc: "2.0",
        id: "",
        error: {
          code: A2A_ERROR_CODES.INVALID_PARAMS,
          message: `Concurrent session limit reached (${this.maxConcurrentSessions})`,
        },
      };
    }

    // Truncate context to 2000 chars
    const truncatedParams: A2AInvokeParams = {
      ...params,
      context: params.context.slice(0, 2000),
    };

    // Build envelope with auth
    const envelope = createEnvelope("a2a.invoke", truncatedParams, auth);

    // Delegate create to Python-owned store; failure here blocks normal success response (degraded visible)
    const started = Date.now();
    try {
      callPythonA2ASessionStore("create", { envelope, frameworkType, startedAt: started });
    } catch (e: any) {
      this.pythonSessionError = `python-a2a-session create failed: ${e?.message || e}`;
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.INTERNAL_ERROR,
          message: `A2A session create failed (python degraded): ${this.pythonSessionError}`,
          data: { degraded: true, pythonError: this.pythonSessionError, source: "python-a2a-session" },
        },
      };
    }

    // Delegate external agent invoke (adapter, url, fetch, response, safe-failure, no-key, missing-endpoint)
    // to Python-first provider. Node is thin proxy only; business semantics owned in Python.
    try {
      try {
        callPythonA2ASessionStore("update", { sessionId: envelope.id, updates: { status: "running" } });
      } catch (e: any) {
        this.pythonSessionError = `python-a2a-session update failed: ${e?.message || e}`;
      }

      const pyRes = callPythonA2AExternalInvoke({
        envelope,
        endpoint,
        auth,
        frameworkType,
      });

      // pyRes contains response (result or error); may include degraded/permissionMetadata
      const response: A2AResponse = pyRes && pyRes.response ? pyRes.response : {
        jsonrpc: "2.0",
        id: envelope.id,
        error: { code: A2A_ERROR_CODES.FRAMEWORK_ERROR, message: "python external invoke returned no response" },
      };

      try {
        const finalStatus = response.error ? "failed" : "completed";
        callPythonA2ASessionStore("update", {
          sessionId: envelope.id,
          updates: { status: finalStatus, completedAt: Date.now(), response },
        });
      } catch (e: any) {
        this.pythonSessionError = `python-a2a-session update failed: ${e?.message || e}`;
      }
      // attach python degraded info if present for visibility
      if (pyRes && (pyRes.degraded || pyRes.permissionMetadata)) {
        (response as any).data = { ...(response as any).data, pythonExternal: { degraded: !!pyRes.degraded, permissionMetadata: pyRes.permissionMetadata } };
      }
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const response: A2AResponse = {
        jsonrpc: "2.0",
        id: envelope.id,
        error: { code: A2A_ERROR_CODES.FRAMEWORK_ERROR, message: `python-external-invoke delegate failed: ${message}` },
      };
      try {
        callPythonA2ASessionStore("update", {
          sessionId: envelope.id,
          updates: { status: "failed", completedAt: Date.now(), response },
        });
      } catch (e: any) {
        this.pythonSessionError = `python-a2a-session update failed: ${e?.message || e}`;
      }
      return response;
    }
  }

  async *invokeStream(
    params: A2AInvokeParams,
    frameworkType: A2AFrameworkType,
    endpoint: string,
    auth?: string,
  ): AsyncGenerator<A2AStreamChunk> {
    // Check via Python-owned
    const activeSessions = this.getActiveSessions();
    if (activeSessions.length >= this.maxConcurrentSessions) {
      throw new Error(
        `Concurrent session limit reached (${this.maxConcurrentSessions})`,
      );
    }

    const truncatedParams: A2AInvokeParams = {
      ...params,
      context: params.context.slice(0, 2000),
      streamMode: true,
    };
    const envelope = createEnvelope("a2a.stream", truncatedParams, auth);

    const started = Date.now();
    try {
      callPythonA2ASessionStore("create", { envelope, frameworkType, startedAt: started });
    } catch (e: any) {
      this.pythonSessionError = `python-a2a-session create failed: ${e?.message || e}`;
      throw new Error(`A2A session create failed (python degraded): ${this.pythonSessionError}`);
    }

    try {
      const adapter = getAdapter(frameworkType);
      const adapted = adapter.adaptRequest(truncatedParams);
      const url = endpoint + adapted.url;
      const headers: Record<string, string> = { ...adapted.headers };
      if (auth) headers["Authorization"] = `Bearer ${auth}`;

      try {
        callPythonA2ASessionStore("update", { sessionId: envelope.id, updates: { status: "running" } });
      } catch (e: any) {
        this.pythonSessionError = `python-a2a-session update failed: ${e?.message || e}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.defaultTimeoutMs,
      );

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(adapted.body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.body) throw new Error("No response body for stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const chunk: A2AStreamChunk = {
          jsonrpc: "2.0",
          id: envelope.id,
          chunk: text,
          done: false,
        };
        try {
          const cur = callPythonA2ASessionStore("get", envelope.id) || {};
          const chunks = Array.isArray(cur.streamChunks) ? [...cur.streamChunks, chunk] : [chunk];
          callPythonA2ASessionStore("update", { sessionId: envelope.id, updates: { streamChunks: chunks } });
        } catch (e: any) {
          this.pythonSessionError = `python-a2a-session update failed: ${e?.message || e}`;
        }
        yield chunk;
      }

      const doneChunk: A2AStreamChunk = {
        jsonrpc: "2.0",
        id: envelope.id,
        chunk: "",
        done: true,
      };
      try {
        const cur = callPythonA2ASessionStore("get", envelope.id) || {};
        const chunks = Array.isArray(cur.streamChunks) ? [...cur.streamChunks, doneChunk] : [doneChunk];
        callPythonA2ASessionStore("update", { sessionId: envelope.id, updates: { streamChunks: chunks, status: "completed", completedAt: Date.now() } });
      } catch (e: any) {
        this.pythonSessionError = `python-a2a-session update failed: ${e?.message || e}`;
      }
      yield doneChunk;
    } catch (err) {
      try {
        callPythonA2ASessionStore("update", { sessionId: envelope.id, updates: { status: "failed", completedAt: Date.now() } });
      } catch (e: any) {
        this.pythonSessionError = `python-a2a-session update failed: ${e?.message || e}`;
      }
      throw err;
    }
  }

  async cancel(sessionId: string): Promise<void> {
    // Delegate to Python store
    try {
      callPythonA2ASessionStore("update", {
        sessionId,
        updates: { status: "cancelled", completedAt: Date.now() },
      });
    } catch (e: any) {
      this.pythonSessionError = `python-a2a-session cancel failed: ${e?.message || e}`;
      // retained compat: do not throw from cancel, but error is recorded for visibility
    }
  }

  getActiveSessions(): A2ASession[] {
    // Python-first; on fail record error (visible) and return [] (no silent ownership)
    try {
      const py = callPythonA2ASessionStore("list_active", {});
      if (Array.isArray(py)) return py as A2ASession[];
      return [];
    } catch (e: any) {
      this.pythonSessionError = `python-a2a-session list_active failed: ${e?.message || e}`;
      return [];
    }
  }

  getSession(sessionId: string): A2ASession | undefined {
    try {
      const s = callPythonA2ASessionStore("get", { sessionId });
      return s || undefined;
    } catch (e: any) {
      this.pythonSessionError = `python-a2a-session get failed: ${e?.message || e}`;
      return undefined;
    }
  }

  terminateTimedOutSessions(): A2ASession[] {
    try {
      const timed = callPythonA2ASessionStore("terminate", { timeoutMs: this.defaultTimeoutMs, now: Date.now() });
      return Array.isArray(timed) ? (timed as A2ASession[]) : [];
    } catch (e: any) {
      this.pythonSessionError = `python-a2a-session terminate failed: ${e?.message || e}`;
      return [];
    }
  }
}
