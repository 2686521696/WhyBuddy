import { describe, expect, it, vi, afterEach } from "vitest";
import { HttpSlideRuleSessionStore } from "../sliderule-http-store";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

function makeState(sessionId = "sliderule-v51-product"): V5SessionState {
  return {
    sessionId,
    goal: { text: "test goal", status: "needs_refinement" },
    artifacts: [],
    capabilityRuns: [],
    coverageGaps: [],
    coverageContract: null,
    coverageGate: null,
    graph: {
      id: "sliderule-session-graph",
      jobId: "sliderule-prototype",
      stage: "effect_preview",
      nodes: [],
      edges: [],
      source: "runtime",
    },
    staleArtifactIds: [],
    conversation: [],
  } as V5SessionState;
}

describe("HttpSlideRuleSessionStore Python compatibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("unwraps Python session envelopes on load", async () => {
    const state = makeState();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        state,
        provenance: "python-fullpath",
        backend: "python",
      }),
    } as Response);

    const store = new HttpSlideRuleSessionStore();
    const loaded = await store.load("sliderule-v51-product");

    expect(loaded?.sessionId).toBe("sliderule-v51-product");
    expect((loaded as any).state).toBeUndefined();
    expect(loaded?.graph?.nodes).toEqual([]);
    expect(loaded?.gates).toEqual([]);
    expect(loaded?.dependencyGraph).toEqual([]);
    expect(loaded?.decisions).toEqual([]);
    expect(loaded?.risks).toEqual([]);
  });

  it("keeps the submitted state when Python save returns an ack envelope", async () => {
    const state = makeState("save-python-ack");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        provenance: "python-fullpath",
        backend: "python",
      }),
    } as Response);

    const store = new HttpSlideRuleSessionStore();
    const saved = await store.save(state);

    expect(saved.sessionId).toBe("save-python-ack");
    expect(saved.graph?.nodes).toEqual([]);
    expect((saved as any).ok).toBeUndefined();
  });

  it("does not crash the active turn when an older Python schema rejects untrusted artifacts", async () => {
    const state = {
      ...makeState("save-python-old-schema"),
      artifacts: [
        {
          id: "art-untrusted",
          kind: "evidence",
          provenance: "llm_fallback",
          trustLevel: "untrusted",
          passedGates: [],
          producedBy: {
            capabilityRunId: "run-untrusted",
            capabilityId: "evidence.search",
            roleId: "grounding",
          },
        },
      ],
    } as V5SessionState;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () =>
        '{"detail":[{"loc":["body","artifacts",0,"trustLevel"],"input":"untrusted"}]}',
    } as Response);

    const store = new HttpSlideRuleSessionStore();
    const saved = await store.save(state);

    expect(saved.sessionId).toBe("save-python-old-schema");
    expect(saved.artifacts[0]?.trustLevel).toBe("untrusted");
  });

  it("HttpSlideRuleSessionStore proves thin compat proxy / frontend contract consumer (Vite dev + Python API mode)", async () => {
    // Explicitly for dev-all-python-api-mode: the store consumes /api/sliderule (proxied by Vite to Python 9700 by default).
    // Node backend is never the owner; store + Vite proxy select python target; Node routes are thin shell.
    // This Vitest proves only contract consumer behavior (no business ownership asserted in client).
    const state = makeState("dev-py-api-thin");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        state,
        provenance: "python-fullpath",
        backend: "python",
      }),
    } as Response);

    const store = new HttpSlideRuleSessionStore("/api/sliderule"); // default vite-relative target
    const loaded = await store.load("dev-py-api-thin");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/sliderule/sessions/"),
      expect.any(Object)
    );
    expect(loaded?.sessionId).toBe("dev-py-api-thin");
    // frontend is consumer only; no Node ownership, python signals present
    expect((loaded as any)?.provenance).toBeUndefined(); // unwrapped
    expect(loaded?.graph).toBeDefined();
  });

  it("deleteSession + load post-delete returns undefined (404 contract) and preserves chinese goal fidelity on pre-delete load (browser /agent-loop/sliderule reset contract)", async () => {
    // Browser smoke contract test: exercises the client path used by resetSession in /agent-loop/sliderule (useSlideRuleSession + SlideRule UI reset button).
    // Vitest emulates browser JS runtime (Vite bundle); fetch goes to /api (Vite proxy -> Python 9700).
    // Covers: 1) chinese state fidelity read via http-store.load (no mojibake in client-visible state), 2) delete, 3) subsequent load returns undefined (maps 404).
    // Proves only TS_RUNTIME_OWNED thin frontend contract consumer; Python owns DELETE/GET 404 + no-mojibake (see pytest).
    const chinese =
      "浏览器重置会话 smoke 测试：reset session + DELETE/GET 无 mojibake";
    const preState = {
      ...makeState("reset-browser-smoke-105"),
      goal: { text: chinese, status: "needs_refinement" },
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          state: preState,
          provenance: "python-fullpath",
          backend: "python",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "",
      } as Response);
    const store = new HttpSlideRuleSessionStore();
    const loadedPre = await store.load("reset-browser-smoke-105");
    expect(loadedPre?.goal?.text).toBe(chinese); // chinese fidelity in browser client read
    await store.deleteSession("reset-browser-smoke-105");
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/reset-browser-smoke-105"),
      expect.objectContaining({ method: "DELETE" })
    );
    const loadedPost = await store.load("reset-browser-smoke-105");
    expect(loadedPost).toBeUndefined(); // 404 contract after reset delete, for browser reload
  });
});
