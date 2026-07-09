import { evaluateCoverageGate } from "@shared/blueprint/sliderule-coverage-gate";
import { latestTrustedReport } from "@shared/blueprint/sliderule-delivery-chain";
import { evaluateCommitGates } from "@shared/blueprint/sliderule-ship-gates";
import { hasGroundedExternalEvidence } from "@shared/blueprint/sliderule-grounding";
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

function isGroundedProvenance(provenance: string): boolean {
  const prov = String(provenance || "");
  return (
    prov.includes("mcp") ||
    prov.includes("github") ||
    prov.startsWith("web:search")
  );
}

function countCommitGatesForReportRun(
  state: V5SessionState,
  reportRunId: string | undefined,
  reportCapId: string
): { passed: number; total: number } {
  if (reportRunId) {
    const run = (state.capabilityRuns || []).find((r) => r.id === reportRunId);
    if (run?.gateResults?.length) {
      const passed = run.gateResults.filter((g) => g.status === "passed").length;
      return { passed, total: run.gateResults.length };
    }
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
  const groundedN = trustedArtifacts.filter(
    (a) => a.kind === "evidence" && isGroundedProvenance(String(a.provenance || ""))
  ).length;

  const report = latestTrustedReport(state);
  const reportCap = report?.producedBy?.capabilityId || "report.write";
  const reportRunId = report?.producedBy?.capabilityRunId;
  const { passed: commitPassed, total: commitTotal } = countCommitGatesForReportRun(
    state,
    reportRunId,
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