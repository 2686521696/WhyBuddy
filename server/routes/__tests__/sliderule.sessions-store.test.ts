/**
 * SlideRule 会话路由 · 薄代理契约（发布门 G1 重写，2026-07-15）。
 *
 * 历史：本文件原是「Node 本地文件存储」时代的契约（PUT 回显归一化会话、
 * 临时文件落盘、Node 侧 N1 归一化、python 子进程互操作）——V5.2
 * NodeRetirement 之后 Node 路由已是零状态纯代理（Python 拥有全部会话
 * 状态），旧断言在任何平台都无法通过，发布门因此长期带伤。
 *
 * 现契约（对着假 Python 夹具断言，hermetic 零外部依赖）：
 *   1. GET/PUT/DELETE/LIST 全部委托 Python 并透传响应（含内部鉴权头）；
 *   2. 上游 404 状态码分流：GET 缺失会话 → 404（前端 store
 *      「404 => undefined」契约，sliderule-http-store.ts load()）；
 *      DELETE 缺失 → 204 幂等；
 *   3. Python 不可达 → 502 { error: "python_unavailable" }，绝不伪造成功；
 *   4. Node 拥有零持久状态：会话操作后本地 sessions 文件不存在。
 * Python 自身的持久化/归一化/并发闸由 slide-rule-python 测试套件守护。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakePython, type FakePython } from "./helpers/fake-python.js";

const SESSION = (sid: string) => ({
  sessionId: sid,
  goal: { text: "thin proxy contract", status: "needs_refinement" },
  artifacts: [],
  conversation: [],
});

describe("SlideRule session routes — thin proxy contract", () => {
  let fake: FakePython;
  let server: ReturnType<typeof createServer> | undefined;
  let base = "";
  let tmpDir = "";
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sliderule-proxy-"));
    fake = await startFakePython();
    for (const k of ["PYTHON_SLIDE_RULE_BASE_URL", "SLIDERULE_SESSIONS_FILE", "SLIDERULE_V5_BACKEND"]) {
      savedEnv[k] = process.env[k];
    }
    process.env.PYTHON_SLIDE_RULE_BASE_URL = fake.baseUrl;
    // 指到临时路径以便断言「Node 不写它」（零持久状态契约）
    process.env.SLIDERULE_SESSIONS_FILE = path.join(tmpDir, "sessions.json");
    delete process.env.SLIDERULE_V5_BACKEND; // 默认 python 模式

    vi.resetModules();
    const mod = await import("../sliderule.js");
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api/sliderule", mod.default);
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/sliderule`;
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
    await fake.close();
  });

  it("PUT delegates to python with internal key and passes the ok envelope through", async () => {
    const sid = "proxy-put-1";
    const put = await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SESSION(sid)),
    });
    expect(put.status).toBe(200);
    // 透传 Python 的 ok 信封（不是旧时代的「回显归一化会话」）
    const body = await put.json();
    expect(body.ok).toBe(true);
    expect(body.provenance).toBe("python-fullpath");

    const call = fake.calls.find((c) => c.method === "PUT" && c.path.endsWith(`/sessions/${sid}`));
    expect(call, "PUT must be delegated to python").toBeTruthy();
    expect(call!.headers["x-internal-key"]).toBeTruthy();
    expect(call!.body.sessionId).toBe(sid);
  });

  it("GET passes the python {state} envelope through verbatim", async () => {
    const sid = "proxy-get-1";
    fake.sessions.set(sid, SESSION(sid));
    const get = await fetch(`${base}/sessions/${sid}`);
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.state.sessionId).toBe(sid);
    expect(body.state.goal.text).toBe("thin proxy contract");
  });

  it("GET missing session returns 404 (frontend store contract: 404 => undefined)", async () => {
    const get = await fetch(`${base}/sessions/definitely-missing`);
    expect(get.status).toBe(404);
    const body = await get.json();
    expect(body.error).toBe("not_found");
  });

  it("DELETE existing → 204 and delegated; DELETE missing → 204 idempotent", async () => {
    const sid = "proxy-del-1";
    fake.sessions.set(sid, SESSION(sid));
    const del = await fetch(`${base}/sessions/${sid}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect(fake.sessions.has(sid)).toBe(false);

    const delAgain = await fetch(`${base}/sessions/${sid}`, { method: "DELETE" });
    expect(delAgain.status).toBe(204);
  });

  it("LIST passes the python sessions envelope through", async () => {
    fake.sessions.set("l1", SESSION("l1"));
    fake.sessions.set("l2", SESSION("l2"));
    const list = await fetch(`${base}/sessions`);
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.sessions.map((s: { sessionId: string }) => s.sessionId).sort()).toEqual(["l1", "l2"]);
  });

  it("python down → 502 python_unavailable (never a fabricated success)", async () => {
    await fake.close();
    const sid = "proxy-down-1";

    const get = await fetch(`${base}/sessions/${sid}`);
    expect(get.status).toBe(502);
    expect((await get.json()).error).toBe("python_unavailable");

    const put = await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SESSION(sid)),
    });
    expect(put.status).toBe(502);
    expect((await put.json()).error).toBe("python_unavailable");

    const list = await fetch(`${base}/sessions`);
    expect(list.status).toBe(502);
    expect((await list.json()).error).toBe("python_unavailable");
  });

  it("node owns ZERO durable state: no local sessions file is ever written", async () => {
    const sid = "proxy-zero-state";
    await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SESSION(sid)),
    });
    await fetch(`${base}/sessions/${sid}`);
    await fetch(`${base}/sessions`);
    expect(fs.existsSync(process.env.SLIDERULE_SESSIONS_FILE!)).toBe(false);
  });
});
