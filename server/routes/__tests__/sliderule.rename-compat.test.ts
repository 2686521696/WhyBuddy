/**
 * 改名兼容 · 路由别名契约（发布门 G1 重写，2026-07-15）。
 *
 * 原文件三项断言的去向：
 *  ① /api/whybuddy 别名 == /api/sliderule —— 保留（本文件，对假 Python
 *     夹具断言：同一路由器、同样委托、同样透传）；
 *  ② WHYBUDDY_SESSIONS_FILE 旧环境变量选存储文件 —— 会话存储已随
 *     NodeRetirement 移交 Python（persistence.py _resolve_store_file 兜底
 *     旧 env），测试同步移到 slide-rule-python/tests/test_rename_env_compat.py；
 *  ③ 启动时 whybuddy-sessions.json 复制为 sliderule-sessions.json ——
 *     Node 不再拥有会话文件，该启动复制行为已随薄代理架构退役；
 *     兼容窗口（2026-06-13 起一个版本周期）亦已届满。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { startFakePython, type FakePython } from "./helpers/fake-python.js";

const MINIMAL_SESSION = (sid: string) => ({
  sessionId: sid,
  goal: { text: "rename compat", status: "needs_refinement" },
  artifacts: [],
});

describe("rename compat: /api/whybuddy alias serves the same thin proxy", () => {
  let fake: FakePython;
  let server: ReturnType<typeof createServer> | undefined;
  let base = "";
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    fake = await startFakePython();
    for (const k of ["PYTHON_SLIDE_RULE_BASE_URL", "SLIDERULE_V5_BACKEND"]) {
      savedEnv[k] = process.env[k];
    }
    process.env.PYTHON_SLIDE_RULE_BASE_URL = fake.baseUrl;
    delete process.env.SLIDERULE_V5_BACKEND;

    vi.resetModules();
    const mod = await import("../sliderule.js");
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    // Mirror server/index.ts: primary mount + legacy alias on the same router.
    app.use("/api/sliderule", mod.default);
    app.use("/api/whybuddy", mod.default);
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
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

  it("write via legacy alias, read back identical bodies through both mounts", async () => {
    const sid = "rename-alias-1";
    const put = await fetch(`${base}/api/whybuddy/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(MINIMAL_SESSION(sid)),
    });
    expect(put.status).toBe(200);
    expect(fake.sessions.has(sid)).toBe(true); // 旧别名同样委托 Python

    const [viaNew, viaOld] = await Promise.all([
      fetch(`${base}/api/sliderule/sessions/${sid}`),
      fetch(`${base}/api/whybuddy/sessions/${sid}`),
    ]);
    expect(viaNew.status).toBe(200);
    expect(viaOld.status).toBe(200);
    expect(await viaOld.text()).toBe(await viaNew.text());
  });

  it("legacy alias mirrors 404 contract and execute-capability delegation", async () => {
    const miss = await fetch(`${base}/api/whybuddy/sessions/never-existed`);
    expect(miss.status).toBe(404);

    const res = await fetch(`${base}/api/whybuddy/execute-capability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilityId: "evidence.search",
        state: MINIMAL_SESSION("rename-exec"),
        turnId: "t-rename",
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).provenance).toBe("python-rag");
  });
});
