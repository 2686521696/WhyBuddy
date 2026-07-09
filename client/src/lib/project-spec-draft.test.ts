import { describe, expect, it } from "vitest";

import {
  buildInitialProjectSpecDraft,
  buildProjectSpecUpdateSuggestion,
} from "./project-spec-draft";
import type {
  Project,
  ProjectArtifact,
  ProjectEvidence,
  ProjectMission,
  ProjectSpec,
} from "./project-store";

const project: Project = {
  id: "project-1",
  name: "Spec Center",
  goal: "Keep project specs updated from execution outcomes.",
  status: "spec_ready",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:00.000Z",
};

const spec: ProjectSpec = {
  id: "spec-1",
  projectId: project.id,
  version: 2,
  title: "Spec Center Spec",
  content: "# Spec Center Spec",
  status: "accepted",
  sourceMessageIds: [],
  sourceEvidenceIds: [],
  sourceArtifactIds: [],
  createdAt: "2026-04-30T00:00:00.000Z",
};

describe("project-spec-draft", () => {
  it("builds an initial project spec draft", () => {
    const draft = buildInitialProjectSpecDraft({
      project,
      messages: [
        {
          id: "message-1",
          projectId: project.id,
          role: "user",
          kind: "chat",
          content: "Need spec updates from project decisions.",
          createdAt: "2026-04-30T01:00:00.000Z",
        },
      ],
    });

    expect(draft).toMatchObject({
      projectId: project.id,
      title: "Spec Center Initial Spec",
      sourceMessageIds: ["message-1"],
    });
    expect(draft.content).toContain("Need spec updates from project decisions.");
  });

  it("creates a spec update suggestion from user decision evidence", () => {
    const decision: ProjectEvidence = {
      id: "evidence-decision-1",
      projectId: project.id,
      type: "decision",
      title: "User approved conservative release",
      detail: "User decided release must require manual approval before publish.",
      createdAt: "2026-04-30T02:00:00.000Z",
    };

    const suggestion = buildProjectSpecUpdateSuggestion({
      spec,
      evidence: [decision],
    });

    expect(suggestion).toMatchObject({
      projectId: project.id,
      specId: spec.id,
      sourceEvidenceIds: [decision.id],
      sourceArtifactIds: [],
      sourceMissionIds: [],
    });
    expect(suggestion?.title).toContain("Spec update suggestion");
    expect(suggestion?.rationale).toContain("user decision");
    expect(suggestion?.content).toContain(
      "Decision: User approved conservative release"
    );
    expect(suggestion?.content).toContain("manual approval before publish");
  });

  it("keeps mission failed and artifact sources attached to the suggestion", () => {
    const failedMission: ProjectMission = {
      id: "project-mission-1",
      projectId: project.id,
      missionId: "mission-runtime-1",
      specId: spec.id,
      status: "failed",
      createdAt: "2026-04-30T03:00:00.000Z",
      updatedAt: "2026-04-30T03:30:00.000Z",
    };
    const artifact: ProjectArtifact = {
      id: "artifact-report-1",
      projectId: project.id,
      type: "report",
      title: "Failure analysis",
      contentPreview: "The deployment step needs a retry and rollback plan.",
      sourceMissionId: failedMission.missionId,
      sourceSpecId: spec.id,
      createdAt: "2026-04-30T03:40:00.000Z",
    };

    const suggestion = buildProjectSpecUpdateSuggestion({
      spec,
      missions: [failedMission],
      artifacts: [artifact],
    });

    expect(suggestion).toMatchObject({
      sourceEvidenceIds: [],
      sourceArtifactIds: [artifact.id],
      sourceMissionIds: [failedMission.missionId],
    });
    expect(suggestion?.rationale).toContain("failed mission");
    expect(suggestion?.content).toContain("Mission failed: mission-runtime-1");
    expect(suggestion?.content).toContain("Artifact: Failure analysis");
    expect(suggestion?.content).toContain(
      "Source mission: mission-runtime-1"
    );
  });

  it("returns null when no effective project source can update the spec", () => {
    const suggestion = buildProjectSpecUpdateSuggestion({
      spec,
      evidence: [
        {
          id: "evidence-message-1",
          projectId: project.id,
          type: "message",
          title: "Ambient chat",
          detail: "This should not become a spec update by itself.",
          createdAt: "2026-04-30T04:00:00.000Z",
        },
      ],
      missions: [
        {
          id: "project-mission-2",
          projectId: project.id,
          missionId: "mission-running-1",
          status: "running",
          createdAt: "2026-04-30T04:00:00.000Z",
          updatedAt: "2026-04-30T04:05:00.000Z",
        },
      ],
    });

    expect(suggestion).toBeNull();
  });
});
