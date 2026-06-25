import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bridge from "./dashboard/bridge";
import * as api from "./dashboard/agentLoopApi";
import AgentLoopPage from "./AgentLoopPage";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (fn: () => void) => {
      (globalThis as any).__AGENT_LOOP_CAPTURED_EFFECT__ = fn;
      return undefined;
    },
  };
});

describe("AgentLoopPage", () => {
  it("mounts the ported AgentLoop dashboard shell (overview workbench)", () => {
    const html = renderToStaticMarkup(<AgentLoopPage />);

    // Page-level chrome-free wrapper renders under SSR; the antd + g6 dashboard itself
    // is client-only and mounts after hydration, so SSR shows the loading placeholder.
    expect(html).toContain('data-testid="agent-loop-page"');
    expect(html).toContain('data-testid="agent-loop-loading"');
    expect(html).toContain("AgentLoop 控制台加载中");
  });
});

describe("agentLoopApi (wired capabilities)", () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("exports the control surface used by the bridge (overview, detail, settings, run, cancel)", () => {
    expect(typeof api.fetchOverview).toBe("function");
    expect(typeof api.fetchDetail).toBe("function");
    expect(typeof api.fetchSettings).toBe("function");
    expect(typeof api.saveSettings).toBe("function");
    expect(typeof api.runQueue).toBe("function");
    expect(typeof api.runSingleTask).toBe("function");
    expect(typeof api.cancelCurrent).toBe("function");
    expect(typeof api.fetchProviderHealth).toBe("function");
  });

  it("fetchOverview hits the documented /runs/overview endpoint", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as any);

    await api.fetchOverview();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/agent-loop/runs/overview"));
  });

  it("fetchDetail and derived paths include reportPath/landingPath/statePath for UI buttons", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        runId: "2026-06-25T12-00-00-000Z",
        status: "DONE_FIXED",
        task: { path: "tasks/foo.md" },
        options: { task: "tasks/foo.md" },
        iterations: [],
        events: [],
      }),
    } as any);

    const d = await api.fetchDetail("2026-06-25T12-00-00-000Z");
    expect(d.reportPath).toBeTruthy();
    expect(d.reportJsonPath).toBeTruthy();
    expect(d.landingPath).toBeTruthy();
    expect(d.statePath).toBeTruthy();
    // paths should target stable documented routes
    expect(d.reportPath).toMatch(/\/api\/agent-loop\/runs\//);
    expect(d.statePath).toMatch(/\/snapshot$/);
  });

  it("fetchSettings/saveSettings hit the Python /settings surface", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ effective: { fixAgent: "grok" }, keys: {} }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as any);

    const s = await api.fetchSettings();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/agent-loop/settings"));
    expect(s.effective || s).toBeTruthy();

    await api.saveSettings({ fixAgent: "codex" });
    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/agent-loop/settings"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("agentloop secret settings semantics 111 does not report secret save success against nonsecret backend", async () => {
    const fetchSpy = global.fetch as any;
    fetchSpy.mockClear();
    // never use real key values; use marker only to exercise the path
    const res = await api.saveSettings({ grokApiKey: 'REDACTED', openaiApiKey: 'REDACTED' });
    // pure secret attempt must not hit the nonsecret /settings backend
    expect(fetchSpy).not.toHaveBeenCalled();
    // must not report success (ok:false + flag); callers must not toast persisted success
    expect(res && res.secretsIgnored).toBe(true);
    expect(res && res.ok).not.toBe(true);
  });

  it("agentloop cancel semantics 111 surfaces queued cancel placeholder instead of stop success", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "queued-cancel",
        message: "cancel is a queued-cancel placeholder (unsupported by bridge; no process kill)",
        exitCode: null,
        timedOut: false,
      }),
    } as any);

    const res = await api.cancelCurrent({});
    expect(res.status).toBe("queued-cancel");
    expect(String(res.message || "")).toMatch(/queued-cancel|placeholder|no process kill/i);
    // ensure not pretending a stop success (distinguish from real cancellable)
    expect(res.status).not.toBe("stopped");
    expect(res.status).not.toBe("cancelled");
    expect(res.status).not.toBe("ok");
  });

  it("agentloop artifact route truth 111 maps report landing and state actions to distinct safe resources", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        runId: "2026-06-25T12-00-00-000Z",
        status: "DONE_FIXED",
        task: { path: "tasks/foo.md" },
        options: { task: "tasks/foo.md" },
        iterations: [],
        events: [],
        artifacts: [
          { id: "final-report.md", kind: "report" },
          { id: "final-report.json", kind: "report" },
          { id: "landing.json", kind: "landing" },
          { id: "state.json", kind: "state" },
        ],
      }),
    } as any);

    const d = await api.fetchDetail("2026-06-25T12-00-00-000Z");
    expect(d.reportPath).toBeTruthy();
    expect(d.reportJsonPath).toBeTruthy();
    expect(d.landingPath).toBeTruthy();
    expect(d.statePath).toBeTruthy();
    // must be distinct (artifact truth rescue, not identical placeholders)
    expect(d.reportPath).not.toBe(d.reportJsonPath);
    expect(d.reportPath).not.toBe(d.landingPath);
    expect(d.landingPath).not.toBe(d.statePath);
    // derived from explicit safe subroutes per artifact ids
    expect(d.reportPath).toMatch(/\/artifacts\/final-report\.md$/);
    expect(d.reportJsonPath).toMatch(/\/artifacts\/final-report\.json$/);
    expect(d.landingPath).toMatch(/\/artifacts\/landing\.json$/);
    expect(d.statePath).toMatch(/\/artifacts\/state\.json$/);
  });
});

describe("agentloop web bridge interaction 111", () => {
  const origFetch = global.fetch;
  const origWindow = (globalThis as any).window;
  const origMessageEvent = (globalThis as any).MessageEvent;

  beforeEach(() => {
    global.fetch = vi.fn();
    (globalThis as any).__AGENT_LOOP_CAPTURED_EFFECT__ = null;
    (globalThis as any).__AGENT_LOOP_DISPATCHED__ = [];

    if (typeof (globalThis as any).MessageEvent === "undefined") {
      (globalThis as any).MessageEvent = class {
        type: string;
        data: unknown;
        constructor(type: string, init?: { data?: unknown }) {
          this.type = type;
          this.data = init?.data;
        }
      };
    }

    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn((event: any) => {
        ((globalThis as any).__AGENT_LOOP_DISPATCHED__ as any[]).push(event);
        return true;
      }),
      open: vi.fn(),
      __AGENT_LOOP_ASSETS__: {},
    };

    bridge.setCommandHandler(null);
  });

  afterEach(() => {
    global.fetch = origFetch;
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
    if (typeof origMessageEvent === "undefined") {
      delete (globalThis as any).MessageEvent;
    } else {
      (globalThis as any).MessageEvent = origMessageEvent;
    }
    bridge.setCommandHandler(null);
    vi.restoreAllMocks();
  });

  async function flushBridge(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("agentloop web bridge interaction 111 hydrates settings and surfaces unsupported semantics truthfully", async () => {
    const setSpy = vi.spyOn(bridge, "setCommandHandler");

    const html = renderToStaticMarkup(<AgentLoopPage />);
    expect(html).toContain('data-testid="agent-loop-page"');
    expect(html).toContain('data-testid="agent-loop-loading"');

    const captured = (globalThis as any).__AGENT_LOOP_CAPTURED_EFFECT__;
    expect(typeof captured).toBe("function");
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as any);
    captured();
    expect(setSpy).toHaveBeenCalled();
    const handler = setSpy.mock.calls.find((call) => typeof call[0] === "function")?.[0] as
      | ((type: string, extra?: Record<string, unknown>) => void)
      | undefined;
    expect(handler).toBeTruthy();

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        effective: { fixAgent: "grok", baseUrl: "http://x", activeProfile: "runtime111" },
        keys: { grokApiKey: "configured" },
      }),
    } as any);

    handler!("getSettings", {});
    await flushBridge();

    const dispatched = (globalThis as any).__AGENT_LOOP_DISPATCHED__ as any[];
    const settingsMsg = dispatched.find((event) => event?.data?.type === "settings");
    expect(settingsMsg).toBeTruthy();
    expect(settingsMsg.data.payload.nonSensitive.fixAgent).toBe("grok");
    expect(settingsMsg.data.payload.activeProfile).toBe("runtime111");

    handler!("getQueueDefaults", {});
    await flushBridge();
    const queueDefaultsMsg = dispatched.find((event) => event?.data?.type === "queueDefaults");
    expect(queueDefaultsMsg).toBeTruthy();
    expect(queueDefaultsMsg.data.payload.unsupported).toBe(true);
    expect(String(queueDefaultsMsg.data.payload.note || "")).toMatch(/not supported|queue defaults/i);

    handler!("getDiagnostics", {});
    await flushBridge();
    const diagnosticsMsg = dispatched.find((event) => event?.data?.type === "diagnostics");
    expect(diagnosticsMsg).toBeTruthy();
    expect(diagnosticsMsg.data.payload.unsupported).toBe(true);

    handler!("listProfiles", {});
    await flushBridge();
    const profilesMsg = dispatched.find((event) => event?.data?.type === "profiles");
    expect(profilesMsg).toBeTruthy();
    expect(profilesMsg.data.payload.unsupported).toBe(true);

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "queued-cancel",
        message: "cancel is a queued-cancel placeholder (unsupported by bridge; no process kill)",
      }),
    } as any);

    handler!("stopRun", {});
    await flushBridge();
    const cancelMsg = dispatched.find((event) => event?.data?.type === "cancelResult");
    expect(cancelMsg).toBeTruthy();
    expect(cancelMsg.data.payload.status).toBe("queued-cancel");
    expect(String(cancelMsg.data.payload.message || "")).toMatch(/queued-cancel|placeholder|no process kill/i);
    expect(cancelMsg.data.payload.status).not.toBe("stopped");

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        runId: "2026-06-25T12-00-00-000Z",
        status: "DONE_FIXED",
        task: { path: "tasks/foo.md" },
        options: { task: "tasks/foo.md" },
        iterations: [],
        events: [],
        artifacts: [
          { id: "final-report.md", kind: "report" },
          { id: "landing.json", kind: "landing" },
          { id: "state.json", kind: "state" },
        ],
      }),
    } as any);

    handler!("openTask", { taskPath: "tasks/foo.md", runId: "2026-06-25T12-00-00-000Z" });
    await flushBridge();

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/agent-loop/runs/2026-06-25T12-00-00-000Z"));
  });
});
