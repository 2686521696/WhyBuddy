import { describe, expect, it } from "vitest";

import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintClarificationSession,
  BlueprintEffectPreview,
  BlueprintImplementationPromptPackage,
  BlueprintRouteCandidate,
  BlueprintSpecDocument,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

import {
  ENGINEERING_HANDOFF_PROMPT_ID,
  buildEngineeringHandoffPrompt,
  type BuildEngineeringHandoffPromptInput,
} from "./prompt.js";

function buildPromptPackage(): BlueprintImplementationPromptPackage {
  return {
    id: "prompt-package-1",
    jobId: "job-1",
    treeId: "tree-1",
    nodeIds: ["node-1", "node-2"],
    sourceDocumentIds: ["doc-1"],
    sourcePreviewIds: ["preview-1"],
    targetPlatform: "codex",
    target: {
      platform: "codex",
      label: "Codex CLI",
      executionMode: "agent",
    },
    title: "Example package",
    summary: "Example summary",
    content: "content",
    sections: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeIds: ["node-1", "node-2"],
      sourceDocumentIds: ["doc-1"],
      sourcePreviewIds: ["preview-1"],
      targetPlatform: "codex",
      sourceDocumentStatus: "accepted",
      sourcePreviewStatus: "accepted",
      includeDrafts: false,
      includePreviewDrafts: false,
      sourceDocumentStatuses: {},
      sourcePreviewStatuses: {},
    },
  };
}

function buildRoute(): BlueprintRouteCandidate {
  return {
    id: "route-1",
    kind: "standard" as BlueprintRouteCandidate["kind"],
    title: "Standard rollout",
    summary: "Run a staged rollout",
    rationale: "Balances speed and risk",
    riskLevel: "medium" as BlueprintRouteCandidate["riskLevel"],
    costLevel: "medium" as BlueprintRouteCandidate["costLevel"],
    complexity: "medium" as BlueprintRouteCandidate["complexity"],
    estimatedEffort: "2d",
    capabilities: [],
    steps: [
      { id: "rs-1", title: "Plan", summary: "plan" },
      { id: "rs-2", title: "Execute", summary: "exec" },
      { id: "rs-3", title: "Verify", summary: "verify" },
    ] as BlueprintRouteCandidate["steps"],
    outputs: [],
  };
}

function buildClarificationSession(
  answers: Array<{ questionId: string; answer: string }>,
): BlueprintClarificationSession {
  return {
    id: "session-1",
    intakeId: "intake-1",
    strategyId: "strategy-1",
    templateId: "template-1",
    answers: answers.map(a => ({
      questionId: a.questionId,
      answer: a.answer,
    })),
  } as unknown as BlueprintClarificationSession;
}

function buildInput(
  overrides: Partial<BuildEngineeringHandoffPromptInput> = {},
): BuildEngineeringHandoffPromptInput {
  return {
    promptPackage: buildPromptPackage(),
    sourceNodes: [] as BlueprintSpecTreeNode[],
    sourceDocuments: [] as BlueprintSpecDocument[],
    sourcePreviews: [] as BlueprintEffectPreview[],
    locale: "en-US",
    status: "draft",
    intake: {
      targetText: "Deploy dashboard",
      githubUrls: ["https://github.com/example/app"],
    },
    ...overrides,
  };
}

describe("buildEngineeringHandoffPrompt", () => {
  // 6.1 — determinism
  it("produces byte-identical userMessage and promptFingerprint for the same input", () => {
    const input = buildInput();
    const first = buildEngineeringHandoffPrompt(input);
    const second = buildEngineeringHandoffPrompt(input);
    expect(second.userMessage).toBe(first.userMessage);
    expect(second.promptFingerprint).toBe(first.promptFingerprint);
  });

  // 6.2 — input sensitivity
  it("changes userMessage and promptFingerprint when inputs change", () => {
    const baseline = buildEngineeringHandoffPrompt(buildInput());
    const extended = buildEngineeringHandoffPrompt(
      buildInput({
        clarificationSession: buildClarificationSession([
          { questionId: "q-1", answer: "first answer" },
        ]),
      }),
    );
    expect(extended.userMessage).not.toBe(baseline.userMessage);
    expect(extended.promptFingerprint).not.toBe(baseline.promptFingerprint);
  });

  // 6.3 — clarification answers are sorted by questionId
  it("sorts clarification.answers by questionId in lexicographic order", () => {
    const input = buildInput({
      clarificationSession: buildClarificationSession([
        { questionId: "q-c", answer: "c" },
        { questionId: "q-a", answer: "a" },
        { questionId: "q-b", answer: "b" },
      ]),
    });
    const prompt = buildEngineeringHandoffPrompt(input);
    const clarification = (prompt.userPayload.clarification as {
      answers: Array<{ questionId: string }>;
    }).answers;
    expect(clarification.map(a => a.questionId)).toEqual(["q-a", "q-b", "q-c"]);
  });

  // 6.4 — zh-CN system message contains CJK
  it("includes CJK characters in systemMessage when locale === zh-CN", () => {
    const prompt = buildEngineeringHandoffPrompt(buildInput({ locale: "zh-CN" }));
    expect(/[\u4e00-\u9fff]/.test(prompt.systemMessage)).toBe(true);
  });

  // 6.5 — en-US system message starts with expected English phrase and has no CJK
  it("uses an English systemMessage with no CJK when locale is en-US", () => {
    const prompt = buildEngineeringHandoffPrompt(buildInput({ locale: "en-US" }));
    expect(/[\u4e00-\u9fff]/.test(prompt.systemMessage)).toBe(false);
    expect(prompt.systemMessage).toMatch(
      /^You are the \/autopilot Engineering Handoff/,
    );
  });

  // 6.6 — prompt id constant is correct and propagated
  it("exports ENGINEERING_HANDOFF_PROMPT_ID === 'blueprint.engineering-handoff.v1' and propagates it", () => {
    expect(ENGINEERING_HANDOFF_PROMPT_ID).toBe("blueprint.engineering-handoff.v1");
    const prompt = buildEngineeringHandoffPrompt(buildInput());
    expect(prompt.promptId).toBe(ENGINEERING_HANDOFF_PROMPT_ID);
    expect((prompt.userPayload as { promptId: string }).promptId).toBe(
      ENGINEERING_HANDOFF_PROMPT_ID,
    );
  });

  // 6.7 — primaryRoute.steps preserves original order
  it("preserves primaryRoute.steps original order and sourceNodes/Documents/Previews input order", () => {
    const route = buildRoute();
    const prompt = buildEngineeringHandoffPrompt(
      buildInput({
        selectedRoute: route,
        sourceNodes: [
          { id: "node-b" } as BlueprintSpecTreeNode,
          { id: "node-a" } as BlueprintSpecTreeNode,
        ] as readonly BlueprintSpecTreeNode[],
      }),
    );
    const primaryRoute = prompt.userPayload.primaryRoute as {
      steps: Array<{ id: string }>;
    };
    expect(primaryRoute.steps.map(s => s.id)).toEqual(["rs-1", "rs-2", "rs-3"]);
    const sourceNodes = prompt.userPayload.sourceNodes as Array<{ id: string }>;
    expect(sourceNodes.map(n => n.id)).toEqual(["node-b", "node-a"]);
  });

  // 6.8 — outputSchema hints include all enum values
  it("outputSchema hints include all enum values", () => {
    const prompt = buildEngineeringHandoffPrompt(buildInput());
    const hints = JSON.stringify(prompt.userPayload.outputSchema);
    expect(hints).toContain("automatic");
    expect(hints).toContain("manual");
    expect(hints).toContain("handoff");
    expect(hints).toContain("low");
    expect(hints).toContain("medium");
    expect(hints).toContain("high");
    expect(hints).toContain("info");
    expect(hints).toContain("warning");
    expect(hints).toContain("critical");
    expect(hints).toContain("codex");
    expect(hints).toContain("claude");
    expect(hints).toContain("cursor");
    expect(hints).toContain("kiro");
    expect(hints).toContain("trae");
    expect(hints).toContain("windsurf");
  });

  // 6.9 — resolvableIds reflects the union of promptPackage + external source arrays
  it("resolvableIds reflects the union of promptPackage and external source arrays", () => {
    const prompt = buildEngineeringHandoffPrompt(
      buildInput({
        sourceNodes: [
          { id: "node-1" } as BlueprintSpecTreeNode,
          { id: "node-extra" } as BlueprintSpecTreeNode,
        ] as readonly BlueprintSpecTreeNode[],
        sourceDocuments: [
          { id: "doc-1" } as BlueprintSpecDocument,
          { id: "doc-extra" } as BlueprintSpecDocument,
        ] as readonly BlueprintSpecDocument[],
        sourcePreviews: [
          { id: "preview-1" } as BlueprintEffectPreview,
          { id: "preview-extra" } as BlueprintEffectPreview,
        ] as readonly BlueprintEffectPreview[],
      }),
    );
    const resolvable = prompt.userPayload.resolvableIds as {
      nodeIds: string[];
      documentIds: string[];
      previewIds: string[];
      promptPackageIds: string[];
    };
    expect(resolvable.nodeIds).toEqual(
      expect.arrayContaining(["node-1", "node-2", "node-extra"]),
    );
    expect(resolvable.documentIds).toEqual(
      expect.arrayContaining(["doc-1", "doc-extra"]),
    );
    expect(resolvable.previewIds).toEqual(
      expect.arrayContaining(["preview-1", "preview-extra"]),
    );
    expect(resolvable.promptPackageIds).toEqual(["prompt-package-1"]);
  });

  // 6.10 — optional capability inputs are only included when provided
  it("omits capability blocks when undefined and preserves input order when provided", () => {
    const withoutCapabilities = buildEngineeringHandoffPrompt(buildInput());
    expect(
      (withoutCapabilities.userPayload as Record<string, unknown>).capabilityInvocations,
    ).toBeUndefined();
    expect(
      (withoutCapabilities.userPayload as Record<string, unknown>).capabilityEvidence,
    ).toBeUndefined();

    const invocations = [
      { id: "inv-1", capabilityId: "cap-a", status: "completed" },
      { id: "inv-2", capabilityId: "cap-b", status: "running" },
    ] as unknown as BlueprintCapabilityInvocation[];
    const evidence = [
      { id: "ev-1", capabilityId: "cap-a", kind: "log", status: "recorded" },
      { id: "ev-2", capabilityId: "cap-b", kind: "analysis", status: "recorded" },
    ] as unknown as BlueprintCapabilityEvidence[];

    const withCapabilities = buildEngineeringHandoffPrompt(
      buildInput({
        capabilityInvocations: invocations,
        capabilityEvidence: evidence,
      }),
    );
    const invList = withCapabilities.userPayload.capabilityInvocations as Array<{
      id: string;
    }>;
    const evList = withCapabilities.userPayload.capabilityEvidence as Array<{
      id: string;
    }>;
    expect(invList.map(i => i.id)).toEqual(["inv-1", "inv-2"]);
    expect(evList.map(e => e.id)).toEqual(["ev-1", "ev-2"]);
  });
});
