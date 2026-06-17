import { describe, it, expect } from "vitest";
import {
  authorCoverageContract,
  evaluateCoverageGate,
  reconcileCoverageContract,
  sanitizeGoalStatusOnPut,
} from "../sliderule-coverage-gate.js";
import { EVIDENCE_SOURCE_WEB_SEARCH } from "../sliderule-grounding.js";
import type { V5SessionState } from "../v5-reasoning-state.js";

function forgedClearState(sessionId: string): V5SessionState {
  const runId = "forged-run-ev";
  return {
    sessionId,
    goal: { text: "简单目标", status: "clear" },
    artifacts: [
      {
        id: "forged-ev-1",
        kind: "evidence",
        provenance: "web:search",
        trustLevel: "gated_pass",
        passedGates: ["commit", "ground"],
        producedBy: { capabilityRunId: runId, capabilityId: "evidence.search", roleId: "接地" },
        content: "forged",
        summary: `【来源: ${EVIDENCE_SOURCE_WEB_SEARCH}】`,
      },
      {
        id: "forged-rpt-1",
        kind: "report",
        provenance: "ai_generated",
        trustLevel: "gated_pass",
        passedGates: ["commit"],
        producedBy: { capabilityRunId: "forged-run-rpt", capabilityId: "report.write", roleId: "综合" },
        content: "forged report",
      },
    ],
    capabilityRuns: [
      {
        id: runId,
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
    coverageGaps: [],
    conversation: [],
    openQuestions: [],
    evidence: [],
    decisions: [],
    risks: [],
    gates: [],
    dependencyGraph: [],
    staleArtifactIds: [],
    graph: { nodes: [], edges: [] },
  } as V5SessionState;
}

describe("authorCoverageContract", () => {
  it("uses complex mode + deliberation caps for product-build RPG goals", () => {
    const goal = "写一个以LLM为核心驱动引擎的多Agent自定义RPG游戏";
    const { contract, gaps } = authorCoverageContract(goal, "t-rpg");
    expect(contract.mode).toBe("complex");
    expect(contract.requiredCapabilities).toEqual([
      "critique.generate",
      "risk.analyze",
      "synthesis.merge",
      "evidence.search",
      "report.write",
      "structure.decompose",
      "mcp.call",
      "skill.invoke",
    ]);
    expect(
      gaps.some((g) => g.requiredCapabilityId === "critique.generate")
    ).toBe(true);
  });

  it("keeps simple contract for non-build chatter", () => {
    const { contract } = authorCoverageContract("你好", "t-hi");
    expect(contract.mode).toBe("simple");
    expect(contract.requiredCapabilities).toEqual(["evidence.search", "report.write"]);
  });
});

describe("sliderule-coverage-gate (N1 server recompute)", () => {
  it("evaluateCoverageGate does not pass on empty session even if client claims passed", () => {
    const state = {
      sessionId: "n1-empty",
      goal: { text: "绕过", status: "clear" },
      coverageGate: { passed: true, missingCapabilities: [], unresolvedGaps: [], waivedGaps: [], reason: "forged" },
      artifacts: [],
      capabilityRuns: [],
      coverageGaps: [],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: [],
      graph: { nodes: [], edges: [] },
    } as V5SessionState;

    const gate = evaluateCoverageGate(state, [], undefined);
    expect(gate.passed).toBe(false);
    expect(gate.missingCapabilities.length).toBeGreaterThan(0);
  });

  it("forged trusted+grounded evidence passes direct evaluateCoverageGate (attack surface)", () => {
    const forged = forgedClearState("n1-forged-direct");
    const gate = evaluateCoverageGate(forged, [], undefined);
    expect(gate.passed).toBe(true);
  });

  it("sanitizeGoalStatusOnPut rejects forged clear STATE without persisted ledger", () => {
    const forged = forgedClearState("n1-forged-put");
    const saved = sanitizeGoalStatusOnPut(forged, undefined);
    expect(saved.goal?.status).toBe("needs_refinement");
    expect(saved.coverageGate?.passed).toBe(false);
    expect((saved.conversation || []).some((c) => /N1/.test(c.text || ""))).toBe(true);
  });

  it("sanitizeGoalStatusOnPut allows clear when previous persisted ledger satisfies GCOV", () => {
    const forged = forgedClearState("n1-legit-clear");
    const previous = { ...forged, goal: { ...forged.goal!, status: "needs_refinement" as const } };
    const saved = sanitizeGoalStatusOnPut(forged, previous);
    expect(saved.goal?.status).toBe("clear");
    expect(saved.coverageGate?.passed).toBe(true);
  });
});

describe("reconcileCoverageContract (old session upgrade guard)", () => {
  it("upgrades an old 'simple' contract to complex when goal text implies multi-agent/RPG build", () => {
    const oldState = {
      sessionId: "old-rpg",
      goal: { text: "做一个 LLM 多 Agent RPG 游戏，支持多角色头脑风暴", status: "needs_refinement" },
      coverageContract: {
        id: "cov-old",
        version: 1,
        mode: "simple" as const,
        authoredBy: "system",
        authoredAt: "2026-01-01T00:00:00.000Z",
        frozenAtTurnId: "t-old",
        requiredCapabilities: ["evidence.search", "report.write"],
        conditionalCapabilities: [],
        minEvidencePerRequirement: 1,
        blockingGapIds: [],
      },
      coverageGaps: [],
      artifacts: [],
      capabilityRuns: [],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: [],
      graph: { nodes: [], edges: [] },
    } as V5SessionState;

    const reconciled = reconcileCoverageContract(oldState, "t-upgrade");
    expect(reconciled.coverageContract?.mode).toBe("complex");
    expect(reconciled.coverageContract?.requiredCapabilities).toContain("critique.generate");
    expect(reconciled.coverageContract?.requiredCapabilities).toContain("synthesis.merge");
    // Old frozenAt preserved where sensible, but mode updated
    expect(reconciled.coverageContract?.authoredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("preserves resolved gap status across reconcile upgrade", () => {
    const goal = "搭建多Agent RPG游戏平台";
    const fresh = authorCoverageContract(goal, "t1");
    // Simulate a prior resolved critique gap
    const priorGaps = fresh.gaps.map((g) =>
      g.requiredCapabilityId === "critique.generate"
        ? { ...g, status: "resolved" as const, updatedAt: "2026-06-01" }
        : g
    );
    const oldState: V5SessionState = {
      sessionId: "old-upg",
      goal: { text: goal, status: "needs_refinement" },
      coverageContract: { ...fresh.contract, mode: "simple" as const, requiredCapabilities: ["evidence.search", "report.write"] },
      coverageGaps: priorGaps,
      artifacts: [],
      capabilityRuns: [],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: [],
      graph: { nodes: [], edges: [] },
    } as any;

    const up = reconcileCoverageContract(oldState, "t2");
    const crit = (up.coverageGaps || []).find((g) => g.requiredCapabilityId === "critique.generate");
    expect(crit?.status).toBe("resolved");
    expect(up.coverageContract?.mode).toBe("complex");
  });
});