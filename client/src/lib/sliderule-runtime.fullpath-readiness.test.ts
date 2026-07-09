/**
 * SlideRule V5.1 Full-Path — S11 G_READY readiness chain.
 * Spec: docs/V5.1-full-path-test-plan.md (§2 S11; edges 53–56).
 */

import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  intakeMessage,
  driveReasoningSession,
  createDeterministicRouter,
  createDeterministicCapabilityExecutor,
  pickNextCapabilities,
  commitArtifact,
} from "./sliderule-runtime";
import { createRawArtifact } from "./sliderule-fullpath-fixtures";
import { gapsFromGapAskContent } from "@shared/blueprint/sliderule-readiness-chain";
import { userClearsReadiness } from "@shared/blueprint/sliderule-interactive-gates";

describe("S11 · G_READY readiness chain", () => {
  it("C_GAP→C_QEXP: vague cold start routes to gap.ask then question.expand", () => {
    // Use a clearly non-product-build vague goal so readiness wins strictly (product/game goals
    // now front-load critique per V5.2 complex contract + audit fixes for RPG marathon runs).
    const s = createInitialSessionState("解释光合作用原理", "S11-pick");
    const picks = pickNextCapabilities(s, "解释一下光合作用是怎么回事");
    expect(picks[0]?.capabilityId).toBe("gap.ask");
    expect(picks.some((p) => p.capabilityId === "question.expand")).toBe(true);
  });

  it("G_READY→AWAIT: parks only when open_question gaps remain after gap.ask", async () => {
    const s = createInitialSessionState("做一个系统", "S11-park");
    const gaps = gapsFromGapAskContent("- 面向谁使用？\n- 成功标准是什么？", "S11-g", "art-gap");
    const withGaps = {
      ...s,
      coverageGaps: gaps,
      coverageContract: {
        id: "c1",
        version: 1,
        requiredCapabilities: ["report.write"],
        blockingGapIds: gaps.map((g) => g.id),
        createdAt: new Date().toISOString(),
      },
    };
    const { preparedState } = intakeMessage(withGaps, { turnId: "S11-t0", userText: "做一个系统" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "S11-t0",
      userText: "做一个系统",
      router: createDeterministicRouter([
        {
          selected: [{ capabilityId: "gap.ask", roleId: "规划" }],
          rationale: "readiness chain",
          source: "llm",
        },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 1,
    });

    expect(result.stopReason).toBe("await_ready");
    expect(result.finalState.awaitReason).toBe("ready");
    expect(
      (result.finalState.conversation || []).some((c) => /\[G_READY\]/.test(c.text || ""))
    ).toBe(true);
    const autoConfirm = (result.finalState.capabilityRuns || []).filter((r) =>
      /confirm|ready_pass/i.test(r.capabilityId)
    );
    expect(autoConfirm).toHaveLength(0);
  });

  it("PYTHON_AUTHORITY signals preserved by thin runtime (frontend contract consumer)", () => {
    // Proves: when state arrives with Python drive awaitReason+runtimePhase (PYTHON_AUTHORITY),
    // the runtime (intake + orchestrate paths) retains them for UI receive instead of silent drop/no-op.
    // Vitest here shows Node/TS layer is thin proxy + contract consumer only.
    const s = createInitialSessionState("做一个系统", "S11-proxy");
    const pyState = {
      ...s,
      runtimePhase: "awaiting" as const,
      awaitReason: "ready" as const,
      awaitDetail: "from python drive",
      coverageGaps: [],
    };
    const { preparedState } = intakeMessage(pyState as any, { turnId: "p-1", userText: "" });
    // no user resolve text: should keep the python signals (not force overwrite to silent)
    expect(preparedState.runtimePhase).toBe("awaiting");
    expect(preparedState.awaitReason).toBe("ready");
    expect(preparedState.awaitDetail).toBe("from python drive");
  });

  it("G_READY→C_GAP: gap.ask materializes open_question gaps for回补", () => {
    let s = createInitialSessionState("做一个系统", "S11-gap");
    const gaps = gapsFromGapAskContent("- 面向谁使用？\n- 成功标准是什么？", "S11-g", "art-gap");
    const { updatedState } = commitArtifact(
      s,
      createRawArtifact("art-gap", "gap.ask", "规划", "decision", "- 面向谁使用？\n- 成功标准是什么？"),
      "S11-g-run",
      false,
      []
    );
    s = {
      ...updatedState,
      coverageGaps: [...(updatedState.coverageGaps || []), ...gaps],
      coverageContract: {
        id: "c1",
        version: 1,
        requiredCapabilities: ["report.write"],
        blockingGapIds: gaps.map((g) => g.id),
        createdAt: new Date().toISOString(),
      },
    };
    expect(s.coverageGaps?.filter((g) => g.status === "open").length).toBeGreaterThanOrEqual(2);
  });

  it("AWAIT→INTAKE: user supplement clears ready gate and continues same session", async () => {
    const s = createInitialSessionState("做一个系统", "S11-resume");
    const parked = {
      ...s,
      awaitReason: "ready" as const,
      runtimePhase: "awaiting" as const,
      sessionId: "S11-resume",
    };
    const supplement = "面向企业内部，需要 RBAC 与数据范围隔离，部署在私有云";
    expect(userClearsReadiness(supplement, parked)).toBe(true);

    const { preparedState } = intakeMessage(parked, {
      turnId: "S11-t1",
      userText: supplement,
    });
    expect(preparedState.awaitReason).toBeUndefined();
    expect(preparedState.sessionId).toBe("S11-resume");
    expect((preparedState.conversation || []).length).toBeGreaterThan(
      (parked.conversation || []).length
    );
  });
});