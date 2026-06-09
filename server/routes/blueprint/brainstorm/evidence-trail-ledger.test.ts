/**
 * Unit tests for brainstorm ledger provenance (autopilot-brainstorm-real-collaboration).
 *
 * Verifies the two follow-up fixes:
 *  1. Ledger records under the stage the debate actually ran in (previously
 *     hardcoded to "spec_docs"); brainstorm "intake" maps to ledger "input".
 *  2. Structured-collaboration facts (critique/rebuttal/adjudication counts,
 *     consensus, unresolved) are written as auditable provenance metadata.
 */

import { describe, it, expect, vi } from "vitest";

import {
  buildBrainstormEvidence,
  writeEvidenceToLedger,
  writeSynthesisAuditToLedger,
  recordTypedStageDebateImpact,
} from "./evidence-trail.js";
import type { BrainstormSession } from "../../../../shared/blueprint/brainstorm-contracts.js";

function makeSession(stageId: string): BrainstormSession {
  const member = (roleId: string) => ({
    roleId: roleId as never,
    state: "completed" as const,
    output: { content: `as planner I reference architect and auditor`, confidence: 0.8 },
  });
  return {
    id: "sess-led-1",
    jobId: "job-led-1",
    stageId,
    mode: "discussion",
    status: "completed",
    crewMembers: new Map<string, ReturnType<typeof member>>([
      ["planner", member("planner")],
      ["architect", member("architect")],
    ]) as never,
    branchNodes: [],
    edges: [],
    startedAt: new Date(0),
    deliberationSummary: {
      roundCount: 3,
      finalConvergenceScore: 0.82,
      consensusAchieved: true,
      totalChallenges: 5,
      unresolvedChallengeCount: 1,
      critiqueCount: 5,
      rebuttalCount: 4,
      adjudicationCount: 3,
    },
  } as unknown as BrainstormSession;
}

describe("brainstorm ledger provenance", () => {
  it("records evidence under the real stage and carries structured debate facts", () => {
    const recordCheck = vi.fn();
    const evidence = buildBrainstormEvidence({
      session: makeSession("route_generation"),
      roundCount: 3,
      finalConvergenceScore: 0.82,
    });
    writeEvidenceToLedger({ checksLedger: { recordCheck }, evidence });

    expect(recordCheck).toHaveBeenCalledTimes(1);
    const arg = recordCheck.mock.calls[0][0];
    expect(arg.stage).toBe("route_generation");
    expect(arg.checkType).toBe("brainstorm_deliberation");
    expect(arg.metadata.critiqueCount).toBe(5);
    expect(arg.metadata.rebuttalCount).toBe(4);
    expect(arg.metadata.adjudicationCount).toBe(3);
    expect(arg.metadata.unresolvedChallengeCount).toBe(1);
    expect(arg.metadata.consensusAchieved).toBe(true);
  });

  it("maps brainstorm 'intake' stage to the ledger 'input' stage", () => {
    const recordCheck = vi.fn();
    const evidence = buildBrainstormEvidence({
      session: makeSession("intake"),
      roundCount: 2,
      finalConvergenceScore: 0.5,
    });
    writeEvidenceToLedger({ checksLedger: { recordCheck }, evidence });
    expect(recordCheck.mock.calls[0][0].stage).toBe("input");
  });

  it("writes the synthesis audit under the real stage too", () => {
    const recordCheck = vi.fn();
    writeSynthesisAuditToLedger({
      checksLedger: { recordCheck },
      jobId: "job-led-1",
      stageId: "spec_tree",
      sessionId: "sess-led-1",
      audit: { status: "needs_review", reasons: ["unsupported"], unresolvedChallengeCount: 2 },
    });
    const arg = recordCheck.mock.calls[0][0];
    expect(arg.stage).toBe("spec_tree");
    expect(arg.status).toBe("warn");
  });

  it("never throws when the ledger is absent", () => {
    const evidence = buildBrainstormEvidence({
      session: makeSession("spec_docs"),
      roundCount: 1,
      finalConvergenceScore: 0,
    });
    expect(() => writeEvidenceToLedger({ evidence })).not.toThrow();
  });

  it("records typed-stage debate impact (parsed / fallback) under correct stage", () => {
    const recordCheck = vi.fn();
    recordTypedStageDebateImpact({
      checksLedger: { recordCheck },
      jobId: "job-impact-1",
      stageId: "spec_tree",
      impact: "parsed",
    });

    expect(recordCheck).toHaveBeenCalledTimes(1);
    const arg = recordCheck.mock.calls[0][0];
    expect(arg.stage).toBe("spec_tree");
    expect(arg.checkType).toBe("brainstorm_impact");
    expect(arg.metadata.impact).toBe("parsed");

    // Also test fallback and intake mapping
    recordCheck.mockClear();
    recordTypedStageDebateImpact({
      checksLedger: { recordCheck },
      jobId: "job-impact-2",
      stageId: "intake",
      impact: "fallback",
    });
    expect(recordCheck.mock.calls[0][0].stage).toBe("input");
    expect(recordCheck.mock.calls[0][0].metadata.impact).toBe("fallback");
  });

  it("never throws for impact recording when ledger absent", () => {
    expect(() =>
      recordTypedStageDebateImpact({
        jobId: "job-x",
        stageId: "route_generation",
        impact: "parsed",
      }),
    ).not.toThrow();
  });
});
