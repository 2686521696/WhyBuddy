import { describe, expect, it, vi } from "vitest";

import {
  createSwitchActiveJobHandler,
  createSwitchActiveNavigationApply,
  executeSwitchActiveJob,
  withActiveJobSearchParam,
} from "../use-switch-active-job";
import { job } from "./version-history-fixtures";

describe("use-switch-active-job", () => {
  it("rejects cross-family jobs and sends toast.error without applying state", async () => {
    const apply = vi.fn();
    const toast = { error: vi.fn() };
    const switchActive = createSwitchActiveJobHandler({
      jobs: [job("root")],
      apply,
      toast,
    });

    await expect(switchActive("external")).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Selected job is outside the current version family."
    );
  });

  it("applies same-family active job state and URL updates", async () => {
    const setActiveJobId = vi.fn();
    const updateUrl = vi.fn((jobId: string) =>
      withActiveJobSearchParam("?history=1", jobId)
    );
    const apply = createSwitchActiveNavigationApply({
      setActiveJobId,
      updateUrl,
    });
    const switchActive = createSwitchActiveJobHandler({
      jobs: [
        job("root"),
        job("branch", { parentJobId: "root", stage: "effect_preview" }),
      ],
      apply,
    });

    await expect(switchActive("branch")).resolves.toBe(true);
    expect(setActiveJobId).toHaveBeenCalledWith("branch");
    expect(updateUrl).toHaveBeenCalledWith("branch");
    expect(withActiveJobSearchParam("?history=1", "branch")).toBe(
      "?history=1&activeJob=branch"
    );
  });

  it("submits through the coordination layer when supplied", async () => {
    const apply = vi.fn();
    const submit = vi.fn(async payload => payload.apply());

    await executeSwitchActiveJob({
      fromJob: job("root", { stage: "spec_docs" }),
      job: job("branch", { stage: "engineering_handoff" }),
      apply,
      coordinator: { submit },
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "switch_active",
        apply: expect.any(Function),
        stageTransition: {
          fromStage: "spec_docs",
          toStage: "engineering_handoff",
        },
        pageTransition: {
          fromPage: 2,
          toPage: 3,
        },
      })
    );
    expect(apply).toHaveBeenCalledWith({
      jobId: "branch",
      stage: "engineering_handoff",
    });
  });

  it("derives switch_active transitions from the current active job to the selected job", async () => {
    const apply = vi.fn();
    const submit = vi.fn(async payload => payload.apply());
    const switchActive = createSwitchActiveJobHandler({
      jobs: [
        job("root", { stage: "spec_docs" }),
        job("branch", { parentJobId: "root", stage: "runtime_capability" }),
      ],
      activeJobId: "root",
      apply,
      coordinator: { submit },
    });

    await expect(switchActive("branch")).resolves.toBe(true);

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "switch_active",
        stageTransition: {
          fromStage: "spec_docs",
          toStage: "runtime_capability",
        },
        pageTransition: {
          fromPage: 2,
          toPage: 3,
        },
      })
    );
    expect(apply).toHaveBeenCalledWith({
      jobId: "branch",
      stage: "runtime_capability",
    });
  });

  it("does not expose spec2/spec3 endpoint calls or backend job-stage mutation", async () => {
    const source = await import("node:fs/promises").then(fs =>
      fs.readFile(
        new URL("../use-switch-active-job.ts", import.meta.url),
        "utf8"
      )
    );

    expect(source).not.toMatch(/\/replan|\/stage-edit|\/jobs\/[^`"']+\/stage/);
    expect(source).not.toMatch(/fetch\(|axios\.|getBlueprintReplan|stage-edit/);
  });
});
