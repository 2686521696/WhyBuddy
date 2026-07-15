/**
 * execute-capability · 深思能力薄代理契约（发布门 G1 重写，2026-07-15）。
 *
 * 历史：本文件原断言 Node 本地执行深思逻辑（R2 rebuttal/counter 的降级
 * 与结构化 bundle）——V5.2 后深思执行权在 Python（v5_capability_executor），
 * Node 默认 python 模式是纯转发，旧断言必红。深思业务本身由
 * slide-rule-python 测试守护；这里只守 Node 的三条转发契约：
 *   1. 深思能力（rebuttal.resolve / counter.argue / critique.generate）
 *      全部委托 Python 并把响应原样透传（含 provenance）；
 *   2. 委托期间 Node 的 legacy 深思模块（deliberation-protocol）零触碰；
 *   3. Python 不可达 → 显式失败（5xx + python-delegated-failed + degraded），
 *      绝不返回伪装成功的 200——上游不可用必须可区分（诚实降级）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../routes/blueprint/brainstorm/pool-llm-caller.js", () => ({
  createPoolBackedBrainstormCaller: vi.fn(() => null),
}));
import express from "express";
import { createServer } from "node:http";
import * as deliberationProtocol from "../../routes/blueprint/brainstorm/deliberation-protocol.js";
import { startFakePython, type FakePython } from "./helpers/fake-python.js";

const STATE = {
  sessionId: "delib-proxy",
  goal: { text: "权限系统" },
  artifacts: [{ id: "a1", kind: "evidence", content: "seed" }],
};

describe("POST /api/sliderule/execute-capability — deliberation thin proxy", () => {
  let fake: FakePython;
  let server: ReturnType<typeof createServer> | undefined;
  let base = "";
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    vi.restoreAllMocks();
    fake = await startFakePython();
    for (const k of ["PYTHON_SLIDE_RULE_BASE_URL", "SLIDERULE_V5_BACKEND"]) {
      savedEnv[k] = process.env[k];
    }
    process.env.PYTHON_SLIDE_RULE_BASE_URL = fake.baseUrl;
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
    vi.restoreAllMocks();
  });

  async function exec(capabilityId: string) {
    return fetch(`${base}/execute-capability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilityId,
        state: STATE,
        inputArtifactIds: ["a1"],
        turnId: `t-${capabilityId}`,
      }),
    });
  }

  it.each(["rebuttal.resolve", "counter.argue", "critique.generate"])(
    "%s delegates to python and passes the result through verbatim",
    async (capabilityId) => {
      const delibSpy = vi.spyOn(deliberationProtocol, "executeDeliberation");
      const res = await exec(capabilityId);
      expect(res.status).toBe(200);
      const body = await res.json();
      // 透传 Python 执行信封（provenance 是「真的走了 Python」的锚点）
      expect(body.provenance).toBe("python-rag");
      expect(body.capabilityId).toBe(capabilityId);

      const call = fake.calls.find(
        (c) => c.path === "/api/sliderule/execute-capability" && c.body?.capabilityId === capabilityId,
      );
      expect(call, "must delegate to python execute-capability").toBeTruthy();
      expect(call!.body.turnId).toBe(`t-${capabilityId}`);
      // Node 的 legacy 深思业务在 python 模式下零触碰
      expect(delibSpy).not.toHaveBeenCalled();
    },
  );

  it("python down → explicit 5xx python-delegated-failed (no fabricated 200 success)", async () => {
    await fake.close();
    const res = await exec("rebuttal.resolve");
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.json();
    expect(body.provenance).toBe("python-delegated-failed");
    expect(body.degraded).toBe(true);
    expect(body.error).toBe("python_unavailable");
  });
});
