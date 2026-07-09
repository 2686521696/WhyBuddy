import { describe, expect, it, vi } from "vitest";

import { runInlineEditFlow } from "../use-inline-edit-flow";

describe("runInlineEditFlow", () => {
  it("submits and wraps refresh plus toast payload in coordinator.submit", async () => {
    const calls: string[] = [];
    const submitEdit = vi.fn(async () => {
      calls.push("submit");
      return { staleEdit: { newlyStaleArtifactCount: 2 } };
    });
    const refreshJob = vi.fn(async () => {
      calls.push("refresh");
    });
    const coordinator = {
      submit: vi.fn(async submission => {
        calls.push("coordinate");
        await submission.apply();
        return { ok: true };
      }),
    };
    const toastQueue = { push: vi.fn() };

    await runInlineEditFlow({
      submitEdit,
      refreshJob,
      coordinator,
      toastQueue,
    });

    expect(calls).toEqual(["submit", "coordinate", "refresh"]);
    expect(coordinator.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "inline_edit",
        apply: expect.any(Function),
        toastPayload: {
          key: "inline_edit.saved",
          level: "info",
          message: "Saved edit. 2 downstream artifacts marked stale.",
        },
      })
    );
    expect(coordinator.submit.mock.calls[0][0]).not.toHaveProperty(
      "pageTransition"
    );
    expect(coordinator.submit.mock.calls[0][0]).not.toHaveProperty(
      "stageTransition"
    );
    expect(toastQueue.push).not.toHaveBeenCalled();
  });

  it("passes the submit result into the coordinated refresh apply", async () => {
    const result = { staleEdit: { newlyStaleArtifactCount: 3 } };
    const refreshJob = vi.fn();
    const coordinator = {
      submit: vi.fn(submission => {
        submission.apply();
        return { ok: true };
      }),
    };

    await runInlineEditFlow({
      submitEdit: async () => result,
      refreshJob,
      coordinator,
    });

    expect(refreshJob).toHaveBeenCalledWith(result);
  });

  it("emits the simple saved toast when the response has no stale summary", async () => {
    const toastQueue = { push: vi.fn() };

    await runInlineEditFlow({
      submitEdit: async () => ({}),
      refreshJob: async () => undefined,
      toastQueue,
    });

    expect(toastQueue.push).toHaveBeenCalledTimes(1);
    expect(toastQueue.push).toHaveBeenCalledWith({
      tone: "success",
      message: "Saved edit.",
    });
  });

  it("does not call resetPin or mutate workflowStageOverride when extra deps are present", async () => {
    const resetPin = vi.fn();
    const workflowState = { workflowStageOverride: "spec_documents" };

    await runInlineEditFlow({
      submitEdit: async () => ({}),
      refreshJob: async () => undefined,
      resetPin,
      workflowState,
    } as Parameters<typeof runInlineEditFlow>[0] & {
      resetPin: () => void;
      workflowState: { workflowStageOverride: string };
    });

    expect(resetPin).not.toHaveBeenCalled();
    expect(workflowState.workflowStageOverride).toBe("spec_documents");
  });
});
