import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function clarificationSessionPayload() {
  return {
    session: {
      id: "clarification-session-1",
      intakeId: "intake-1",
      questions: [],
      answers: [],
      readiness: {
        status: "ready",
        score: 1,
        answeredRequired: 0,
        requiredTotal: 0,
        missingQuestionIds: [],
      },
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
    },
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("blueprint clarification API paths", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse(clarificationSessionPayload()));
  });

  it("creates clarification sessions under the intake route", async () => {
    const { createBlueprintClarificationSession } = await import(
      "./blueprint-api"
    );

    await createBlueprintClarificationSession("intake-1", {
      projectId: "project-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blueprint/intake/intake-1/clarifications",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("fetches clarification sessions from the top-level clarification route", async () => {
    const { fetchBlueprintClarificationSession } = await import(
      "./blueprint-api"
    );

    await fetchBlueprintClarificationSession("clarification-session-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blueprint/clarifications/clarification-session-1",
      undefined
    );
  });

  it("submits clarification answers to the top-level clarification route", async () => {
    const { saveBlueprintClarificationAnswers } = await import(
      "./blueprint-api"
    );

    await saveBlueprintClarificationAnswers("clarification-session-1", {
      answeredBy: "autopilot",
      answers: [{ questionId: "q1", answer: "Use the architecture route." }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blueprint/clarifications/clarification-session-1/answers",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("blueprint latest job normalization", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("normalizes intake and project context from the latest job payload", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        job: {
          id: "job-latest",
          request: {
            userInput: "Recover the cockpit",
            sources: [],
          },
          status: "running",
          stage: "route_generation",
          version: "blueprint-generation/v1",
          createdAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z",
          artifacts: [],
          events: [],
        },
        intake: {
          id: "intake-latest",
          project_id: "project-latest",
          source_id: "source-latest",
          target_text: "Recover the cockpit",
          github_urls: ["https://github.com/example/latest"],
          sources: [],
          domain_notes: ["repo context"],
          assets: [],
          evidence: [],
          readiness: {
            status: "ready",
            score: 1,
            answered_required: 0,
            required_total: 0,
            missing_question_ids: [],
          },
          created_at: "2026-05-22T00:00:00.000Z",
          updated_at: "2026-05-22T00:01:00.000Z",
        },
        project_context: {
          project_id: "project-latest",
          intake_ids: ["intake-latest"],
          source_ids: ["source-latest"],
          assets: [],
          evidence: [],
          updated_at: "2026-05-22T00:01:00.000Z",
        },
      })
    );

    const { fetchLatestBlueprintGenerationJob } = await import(
      "./blueprint-api"
    );

    const result = await fetchLatestBlueprintGenerationJob();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blueprint/jobs/latest",
      undefined
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.intake).toMatchObject({
      id: "intake-latest",
      projectId: "project-latest",
      sourceId: "source-latest",
      targetText: "Recover the cockpit",
      githubUrls: ["https://github.com/example/latest"],
      domainNotes: ["repo context"],
    });
    expect(result.data.intake?.readiness).toMatchObject({
      answeredRequired: 0,
      requiredTotal: 0,
      missingQuestionIds: [],
    });
    expect(result.data.projectContext).toMatchObject({
      projectId: "project-latest",
      intakeIds: ["intake-latest"],
      sourceIds: ["source-latest"],
    });
  });

  it("scopes latest generation job requests by project id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        job: null,
      })
    );

    const { fetchLatestBlueprintGenerationJob } = await import(
      "./blueprint-api"
    );

    const result = await fetchLatestBlueprintGenerationJob({
      projectId: "project-new",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blueprint/jobs/latest?projectId=project-new",
      undefined
    );
    expect(result.ok).toBe(true);
  });
});
