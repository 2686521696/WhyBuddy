/**
 * Rename-migration compat tests (R3③, WhyBuddy → SlideRule):
 *  - legacy /api/whybuddy alias serves the same router/responses as /api/sliderule
 *  - legacy WHYBUDDY_SESSIONS_FILE env still selects the sessions file
 *  - legacy default sessions file (data/whybuddy-sessions.json) is copied (not moved)
 *    to the new default path on startup
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MINIMAL_SESSION = (sid: string) => ({
  sessionId: sid,
  goal: { text: "rename compat", status: "needs_refinement" },
  artifacts: [],
  staleArtifactIds: [],
  decisionLedger: [],
  capabilityRuns: [],
});

describe("rename compat: route alias + sessions file", () => {
  let server: ReturnType<typeof createServer> | undefined;
  let tmpDir = "";
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sliderule-rename-"));
    for (const k of ["SLIDERULE_SESSIONS_FILE", "WHYBUDDY_SESSIONS_FILE"]) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
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
    vi.restoreAllMocks();
  });

  async function startWithBothMounts(): Promise<string> {
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
    return `http://127.0.0.1:${port}`;
  }

  it("legacy /api/whybuddy path returns 200 with the same payload as /api/sliderule", async () => {
    process.env.SLIDERULE_SESSIONS_FILE = path.join(tmpDir, "sessions.json");
    const base = await startWithBothMounts();
    const sid = `rename-compat-${Date.now()}`;

    // write through the LEGACY path (old TRAE Skill behavior)
    const put = await fetch(`${base}/api/whybuddy/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(MINIMAL_SESSION(sid)),
    });
    expect(put.status).toBe(200);

    // read back through both paths — identical response body
    const [viaNew, viaOld] = await Promise.all([
      fetch(`${base}/api/sliderule/sessions/${sid}`),
      fetch(`${base}/api/whybuddy/sessions/${sid}`),
    ]);
    expect(viaNew.status).toBe(200);
    expect(viaOld.status).toBe(200);
    expect(await viaOld.text()).toBe(await viaNew.text());
  });

  it("WHYBUDDY_SESSIONS_FILE (legacy env only) still selects the sessions file", async () => {
    const legacyEnvFile = path.join(tmpDir, "legacy-env-sessions.json");
    process.env.WHYBUDDY_SESSIONS_FILE = legacyEnvFile;
    const base = await startWithBothMounts();
    const sid = `legacy-env-${Date.now()}`;

    const put = await fetch(`${base}/api/sliderule/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(MINIMAL_SESSION(sid)),
    });
    expect(put.status).toBe(200);
    expect(fs.existsSync(legacyEnvFile)).toBe(true);
    expect(fs.readFileSync(legacyEnvFile, "utf8")).toContain(sid);
  });

  it("copies data/whybuddy-sessions.json to data/sliderule-sessions.json on startup (copy, not move)", async () => {
    const sid = "legacy-file-session";
    const legacyDefault = path.join(tmpDir, "data", "whybuddy-sessions.json");
    fs.mkdirSync(path.dirname(legacyDefault), { recursive: true });
    fs.writeFileSync(legacyDefault, JSON.stringify([[sid, MINIMAL_SESSION(sid)]]));

    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const base = await startWithBothMounts();

    const newDefault = path.join(tmpDir, "data", "sliderule-sessions.json");
    expect(fs.existsSync(newDefault)).toBe(true);
    expect(fs.existsSync(legacyDefault)).toBe(true); // rollback copy kept

    const get = await fetch(`${base}/api/sliderule/sessions/${sid}`);
    expect(get.status).toBe(200);
  });
});
