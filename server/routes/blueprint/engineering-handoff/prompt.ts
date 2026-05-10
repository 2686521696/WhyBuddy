/**
 * Engineering Handoff LLM — prompt builder.
 *
 * Produces a deterministic system/user prompt pair plus a stable fingerprint
 * per invocation. The output is consumed by `service.ts` before dispatching
 * to `ctx.llm.callJson`.
 *
 * Hard constraints (design §2.D1, §5.6):
 * - No runtime / business module imports.
 * - No `callLLMJson` / `getAIConfig` / `fetch` imports.
 * - Only `node:crypto` for sha256 and `import type` shared blueprint types.
 */

import { createHash } from "node:crypto";

import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintClarificationSession,
  BlueprintEffectPreview,
  BlueprintEngineeringLandingPlanStatus,
  BlueprintImplementationPromptPackage,
  BlueprintProjectDomainContext,
  BlueprintRouteCandidate,
  BlueprintSpecDocument,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

export const ENGINEERING_HANDOFF_PROMPT_ID = "blueprint.engineering-handoff.v1";

export interface EngineeringHandoffPromptPayload {
  readonly promptId: string;
  readonly systemMessage: string;
  readonly userMessage: string;
  readonly userPayload: Record<string, unknown>;
  readonly promptFingerprint: string;
}

export interface BuildEngineeringHandoffPromptInput {
  readonly promptPackage: BlueprintImplementationPromptPackage;
  readonly sourceNodes: readonly BlueprintSpecTreeNode[];
  readonly sourceDocuments: readonly BlueprintSpecDocument[];
  readonly sourcePreviews: readonly BlueprintEffectPreview[];
  readonly selectedRoute?: BlueprintRouteCandidate;
  readonly specTreeSummary?: {
    readonly id: string;
    readonly version: number;
    readonly nodeCount: number;
  };
  readonly clarificationSession?: BlueprintClarificationSession;
  readonly domainContext?: BlueprintProjectDomainContext;
  readonly capabilityInvocations?: readonly BlueprintCapabilityInvocation[];
  readonly capabilityEvidence?: readonly BlueprintCapabilityEvidence[];
  readonly locale: string;
  readonly status: BlueprintEngineeringLandingPlanStatus;
  readonly intake?: {
    readonly targetText?: string;
    readonly githubUrls?: readonly string[];
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildOutputSchemaHints(): Record<string, unknown> {
  return {
    steps: {
      mode: ["automatic", "manual", "handoff"],
      riskLevel: ["low", "medium", "high"],
    },
    riskNotes: {
      level: ["info", "warning", "critical"],
    },
    handoffs: {
      platform: ["codex", "claude", "cursor", "kiro", "trae", "windsurf"],
    },
    constraints: [
      "title: 1..200 chars, trimmed",
      "summary: 1..500 chars, trimmed",
      "missionSummary: 1..1000 chars, trimmed",
      "steps: 1..30 entries",
      "acceptanceCriteria: 1..20 entries, each 1..500 chars",
      "riskNotes: 0..20 entries",
      "handoffs: 1..10 entries",
      "handoffs[*].platform must equal promptPackage.targetPlatform",
      "handoffs[*].promptPackageId (if provided) must equal promptPackage.id",
      "steps[*].sourceNodeIds / sourceDocumentIds / sourcePreviewIds / promptPackageIds must resolve to input sets",
      "steps[*].id must be unique within the plan (case-insensitive, trimmed)",
    ],
  };
}

function buildClarificationBlock(
  session: BlueprintClarificationSession | undefined,
): {
  readonly strategyId?: string;
  readonly templateId?: string;
  readonly answers: ReadonlyArray<{
    readonly questionId: string;
    readonly answer: unknown;
  }>;
} {
  if (!session) {
    return { answers: [] };
  }
  const answers = (session.answers ?? []).map(answer => ({
    questionId: answer.questionId,
    answer: answer.answer,
  }));
  answers.sort((a, b) => a.questionId.localeCompare(b.questionId));
  return {
    strategyId: session.strategyId,
    templateId: session.templateId,
    answers,
  };
}

function buildSystemMessage(
  locale: string,
  promptPackage: BlueprintImplementationPromptPackage,
): string {
  const isZh = locale === "zh-CN";
  if (isZh) {
    return [
      "你是 /autopilot 工程落地交接 (Engineering Handoff) 推理器。",
      `你必须为目标平台 ${promptPackage.targetPlatform} 产出结构化交接单。`,
      "你必须产出 title、summary、missionSummary、missionMetadata、steps、acceptanceCriteria、riskNotes、handoffs 八个顶层字段。",
      `handoffs[*].platform 必须等于 promptPackage.targetPlatform（即 ${promptPackage.targetPlatform}）。`,
      "所有 steps[*].sourceNodeIds / sourceDocumentIds / sourcePreviewIds / promptPackageIds 必须在 resolvableIds 中解析。",
      "不要在产出中包含真实凭据、token、apiKey、密钥等字面量。",
      "steps[*].mode 仅允许 automatic / manual / handoff；riskLevel 仅允许 low / medium / high。",
      "riskNotes[*].level 仅允许 info / warning / critical。",
      "仅返回 JSON 对象，不要在 JSON 之外附加任何说明文本。",
    ].join("\n");
  }
  return [
    "You are the /autopilot Engineering Handoff planner.",
    `You must produce a structured handoff for target platform ${promptPackage.targetPlatform}.`,
    "You must produce eight top-level fields: title, summary, missionSummary, missionMetadata, steps, acceptanceCriteria, riskNotes, handoffs.",
    `handoffs[*].platform must equal promptPackage.targetPlatform (i.e. ${promptPackage.targetPlatform}).`,
    "All steps[*].sourceNodeIds / sourceDocumentIds / sourcePreviewIds / promptPackageIds must resolve against resolvableIds.",
    "Do not include real credentials, tokens, apiKeys, or secret literals in the output.",
    "steps[*].mode is one of automatic / manual / handoff; riskLevel is one of low / medium / high.",
    "riskNotes[*].level is one of info / warning / critical.",
    "Return JSON only. Do not include any additional prose outside the JSON object.",
  ].join("\n");
}

/**
 * Build a deterministic Engineering Handoff prompt payload.
 *
 * The user payload field ordering is fixed for determinism. See design §4.5
 * for the canonical schema.
 */
export function buildEngineeringHandoffPrompt(
  input: BuildEngineeringHandoffPromptInput,
): EngineeringHandoffPromptPayload {
  const resolvableIds = {
    nodeIds: Array.from(
      new Set<string>([
        ...input.promptPackage.nodeIds,
        ...input.sourceNodes.map(node => node.id),
      ]),
    ),
    documentIds: Array.from(
      new Set<string>([
        ...input.promptPackage.sourceDocumentIds,
        ...input.sourceDocuments.map(doc => doc.id),
      ]),
    ),
    previewIds: Array.from(
      new Set<string>([
        ...input.promptPackage.sourcePreviewIds,
        ...input.sourcePreviews.map(preview => preview.id),
      ]),
    ),
    promptPackageIds: [input.promptPackage.id],
  };

  const primaryRoute = input.selectedRoute
    ? {
        id: input.selectedRoute.id,
        title: input.selectedRoute.title,
        summary: input.selectedRoute.summary,
        steps: input.selectedRoute.steps,
      }
    : undefined;

  const capabilityInvocationsSummary = input.capabilityInvocations
    ? input.capabilityInvocations.map(invocation => ({
        id: invocation.id,
        capabilityId: invocation.capabilityId,
        status: invocation.status,
      }))
    : undefined;
  const capabilityEvidenceSummary = input.capabilityEvidence
    ? input.capabilityEvidence.map(evidence => ({
        id: evidence.id,
        capabilityId: evidence.capabilityId,
        kind: evidence.kind,
        status: evidence.status,
      }))
    : undefined;

  // Build userPayload with stable field ordering (design §4.5).
  const userPayload: Record<string, unknown> = {
    promptId: ENGINEERING_HANDOFF_PROMPT_ID,
    promptPackage: {
      id: input.promptPackage.id,
      title: input.promptPackage.title,
      summary: input.promptPackage.summary,
      targetPlatform: input.promptPackage.targetPlatform,
      nodeIds: input.promptPackage.nodeIds,
      sourceDocumentIds: input.promptPackage.sourceDocumentIds,
      sourcePreviewIds: input.promptPackage.sourcePreviewIds,
    },
    sourceNodes: input.sourceNodes.map(node => ({
      id: node.id,
      title: node.title,
      summary: node.summary,
    })),
    sourceDocuments: input.sourceDocuments.map(doc => ({
      id: doc.id,
      title: doc.title,
      summary: doc.summary,
    })),
    sourcePreviews: input.sourcePreviews.map(preview => ({
      id: preview.id,
      nodeId: preview.nodeId,
      summary: preview.summary,
    })),
    ...(primaryRoute !== undefined ? { primaryRoute } : {}),
    ...(input.specTreeSummary !== undefined
      ? { specTreeSummary: input.specTreeSummary }
      : {}),
    intake: {
      targetText: input.intake?.targetText,
      githubUrls: input.intake?.githubUrls ?? [],
    },
    clarification: buildClarificationBlock(input.clarificationSession),
    projectContext: input.domainContext
      ? {
          projectId: input.domainContext.projectId,
          updatedAt: input.domainContext.updatedAt,
        }
      : undefined,
    ...(capabilityInvocationsSummary !== undefined
      ? { capabilityInvocations: capabilityInvocationsSummary }
      : {}),
    ...(capabilityEvidenceSummary !== undefined
      ? { capabilityEvidence: capabilityEvidenceSummary }
      : {}),
    status: input.status,
    outputSchema: buildOutputSchemaHints(),
    resolvableIds,
  };

  const systemMessage = buildSystemMessage(input.locale, input.promptPackage);
  const userMessage = JSON.stringify(userPayload, null, 2);
  const promptFingerprint = `sha256:${sha256Hex(
    `${systemMessage}\n\n${userMessage}`,
  )}`;

  return {
    promptId: ENGINEERING_HANDOFF_PROMPT_ID,
    systemMessage,
    userMessage,
    userPayload,
    promptFingerprint,
  };
}
