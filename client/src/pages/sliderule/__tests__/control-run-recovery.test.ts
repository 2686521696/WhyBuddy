import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeControlStreamResponse,
  postControlTurnStream,
  resumeControlTurnStream,
} from "../../../lib/sliderule-marathon-driver";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { loadActiveRun, saveActiveRun } from "../active-run-store";

function stream(events: Record<string, unknown>[]) {
  return new Response(
    events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "X-Control-Run-Id": "ctr-1",
      },
    }
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("durable control stream", () => {
  it("uses one caller request identity and resumes with GET without replaying POST", async () => {
    const state = { sessionId: "session-1" } as V5SessionState;
    const fetcher = vi
      .fn()
      .mockImplementation(async () => stream([{ type: "complete", state }]));
    vi.stubGlobal("fetch", fetcher);
    const onControlRunId = vi.fn();
    await postControlTurnStream(state, "Continue", {
      controlRequestId: "request-1",
      onControlRunId,
    });
    expect(fetcher.mock.calls[0][1].headers["X-Control-Request-Id"]).toBe(
      "request-1"
    );
    expect(onControlRunId).toHaveBeenCalledWith("ctr-1");
    await resumeControlTurnStream("ctr-1");
    expect(fetcher.mock.calls[1][0]).toBe(
      "/api/sliderule/control-runs/ctr-1/stream"
    );
    expect(fetcher.mock.calls[1][1].method).toBeUndefined();
    expect(fetcher.mock.calls[1][1].body).toBeUndefined();
  });

  it("deduplicates persisted sequence numbers before applying tool results", async () => {
    const result = {
      type: "control_tool_result",
      tool: "project_create",
      ok: true,
      controlRunId: "ctr-1",
      seq: 1,
    };
    const onControlToolResult = vi.fn();
    const onControlRunId = vi.fn();
    const onRunId = vi.fn();
    await consumeControlStreamResponse(
      stream([
        { type: "control_run_started", controlRunId: "ctr-1" },
        result,
        result,
        {
          type: "complete",
          state: { sessionId: "session-1" },
          controlRunId: "ctr-1",
          seq: 2,
        },
      ]),
      { onControlToolResult, onControlRunId, onRunId }
    );
    expect(onControlToolResult).toHaveBeenCalledTimes(1);
    expect(onControlRunId).toHaveBeenCalledWith("ctr-1");
    expect(onRunId).not.toHaveBeenCalled();
  });

  it("treats an interrupted run as an error without inventing a completed state", async () => {
    const onRunSettled = vi.fn();
    const out = await consumeControlStreamResponse(
      stream([
        {
          type: "control_run_settled",
          status: "interrupted",
          error: "control_reconciliation_required",
        },
      ]),
      { onRunSettled }
    );
    expect(onRunSettled).toHaveBeenCalledWith("error");
    expect(out).toBeNull();
  });

  it("retains the control kind across bookmark reloads", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => data.set(key, value),
      getItem: (key: string) => data.get(key) ?? null,
    });
    saveActiveRun("s1", {
      runId: "ctr-1",
      kind: "control",
      userText: "Continue",
      startedAt: "now",
    });
    expect(loadActiveRun("s1")?.kind).toBe("control");
    saveActiveRun("s2", {
      runId: "factory-1",
      userText: "Continue",
      startedAt: "now",
    });
    expect(loadActiveRun("s2")?.kind).toBeUndefined();
  });

  it.each(["cancelled", "failed", "interrupted"])(
    "does not return a nested factory result when the control run is %s",
    async status => {
      const onRunSettled = vi.fn();
      const out = await consumeControlStreamResponse(stream([
        { type: "control_handoff_factory", runId: "factory-1" },
        { type: "factory_complete", state: { sessionId: "s1" }, stopReason: "completed" },
        { type: "control_run_settled", status },
      ]), { onRunSettled });
      expect(out).toBeNull();
      expect(onRunSettled).toHaveBeenLastCalledWith(status === "cancelled" ? "cancelled" : "error");
      expect(onRunSettled).not.toHaveBeenCalledWith("complete");
    }
  );

  it("cancels a discovered run when resume is stopped before any response", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("Stopped", "AbortError");
    }).mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    expect(await resumeControlTurnStream("discovered-run", { stopSignal: controller.signal })).toBeNull();
    expect(fetcher.mock.calls[1][0]).toBe("/api/sliderule/control-runs/discovered-run");
    expect(fetcher.mock.calls[1][1].method).toBe("DELETE");
    expect(fetcher.mock.calls[1][1].signal).toBeUndefined();
  });

  it("keeps the discovered run alive after an ordinary resume network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetcher);
    expect(await resumeControlTurnStream("discovered-run")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops the submitted request even when abort precedes its first response header", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException("Stopped", "AbortError");
      })
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    await postControlTurnStream(
      { sessionId: "s1" } as V5SessionState,
      "Continue",
      {
        stopSignal: controller.signal,
        controlRequestId: "request-early-stop",
      }
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      "/api/sliderule/control-requests/request-early-stop?sessionId=s1"
    );
    expect(fetcher.mock.calls[1][1].method).toBe("DELETE");
    expect(fetcher.mock.calls[1][1].signal).toBeUndefined();
  });
});
