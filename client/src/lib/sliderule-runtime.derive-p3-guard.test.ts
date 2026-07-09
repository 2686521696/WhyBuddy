/**
 * DERIVE P3 Guard Tests — SlideRule V5.1 GOAL Conclusion Gate
 * Spec: .kiro/specs/sliderule-goal-conclusion-gate/ (Task 3.3, Property 3 / P3)
 *
 * Task 3.3 pins the DERIVE read-only-on-STATE invariant (P3) with an explicit guard helper
 * (`assertDeriveReadOnly`) and a test that:
 *   1. POSITIVE — runs production `deriveNodeStatus` on a richly populated state, deep-clones
 *      before, and asserts only `graph.nodes[].status` changed (the guard passes).
 *   2. META / REGRESSION — proves the guard is NOT vacuous: it FAILS when an `after` state
 *      writes any authoritative STATE field (`artifacts`, `goal`, `decisions`,
 *      `capabilityRuns`, `coverageGaps`, `decisionLedger`, ...), graph metadata, the node
 *      count, or a node field other than `status`. This is what makes the guard catch a
 *      future regression where DERIVE writes authoritative STATE.
 *
 * Production `deriveNodeStatus` is read-only and UNCHANGED by this task.
 *
 * **Validates: Requirements 2.5, 3.5**
 */

import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  deriveNodeStatus,
} from "./sliderule-runtime";
import { assertDeriveReadOnly, AUTHORITATIVE_STATE_FIELDS } from "./sliderule-derive-readonly-guard";
import type { V5SessionState, Artifact } from "@shared/blueprint/v5-reasoning-state";
import type { V5CapabilityId } from "@shared/blueprint/contracts";

// ---- helpers (mirror conventions from the Task 2 preservation test) ----

function createRawArtifact(
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact["kind"],
  content = `${roleId} 通过 ${capabilityId} 贡献了内容。`
): Omit<Artifact, "trustLevel" | "passedGates"> {
  return {
    id,
    kind,
    provenance: "ai_generated",
    producedBy: { capabilityRunId: `run-${id}`, capabilityId, roleId },
    passedGates: [],
    title: content.split("\n")[0]?.slice(0, 80),
    summary: content.slice(0, 200),
    content,
  };
}

function markTrusted(state: V5SessionState, artId: string): void {
  const art = (state.artifacts || []).find((a: any) => a.id === artId);
  if (art) {
    (art as any).trustLevel = "gated_pass";
    (art as any).passedGates = ["commit"];
  }
}

function kindForCap(capabilityId: string): Artifact["kind"] {
  if (capabilityId === "report.write") return "report";
  if (capabilityId === "risk.analyze") return "risk";
  if (capabilityId === "synthesis.merge") return "synthesis";
  return "doc";
}

/**
 * Fold a few orchestrate+commit turns into a richly populated session so DERIVE actually
 * exercises its status branches (active / running / completed / challenged / failed) while
 * authoritative STATE (artifacts, runs, gaps, ledger, ...) stays populated.
 */
function buildRichSession(seed: number): V5SessionState {
  let s = createInitialSessionState("分析权限系统的风险并给出最终可行性报告", `p3-guard-${seed}`);
  const turns = [
    { text: "分析风险", trusted: true, forceFail: false, stale: false },
    { text: "综合证据", trusted: true, forceFail: false, stale: false },
    { text: "生成最终报告", trusted: false, forceFail: false, stale: true },
  ];
  turns.forEach((turn, ti) => {
    const turnId = `t${seed}-${ti}`;
    const { newState, plan } = orchestrateReasoningTurn(s, { turnId, userText: turn.text });
    s = newState;
    (plan.selected || []).forEach((sel: any, i: number) => {
      const runId = `${turnId}-run-${i}`;
      const artId = `${turnId}-art-${i}`;
      const { updatedState } = commitArtifact(
        s,
        createRawArtifact(artId, sel.capabilityId as V5CapabilityId, sel.roleId || "综合", kindForCap(sel.capabilityId)),
        runId,
        turn.forceFail,
        sel.inputArtifactIds || []
      );
      s = updatedState;
      if (turn.trusted) markTrusted(s, artId);
    });
    if (turn.stale && (s.artifacts || []).length > 0) {
      const last = s.artifacts[s.artifacts.length - 1];
      s = { ...s, staleArtifactIds: [...(s.staleArtifactIds || []), last.id] };
    }
  });
  return s;
}

// =====================================================================================
// POSITIVE: production deriveNodeStatus passes the guard (read-only on authoritative STATE)
// =====================================================================================

describe("DERIVE P3 guard (Task 3.3): production deriveNodeStatus is read-only on authoritative STATE", () => {
  it("on a richly populated state, only graph.nodes[].status changes; the guard passes", () => {
    const s = buildRichSession(1);

    // Sanity: the state is actually rich.
    expect((s.graph?.nodes || []).length).toBeGreaterThan(0);
    expect((s.artifacts || []).length).toBeGreaterThan(0);
    expect((s.capabilityRuns || []).length).toBeGreaterThan(0);
    expect((s.decisionLedger || []).length).toBeGreaterThan(0);

    const before = structuredClone(s);
    const after = deriveNodeStatus(s);

    // Input not mutated, and the guard accepts the read-only projection.
    expect(s).toEqual(before);
    expect(() => assertDeriveReadOnly(before, after)).not.toThrow();
  });

  it("a no-op deriveNodeStatus (status-only flip applied manually) still passes the guard", () => {
    const s = buildRichSession(2);
    const before = structuredClone(s);
    const after = deriveNodeStatus(s);

    // Manually flip a node status: still only graph.nodes[].status differs.
    const tweaked: V5SessionState = {
      ...after,
      graph: {
        ...after.graph,
        nodes: (after.graph?.nodes || []).map((n: any, i: number) =>
          i === 0 ? { ...n, status: n.status === "completed" ? "active" : "completed" } : n
        ),
      } as any,
    };
    expect(() => assertDeriveReadOnly(before, tweaked)).not.toThrow();
  });
});

// =====================================================================================
// META / REGRESSION: the guard FAILS when DERIVE writes authoritative STATE
// (this is what pins P3 — a guard that never fails would not catch a regression)
// =====================================================================================

describe("DERIVE P3 guard (Task 3.3): guard catches any DERIVE write to authoritative STATE", () => {
  const baseSession = () => buildRichSession(3);

  it('FAILS when DERIVE writes "goal"', () => {
    const s = baseSession();
    const before = structuredClone(s);
    // Tamper to a status GUARANTEED different from the live value so this always represents a
    // real GOAL write, regardless of what buildRichSession now produces (after the GCOV-gated
    // GOAL write landed, buildRichSession(3) may legitimately reach goal.status === "clear").
    const tamperedStatus = s.goal.status === "clear" ? "not_recommended" : "clear";
    const tampered: V5SessionState = { ...deriveNodeStatus(s), goal: { ...s.goal, status: tamperedStatus } };
    expect(() => assertDeriveReadOnly(before, tampered)).toThrow(/goal/);
  });

  it('FAILS when DERIVE writes "artifacts"', () => {
    const s = baseSession();
    const before = structuredClone(s);
    const after = deriveNodeStatus(s);
    const tampered: V5SessionState = {
      ...after,
      artifacts: [
        ...after.artifacts,
        createRawArtifact("injected", "report.write", "综合", "report") as Artifact,
      ],
    };
    expect(() => assertDeriveReadOnly(before, tampered)).toThrow(/artifacts/);
  });

  it('FAILS when DERIVE writes "decisions"', () => {
    const s = baseSession();
    const before = structuredClone(s);
    const tampered: V5SessionState = { ...deriveNodeStatus(s), decisions: [{ id: "d-injected" }] };
    expect(() => assertDeriveReadOnly(before, tampered)).toThrow(/decisions/);
  });

  it('FAILS when DERIVE writes "capabilityRuns"', () => {
    const s = baseSession();
    const before = structuredClone(s);
    const after = deriveNodeStatus(s);
    const tampered: V5SessionState = {
      ...after,
      capabilityRuns: [
        ...after.capabilityRuns,
        {
          id: "run-injected",
          capabilityId: "report.write" as V5CapabilityId,
          inputs: [],
          outputs: [],
          gateResults: [],
          turnId: "t-injected",
        },
      ],
    };
    expect(() => assertDeriveReadOnly(before, tampered)).toThrow(/capabilityRuns/);
  });

  it('FAILS when DERIVE writes gaps ("coverageGaps")', () => {
    const s = baseSession();
    const before = structuredClone(s);
    const tampered: V5SessionState = {
      ...deriveNodeStatus(s),
      coverageGaps: [
        {
          id: "gap-injected",
          kind: "missing_capability",
          label: "injected",
          status: "open",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    expect(() => assertDeriveReadOnly(before, tampered)).toThrow(/coverageGaps/);
  });

  it('FAILS when DERIVE writes ledgers ("decisionLedger")', () => {
    const s = baseSession();
    const before = structuredClone(s);
    const after = deriveNodeStatus(s);
    const tampered: V5SessionState = {
      ...after,
      decisionLedger: [
        ...(after.decisionLedger || []),
        {
          id: "dec-injected",
          turnId: "t-injected",
          saw: [],
          chose: [],
          skipped: [],
          addresses: [],
          rationale: "injected",
          alternativesRejected: [],
          createdAt: new Date().toISOString(),
        },
      ],
    };
    expect(() => assertDeriveReadOnly(before, tampered)).toThrow(/decisionLedger/);
  });

  it("FAILS when DERIVE changes a node field other than status", () => {
    const s = baseSession();
    const before = structuredClone(s);
    const after = deriveNodeStatus(s);
    const tampered: V5SessionState = {
      ...after,
      graph: {
        ...after.graph,
        nodes: (after.graph?.nodes || []).map((n: any, i: number) =>
          i === 0 ? { ...n, label: `${n.label || ""}-tampered` } : n
        ),
      } as any,
    };
    expect(() => assertDeriveReadOnly(before, tampered)).toThrow(/node\[0\]/);
  });

  it("FAILS when DERIVE changes the graph node count", () => {
    const s = baseSession();
    const before = structuredClone(s);
    const after = deriveNodeStatus(s);
    const tampered: V5SessionState = {
      ...after,
      graph: { ...after.graph, nodes: (after.graph?.nodes || []).slice(1) } as any,
    };
    expect(() => assertDeriveReadOnly(before, tampered)).toThrow(/node count/);
  });

  it("covers every documented authoritative STATE field", () => {
    // Guards the field list itself against silent shrinkage.
    for (const field of ["artifacts", "goal", "decisions", "capabilityRuns", "coverageGaps", "decisionLedger"]) {
      expect(AUTHORITATIVE_STATE_FIELDS).toContain(field);
    }
  });
});
