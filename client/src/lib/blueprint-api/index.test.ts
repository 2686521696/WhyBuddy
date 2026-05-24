import { afterEach, describe, expect, it, vi } from "vitest";

import * as intake from "./intake.js";
import * as clarification from "./clarification.js";
import * as jobs from "./jobs.js";
import * as replan from "./replan.js";
import * as family from "./family.js";
import * as agentCrew from "./agent-crew.js";
import * as routeset from "./routeset.js";
import * as specDocuments from "./spec-documents.js";
import * as downstream from "./downstream.js";
import * as artifactReplay from "./artifact-replay.js";
import * as barrel from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("blueprint-api subdomain SDK shells", () => {
  it("intake exposes endpoint constants plus fetch/create/patch helpers", () => {
    expect(typeof intake.BLUEPRINT_SPECS_ENDPOINT).toBe("string");
    expect(typeof intake.BLUEPRINT_INTAKE_ENDPOINT).toBe("string");
    expect(typeof intake.fetchBlueprintSpecsProgress).toBe("function");
    expect(typeof intake.createBlueprintIntake).toBe("function");
    expect(typeof intake.patchBlueprintIntake).toBe("function");
    expect(typeof intake.fetchBlueprintProjectContext).toBe("function");
  });

  it("clarification exposes session and answers helpers", () => {
    expect(typeof clarification.BLUEPRINT_CLARIFICATIONS_ENDPOINT).toBe(
      "string"
    );
    expect(typeof clarification.createBlueprintClarificationSession).toBe(
      "function"
    );
    expect(typeof clarification.fetchBlueprintClarificationSession).toBe(
      "function"
    );
    expect(typeof clarification.saveBlueprintClarificationAnswers).toBe(
      "function"
    );
  });

  it("jobs exposes latest/event helpers", () => {
    expect(typeof jobs.BLUEPRINT_JOBS_ENDPOINT).toBe("string");
    expect(typeof jobs.BLUEPRINT_GENERATIONS_ENDPOINT).toBe("string");
    expect(typeof jobs.createBlueprintGenerationJob).toBe("function");
    expect(typeof jobs.fetchBlueprintGenerationJob).toBe("function");
    expect(typeof jobs.fetchLatestBlueprintGenerationJob).toBe("function");
    expect(typeof jobs.fetchBlueprintJobEvents).toBe("function");
    expect(typeof jobs.fetchBlueprintJobEventStreamUrl("job-1")).toBe("string");
  });

  it("jobs fetches a specific generation job by id for history snapshots", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ job: { id: "job 1" } }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await jobs.fetchBlueprintGenerationJob("job 1");

    expect(result).toMatchObject({
      ok: true,
      data: {
        job: { id: "job 1" },
      },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/blueprint/jobs/job%201",
      undefined
    );
  });

  it("replan posts the stage edit strategy to the job replan endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mode: "branch", job: { id: "job-2" } }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await replan.postBlueprintReplan("job 1", {
      fromStage: "route_generation",
      mode: "branch",
      reason: "try another route",
    });

    expect(result).toEqual({
      ok: true,
      data: { mode: "branch", job: { id: "job-2" } },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/blueprint/jobs/job%201/replan",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          fromStage: "route_generation",
          mode: "branch",
          reason: "try another route",
        }),
      })
    );
  });

  it("replan wraps 4xx API failures in BlueprintReplanError", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "running downstream" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await replan.postBlueprintReplan("job-1", {
      fromStage: "route_generation",
      mode: "in_place",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(replan.BlueprintReplanError);
      expect(result.error.status).toBe(409);
      expect(result.error.message).toBe("running downstream");
    }
  });

  it("barrel re-exports BlueprintReplanError", () => {
    expect(typeof barrel.BlueprintReplanError).toBe("function");
  });

  it("family fetches the blueprint job family endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          rootJobId: "job-1",
          jobs: [],
          replanEvents: [],
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await family.getBlueprintFamily("job/1");

    expect(result).toEqual({
      ok: true,
      data: { rootJobId: "job-1", jobs: [], replanEvents: [] },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/blueprint/jobs/job%2F1/family",
      undefined
    );
  });

  it("intake patches editable intake fields without normalizing stale edit data", async () => {
    const payload = {
      intake: { id: "intake-1", targetText: "new target" },
      projectContext: { projectId: "project-1" },
      staleEdit: {
        fromStage: "spec_documents",
        newlyStaleArtifactIds: ["artifact-1"],
        newlyStaleArtifactCount: 1,
        staleArtifactIdsSnapshot: ["artifact-1"],
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await intake.patchBlueprintIntake("intake/1", {
      targetText: "new target",
      reason: "source changed",
    });

    expect(result).toEqual({ ok: true, data: payload });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/blueprint/intake/intake%2F1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          targetText: "new target",
          reason: "source changed",
        }),
      })
    );
  });

  it("agent-crew exposes capability / invocation / evidence helpers", () => {
    expect(typeof agentCrew.fetchBlueprintJobCapabilities).toBe("function");
    expect(typeof agentCrew.invokeBlueprintCapability).toBe("function");
    expect(typeof agentCrew.fetchBlueprintCapabilityInvocations).toBe(
      "function"
    );
    expect(typeof agentCrew.fetchBlueprintCapabilityEvidence).toBe("function");
    expect(typeof agentCrew.normalizeBlueprintAgentCrew).toBe("function");
  });

  it("routeset exposes route / spec tree helpers", () => {
    expect(typeof routeset.selectBlueprintRoute).toBe("function");
    expect(typeof routeset.resetBlueprintRouteSelection).toBe("function");
    expect(typeof routeset.updateBlueprintSpecTreeNode).toBe("function");
    expect(typeof routeset.saveBlueprintSpecTreeVersion).toBe("function");
    expect(typeof routeset.runBlueprintSpecTreeAction).toBe("function");
  });

  it("spec-documents exposes review / generate / version helpers", () => {
    expect(typeof specDocuments.fetchBlueprintSpecDocuments).toBe("function");
    expect(typeof specDocuments.generateBlueprintSpecDocuments).toBe(
      "function"
    );
    expect(typeof specDocuments.reviewBlueprintSpecDocument).toBe("function");
    expect(typeof specDocuments.saveBlueprintSpecDocumentVersion).toBe(
      "function"
    );
  });

  it("downstream exposes preview / prompt / landing / run helpers", () => {
    expect(typeof downstream.fetchBlueprintEffectPreviews).toBe("function");
    expect(typeof downstream.generateBlueprintEffectPreview).toBe("function");
    expect(typeof downstream.fetchBlueprintPromptPackages).toBe("function");
    expect(typeof downstream.generateBlueprintPromptPackages).toBe("function");
    expect(typeof downstream.fetchBlueprintEngineeringLanding).toBe("function");
    expect(typeof downstream.generateBlueprintEngineeringLanding).toBe(
      "function"
    );
    expect(typeof downstream.fetchBlueprintEngineeringRuns).toBe("function");
  });

  it("artifact-replay exposes ledger / replay / feedback helpers", () => {
    expect(typeof artifactReplay.fetchBlueprintArtifactLedger).toBe("function");
    expect(typeof artifactReplay.fetchBlueprintArtifactReplays).toBe(
      "function"
    );
    expect(typeof artifactReplay.recordBlueprintArtifactFeedback).toBe(
      "function"
    );
    expect(typeof artifactReplay.normalizeBlueprintArtifactLedgerEntry).toBe(
      "function"
    );
  });

  it("barrel aggregates representative symbols from all subdomains", () => {
    expect(typeof barrel.createBlueprintIntake).toBe("function");
    expect(typeof barrel.patchBlueprintIntake).toBe("function");
    expect(typeof barrel.createBlueprintClarificationSession).toBe("function");
    expect(typeof barrel.fetchLatestBlueprintGenerationJob).toBe("function");
    expect(typeof barrel.postBlueprintReplan).toBe("function");
    expect(typeof barrel.getBlueprintFamily).toBe("function");
    expect(typeof barrel.invokeBlueprintCapability).toBe("function");
    expect(typeof barrel.selectBlueprintRoute).toBe("function");
    expect(typeof barrel.reviewBlueprintSpecDocument).toBe("function");
    expect(typeof barrel.generateBlueprintEffectPreview).toBe("function");
    expect(typeof barrel.fetchBlueprintArtifactLedger).toBe("function");
  });
});
