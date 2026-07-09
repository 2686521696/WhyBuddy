import { afterEach, describe, expect, it, vi } from "vitest";

import { BlueprintReplanError } from "@/lib/blueprint-api/replan";
import { useReplanFlow } from "../use-replan-flow";
import type { ReplanImpact } from "../types";

const impact: ReplanImpact = {
  artifactIds: ["requirements", "preview"],
  artifactCount: 2,
  stages: ["spec_docs", "effect_preview"],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("useReplanFlow", () => {
  it("posts an in-place replan and delegates the centralized apply callback", async () => {
    const postReplan = vi.fn().mockResolvedValue({
      mode: "in_place",
      job: { id: "job-1", stage: "spec_tree" },
    });
    const refreshJob = vi.fn().mockResolvedValue(undefined);
    const applyInPlace = vi.fn();
    const activeJob = vi.fn();

    const flow = useReplanFlow({
      postReplan,
      refreshJob,
      applyNavigation: { applyInPlace, activeJob },
    });

    const result = await flow.confirmReplan({
      jobId: "job-1",
      fromStage: "spec_tree",
      mode: "in_place",
      reason: "Regenerate docs after route edits",
      impact,
    });

    expect(postReplan).toHaveBeenCalledWith(
      {
        jobId: "job-1",
        fromStage: "spec_tree",
        mode: "in_place",
        reason: "Regenerate docs after route edits",
        impactArtifactIds: ["requirements", "preview"],
      },
      { signal: expect.any(AbortSignal) }
    );
    expect(refreshJob).toHaveBeenCalledWith("job-1");
    expect(applyInPlace).toHaveBeenCalledWith(result);
    expect(activeJob).not.toHaveBeenCalled();
  });

  it("posts a branch replan and activates the returned branch job", async () => {
    const postReplan = vi.fn().mockResolvedValue({
      mode: "branch",
      job: { id: "job-branch", stage: "spec_tree" },
    });
    const applyInPlace = vi.fn();
    const activeJob = vi.fn();

    const flow = useReplanFlow({
      postReplan,
      refreshJob: undefined,
      applyNavigation: { applyInPlace, activeJob },
    });

    const result = await flow.confirmReplan({
      jobId: "job-1",
      fromStage: "spec_tree",
      mode: "branch",
      reason: "Explore safer branch",
      impact,
    });

    expect(postReplan).toHaveBeenCalledWith(
      {
        jobId: "job-1",
        fromStage: "spec_tree",
        mode: "branch",
        reason: "Explore safer branch",
        impactArtifactIds: ["requirements", "preview"],
      },
      { signal: expect.any(AbortSignal) }
    );
    expect(activeJob).toHaveBeenCalledWith("job-branch", result);
    expect(applyInPlace).not.toHaveBeenCalled();
  });

  it('adds triggerSource: "replan" when a coordinator is supplied and delegates toast status to the coordinator', async () => {
    const postReplan = vi.fn().mockResolvedValue({
      mode: "in_place",
      job: { id: "job-1", stage: "effect_preview" },
    });
    const submit = vi.fn(submission => {
      submission.apply();
      return { ok: true };
    });
    const coordinator = { submit };
    const toastQueue = { push: vi.fn() };
    const applyInPlace = vi.fn();

    const flow = useReplanFlow({
      postReplan,
      refreshJob: undefined,
      applyNavigation: { applyInPlace, activeJob: () => {} },
      coordinator,
      toastQueue,
    });

    await flow.confirmReplan({
      jobId: "job-1",
      fromStage: "effect_preview",
      mode: "in_place",
      reason: "",
      impact,
    });

    expect(postReplan).toHaveBeenCalledWith(
      {
        jobId: "job-1",
        fromStage: "effect_preview",
        mode: "in_place",
        reason: "",
        impactArtifactIds: ["requirements", "preview"],
        triggerSource: "replan",
      },
      { signal: expect.any(AbortSignal) }
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "replan",
        toastPayload: {
          key: "replan.in_place.job-1",
          level: "info",
          message: "2 downstream artifacts queued for regeneration.",
        },
      })
    );
    expect(toastQueue.push).not.toHaveBeenCalled();
  });

  it("wraps branch success state updates in coordinator.submit and appends branch index before switching active", async () => {
    const postReplan = vi.fn().mockResolvedValue({
      mode: "branch",
      job: { id: "job-branch", stage: "spec_tree" },
    });
    const submit = vi.fn(submission => {
      submission.apply();
      return { ok: true };
    });
    const branchIndex = { append: vi.fn() };
    const activeJob = vi.fn();

    const flow = useReplanFlow({
      postReplan,
      applyNavigation: { applyInPlace: vi.fn(), activeJob },
      branchIndex,
      coordinator: { submit },
    });

    const result = await flow.confirmReplan({
      jobId: "job-parent",
      fromStage: "spec_tree",
      mode: "branch",
      reason: "Explore branch",
      impact,
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "replan",
        apply: expect.any(Function),
        toastPayload: expect.objectContaining({
          key: "replan.branch.job-branch",
          level: "info",
        }),
      })
    );
    expect(branchIndex.append).toHaveBeenCalledWith("job-parent", "job-branch");
    expect(activeJob).toHaveBeenCalledWith("job-branch", result);
  });

  it("passes stage and page transitions into coordinator.submit when provided", async () => {
    const postReplan = vi.fn().mockResolvedValue({
      mode: "branch",
      job: { id: "job-branch", stage: "spec_tree" },
    });
    const submit = vi.fn(submission => {
      submission.apply();
      return { ok: true };
    });
    const getCoordinationTransitions = vi.fn(() => ({
      stageTransition: {
        fromStage: "effect_preview",
        toStage: "spec_tree",
      },
      pageTransition: {
        fromPage: 3,
        toPage: 2,
      },
    }));

    const flow = useReplanFlow({
      postReplan,
      applyNavigation: { applyInPlace: vi.fn(), activeJob: vi.fn() },
      coordinator: { submit },
      getCoordinationTransitions,
    });

    const result = await flow.confirmReplan({
      jobId: "job-parent",
      fromStage: "effect_preview",
      mode: "branch",
      reason: "Move back to spec tree",
      impact,
    });

    expect(getCoordinationTransitions).toHaveBeenCalledWith(
      expect.objectContaining({ fromStage: "effect_preview", mode: "branch" }),
      result
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "replan",
        stageTransition: {
          fromStage: "effect_preview",
          toStage: "spec_tree",
        },
        pageTransition: {
          fromPage: 3,
          toPage: 2,
        },
      })
    );
  });

  it("keeps coordinator apply synchronous so atomic refresh can commit the replan navigation", async () => {
    const postReplan = vi.fn().mockResolvedValue({
      mode: "branch",
      job: { id: "job-branch", stage: "spec_tree" },
    });
    const submit = vi.fn(submission => {
      const applyResult = submission.apply();
      expect(applyResult).toBeUndefined();
      return { ok: true };
    });

    const flow = useReplanFlow({
      postReplan,
      applyNavigation: {
        applyInPlace: vi.fn(),
        activeJob: vi.fn(),
      },
      coordinator: { submit },
    });

    await flow.confirmReplan({
      jobId: "job-parent",
      fromStage: "effect_preview",
      mode: "branch",
      reason: "Move back to spec tree",
      impact,
    });

    expect(submit).toHaveBeenCalledOnce();
  });

  it("propagates BlueprintReplanError for 4xx responses without applying store changes", async () => {
    const error = new BlueprintReplanError({
      kind: "error",
      source: "http",
      endpoint: "/api/blueprint/jobs/job-1/replan",
      message: "running downstream",
      detail:
        "The request completed, but the server reported an application error.",
      retryable: false,
      status: 409,
    });
    const postReplan = vi.fn().mockRejectedValue(error);
    const applyInPlace = vi.fn();
    const activeJob = vi.fn();

    const flow = useReplanFlow({
      postReplan,
      applyNavigation: { applyInPlace, activeJob },
    });

    await expect(
      flow.confirmReplan({
        jobId: "job-1",
        fromStage: "spec_tree",
        mode: "in_place",
        reason: "",
        impact,
      })
    ).rejects.toBe(error);

    expect(applyInPlace).not.toHaveBeenCalled();
    expect(activeJob).not.toHaveBeenCalled();
  });

  it("aborts the replan request after 30 seconds", async () => {
    vi.useFakeTimers();
    const postReplan = vi.fn(
      (_request, options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError")
            );
          });
        })
    );
    const flow = useReplanFlow({
      postReplan,
      applyNavigation: { applyInPlace: vi.fn(), activeJob: vi.fn() },
    });

    const pending = flow.confirmReplan({
      jobId: "job-1",
      fromStage: "spec_tree",
      mode: "in_place",
      reason: "",
      impact,
    });

    const assertion = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
    expect(postReplan.mock.calls[0][1]?.signal.aborted).toBe(true);
  });
});
