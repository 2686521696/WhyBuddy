import { describe, expect, it } from "vitest";

import {
  A2A_ERROR_CODES,
  A2A_PYTHON_RUNTIME_CONTRACT_VERSION,
  type A2AEnvelope,
  isA2APythonRuntimeResult,
} from "../../../shared/a2a-protocol.js";

function envelope(method: A2AEnvelope["method"] = "a2a.stream"): A2AEnvelope {
  return {
    jsonrpc: "2.0",
    method,
    id: "a2a-stream-boundary-1",
    params: {
      targetAgent: "stream-boundary-agent",
      task: "Project a stream runtime envelope",
      context: "Runtime boundary only.",
      capabilities: ["stream"],
      streamMode: method === "a2a.stream",
    },
    auth: "stream-token",
  };
}

function baseRuntime(operation: string, payload: Record<string, unknown>) {
  return {
    contractVersion: A2A_PYTHON_RUNTIME_CONTRACT_VERSION,
    runtime: "python-contract",
    operation,
    ...payload,
  };
}

describe("A2A Python stream runtime boundary", () => {
  it("accepts running and completed stream chunks without starting transport", () => {
    const runningChunk = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      chunk: "first partial chunk",
      done: false,
    };
    const completedChunk = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      chunk: "",
      done: true,
    };
    const running = baseRuntime("stream_chunk", {
      ok: true,
      status: "streaming",
      envelope: envelope(),
      streamChunk: runningChunk,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope(),
        status: "running",
        frameworkType: "custom",
        startedAt: 1710000000000,
        streamChunks: [runningChunk],
      },
    });
    const completed = baseRuntime("stream_chunk", {
      ok: true,
      status: "completed",
      envelope: envelope(),
      streamChunk: completedChunk,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope(),
        status: "completed",
        frameworkType: "custom",
        startedAt: 1710000000000,
        completedAt: 1710000000002,
        streamChunks: [completedChunk],
      },
    });

    expect(isA2APythonRuntimeResult(running)).toBe(true);
    expect(isA2APythonRuntimeResult(completed)).toBe(true);
  });

  it("rejects partial stream chunks that masquerade as completed", () => {
    const partialChunk = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      chunk: "still running",
      done: false,
    };
    const partialAsCompleted = baseRuntime("stream_chunk", {
      ok: true,
      status: "completed",
      envelope: envelope(),
      streamChunk: partialChunk,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope(),
        status: "completed",
        frameworkType: "custom",
        startedAt: 1710000000000,
        completedAt: 1710000000001,
        streamChunks: [partialChunk],
      },
    });

    expect(isA2APythonRuntimeResult(partialAsCompleted)).toBe(false);
  });

  it("accepts failed stream envelopes and rejects failed-as-completed output", () => {
    const error = {
      code: A2A_ERROR_CODES.FRAMEWORK_ERROR,
      message: "Python stream runtime boundary failed.",
      data: { phase: "stream" },
    };
    const response = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      error,
    };
    const failed = baseRuntime("stream_chunk", {
      ok: false,
      status: "failed",
      envelope: envelope(),
      error,
      response,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope(),
        status: "failed",
        frameworkType: "custom",
        startedAt: 1710000000000,
        completedAt: 1710000000003,
        response,
        streamChunks: [],
      },
    });
    const failedAsCompleted = {
      ...failed,
      ok: true,
      status: "completed",
      response: {
        jsonrpc: "2.0",
        id: "a2a-stream-boundary-1",
        result: { output: "not allowed", artifacts: [], metadata: {} },
      },
    };

    expect(isA2APythonRuntimeResult(failed)).toBe(true);
    expect(isA2APythonRuntimeResult(failedAsCompleted)).toBe(false);
  });

  it("accepts cancelled envelopes and rejects cancelled-as-completed output", () => {
    const error = {
      code: A2A_ERROR_CODES.CANCELLED,
      message: "A2A session cancelled.",
    };
    const response = {
      jsonrpc: "2.0" as const,
      id: "a2a-stream-boundary-1",
      error,
    };
    const cancelled = baseRuntime("cancel", {
      ok: false,
      status: "cancelled",
      envelope: envelope("a2a.cancel"),
      error,
      response,
      session: {
        sessionId: "a2a-stream-boundary-1",
        requestEnvelope: envelope("a2a.cancel"),
        status: "cancelled",
        frameworkType: "custom",
        startedAt: 1710000000000,
        completedAt: 1710000000004,
        response,
        streamChunks: [],
      },
    });
    const cancelledAsCompleted = {
      ...cancelled,
      ok: true,
      status: "completed",
      response: {
        jsonrpc: "2.0",
        id: "a2a-stream-boundary-1",
        result: { output: "not allowed", artifacts: [], metadata: {} },
      },
    };

    expect(isA2APythonRuntimeResult(cancelled)).toBe(true);
    expect(isA2APythonRuntimeResult(cancelledAsCompleted)).toBe(false);
  });
});
