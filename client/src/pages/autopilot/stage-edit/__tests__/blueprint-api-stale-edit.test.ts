import { afterEach, describe, expect, it, vi } from "vitest";

import { saveBlueprintClarificationAnswers } from "../../../../lib/blueprint-api/clarification";
import { selectBlueprintRoute } from "../../../../lib/blueprint-api/routeset";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stage-edit blueprint-api staleEdit parsing", () => {
  it("preserves staleEdit on clarification answer saves", async () => {
    const payload = {
      session: { id: "session-1", answers: [] },
      staleEdit: {
        fromStage: "clarification",
        newlyStaleArtifactIds: ["artifact-spec"],
        newlyStaleArtifactCount: 1,
        staleArtifactIdsSnapshot: ["artifact-spec"],
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await saveBlueprintClarificationAnswers("session/1", {
      answers: [],
    });

    expect(result).toEqual({
      ok: true,
      data: {
        intake: undefined,
        session: payload.session,
        clarificationSession: payload.session,
        projectContext: undefined,
        staleEdit: payload.staleEdit,
      },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/blueprint/clarifications/session%2F1/answers",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("preserves staleEdit on route reselection responses", async () => {
    const payload = {
      job: { id: "job-1" },
      routeSet: { id: "routes" },
      selection: { id: "selection-1" },
      specTree: { id: "tree-1" },
      staleEdit: {
        fromStage: "route_generation",
        newlyStaleArtifactIds: ["artifact-docs"],
        newlyStaleArtifactCount: 1,
        staleArtifactIdsSnapshot: ["artifact-docs"],
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await selectBlueprintRoute("job/1", {
      routeId: "route-a",
    });

    expect(result).toEqual({ ok: true, data: payload });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/blueprint/jobs/job%2F1/route-selection",
      expect.objectContaining({ method: "POST" })
    );
  });
});
