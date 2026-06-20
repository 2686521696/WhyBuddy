import { describe, expect, it } from "vitest";

import {
  isBlueprintExecutorMissionId,
  resolveExecutorCallbackRouting,
} from "../core/executor-callback-routing.js";

describe("executor callback routing", () => {
  it("accepts both blueprint callback mission id formats", () => {
    expect(isBlueprintExecutorMissionId("blueprint:job-real")).toBe(true);
    expect(
      isBlueprintExecutorMissionId(
        "blueprint-job-2de22800-3b5f-403e-9089-5949cf0271f8",
      ),
    ).toBe(true);
  });

  it("does not classify regular mission ids as blueprint callbacks", () => {
    expect(isBlueprintExecutorMissionId("mission_mnw0brh6_gs7jnj")).toBe(false);
    expect(isBlueprintExecutorMissionId("")).toBe(false);
  });

  it("keeps mission callbacks on the mission route", () => {
    expect(
      resolveExecutorCallbackRouting({
        eventId: "evt-regular",
        missionId: "mission_mnw0brh6_gs7jnj",
        jobId: "job-regular",
        type: "job.progress",
        status: "running",
      }),
    ).toEqual({
      route: "mission",
      missionId: "mission_mnw0brh6_gs7jnj",
      jobId: "job-regular",
      eventId: "evt-regular",
      callbackSource: "node",
      terminal: false,
      ignoredTerminal: false,
    });
  });

  it("marks duplicate terminal callbacks as ignored terminal routing metadata", () => {
    expect(
      resolveExecutorCallbackRouting({
        eventId: "evt-replay",
        missionId: "mission_mnw0brh6_gs7jnj",
        jobId: "job-regular",
        type: "job.completed",
        status: "completed",
        callbackSource: "python",
        delivery: {
          sequence: 9,
          attempt: 2,
          duplicate: true,
          outOfOrder: false,
        },
      }),
    ).toMatchObject({
      route: "mission",
      callbackSource: "python",
      terminal: true,
      ignoredTerminal: true,
    });
  });
});
