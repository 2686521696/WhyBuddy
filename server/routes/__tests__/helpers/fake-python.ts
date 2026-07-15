/**
 * 假 Python 后端夹具（发布门 G1，2026-07-15）。
 *
 * 背景：Node sliderule 路由已收敛为零状态薄代理（Python 拥有全部会话
 * 状态与 V5 执行），server 段发布门测试因此改为「薄代理契约」断言——
 * 需要一个可控的 Python 替身：内存会话表 + 请求日志 + 可关停（模拟
 * Python 不可达）。真实 Python 行为由 slide-rule-python 自己的 1600+
 * 测试守护，这里只守 Node 的转发契约（透传/状态码分流/零本地状态）。
 */
import { createServer, type Server } from "node:http";

export interface FakePythonCall {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

export interface FakePython {
  baseUrl: string;
  calls: FakePythonCall[];
  sessions: Map<string, any>;
  close(): Promise<void>;
}

export async function startFakePython(): Promise<FakePython> {
  const sessions = new Map<string, any>();
  const calls: FakePythonCall[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: any = undefined;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      const path = (req.url || "").split("?")[0];
      calls.push({ method: req.method || "?", path, headers: { ...req.headers }, body });

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      // /health（thin proxy 健康检查透传用）
      if (path === "/health") {
        return send(200, { status: "ok", backend: "slide-rule-python", provenance: "backend:slide-rule-python" });
      }

      const sessionMatch = path.match(/^\/api\/sliderule\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        const sid = decodeURIComponent(sessionMatch[1]);
        if (req.method === "GET") {
          const state = sessions.get(sid);
          if (!state) return send(404, { detail: "Not found" });
          // 与真 Python get_sess 同形：{state: ...} 包封
          return send(200, { state });
        }
        if (req.method === "PUT") {
          sessions.set(sid, body);
          // 与真 Python save_sess 同形：ok 信封（不回显会话）
          return send(200, { ok: true, stateAuthority: "python", provenance: "python-fullpath", backend: "python" });
        }
        if (req.method === "DELETE") {
          if (!sessions.has(sid)) return send(404, { detail: "Not found" });
          sessions.delete(sid);
          return send(200, { ok: true });
        }
      }

      if (path === "/api/sliderule/sessions" && req.method === "GET") {
        return send(200, {
          sessions: [...sessions.keys()].map((sid) => ({ sessionId: sid })),
          provenance: "python-fullpath",
        });
      }

      if (path === "/api/sliderule/execute-capability" && req.method === "POST") {
        // 与真 Python 执行结果同形的最小信封（provenance 是 Node 透传断言的锚点）
        return send(200, {
          artifact: {
            id: `art-${body?.capabilityId || "cap"}-${calls.length}`,
            kind: "evidence",
            content: `fake result for ${body?.capabilityId}`,
          },
          capabilityId: body?.capabilityId,
          turnId: body?.turnId,
          provenance: "python-rag",
          backend: "python",
        });
      }

      if (path === "/api/sliderule/orchestrate-plan" && req.method === "POST") {
        return send(200, { selected: [], rationale: "fake plan", provenance: "python-fullpath" });
      }

      return send(404, { detail: `fake python has no route for ${req.method} ${path}` });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // 关掉 keep-alive 连接，避免测试悬挂
        server.closeAllConnections?.();
      }),
  };
}
