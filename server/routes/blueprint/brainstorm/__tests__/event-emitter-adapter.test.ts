import { describe, expect, it, vi } from "vitest";

import { createEventEmitterAdapter } from "../event-emitter-adapter";

describe("createEventEmitterAdapter", () => {
  it("uses payload stageId as the envelope stage when adapter stage is empty", () => {
    const emit = vi.fn();
    const adapter = createEventEmitterAdapter({
      eventBus: { emit },
      logger: { warn: vi.fn() },
      jobId: "",
      stage: "",
    });

    adapter("brainstorm.session.started", {
      jobId: "job-1",
      stageId: "spec_docs",
      sessionId: "session-1",
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        stage: "spec_docs",
        type: "brainstorm.session.started",
        family: "brainstorm",
      }),
    );
  });
});
