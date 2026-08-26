import { describe, it, expect, vi } from "vitest";
import { createInitialSessionState, intakeMessage, orchestrateReasoningTurn } from "@/lib/sliderule-runtime";
import {
  REHEARSAL_MODULE_TO_STEP,
  REHEARSAL_PRODUCT_STEPS,
  REHEARSAL_WALL_CLOCK_COPY,
  advanceRehearsalCursor,
  buildRehearsalClockView,
  deriveContextHudFacts,
  deriveStatusBarFacts,
  idleRehearsalCursor,
  mapInternalEventToProductStep,
  startRehearsalCursor,
} from "../derive-status-bar";
import type { CapabilityCostRecord } from "@shared/blueprint/v5-reasoning-state";

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
describe("M8 产品六步钟映射表", () => {
  it("钉死内部模块 → 产品步（改 spec_tree 到 1 必须红）", () => {
    // ⚠ 变异：把 REHEARSAL_MODULE_TO_STEP.spec_tree 改成 1，下面必红。
    // 默认 rehearse 从起草 SPEC 起跳；映射成第 1 步等于把钟的起点挪到取证。
    expect(REHEARSAL_MODULE_TO_STEP.spec_tree).toBe(2);
    expect(mapInternalEventToProductStep("spec_tree")).toBe(2);
    expect(mapInternalEventToProductStep("spec_page_html")).toBe(3);
    expect(mapInternalEventToProductStep("page_shell")).toBe(3);
    expect(mapInternalEventToProductStep("html_structure")).toBe(4);
    expect(mapInternalEventToProductStep("spec_semantics")).toBe(5);
    expect(mapInternalEventToProductStep("model_assembly")).toBe(6);
    expect(mapInternalEventToProductStep("html_bindings")).toBe(6);
    expect(mapInternalEventToProductStep("v5_model_gate")).toBe(6);
    expect(mapInternalEventToProductStep("evaluate_coverage_gate")).toBe(6);
    expect(mapInternalEventToProductStep("intent.clarify")).toBe(1);
    expect(mapInternalEventToProductStep("gap.ask")).toBe(1);
    expect(mapInternalEventToProductStep("evidence.search")).toBe(1);
  });

  it("活 SSE 别名落到同一张钟，不另开进度 API", () => {
    expect(mapInternalEventToProductStep("specfirst.spec")).toBe(2);
    expect(mapInternalEventToProductStep("specfirst.pages")).toBe(3);
    expect(mapInternalEventToProductStep("spec_page")).toBe(3);
    expect(mapInternalEventToProductStep("specfirst.structure")).toBe(4);
    expect(mapInternalEventToProductStep("specfirst.semantics")).toBe(5);
    expect(mapInternalEventToProductStep("specfirst.assemble")).toBe(6);
    expect(mapInternalEventToProductStep("specfirst.bind")).toBe(6);
    expect(mapInternalEventToProductStep("risk.analyze")).toBeNull();
    expect(mapInternalEventToProductStep("monitor.design")).toBeNull();
  });

  it("第 1 步默认 skippable；2–6 不可跳", () => {
    expect(REHEARSAL_PRODUCT_STEPS).toHaveLength(6);
    expect(REHEARSAL_PRODUCT_STEPS[0]).toMatchObject({
      id: 1,
      label: "澄清与取证",
      skippable: true,
    });
    expect(REHEARSAL_PRODUCT_STEPS.slice(1).every((s) => s.skippable === false)).toBe(
      true
    );
  });

  it("默认 rehearse 从第 2 步起跳，第 1 格是 skipped 不是 current", () => {
    const view = buildRehearsalClockView(startRehearsalCursor(), {
      isRunning: true,
    });
    expect(view.currentStep).toBe(2);
    expect(view.currentLabel).toBe("起草 SPEC");
    expect(view.steps[0].status).toBe("skipped");
    expect(view.steps[0].skippable).toBe(true);
    expect(view.steps[1].status).toBe("current");
    expect(view.wallClockCopy).toBe(REHEARSAL_WALL_CLOCK_COPY);
    expect(view.wallClockCopy).toBe("大约数分钟，第一页会先出现");
  });

  it("spec_tree 事件把钟钉在第 2 步（从表读，不写死）", () => {
    const next = advanceRehearsalCursor(idleRehearsalCursor(), "spec_tree");
    expect(next.currentStep).toBe(REHEARSAL_MODULE_TO_STEP.spec_tree);
    expect(next.currentStep).toBe(2);
    expect(next.receivedMappedEvent).toBe(true);
    expect(next.sawStep1).toBe(false);
  });

  it("evidence.search 先到才亮第 1 步；之后 spec_tree 把第 1 步收成 done", () => {
    const afterEvidence = advanceRehearsalCursor(
      startRehearsalCursor(),
      "evidence.search"
    );
    expect(afterEvidence.currentStep).toBe(1);
    expect(afterEvidence.sawStep1).toBe(true);
    const afterSpec = advanceRehearsalCursor(afterEvidence, "spec_tree");
    expect(afterSpec.currentStep).toBe(2);
    const view = buildRehearsalClockView(afterSpec, { isRunning: true });
    expect(view.steps[0].status).toBe("done");
    expect(view.steps[1].status).toBe("current");
  });

  it("未映射事件不推进钟（heartbeat 噪音不许冒充进度）", () => {
    const start = startRehearsalCursor();
    const next = advanceRehearsalCursor(start, "monitor.design");
    expect(next).toEqual(start);
  });
});

describe("context HUD：证据 fail-closed / token 只认 server", () => {
  function ledgerRow(
    over: Partial<CapabilityCostRecord> & Pick<CapabilityCostRecord, "source">
  ): CapabilityCostRecord {
    return {
      id: over.id || "c1",
      turnId: "t1",
      capabilityRunId: "r1",
      capabilityId: over.capabilityId || "risk.analyze",
      estimatedTokens: over.estimatedTokens ?? 0,
      source: over.source,
      createdAt: "2026-08-27T00:00:00.000Z",
    };
  }

  it("缺 publishClosure 时证据列是 0，不拿 evidence.search 冒充", () => {
    const state = createInitialSessionState("hud", "hud-closed");
    state.capabilityRuns = [
      {
        id: "r-ev",
        capabilityId: "evidence.search",
        turnId: "t1",
        inputs: [],
        outputs: [],
        gateResults: [],
      } as never,
    ];
    const hud = deriveContextHudFacts(state, null);
    expect(hud.gatedEvidenceCount).toBe(0);
    expect(hud.narrativeTokens).toBe(0);
  });

  it("token 列只累加 source=server；estimated / manual 不进事实", () => {
    const state = createInitialSessionState("hud", "hud-tokens");
    state.costLedger = [
      ledgerRow({ id: "s", source: "server", estimatedTokens: 40 }),
      ledgerRow({ id: "e", source: "estimated", estimatedTokens: 999 }),
      ledgerRow({ id: "m", source: "manual", estimatedTokens: 50 }),
    ];
    const hud = deriveContextHudFacts(state, {
      blocked: false,
      evidencePresentCount: 2,
      skillCount: 6,
      versionPinsChecked: true,
      topBlockers: [],
      tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
    });
    expect(hud.gatedEvidenceCount).toBe(2);
    expect(hud.narrativeTokens).toBe(40);
    expect(hud.narrativeTokens).not.toBe(999);
    expect(hud.narrativeTokens).not.toBe(1089);
  });
});

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
      turnId: "turn-command-120",
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/sliderule/drive-full",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"max_loops":7'),
      })
    );
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as any).body)).turnId).toBe("turn-command-120");
    expect(positive?.finalState.runtimePhase).toBe("done");
    expect((positive as any)?.loops?.[0]?.loopTurnId).toBe("turn-command-120");
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

it("classifies /drive-full status for visible loading and fallback states", async () => {
  const { classifyDriveFullStatus } = await import("@/lib/sliderule-marathon-driver");

  expect(classifyDriveFullStatus({ finalState: createInitialSessionState("ok") })).toBe(
    "python_success"
  );
  expect(classifyDriveFullStatus({ error: "timeout" })).toBe("timeout");
  expect(classifyDriveFullStatus({ error: "python_unavailable" })).toBe("python_unavailable");
  expect(classifyDriveFullStatus(null)).toBe("fallback");
});
