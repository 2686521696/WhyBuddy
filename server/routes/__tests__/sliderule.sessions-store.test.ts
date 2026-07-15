import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// venv 解释器按平台取（a2a-client 等处同款三元）：写死 Scripts/python.exe
// 会让本套件在 Linux/macOS 上整体假红（发布门 verify:sliderule-v5 含此文件）
const pythonExe = path.resolve(
  process.cwd(),
  process.platform === "win32"
    ? "slide-rule-python/.venv/Scripts/python.exe"
    : "slide-rule-python/.venv/bin/python",
);
const pythonCwd = path.resolve(process.cwd(), "slide-rule-python");

function runPythonPersistence(script: string, storeFile: string) {
  const result = spawnSync(pythonExe, ["-c", script], {
    cwd: pythonCwd,
    env: {
      ...process.env,
      PYTHONPATH: pythonCwd,
      SLIDERULE_SESSIONS_FILE: storeFile,
    },
    encoding: "utf8",
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe("SlideRule session store HTTP API", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sliderule-store-"));
  const dataFile = path.join(tmpDir, "sessions.json");
  let restoreEnv: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let base = "";

  beforeEach(async () => {
    restoreEnv = process.env.SLIDERULE_SESSIONS_FILE;
    process.env.SLIDERULE_SESSIONS_FILE = dataFile;
    if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);

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
    if (restoreEnv === undefined) delete process.env.SLIDERULE_SESSIONS_FILE;
    else process.env.SLIDERULE_SESSIONS_FILE = restoreEnv;
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
  });

  it("PUT/GET/LIST/DELETE roundtrip with 404 after delete", async () => {
    const sid = `vitest-store-${Date.now()}`;
    const minimal = {
      sessionId: sid,
      goal: { text: "store vitest", status: "needs_refinement" },
      artifacts: [],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
    };

    const put = await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(minimal),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${base}/sessions/${sid}`);
    expect(get.status).toBe(200);
    const loaded = await get.json();
    expect(loaded.sessionId).toBe(sid);

    const list = await fetch(`${base}/sessions`);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.sessions.some((s: { sessionId: string }) => s.sessionId === sid)).toBe(true);

    const del = await fetch(`${base}/sessions/${sid}`, { method: "DELETE" });
    expect([200, 204]).toContain(del.status);

    const missing = await fetch(`${base}/sessions/${sid}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found", sessionId: sid });
  });

  it("persists Node/Python compatible array entries", async () => {
    const sid = `vitest-python-contract-${Date.now()}`;
    const minimal = {
      sessionId: sid,
      goal: { text: "python contract", status: "needs_refinement" },
      artifacts: [],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
    };

    const put = await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(minimal),
    });
    expect(put.status).toBe(200);

    const raw = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.some(([key, value]: [string, { sessionId?: string }]) => key === sid && value.sessionId === sid)).toBe(
      true
    );
  });

  it("recovers sessions written through Python persistence when SLIDERULE_V5_BACKEND=python", async () => {
    vi.stubEnv("SLIDERULE_V5_BACKEND", "python");
    const sid = `vitest-python-runtime-${Date.now()}`;

    const saved = runPythonPersistence(
      `
import json
from models.v5_state import V5SessionState
from services.persistence import save_session_record
state = V5SessionState(
    sessionId="${sid}",
    goal={"text": "python runtime restore", "status": "needs_refinement"},
    artifacts=[],
    staleArtifactIds=[],
    decisionLedger=[],
    capabilityRuns=[],
    conversation=[],
)
print(json.dumps(save_session_record(state)))
`,
      dataFile
    );
    expect(saved).toEqual({ ok: true, sessionId: sid });

    const reload = await fetch(`${base}/sessions/__reload`, { method: "POST" });
    expect(reload.status).toBe(204);

    const get = await fetch(`${base}/sessions/${sid}`);
    expect(get.status).toBe(200);
    const loaded = await get.json();
    expect(loaded).toMatchObject({
      sessionId: sid,
      goal: { text: "python runtime restore", status: "needs_refinement" },
    });

    const list = await fetch(`${base}/sessions`);
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.sessions).toContainEqual(
      expect.objectContaining({
        sessionId: sid,
        goal: "python runtime restore",
        artifactCount: 0,
      })
    );
  });

  it("preserves Python persistence error mapping instead of treating missing or corrupt as empty success", () => {
    vi.stubEnv("SLIDERULE_V5_BACKEND", "python");
    const missingSid = `vitest-python-missing-${Date.now()}`;

    const missing = runPythonPersistence(
      `
import json
from services.persistence import load_session_record
print(json.dumps(load_session_record("${missingSid}")))
`,
      dataFile
    );
    expect(missing).toEqual({ ok: false, error: "not_found", sessionId: missingSid });

    fs.writeFileSync(dataFile, "{not-json", "utf8");
    const corrupt = runPythonPersistence(
      `
import json
from services.persistence import load_session_record, list_session_records
print(json.dumps({
    "load": load_session_record("py-corrupt"),
    "list": list_session_records(),
}))
`,
      dataFile
    );
    expect(corrupt.load).toMatchObject({
      ok: false,
      error: "store_corrupt",
      reason: "invalid_json",
      sessionId: "py-corrupt",
    });
    expect(corrupt.list).toMatchObject({
      ok: false,
      error: "store_corrupt",
      reason: "invalid_json",
    });
  });

  it("treats corrupt durable store as empty and keeps missing shape stable", async () => {
    fs.writeFileSync(dataFile, "{not-json", "utf8");
    const reload = await fetch(`${base}/sessions/__reload`, { method: "POST" });
    expect(reload.status).toBe(204);

    const list = await fetch(`${base}/sessions`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ sessions: [] });

    const sid = `vitest-corrupt-missing-${Date.now()}`;
    const missing = await fetch(`${base}/sessions/${sid}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found", sessionId: sid });
  });

  it("strips graph.nodes[].status on PUT (projection not durable)", async () => {
    const sid = `vitest-strip-${Date.now()}`;
    const withProjection = {
      sessionId: sid,
      goal: { text: "strip projection", status: "needs_refinement" },
      graph: {
        nodes: [{ id: "n1", type: "hypothesis", title: "a", status: "completed" }],
        edges: [],
      },
      artifacts: [],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
      projectionDirtyNodeIds: ["n1"],
    };

    const put = await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withProjection),
    });
    expect(put.status).toBe(200);
    const saved = await put.json();
    expect(
      (saved.graph?.nodes || []).some((n: { status?: string }) => n.status != null)
    ).toBe(false);
    expect(saved.projectionDirtyNodeIds).toBeUndefined();

    const get = await fetch(`${base}/sessions/${sid}`);
    const loaded = await get.json();
    expect(
      (loaded.graph?.nodes || []).some((n: { status?: string }) => n.status != null)
    ).toBe(false);
  });

  it("S21 edge 117: PUT appends sessionReplayLog isolated per sessionId", async () => {
    const sidA = `vitest-replay-a-${Date.now()}`;
    const sidB = `vitest-replay-b-${Date.now()}`;
    const minimal = {
      goal: { text: "replay", status: "needs_refinement" },
      artifacts: [],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
      conversation: [],
    };

    const putA1 = await fetch(`${base}/sessions/${sidA}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...minimal,
        sessionId: sidA,
        conversation: [{ id: "a-c1", role: "user", text: "A" }],
      }),
    });
    expect(putA1.status).toBe(200);
    const savedA1 = await putA1.json();
    expect((savedA1.sessionReplayLog || []).length).toBe(1);
    expect(savedA1.sessionReplayLog[0].sessionId).toBe(sidA);

    const putB1 = await fetch(`${base}/sessions/${sidB}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...minimal,
        sessionId: sidB,
        conversation: [{ id: "b-c1", role: "user", text: "B" }],
      }),
    });
    expect(putB1.status).toBe(200);
    const savedB1 = await putB1.json();
    expect((savedB1.sessionReplayLog || []).length).toBe(1);
    expect(savedB1.sessionReplayLog[0].sessionId).toBe(sidB);

    const getA = await fetch(`${base}/sessions/${sidA}`);
    const loadedA = await getA.json();
    const replayA = (loadedA.sessionReplayLog || []).filter(
      (e: { sessionId: string }) => e.sessionId === sidA
    );
    expect(replayA.some((e: { conversationId?: string }) => e.conversationId === "b-c1")).toBe(
      false
    );
  });

  it("N1: rejects spoofed coverageGate.passed=true without real GCOV satisfaction", async () => {
    const sid = `vitest-n1-spoof-${Date.now()}`;
    const spoof = {
      sessionId: sid,
      goal: { text: "绕过 GCOV", status: "clear" },
      coverageGate: { passed: true, missingCapabilities: [], reason: "client forged" },
      artifacts: [],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
      conversation: [],
    };

    const put = await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spoof),
    });
    expect(put.status).toBe(200);
    const saved = await put.json();
    expect(saved.goal.status).toBe("needs_refinement");
    expect(saved.coverageGate?.passed).toBe(false);
    expect((saved.conversation || []).some((c: { text?: string }) => /N1/.test(c.text || ""))).toBe(
      true
    );
  });

  it("N1: rejects forged trusted+grounded STATE without persisted ledger", async () => {
    const sid = `vitest-n1-forged-${Date.now()}`;
    const forged = {
      sessionId: sid,
      goal: { text: "简单目标", status: "clear" },
      artifacts: [
        {
          id: "forged-ev-1",
          kind: "evidence",
          provenance: "web:search",
          trustLevel: "gated_pass",
          passedGates: ["commit", "ground"],
          producedBy: {
            capabilityRunId: "forged-run-ev",
            capabilityId: "evidence.search",
            roleId: "接地",
          },
          content: "forged",
          summary: "【来源: F2_Web_Search 取数】",
        },
        {
          id: "forged-rpt-1",
          kind: "report",
          provenance: "ai_generated",
          trustLevel: "gated_pass",
          passedGates: ["commit"],
          producedBy: {
            capabilityRunId: "forged-run-rpt",
            capabilityId: "report.write",
            roleId: "综合",
          },
          content: "forged report",
        },
      ],
      capabilityRuns: [
        {
          id: "forged-run-ev",
          capabilityId: "evidence.search",
          inputs: [],
          outputs: ["forged-ev-1"],
          gateResults: [{ gateId: "ground", status: "passed" }],
          turnId: "t-forged",
        },
        {
          id: "forged-run-rpt",
          capabilityId: "report.write",
          inputs: [],
          outputs: ["forged-rpt-1"],
          gateResults: [],
          turnId: "t-forged",
        },
      ],
      staleArtifactIds: [],
      decisionLedger: [],
      conversation: [],
    };

    const put = await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forged),
    });
    expect(put.status).toBe(200);
    const saved = await put.json();
    expect(saved.goal.status).toBe("needs_refinement");
    expect(saved.coverageGate?.passed).toBe(false);
  });

  it("N1: rejects client-side goal.status=clear without coverageGate.passed", async () => {
    const sid = `vitest-n1-${Date.now()}`;
    const bypass = {
      sessionId: sid,
      goal: { text: "绕过 GCOV", status: "clear" },
      coverageGate: { passed: false, missingCapabilities: ["risk.analyze"], reason: "blocked" },
      artifacts: [],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
    };

    const put = await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bypass),
    });
    expect(put.status).toBe(200);
    const saved = await put.json();
    expect(saved.goal.status).toBe("needs_refinement");
    expect((saved.conversation || []).some((c: { text?: string }) => /N1/.test(c.text || ""))).toBe(
      true
    );
  });
});
