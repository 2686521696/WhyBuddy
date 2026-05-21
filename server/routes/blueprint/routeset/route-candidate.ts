import { createHash } from "node:crypto";

import type {
  BlueprintCapabilityUsage,
  BlueprintClarificationReadinessSignalId,
  BlueprintClarificationRouteDimension,
  BlueprintClarificationSession,
  BlueprintClarificationStrategyId,
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteComplexity,
  BlueprintRouteCostLevel,
  BlueprintRouteRiskLevel,
  BlueprintRouteStep,
} from "../../../../shared/blueprint/index.js";

export interface BlueprintClarificationRouteContext {
  strategyId?: BlueprintClarificationStrategyId;
  templateId?: string;
  routeReadySummary?: string;
  readinessSignals: BlueprintClarificationReadinessSignalId[];
  routeDimensions: BlueprintClarificationRouteDimension[];
  answeredQuestionIds: string[];
  evidenceIds: string[];
  sourceIds: string[];
  answerCount: number;
}

function stableId(prefix: string, value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `${prefix}-${slug || "unknown"}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(isString))];
}

export function buildClarificationRouteContext(
  request: BlueprintGenerationRequest,
  clarificationSession?: BlueprintClarificationSession,
): BlueprintClarificationRouteContext {
  const answers = clarificationSession?.answers ?? request.clarifications ?? [];
  const questionById = new Map(
    (clarificationSession?.questions ?? []).map((question) => [
      question.id,
      question,
    ]),
  );
  const strategyIds = uniqueStrings(
    [
      clarificationSession?.strategyId,
      ...answers.map((answer) => answer.provenance?.strategyId),
    ].filter(
      (strategyId): strategyId is BlueprintClarificationStrategyId =>
        Boolean(strategyId),
    ),
  ) as BlueprintClarificationStrategyId[];
  const templateIds = uniqueStrings(
    [
      clarificationSession?.templateId,
      ...answers.map((answer) => answer.provenance?.templateId),
    ].filter(isString),
  );
  const readinessSignals = uniqueStrings(
    [
      ...(clarificationSession?.readinessSignals ?? []),
      ...(clarificationSession?.readiness.readinessSignals ?? []),
      ...answers.map((answer) => answer.provenance?.readinessSignal),
    ].filter(
      (signal): signal is BlueprintClarificationReadinessSignalId =>
        Boolean(signal),
    ),
  ) as BlueprintClarificationReadinessSignalId[];
  const routeDimensions = uniqueStrings(
    [
      ...(clarificationSession?.readiness.routeDimensions ?? []),
      ...answers.map((answer) => answer.provenance?.routeDimension),
    ].filter(
      (dimension): dimension is BlueprintClarificationRouteDimension =>
        Boolean(dimension),
    ),
  ) as BlueprintClarificationRouteDimension[];
  const sourceIds = uniqueStrings(
    answers
      .flatMap((answer) => questionById.get(answer.questionId)?.sourceIds ?? [])
      .filter(isString),
  );
  const evidenceIds = uniqueStrings(
    answers.flatMap((answer) => {
      const question = questionById.get(answer.questionId);
      return question?.evidenceIds.length
        ? question.evidenceIds
        : [
            stableId(
              "blueprint-evidence-clarification",
              `${answer.questionId}-${hashText(
                `${request.intakeId ?? request.clarificationSessionId ?? "request"}-${answer.answer}`,
              )}`,
            ),
          ];
    }),
  );

  return {
    strategyId: strategyIds[0],
    templateId: templateIds[0],
    readinessSignals,
    routeDimensions,
    answeredQuestionIds: uniqueStrings(
      answers.map((answer) => answer.questionId).filter(isString),
    ),
    evidenceIds,
    sourceIds,
    answerCount: answers.length,
    routeReadySummary:
      clarificationSession?.routeReadySummary ??
      (answers.length
        ? `Clarification ${strategyIds[0] ?? "strategy"} provided ${answers.length} route-ready answer${answers.length === 1 ? "" : "s"} across ${routeDimensions.length || 1} route dimension${routeDimensions.length === 1 ? "" : "s"}.`
        : undefined),
  };
}

export function buildRouteCandidate(input: {
  id: string;
  kind: "primary" | "alternative";
  title: string;
  summary: string;
  rationale: string;
  riskLevel: BlueprintRouteRiskLevel;
  costLevel: BlueprintRouteCostLevel;
  complexity: BlueprintRouteComplexity;
  estimatedEffort: string;
  includeGithubStep: boolean;
  clarificationContext: BlueprintClarificationRouteContext;
  externalOverrides?: {
    id?: string;
    kind?: "primary" | "alternative";
    title?: string;
    summary?: string;
    rationale?: string;
    riskLevel?: BlueprintRouteRiskLevel;
    costLevel?: BlueprintRouteCostLevel;
    complexity?: BlueprintRouteComplexity;
    estimatedEffort?: string;
    capabilities?: BlueprintCapabilityUsage[];
  };
}): BlueprintRouteCandidate {
  const steps = buildRouteSteps(
    input.includeGithubStep,
    input.clarificationContext,
  );
  const overrides = input.externalOverrides;

  return {
    id: overrides?.id ?? input.id,
    kind: overrides?.kind ?? input.kind,
    title: overrides?.title ?? input.title,
    summary: appendClarificationRouteSummary(
      overrides?.summary ?? input.summary,
      input.clarificationContext,
    ),
    rationale: appendClarificationRouteSummary(
      overrides?.rationale ?? input.rationale,
      input.clarificationContext,
    ),
    riskLevel: overrides?.riskLevel ?? input.riskLevel,
    costLevel: overrides?.costLevel ?? input.costLevel,
    complexity: overrides?.complexity ?? input.complexity,
    estimatedEffort: overrides?.estimatedEffort ?? input.estimatedEffort,
    capabilities:
      overrides?.capabilities ??
      buildCapabilityUsage(input.includeGithubStep, input.clarificationContext),
    steps,
    outputs: uniqueStrings([
      "RouteSet outline",
      "Decision evidence",
      "SPEC tree seed",
      "Architecture notes",
      "Implementation prompt seed",
      ...(input.clarificationContext.answerCount > 0
        ? ["Clarification route-ready summary"]
        : []),
    ]),
  };
}

function appendClarificationRouteSummary(
  text: string,
  context: BlueprintClarificationRouteContext,
): string {
  if (!context.strategyId) return text;
  return `${text} Clarification strategy: ${context.strategyId}; readiness signals: ${context.readinessSignals.join(", ") || "none"}.`;
}

function buildRouteSteps(
  includeGithubStep: boolean,
  clarificationContext: BlueprintClarificationRouteContext,
): BlueprintRouteStep[] {
  const steps: BlueprintRouteStep[] = [
    {
      id: "clarify-intent",
      title: "Clarify execution intent",
      description:
        "Collect target users, product boundary, constraints, and success criteria before route choice.",
      role: "Product strategist",
      status: "ready",
    },
  ];

  if (includeGithubStep) {
    steps.push({
      id: "scan-github-source",
      title: "Scan GitHub source",
      description:
        "Inspect repositories and extract technology stack, module boundaries, and reusable assets.",
      role: "Source analyst",
      status: "ready",
    });
  }

  if (clarificationContext.strategyId) {
    steps.push({
      id: `apply-${clarificationContext.strategyId}-clarification`,
      title: `Apply ${clarificationContext.strategyId.replace(/_/g, "-")} clarification`,
      description:
        clarificationContext.routeReadySummary ??
        "Bind clarification answers, readiness signals, and route dimensions into route generation.",
      role: "Product strategist",
      status: clarificationContext.answerCount > 0 ? "ready" : "blocked",
    });
  }

  return steps.concat([
    {
      id: "map-capability-pool",
      title: "Map capability pool",
      description:
        "Choose Docker, MCP, skills, AIGC nodes, and specialist roles for analysis coverage.",
      role: "Orchestrator",
      status: "ready",
    },
    {
      id: "derive-spec-tree-seed",
      title: "Derive SPEC tree seed",
      description:
        "Transform primary and alternative route nodes into an editable SPEC tree asset.",
      role: "SPEC curator",
      status: "pending",
    },
    {
      id: "plan-preview-and-prompts",
      title: "Plan previews and prompts",
      description:
        "Prepare the downstream effect preview, architecture diagram, and implementation prompt package.",
      role: "Preview planner",
      status: "pending",
    },
  ]);
}

function buildCapabilityUsage(
  includeGithubStep: boolean,
  clarificationContext: BlueprintClarificationRouteContext,
): BlueprintCapabilityUsage[] {
  const capabilities: BlueprintCapabilityUsage[] = [
    {
      id: "role-product-strategy",
      label: "Product strategy role",
      kind: "role",
      purpose: "Clarify user intent, boundaries, and acceptance signals.",
    },
    {
      id: "role-system-architecture",
      label: "System architecture role",
      kind: "role",
      purpose: "Shape modules, dependencies, and engineering landing risks.",
    },
    {
      id: "docker-analysis-sandbox",
      label: "Docker analysis sandbox",
      kind: "docker",
      purpose: "Run repository inspection and artifact generation in isolation.",
    },
    {
      id: "skill-svg-architecture",
      label: "SVG architecture skill",
      kind: "skill",
      purpose: "Produce architecture diagrams and route evidence artifacts.",
    },
    {
      id: "aigc-spec-node",
      label: "AIGC SPEC derivation node",
      kind: "aigc_node",
      purpose: "Turn route nodes into SPEC tree candidates.",
    },
  ];

  if (includeGithubStep) {
    capabilities.unshift({
      id: "mcp-github-source",
      label: "GitHub source reader",
      kind: "mcp",
      purpose: "Read repository context before route generation.",
    });
  }

  if (clarificationContext.strategyId) {
    capabilities.unshift({
      id: `clarification-${clarificationContext.strategyId}`,
      label: `${clarificationContext.strategyId.replace(/_/g, " ")} clarification strategy`,
      kind: "role",
      purpose:
        clarificationContext.routeReadySummary ??
        "Carry structured clarification strategy, provenance, and readiness signals into route generation.",
    });
  }

  return capabilities;
}
