import { describe, expect, it } from "vitest";

import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintClarificationAnswer,
  BlueprintClarificationSession,
  BlueprintGenerationJob,
  BlueprintRouteCandidate,
  BlueprintSpecDocument,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

import {
  EFFECT_PREVIEW_PROMPT_ID,
  buildEffectPreviewPrompt,
  type BuildEffectPreviewPromptInput,
} from "./prompt.js";

/**
 * Validates: Requirements 2.5, 3.1, 3.2, 9.2
 *
 * ~9 example-based unit tests covering the deterministic, locale-aware prompt
 * builder for the Effect Preview LLM call:
 *
 *  - 6.1 Byte-identical `userMessage` for identical input tuples.
 *  - 6.2 Adding a clarification answer mutates both `userMessage` and
 *        `promptFingerprint`.
 *  - 6.3 `clarification.answers` sort by `questionId` lexicographically.
 *  - 6.4 `sourceDocuments` sort by `id` lexicographically inside `userPayload`.
 *  - 6.5 `locale === "zh-CN"` system message contains CJK characters.
 *  - 6.6 `locale === "en-US"` system message is CJK-free and starts with the
 *        expected English preamble.
 *  - 6.7 `EFFECT_PREVIEW_PROMPT_ID` matches the emitted `promptId`.
 *  - 6.8 `capabilityInvocations` / `capabilityEvidence` optional branch:
 *        undefined on input → `userPayload.upstreamEvidence === undefined`;
 *        non-empty → sorted by `id` and surfaced inside `upstreamEvidence`.
 *  - 6.9 `userPayload.outputSchema` surfaces runtime projection hints
 *        (`hudState`, `consoleLines`, `logTimeline`, `browserPreview`) and
 *        constrains `logTimeline[*].level` to `{info, warning, success}`.
 */

// ---------------------------------------------------------------------------
// Factory helpers — build deterministic fixtures so individual tests can focus
// on the specific bit of input they want to mutate.
// ---------------------------------------------------------------------------

function buildSpecTreeNode(
  overrides: Partial<BlueprintSpecTreeNode> = {},
): BlueprintSpecTreeNode {
  return {
    id: overrides.id ?? "node-1",
    parentId: overrides.parentId,
    title: overrides.title ?? "Release Dashboard Cockpit",
    summary:
      overrides.summary ??
      "Ship the first effect preview cockpit slice for operator handoff.",
    type: overrides.type ?? "spec_document",
    status: overrides.status ?? "ready",
    priority: overrides.priority ?? 1,
    routeId: overrides.routeId ?? "route-primary",
    routeStepId: overrides.routeStepId ?? "route-step-1",
    dependencies: overrides.dependencies ?? ["node-dep-a", "node-dep-b"],
    outputs: overrides.outputs ?? ["hud-release-dashboard"],
    children: overrides.children ?? [],
    metadata: overrides.metadata,
  };
}

function buildSpecDocument(
  id: string,
  overrides: Partial<BlueprintSpecDocument> = {},
): BlueprintSpecDocument {
  return {
    id,
    jobId: overrides.jobId ?? "job-1",
    treeId: overrides.treeId ?? "tree-1",
    nodeId: overrides.nodeId ?? "node-1",
    type: overrides.type ?? "requirements",
    status: overrides.status ?? "accepted",
    version: overrides.version ?? 1,
    sourceDocumentId: overrides.sourceDocumentId,
    title: overrides.title ?? `Spec Document ${id}`,
    summary: overrides.summary ?? `Summary for ${id}.`,
    content: overrides.content ?? `Content body for ${id}.`,
    format: "markdown",
    createdAt: overrides.createdAt ?? "2026-05-07T00:00:00.000Z",
    updatedAt: overrides.updatedAt,
    provenance: overrides.provenance ?? {
      jobId: "job-1",
      projectId: "project-1",
      sourceId: "source-1",
      targetText: "target",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "spec_document",
      nodeTitle: "Release Dashboard Cockpit",
      nodeSummary: "spec node summary",
      dependencies: [],
      outputs: [],
    },
  };
}

function buildPrimaryRoute(
  overrides: Partial<BlueprintRouteCandidate> = {},
): BlueprintRouteCandidate {
  return {
    id: overrides.id ?? "route-primary",
    kind: overrides.kind ?? "primary",
    title: overrides.title ?? "Primary Route",
    summary: overrides.summary ?? "Primary route summary.",
    rationale: overrides.rationale ?? "Primary route rationale.",
    riskLevel: overrides.riskLevel ?? "medium",
    costLevel: overrides.costLevel ?? "medium",
    complexity: overrides.complexity ?? "balanced",
    estimatedEffort: overrides.estimatedEffort ?? "1 sprint",
    capabilities: overrides.capabilities ?? [
      {
        id: "cap-1",
        label: "Cap One",
        kind: "aigc_node",
        purpose: "node-level reasoning",
      },
    ],
    steps: overrides.steps ?? [
      {
        id: "step-1",
        title: "Step 1",
        description: "Initialize cockpit scaffold.",
        role: "planner",
        status: "pending",
      },
      {
        id: "step-2",
        title: "Step 2",
        description: "Render HUD surface.",
        role: "executor",
        status: "pending",
      },
    ],
    outputs: overrides.outputs ?? ["hud-release-dashboard"],
  };
}

function buildJob(
  overrides: Partial<BlueprintGenerationJob> = {},
): BlueprintGenerationJob {
  return {
    id: overrides.id ?? "job-1",
    request:
      overrides.request ?? {
        projectId: "project-1",
        sourceId: "source-1",
        targetText: "Ship the release dashboard cockpit.",
        githubUrls: [
          "https://github.com/example/repo-a",
          "https://github.com/example/repo-b",
        ],
      },
    status: overrides.status ?? "running",
    stage: overrides.stage ?? "effect_preview",
    projectId: overrides.projectId ?? "project-1",
    sourceId: overrides.sourceId ?? "source-1",
    version: overrides.version ?? "v1",
    createdAt: overrides.createdAt ?? "2026-05-07T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-07T01:00:00.000Z",
    artifacts: overrides.artifacts ?? [],
    events: overrides.events ?? [],
  };
}

function buildAnswer(
  questionId: string,
  answer: string,
): BlueprintClarificationAnswer {
  return {
    questionId,
    answer,
    answeredAt: "2026-05-07T00:30:00.000Z",
  };
}

function buildClarificationSession(
  answers: BlueprintClarificationAnswer[],
): BlueprintClarificationSession {
  return {
    id: "clar-1",
    intakeId: "intake-1",
    projectId: "project-1",
    strategyId: "target_first",
    templateId: "template-1",
    questions: [],
    answers,
    readiness: {
      status: "ready",
      score: 100,
      answeredRequired: answers.length,
      requiredTotal: answers.length,
      missingQuestionIds: [],
    },
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:30:00.000Z",
  };
}

function buildCapabilityInvocation(
  id: string,
  overrides: Partial<BlueprintCapabilityInvocation> = {},
): BlueprintCapabilityInvocation {
  return {
    id,
    jobId: overrides.jobId ?? "job-1",
    capabilityId: overrides.capabilityId ?? `cap-${id}`,
    capabilityLabel: overrides.capabilityLabel ?? `Capability ${id}`,
    kind: overrides.kind ?? "aigc_node",
    status: overrides.status ?? "succeeded",
    securityLevel: overrides.securityLevel ?? "readonly",
    safetyGate: overrides.safetyGate ?? {
      status: "allowed",
      reason: "ok",
      requiresApproval: false,
      approved: true,
      securityLevel: "readonly",
    },
    requestedAt: overrides.requestedAt ?? "2026-05-07T00:10:00.000Z",
    completedAt: overrides.completedAt ?? "2026-05-07T00:11:00.000Z",
    outputSummary: overrides.outputSummary ?? `summary for ${id}`,
    logs: overrides.logs ?? [],
    evidenceIds: overrides.evidenceIds ?? [],
    durationMs: overrides.durationMs ?? 1000,
    provenance: overrides.provenance ?? {
      jobId: "job-1",
      githubUrls: [],
    },
  };
}

function buildCapabilityEvidence(
  id: string,
  overrides: Partial<BlueprintCapabilityEvidence> = {},
): BlueprintCapabilityEvidence {
  return {
    id,
    jobId: overrides.jobId ?? "job-1",
    invocationId: overrides.invocationId ?? `inv-${id}`,
    capabilityId: overrides.capabilityId ?? `cap-${id}`,
    capabilityLabel: overrides.capabilityLabel ?? `Capability ${id}`,
    kind: overrides.kind ?? "analysis",
    status: overrides.status ?? "recorded",
    title: overrides.title ?? `Evidence ${id}`,
    summary: overrides.summary ?? `evidence summary ${id}`,
    createdAt: overrides.createdAt ?? "2026-05-07T00:12:00.000Z",
    artifacts: overrides.artifacts ?? [],
    logs: overrides.logs ?? [],
    tags: overrides.tags ?? [],
    payloadSummary: overrides.payloadSummary ?? {},
    provenance: overrides.provenance ?? {
      jobId: "job-1",
      githubUrls: [],
    },
  };
}

function buildBaselineInput(
  overrides: Partial<BuildEffectPreviewPromptInput> = {},
): BuildEffectPreviewPromptInput {
  return {
    job: overrides.job ?? buildJob(),
    specTreeNode: overrides.specTreeNode ?? buildSpecTreeNode(),
    sourceDocuments:
      overrides.sourceDocuments ??
      [buildSpecDocument("doc-a"), buildSpecDocument("doc-b")],
    primaryRoute:
      overrides.primaryRoute === undefined
        ? buildPrimaryRoute()
        : overrides.primaryRoute,
    clarificationSession:
      overrides.clarificationSession === undefined
        ? buildClarificationSession([
            buildAnswer("q-a", "answer a"),
            buildAnswer("q-b", "answer b"),
          ])
        : overrides.clarificationSession,
    domainContext: overrides.domainContext,
    capabilityInvocations: overrides.capabilityInvocations,
    capabilityEvidence: overrides.capabilityEvidence,
    includeDrafts: overrides.includeDrafts ?? false,
    locale: overrides.locale ?? "zh-CN",
  };
}

// ---------------------------------------------------------------------------
// 6.1 Determinism: identical input → byte-identical `userMessage`.
// ---------------------------------------------------------------------------

describe("buildEffectPreviewPrompt — determinism", () => {
  it("6.1 produces byte-identical userMessage for identical input tuples", () => {
    const input = buildBaselineInput();
    const first = buildEffectPreviewPrompt(input);
    const second = buildEffectPreviewPrompt(input);

    expect(second.userMessage).toBe(first.userMessage);
    expect(second.promptFingerprint).toBe(first.promptFingerprint);
    expect(second.systemMessage).toBe(first.systemMessage);
  });
});

// ---------------------------------------------------------------------------
// 6.2 Input-change sensitivity: adding a clarification answer mutates
// `userMessage` and `promptFingerprint`.
// ---------------------------------------------------------------------------

describe("buildEffectPreviewPrompt — input-change sensitivity", () => {
  it("6.2 changes userMessage and promptFingerprint when a new clarification answer is appended", () => {
    const baseSession = buildClarificationSession([
      buildAnswer("q-a", "answer a"),
      buildAnswer("q-b", "answer b"),
    ]);
    const baselineInput = buildBaselineInput({
      clarificationSession: baseSession,
    });
    const base = buildEffectPreviewPrompt(baselineInput);

    const extendedSession = buildClarificationSession([
      ...baseSession.answers,
      buildAnswer("q-c", "answer c"),
    ]);
    const mutatedInput = buildBaselineInput({
      clarificationSession: extendedSession,
    });
    const mutated = buildEffectPreviewPrompt(mutatedInput);

    expect(mutated.userMessage).not.toBe(base.userMessage);
    expect(mutated.promptFingerprint).not.toBe(base.promptFingerprint);
  });
});

// ---------------------------------------------------------------------------
// 6.3 `answers` sorted by `questionId` lexicographically.
// ---------------------------------------------------------------------------

describe("buildEffectPreviewPrompt — clarification answer ordering", () => {
  it("6.3 sorts clarification answers by questionId in ascending order", () => {
    const session = buildClarificationSession([
      buildAnswer("q-c", "answer c"),
      buildAnswer("q-a", "answer a"),
      buildAnswer("q-b", "answer b"),
    ]);

    const result = buildEffectPreviewPrompt(
      buildBaselineInput({ clarificationSession: session }),
    );

    const clarification = result.userPayload.clarification as
      | { answers: Array<{ questionId: string; answer: string }> }
      | undefined;
    expect(clarification).toBeDefined();
    expect(clarification?.answers.map((entry) => entry.questionId)).toEqual([
      "q-a",
      "q-b",
      "q-c",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6.4 `sourceDocuments` sorted by `id` lexicographically.
// ---------------------------------------------------------------------------

describe("buildEffectPreviewPrompt — sourceDocuments ordering", () => {
  it("6.4 sorts sourceDocuments by id lexicographically inside userPayload", () => {
    const input = buildBaselineInput({
      sourceDocuments: [
        buildSpecDocument("doc-c"),
        buildSpecDocument("doc-a"),
        buildSpecDocument("doc-b"),
      ],
    });

    const result = buildEffectPreviewPrompt(input);
    const sourceDocuments = result.userPayload.sourceDocuments as Array<{
      id: string;
    }>;
    expect(sourceDocuments.map((doc) => doc.id)).toEqual([
      "doc-a",
      "doc-b",
      "doc-c",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6.5 / 6.6 Locale-aware system message.
// ---------------------------------------------------------------------------

describe("buildEffectPreviewPrompt — locale-aware systemMessage", () => {
  it("6.5 renders CJK characters when locale === 'zh-CN'", () => {
    const result = buildEffectPreviewPrompt(
      buildBaselineInput({ locale: "zh-CN" }),
    );

    expect(result.systemMessage).toMatch(/[\u4e00-\u9fff]/);
  });

  it("6.6 renders an English-only preamble when locale === 'en-US'", () => {
    const result = buildEffectPreviewPrompt(
      buildBaselineInput({ locale: "en-US" }),
    );

    expect(result.systemMessage).not.toMatch(/[\u4e00-\u9fff]/);
    expect(result.systemMessage).toMatch(
      /^You are the \/autopilot Effect Preview/,
    );
  });
});

// ---------------------------------------------------------------------------
// 6.7 Prompt identifier contract.
// ---------------------------------------------------------------------------

describe("buildEffectPreviewPrompt — prompt identifier", () => {
  it("6.7 pins EFFECT_PREVIEW_PROMPT_ID to 'blueprint.effect-preview.v1' and surfaces it on the payload", () => {
    expect(EFFECT_PREVIEW_PROMPT_ID).toBe("blueprint.effect-preview.v1");

    const result = buildEffectPreviewPrompt(buildBaselineInput());
    expect(result.promptId).toBe(EFFECT_PREVIEW_PROMPT_ID);
    expect(result.userPayload.promptId).toBe(EFFECT_PREVIEW_PROMPT_ID);
  });
});

// ---------------------------------------------------------------------------
// 6.8 Optional upstreamEvidence branch.
// ---------------------------------------------------------------------------

describe("buildEffectPreviewPrompt — upstreamEvidence optional branch", () => {
  it("6.8 leaves userPayload.upstreamEvidence === undefined when capability data is absent", () => {
    const result = buildEffectPreviewPrompt(
      buildBaselineInput({
        capabilityInvocations: undefined,
        capabilityEvidence: undefined,
      }),
    );

    expect(result.userPayload.upstreamEvidence).toBeUndefined();
    // `JSON.stringify` should drop the key entirely rather than emitting `null`.
    expect(result.userMessage).not.toMatch(/"upstreamEvidence"/);
  });

  it("6.8 sorts capabilityInvocations and capabilityEvidence by id inside upstreamEvidence", () => {
    const result = buildEffectPreviewPrompt(
      buildBaselineInput({
        capabilityInvocations: [
          buildCapabilityInvocation("inv-c"),
          buildCapabilityInvocation("inv-a"),
          buildCapabilityInvocation("inv-b"),
        ],
        capabilityEvidence: [
          buildCapabilityEvidence("ev-c"),
          buildCapabilityEvidence("ev-a"),
          buildCapabilityEvidence("ev-b"),
        ],
      }),
    );

    const upstream = result.userPayload.upstreamEvidence as
      | {
          capabilityInvocations?: Array<{ id: string }>;
          capabilityEvidence?: Array<{ id: string }>;
        }
      | undefined;
    expect(upstream).toBeDefined();
    expect(upstream?.capabilityInvocations?.map((entry) => entry.id)).toEqual([
      "inv-a",
      "inv-b",
      "inv-c",
    ]);
    expect(upstream?.capabilityEvidence?.map((entry) => entry.id)).toEqual([
      "ev-a",
      "ev-b",
      "ev-c",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6.9 outputSchema hints.
// ---------------------------------------------------------------------------

describe("buildEffectPreviewPrompt — outputSchema hints", () => {
  it("6.9 surfaces runtimeProjection hints and constrains logTimeline[*].level", () => {
    const result = buildEffectPreviewPrompt(buildBaselineInput());

    const outputSchema = result.userPayload.outputSchema as {
      runtimeProjection?: {
        hudState?: string;
        consoleLines?: string;
        logTimeline?: string;
        browserPreview?: string;
      };
    };

    const runtimeProjection = outputSchema.runtimeProjection;
    expect(runtimeProjection).toBeDefined();
    expect(runtimeProjection?.hudState).toBeDefined();
    expect(runtimeProjection?.hudState).toContain("progressPercent");
    expect(runtimeProjection?.consoleLines).toBeDefined();
    expect(runtimeProjection?.logTimeline).toBeDefined();
    expect(runtimeProjection?.logTimeline).toMatch(
      /'info'\|'warning'\|'success'/,
    );
    expect(runtimeProjection?.browserPreview).toBeDefined();
  });
});
