/**
 * 发布的网页工程在线打开：Node 薄代理必须把 Python 给的隔离响应头原样带给浏览器。
 *
 * ⚠ 2026-10-02（slide-rule-python/services/published_site.py 头注）：别人发布的 JS 跑在我们的域名下，
 *   隔离全靠 CSP sandbox 响应头。catch-all 原来只转 content-type / set-cookie——生产里那条头被丢掉，
 *   直接打开 /apps/:id/site/ 就是在我们域名上执行别人的脚本，dev（vite 直连 Python）里却看不出来。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";

const CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads";

describe("published site headers pass through the Node proxy", () => {
  let upstream: Server;
  let server: Server;
  let base = "";
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    upstream = createServer((req, res) => {
      if ((req.url || "").startsWith("/api/sliderule/apps/app-1/site/")) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": CSP,
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
          "X-Not-Forwarded": "1",
        });
        res.end("<html><head></head><body>cafe</body></html>");
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>(resolve => upstream.listen(0, resolve));
    const addr = upstream.address();
    saved.PYTHON_SLIDE_RULE_BASE_URL = process.env.PYTHON_SLIDE_RULE_BASE_URL;
    process.env.PYTHON_SLIDE_RULE_BASE_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    vi.resetModules();
    const mod = await import("../sliderule.js");
    const app = express();
    app.use("/api/sliderule", mod.default);
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const own = server.address();
    base = `http://127.0.0.1:${typeof own === "object" && own ? own.port : 0}`;
  });

  afterEach(async () => {
    process.env.PYTHON_SLIDE_RULE_BASE_URL = saved.PYTHON_SLIDE_RULE_BASE_URL;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  });

  it("CSP sandbox and CORS reach the browser; unrelated upstream headers do not", async () => {
    const res = await fetch(`${base}/api/sliderule/apps/app-1/site/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-not-forwarded")).toBeNull();
    expect(await res.text()).toContain("cafe");
  });
});
