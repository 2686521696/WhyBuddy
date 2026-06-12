import { evaluateCoverageGate } from "@shared/blueprint/whybuddy-coverage-gate";
import { latestTrustedReport } from "@shared/blueprint/whybuddy-delivery-chain";
import { evaluateCommitGates } from "@shared/blueprint/whybuddy-ship-gates";
import { hasGroundedExternalEvidence } from "@shared/blueprint/whybuddy-grounding";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

export type TrustSealFacts = {
  commitPassed: number;
  commitTotal: number;
  gcovLabel: string;
  groundedN: number;
  trustedM: number;
  displayLine: string;
};

function isHealthyArtifact(
  artifact: { id: string; trustLevel?: string },
  staleSet: Set<string>
): boolean {
  return (
    (artifact.trustLevel === "gated_pass" || artifact.trustLevel === "audited") &&
    !staleSet.has(artifact.id)
  );
}

function countCommitGates(state: V5SessionState, reportCapId: string): {
  passed: number;
  total: number;
} {
  const fromState = (state.gates || []).filter(
    (g) => g.phase === "commit" || g.kind === "commit"
  );
  if (fromState.length > 0) {
    const passed = fromState.filter((g) => g.status === "passed").length;
    return { passed, total: fromState.length };
  }
  const snapshot = evaluateCommitGates(reportCapId, {
    groundingOk: hasGroundedExternalEvidence(state),
  });
  const passed = snapshot.filter((g) => g.status === "passed").length;
  return { passed, total: snapshot.length };
}

/** Read-only trust seal for Knife C terminal node header. */
export function deriveTrustSeal(state: V5SessionState): TrustSealFacts {
  const stale = new Set(state.staleArtifactIds || []);
  const trustedArtifacts = (state.artifacts || []).filter((a) =>
    isHealthyArtifact(a, stale)
  );
  const groundedN = trustedArtifacts.filter((a) => {
    const prov = String(a.provenance || "");
    return (
      a.kind === "evidence" &&
      (prov.includes("mcp") || prov.includes("github") || prov === "web:search")
    );
  }).length;

  const report = latestTrustedReport(state);
  const reportCap = report?.producedBy?.capabilityId || "report.write";
  const { passed: commitPassed, total: commitTotal } = countCommitGates(
    state,
    reportCap
  );

  const gcov = evaluateCoverageGate(state, [], state.coverageContract);
  const gcovLabel = gcov.passed ? "✓" : "缺口";

  const trustedM = trustedArtifacts.length;
  const displayLine = `T_GATE ${commitPassed}/${commitTotal} · GCOV ${gcovLabel} · 接地 ${groundedN} · 可信 ${trustedM}`;

  return {
    commitPassed,
    commitTotal,
    gcovLabel,
    groundedN,
    trustedM,
    displayLine,
  };
}