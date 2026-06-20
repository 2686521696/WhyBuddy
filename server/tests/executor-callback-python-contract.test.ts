import { describe, expect, it } from "vitest";

import {
  mapExecutorEventToAction,
  normalizePythonExecutorCallbackEvent,
} from "../core/executor-event-mapper.js";
import {
  isBlueprintExecutorMissionId,
  resolveExecutorCallbackRouting,
} from "../core/executor-callback-routing.js";

const basePythonEvent = {
  version: "2026-03-28",
  eventId: "py-evt-001",
  missionId: "mission_python_callback_contract",
  jobId: "job_python_callback_contract",
  executor: "python-slide-rule",
  type: "job.progress",
  status: "running",
  occurredAt: "2026-06-20T10:00:00.000Z",
  message: "Python executor callback event",
  progress: 42,
  delivery: {
    sequence: 1,
    attempt: 1,
    duplicate: false,
    outOfOrder: false,
  },
} as const;

describe("executor callback Python contract", () => {
  it("maps a Python progress callback into existing callback action routing", () => {
    const normalized = normalizePythonExecutorCallbackEvent({
      ...basePythonEvent,
      eventId: "py-evt-progress",
      type: "job.progress",
      status: "running",
      progress: 64,
      message: "Python executor progress",
      delivery: {
        sequence: 7,
        attempt: 1,
        duplicate: false,
        outOfOrder: false,
      },
    });

    expect(normalized).toMatchObject({
      eventId: "py-evt-progress",
      missionId: "mission_python_callback_contract",
      jobId: "job_python_callback_contract",
      type: "job.progress",
      status: "running",
      progress: 64,
      callbackSource: "python",
      delivery: {
        sequence: 7,
        attempt: 1,
        duplicate: false,
        outOfOrder: false,
      },
    });
    expect(mapExecutorEventToAction(normalized)).toEqual({
      action: "progress",
      progress: 64,
    });
  });

  it("maps Python success and error callbacks to existing terminal actions", () => {
    const success = normalizePythonExecutorCallbackEvent({
      ...basePythonEvent,
      eventId: "py-evt-success",
      type: "job.completed",
      status: "completed",
      progress: 100,
      message: "Python executor completed",
      summary: "All callback work finished.",
    });
    const failure = normalizePythonExecutorCallbackEvent({
      ...basePythonEvent,
      eventId: "py-evt-error",
      type: "job.failed",
      status: "failed",
      progress: 73,
      message: "Python executor failed",
      detail: "Callback contract failure path.",
      errorCode: "PY_CALLBACK_CONTRACT_FAILURE",
    });

    expect(mapExecutorEventToAction(success)).toEqual({
      action: "done",
      summary: "All callback work finished.",
    });
    expect(mapExecutorEventToAction(failure)).toEqual({
      action: "failed",
      error: "Callback contract failure path.",
    });
  });

  it("does not let duplicate Python callbacks forge a successful completion", () => {
    const duplicateTerminal = normalizePythonExecutorCallbackEvent({
      ...basePythonEvent,
      eventId: "py-evt-success",
      type: "job.completed",
      status: "completed",
      progress: 100,
      message: "Duplicate terminal callback replay",
      delivery: {
        sequence: 8,
        attempt: 2,
        duplicate: true,
        outOfOrder: false,
      },
    });

    expect(duplicateTerminal).toMatchObject({
      type: "job.completed",
      status: "completed",
      delivery: {
        sequence: 8,
        attempt: 2,
        duplicate: true,
        outOfOrder: false,
      },
    });
    expect(mapExecutorEventToAction(duplicateTerminal)).toEqual({
      action: "duplicate",
      reason: "duplicate",
    });
  });

  it("does not let out-of-order Python callbacks forge a successful completion", () => {
    const outOfOrderTerminal = normalizePythonExecutorCallbackEvent({
      ...basePythonEvent,
      eventId: "py-evt-late-success",
      type: "job.completed",
      status: "completed",
      progress: 100,
      message: "Late terminal callback",
      delivery: {
        sequence: 4,
        attempt: 1,
        duplicate: false,
        outOfOrder: true,
      },
    });

    expect(mapExecutorEventToAction(outOfOrderTerminal)).toEqual({
      action: "duplicate",
      reason: "out_of_order",
    });
  });

  it("routes Python blueprint callback mission ids through the existing blueprint branch", () => {
    const blueprint = normalizePythonExecutorCallbackEvent({
      ...basePythonEvent,
      missionId: "blueprint-job-2de22800-3b5f-403e-9089-5949cf0271f8",
      eventId: "py-evt-blueprint",
      type: "job.progress",
      status: "running",
    });

    expect(isBlueprintExecutorMissionId(blueprint.missionId)).toBe(true);
    expect(resolveExecutorCallbackRouting(blueprint)).toEqual({
      route: "blueprint",
      missionId: "blueprint-job-2de22800-3b5f-403e-9089-5949cf0271f8",
      jobId: "job_python_callback_contract",
      eventId: "py-evt-blueprint",
      callbackSource: "python",
      terminal: false,
      ignoredTerminal: false,
    });
  });
});
