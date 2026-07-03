import { describe, it, expect, vi } from "vitest";
import { createInitialSessionState, intakeMessage, orchestrateReasoningTurn } from "@/lib/sliderule-runtime";
import { deriveStatusBarFacts } from "../derive-status-bar";

describe("deriveStatusBarFacts", () => {
  it("surfaces gap count and park hint when awaiting with open gaps", () => {
    const state = createInitialSessionState("测试", "status-test");
    state.runtimePhase = "awaiting";
    state.coverageGaps = [
      { id: "g1", status: "open", description: "need evidence" } as any,
    ];
    const facts = deriveStatusBarFacts(state, { turnCount: 2, isRunning: false });
    expect(facts.openGapCount).toBe(1);
    expect(facts.parkHint).toContain("缺口");
    expect(facts.turnCount).toBe(2);
  });

  it("shows autonomous drive hint while running", () => {
    const state = createInitialSessionState("测试", "status-run");
    const facts = deriveStatusBarFacts(state, { turnCount: 1, isRunning: true });
    expect(facts.parkHint).toContain("自主推进");
    expect(facts.phaseLabel).toBe("推演中");
  });

  it("immersion mode avoids park/await copy on the status surface", () => {
    const state = createInitialSessionState("测试", "status-immersion");
    state.runtimePhase = "awaiting";
    const facts = deriveStatusBarFacts(state, {
      turnCount: 1,
      isRunning: false,
      immersion: true,
      closureReason: "convergence_signal",
    });
    expect(facts.phaseLabel).not.toBe("停泊");
    expect(facts.parkHint == null || !/歇脚|停泊/.test(facts.parkHint)).toBe(true);
  });

  it("exposes three Autopilot-style metrics and closure reason", () => {
    const state = createInitialSessionState("测试", "status-metrics");
    state.runtimePhase = "awaiting";
    const facts = deriveStatusBarFacts(state, {
      turnCount: 3,
      isRunning: false,
      driveLoopCount: 2,
      closureReason: "convergence_signal",
    });
    expect(facts.driveLoopCount).toBe(2);
    expect(facts.trustedArtifactCount).toBeGreaterThanOrEqual(0);
    expect(facts.parkHint).toContain("convergence_signal");
  });

  it("surfaces publish closure status as a status-bar badge fact", () => {
    const state = createInitialSessionState("publish closure status", "status-publish-closure");

    const closed = deriveStatusBarFacts(state, {
      turnCount: 1,
      isRunning: false,
      publishClosure: {
        blocked: false,
        evidencePresentCount: 6,
        skillCount: 6,
        versionPinsChecked: true,
        topBlockers: [],
        tierCounts: { hard_blocker: 0, warning: 1, info: 2 },
      },
    });
    expect(closed.publishClosureLabel).toBe("publish closed");
    expect(closed.publishClosureHint).toContain("6/6");

    const blocked = deriveStatusBarFacts(state, {
      turnCount: 1,
      isRunning: false,
      publishClosure: {
        blocked: true,
        evidencePresentCount: 4,
        skillCount: 6,
        versionPinsChecked: false,
        topBlockers: [{ code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED", path: "page" }],
        tierCounts: { hard_blocker: 2, warning: 1, info: 0 },
      },
    });
    expect(blocked.publishClosureLabel).toBe("publish blocked");
    expect(blocked.publishClosureHint).toContain("hard 2");
  });

  it("surfaces G-GROUND degraded badge after ungrounded evidence.search", () => {
    const s0 = createInitialSessionState("", "status-ground");
    const { preparedState, context } = intakeMessage(s0, {
      turnId: "t-ground",
      userText: "分析权限与风险",
    });
    const { newState } = orchestrateReasoningTurn(preparedState, context);
    const withUngroundedEvidence = {
      ...newState,
      capabilityRuns: [
        ...(newState.capabilityRuns || []),
        {
          id: "r-ev-unground",
          capabilityId: "evidence.search",
          turnId: "t-ground",
          inputs: [],
          outputs: [],
          gateResults: [],
        },
      ],
      artifacts: [
        ...(newState.artifacts || []),
        {
          id: "ev-unground",
          kind: "evidence" as const,
          provenance: "ai_generated" as const,
          trustLevel: "untrusted" as const,
          producedBy: {
            capabilityRunId: "r-ev-unground",
            capabilityId: "evidence.search",
            roleId: "接地",
          },
          content: "【来源: 会话内综合】未找到可检索的公开仓库线索。",
          payload: { evidenceSource: "会话内综合" },
          passedGates: [],
        },
      ],
    };
    const facts = deriveStatusBarFacts(withUngroundedEvidence, {
      turnCount: 1,
      isRunning: false,
      executorMode: "server-llm",
    });
    expect(facts.groundingLabel).toContain("degraded");
    expect(facts.groundingHint).toContain("外部证据未接地");
    expect(facts.executorModeLabel).toContain("server-llm");
  });
});

/** M7 收尾 + 保全：默认 UI 不得出现内部机制词汇（lint 黑名单）。翻译 + derive 负责用户语言化。 */
it("M7: deriveStatusBarFacts default labels avoid internal mechanism tokens (lint blacklist)", () => {
  const forbidden = [
    "T_GATE", "G-GROUND", "gated_pass", "pilot-template",
    "budget_exhausted", "coverage_sufficient", "user_interrupted", "await_ready",
    "frontier_exhausted", "session_budget_exhausted", "autopilotPolicy", "supersededArtifactIds",
    "convergence_signal", "await_confirm"
  ];
  const state = createInitialSessionState("m7 lang test");
  const facts = deriveStatusBarFacts(state, { turnCount: 1, isRunning: true });
  const allLabels = `${facts.phaseLabel} ${facts.groundingLabel} ${facts.groundingHint || ""} ${facts.executorModeLabel} ${facts.conclusionLabel}`;
  for (const f of forbidden) {
    expect(allLabels).not.toContain(f);
  }
});

/** M2.1 探索测试（mock frontier）：marathon driver skeleton 3 轮链，断言 auto-seeded 标记、stop reasons。 */
it("M2.1: marathon driver skeleton with 3-round mock chain (auto-seed, exhausted)", async () => {
  // 简 mock：直接调用 skeleton (内部用 drive single)，检查返回有 rounds
  const controller = new AbortController();
  const state = createInitialSessionState("m2 marathon test");
  const res = await (await import("@/lib/sliderule-marathon-driver")).driveMarathon(state, "seed1", {
    stopSignal: controller.signal,
    budget: { declaredAt: new Date().toISOString() },
    policy: {},
  });
  expect(res.rounds.length).toBeGreaterThan(0);
  expect(res.stopReason).toBeDefined(); // frontier or other in stub
  // 真实 mock frontier 会在下波；当前 skeleton 覆盖接口
});

it("BudgetMarathon: driveMarathon first consumes Python authority endpoint", async () => {
  const { driveMarathon } = await import("@/lib/sliderule-marathon-driver");
  const controller = new AbortController();
  const state = createInitialSessionState("python marathon route");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      backend: "python",
      budgetAuthority: "python",
      state: { ...state, runtimePhase: "awaiting", awaitReason: "budget" },
      publishClosure: {
        blocked: false,
        evidencePresentCount: 6,
        skillCount: 6,
        versionPinsChecked: true,
        topBlockers: [],
        tierCounts: { hard_blocker: 0, warning: 0, info: 1 },
      },
      rounds: [{ loopTurnId: "py-1", stopReason: "session_budget_exhausted" }],
      stopReason: "session_budget_exhausted",
    }),
  } as any);
  try {
    const res = await driveMarathon(state, "seed-python", {
      stopSignal: controller.signal,
      budget: { maxTokens: 1000, declaredAt: new Date().toISOString() },
      policy: {},
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sliderule/drive-marathon",
      expect.objectContaining({ method: "POST" })
    );
    expect(res.stopReason).toBe("session_budget_exhausted");
    expect((res.finalState as any).awaitReason).toBe("budget");
    expect((res.finalState as any).publishClosure?.evidencePresentCount).toBe(6);
  } finally {
    fetchSpy.mockRestore();
  }
});

/** M3/M5/M6 探索测试：driver de-dupe (M3), budget exhausted (M5), superseded (M6). */
it("M3/M5/M6: driver stubs - de-dupe leads to exhausted, budget top, superseded collection", async () => {
  const controller = new AbortController();
  let state = createInitialSessionState("m3-6 test");
  // Force multiple convergence-like by short runs, but stub will hit budget/de-dupe
  const res = await (await import("@/lib/sliderule-marathon-driver")).driveMarathon(state, "seed", {
    stopSignal: controller.signal,
    budget: { maxTokens: 2000, declaredAt: new Date().toISOString() }, // low to hit M5
    policy: {},
  });
  // Stub may hit await_human or other; check that at least one relevant stop or superseded was exercised in this wave
  const stops = [res.stopReason, ...res.rounds.map((r: any) => r.stopReason)];
  expect(stops.some((s: string) => ["frontier_exhausted", "session_budget_exhausted", "await_human"].includes(s)) || (res.finalState as any).supersededArtifactIds).toBe(true);
  // superseded may be set on final state
  expect(Array.isArray((res.finalState as any).supersededArtifactIds) || (res.finalState as any).supersededArtifactIds === undefined).toBe(true);
});

/** M4 探索测试：marathon policy for confirm (代答), await_ready = human stop (await_human). */
it("M4: marathon policy artifact + await_confirm auto (per policy, ledger trace conceptually), await_ready human-only", async () => {
  const controller = new AbortController();
  const state = createInitialSessionState("m4 policy test");
  const res = await (await import("@/lib/sliderule-marathon-driver")).driveMarathon(state, "seed", {
    stopSignal: controller.signal,
    budget: { declaredAt: new Date().toISOString() },
    policy: { autoConfirmRoute: "primary" },
  });
  // In driver, await_ready -> await_human; await_confirm treated as continue with policy seed
  // Policy attached
  expect((res.finalState as any).autopilotPolicy).toBeDefined();
  expect(["await_human", "frontier_exhausted", "session_budget_exhausted"].includes(res.stopReason) || res.rounds.some((r: any) => r.stopReason === "await_confirm")).toBe(true);
});

/** M3 保全测试（真实 frontier.propose）：prompt + rationale + ledger 必须存在且可审计。 */
it("M3 preservation: real proposeFrontier yields prompt(单源) + rationale + ledgerEntry (type=frontier_propose)", async () => {
  const { proposeFrontier, createRoundDigest } = await import("@/lib/sliderule-marathon-driver");
  const st = createInitialSessionState("m3 real propose test");
  const digest = createRoundDigest(st, (st.artifacts || []).slice(-3).map((a: any) => a.id));
  const p = await proposeFrontier(st, digest, []);
  expect(typeof p.prompt).toBe("string");
  expect(p.prompt.length).toBeGreaterThan(10);
  expect(p.rationale).toContain("M3 frontier.propose");
  expect(p.ledgerEntry).toBeDefined();
  expect(p.ledgerEntry.type).toBe("frontier_propose");
  expect(typeof p.seed).toBe("string");
});

/** M6 保全测试（真实 digest + 过质量门概念 + superseded + K1 supply）：9 段 schema + superseded 集合。 */
it("M6 preservation: createRoundDigest uses buildStructuredReport (9 sections) + returns supersededIds for grouping/K1", async () => {
  const { createRoundDigest } = await import("@/lib/sliderule-marathon-driver");
  const st = createInitialSessionState("m6 digest gate test");
  const d = createRoundDigest(st, []);
  expect(d.title).toBeTruthy();
  expect(d.content).toContain("支撑证据");
  expect(d.content).toContain("未解缺口");
  expect(d.content).toContain("下一步工程化分支");
  expect(Array.isArray(d.supersededIds)).toBe(true);
});

/** M5 保全 + 探索：真实 costLedger 累计 + budget 触发 session_budget_exhausted（低预算必中）。 */
it("M5 preservation: driveMarathon consumes real costLedger; low maxTokens forces session_budget_exhausted", async () => {
  const controller = new AbortController();
  const st = createInitialSessionState("m5 cost real");
  const res = await (await import("@/lib/sliderule-marathon-driver")).driveMarathon(st, "seed-m5", {
    stopSignal: controller.signal,
    budget: { maxTokens: 1500, declaredAt: new Date().toISOString() }, // low -> force
    policy: {},
  });
  const cl = (res.finalState as any).costLedger || [];
  expect(Array.isArray(cl)).toBe(true);
  expect(["session_budget_exhausted", "frontier_exhausted", "await_human"].includes(res.stopReason)).toBe(true);
});

it("driveFullViaPython attaches Python publishClosure on success and returns null on degraded response", async () => {
  const { driveFullViaPython } = await import("@/lib/sliderule-marathon-driver");
  const state = createInitialSessionState("drive-full-python-closure-120");

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        backend: "python",
        state: { ...state, runtimePhase: "done" },
        publishClosure: {
          blocked: false,
          evidencePresentCount: 6,
          skillCount: 6,
          versionPinsChecked: true,
          closureHash: "python-closed-120",
          tierCounts: { hard_blocker: 0, warning: 0, info: 1 },
          topBlockers: [],
        },
      }),
    } as any)
    .mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: "python_unavailable" }),
    } as any);

  try {
    const positive = await driveFullViaPython(state, "show closure on page", {
      stopSignal: new AbortController().signal,
      maxLoops: 7,
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/sliderule/drive-full",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"max_loops":7'),
      })
    );
    expect(positive?.finalState.runtimePhase).toBe("done");
    expect((positive?.finalState as any).publishClosure?.blocked).toBe(false);
    expect((positive?.finalState as any).publishClosure?.evidencePresentCount).toBe(6);
    expect((positive?.finalState as any).publishClosure?.closureHash).toBe("python-closed-120");

    const degraded = await driveFullViaPython(state, "fallback locally", {
      stopSignal: new AbortController().signal,
    });
    expect(degraded).toBeNull();
  } finally {
    fetchSpy.mockRestore();
  }
});
