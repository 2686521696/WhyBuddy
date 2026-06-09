import type {
  BrainstormRoleId,
  BrainstormSession,
} from "../../../../shared/blueprint/brainstorm-contracts.js";
import type { ChecksLedgerService } from "../checks-ledger/types.js";
import type { BlueprintGenerationStage } from "../../../../shared/blueprint/contracts.js";

/**
 * Map a brainstorm `stageId` to a valid ledger `BlueprintGenerationStage`.
 * Brainstorm uses `"intake"` where the generation pipeline uses `"input"`;
 * every other stage id aligns 1:1. Unknown ids fall back to `"spec_docs"` so a
 * malformed stage never breaks the (best-effort) ledger write.
 */
const LEDGER_STAGES: ReadonlySet<string> = new Set<BlueprintGenerationStage>([
  "input",
  "clarification",
  "route_generation",
  "spec_tree",
  "spec_docs",
  "preview",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
]);
function toLedgerStage(stageId: string): BlueprintGenerationStage {
  if (stageId === "intake") return "input";
  return (LEDGER_STAGES.has(stageId) ? stageId : "spec_docs") as BlueprintGenerationStage;
}

export interface BrainstormEvidence {
  artifactName: "brainstorm_evidence";
  sessionId: string;
  jobId: string;
  stageId: string;
  roundCount: number;
  finalConvergenceScore: number;
  interMemberReferences: Array<{
    fromRoleId: BrainstormRoleId;
    toRoleId: BrainstormRoleId;
  }>;
  status: "pass" | "fail";
  output: string;
  /**
   * Auditable structured-collaboration facts (autopilot-brainstorm-real-collaboration).
   * These make "this node survived a real debate" queryable provenance rather
   * than an ephemeral process: how many critiques/rebuttals were issued, how
   * many critiques stayed unresolved, whether consensus was reached, and how
   * many primary-model adjudications ran. All optional — absent on legacy
   * heuristic sessions that produced no structured summary.
   */
  consensusAchieved?: boolean;
  totalChallenges?: number;
  unresolvedChallengeCount?: number;
  critiqueCount?: number;
  rebuttalCount?: number;
  adjudicationCount?: number;
}

export interface BuildBrainstormEvidenceInput {
  session: BrainstormSession;
  roundCount: number;
  finalConvergenceScore: number;
}

export interface WriteEvidenceToLedgerInput {
  checksLedger?: Pick<ChecksLedgerService, "recordCheck">;
  evidence: BrainstormEvidence;
}

function collectInterMemberReferences(
  session: BrainstormSession,
): BrainstormEvidence["interMemberReferences"] {
  const members = Array.from(session.crewMembers.values());
  const roleIds = members.map((member) => member.roleId);
  const references: BrainstormEvidence["interMemberReferences"] = [];

  for (const member of members) {
    const content = member.output?.content.toLowerCase() ?? "";
    for (const roleId of roleIds) {
      if (roleId === member.roleId) continue;
      if (content.includes(roleId.toLowerCase())) {
        references.push({
          fromRoleId: member.roleId,
          toRoleId: roleId,
        });
      }
    }
  }

  return references;
}

export function buildBrainstormEvidence(
  input: BuildBrainstormEvidenceInput,
): BrainstormEvidence {
  const interMemberReferences = collectInterMemberReferences(input.session);
  const status =
    input.roundCount >= 2 && interMemberReferences.length > 0 ? "pass" : "fail";

  const summary = input.session.deliberationSummary;

  return {
    artifactName: "brainstorm_evidence",
    sessionId: input.session.id,
    jobId: input.session.jobId,
    stageId: input.session.stageId,
    roundCount: input.roundCount,
    finalConvergenceScore: input.finalConvergenceScore,
    interMemberReferences,
    status,
    consensusAchieved: summary?.consensusAchieved,
    totalChallenges: summary?.totalChallenges,
    unresolvedChallengeCount: summary?.unresolvedChallengeCount,
    critiqueCount: summary?.critiqueCount,
    rebuttalCount: summary?.rebuttalCount,
    adjudicationCount: summary?.adjudicationCount,
    output:
      status === "pass"
        ? `brainstorm evidence passed: ${input.roundCount} rounds, ${interMemberReferences.length} inter-member references`
        : `brainstorm evidence failed: ${input.roundCount} rounds, ${interMemberReferences.length} inter-member references`,
  };
}

export function writeEvidenceToLedger(
  input: WriteEvidenceToLedgerInput,
): void {
  try {
    input.checksLedger?.recordCheck({
      jobId: input.evidence.jobId,
      // Record under the stage the debate actually ran in (previously hardcoded
      // to "spec_docs", which mislabeled route_generation / spec_tree / … debates).
      stage: toLedgerStage(input.evidence.stageId),
      checkType: "brainstorm_deliberation",
      checkName: `brainstorm:evidence:${input.evidence.sessionId}`,
      status: input.evidence.status,
      validator: "brainstorm/orchestrator.ts",
      output: input.evidence.output,
      metadata: {
        artifactName: input.evidence.artifactName,
        sessionId: input.evidence.sessionId,
        stageId: input.evidence.stageId,
        roundCount: input.evidence.roundCount,
        finalConvergenceScore: input.evidence.finalConvergenceScore,
        interMemberReferences: input.evidence.interMemberReferences,
        // Auditable structured debate facts (provenance, not just process).
        consensusAchieved: input.evidence.consensusAchieved,
        totalChallenges: input.evidence.totalChallenges,
        unresolvedChallengeCount: input.evidence.unresolvedChallengeCount,
        critiqueCount: input.evidence.critiqueCount,
        rebuttalCount: input.evidence.rebuttalCount,
        adjudicationCount: input.evidence.adjudicationCount,
      },
    });
  } catch {
    // Ledger evidence must never block brainstorm completion.
  }
}

export interface WriteSynthesisAuditToLedgerInput {
  checksLedger?: Pick<ChecksLedgerService, "recordCheck">;
  jobId: string;
  stageId: string;
  sessionId: string;
  audit: {
    status: "pass" | "needs_review";
    reasons: string[];
    unresolvedChallengeCount: number;
  };
}

/**
 * Write a primary-model synthesis audit result to the checks ledger. Reuses the
 * same ledger channel as `writeEvidenceToLedger`. `needs_review` maps to the
 * ledger `warn` status (the synthesis is surfaced for review without hard
 * failing the stage). Never throws — ledger writes must not block the pipeline.
 */
export function writeSynthesisAuditToLedger(
  input: WriteSynthesisAuditToLedgerInput,
): void {
  try {
    input.checksLedger?.recordCheck({
      jobId: input.jobId,
      stage: toLedgerStage(input.stageId),
      checkType: "companion_trace",
      checkName: `brainstorm:synthesis-audit:${input.sessionId}`,
      status: input.audit.status === "pass" ? "pass" : "warn",
      validator: "brainstorm/synthesis-audit.ts",
      output:
        input.audit.reasons.length > 0
          ? input.audit.reasons.join("; ")
          : `synthesis audit ${input.audit.status}`,
      metadata: {
        artifactName: "brainstorm_synthesis_audit",
        sessionId: input.sessionId,
        stageId: input.stageId,
        auditStatus: input.audit.status,
        unresolvedChallengeCount: input.audit.unresolvedChallengeCount,
        reasons: input.audit.reasons,
      },
    });
  } catch {
    // Audit ledger writes must never block brainstorm completion.
  }
}

/**
 * Record whether a typed-stage debate synthesis was successfully parsed
 * into the final product or had to fall back to deterministic single-agent.
 *
 * This is the key signal for "did the debate actually change the product?"
 * Called from wrapTypedBlueprintStage after the parse attempt.
 * Written as a separate best-effort check so it can be correlated with
 * the main brainstorm_deliberation entry for the same job/stage.
 */
export interface RecordTypedStageImpactInput {
  checksLedger?: Pick<ChecksLedgerService, "recordCheck">;
  jobId: string;
  stageId: string;
  impact: "parsed" | "fallback";
}

export function recordTypedStageDebateImpact(
  input: RecordTypedStageImpactInput,
): void {
  try {
    input.checksLedger?.recordCheck({
      jobId: input.jobId,
      stage: toLedgerStage(input.stageId),
      checkType: "brainstorm_impact",
      checkName: `brainstorm:typed-impact:${input.stageId}`,
      status: "pass",
      validator: "blueprint/wrapTypedBlueprintStage",
      output: `debate synthesis was ${input.impact} into typed stage output`,
      metadata: {
        impact: input.impact,
        stageId: input.stageId,
      },
    });
  } catch {
    // Ledger writes for impact must never block the typed stage.
  }
}
