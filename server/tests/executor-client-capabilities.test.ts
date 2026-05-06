import { describe, expect, it } from "vitest";
import {
  ExecutorClient,
  ExecutorClientError,
  getExecutorCapabilityMismatchReason,
} from "../core/executor-client.js";
import type { ExecutorCapabilitiesResponse } from "../../shared/executor/api.js";
import type {
  ExecutionPlan,
  ExecutorCapabilities,
} from "../../shared/executor/contracts.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createCapabilities(
  capabilities: ExecutorCapabilities["capabilities"] = ["runtime.mock", "artifact.log"],
): ExecutorCapabilities {
  return {
    executor: "lobster",
    service: "lobster-executor",
    version: "2026-03-28",
    timestamp: "2026-05-04T00:00:00.000Z",
    mode: "mock",
    docker: { status: "disconnected", lifecycle: false },
    image: {
      defaultImage: "node:20-slim",
      aiImage: "cube-ai-sandbox:latest",
    },
    capabilities,
    artifactTypes: ["file", "log", "json"],
    previewTypes: ["text", "json"],
    limits: {
      memory: "512m",
      cpus: "1.0",
      pids: 256,
      timeoutMs: 300000,
      maxConcurrentJobs: 2,
    },
    warnings: [],
  };
}

function createPlan(requiredCapabilities: unknown[] = []): ExecutionPlan {
  return {
    version: "2026-03-28",
    missionId: "mission-1",
    summary: "Run test plan",
    objective: "Validate executor capabilities",
    requestedBy: "brain",
    mode: "auto",
    steps: [
      {
        key: "execute",
        label: "Execute",
        description: "Run executor job",
      },
    ],
    jobs: [
      {
        id: "job-1",
        key: "execute",
        label: "Execute",
        description: "Run executor job",
        kind: "execute",
        payload: requiredCapabilities.length > 0 ? { requiredCapabilities } : {},
      },
    ],
  };
}

describe("ExecutorClient.getCapabilities", () => {
  it("returns executor capabilities from the capabilities endpoint", async () => {
    const body: ExecutorCapabilitiesResponse = {
      ok: true,
      capabilities: createCapabilities(),
    };
    const client = new ExecutorClient({
      baseUrl: "http://executor.test",
      callbackUrl: "http://server.test/api/executor/events",
      fetchImpl: async (url) => {
        expect(String(url)).toBe("http://executor.test/api/executor/capabilities");
        return jsonResponse(body);
      },
    });

    await expect(client.getCapabilities()).resolves.toEqual(body.capabilities);
  });

  it("throws protocol errors for malformed capability responses", async () => {
    const client = new ExecutorClient({
      baseUrl: "http://executor.test",
      callbackUrl: "http://server.test/api/executor/events",
      fetchImpl: async () => jsonResponse({ ok: true }),
    });

    await expect(client.getCapabilities()).rejects.toMatchObject({
      name: "ExecutorClientError",
      kind: "protocol",
    } satisfies Partial<ExecutorClientError>);
  });

  it("throws unavailable errors when the capabilities endpoint cannot be reached", async () => {
    const client = new ExecutorClient({
      baseUrl: "http://executor.test",
      callbackUrl: "http://server.test/api/executor/events",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });

    await expect(client.getCapabilities()).rejects.toMatchObject({
      name: "ExecutorClientError",
      kind: "unavailable",
    } satisfies Partial<ExecutorClientError>);
  });

  it("preserves structured executor rejection details", async () => {
    const client = new ExecutorClient({
      baseUrl: "http://executor.test",
      callbackUrl: "http://server.test/api/executor/events",
      fetchImpl: async () =>
        jsonResponse(
          {
            ok: false,
            error: "Executor does not support required capabilities: browser.playwright",
            code: "EXECUTOR_CAPABILITY_UNSUPPORTED",
            unsupportedCapabilities: ["browser.playwright"],
            supportedCapabilities: ["runtime.mock", "artifact.log"],
            hint: "Use cube-ai-agent-sandbox image.",
          },
          400,
        ),
    });

    await expect(client.getCapabilities()).rejects.toMatchObject({
      name: "ExecutorClientError",
      kind: "rejected",
      statusCode: 400,
      details: {
        code: "EXECUTOR_CAPABILITY_UNSUPPORTED",
        unsupportedCapabilities: ["browser.playwright"],
        supportedCapabilities: ["runtime.mock", "artifact.log"],
        hint: "Use cube-ai-agent-sandbox image.",
      },
    } satisfies Partial<ExecutorClientError>);
  });
});

describe("ExecutorClient.dispatchPlan capability errors", () => {
  it("preserves structured executor rejection details from create-job", async () => {
    let callCount = 0;
    const client = new ExecutorClient({
      baseUrl: "http://executor.test",
      callbackUrl: "http://server.test/api/executor/events",
      fetchImpl: async () => {
        callCount += 1;
        if (callCount === 1) {
          return jsonResponse({ status: "ok" });
        }

        return jsonResponse(
          {
            ok: false,
            error: "Executor does not support required capabilities: browser.playwright",
            code: "EXECUTOR_CAPABILITY_UNSUPPORTED",
            unsupportedCapabilities: ["browser.playwright"],
            supportedCapabilities: ["runtime.mock", "artifact.log"],
            hint: "Use cube-ai-agent-sandbox image.",
          },
          400,
        );
      },
      createId: () => "generated-id",
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    });

    await expect(
      client.dispatchPlan(createPlan(["browser.playwright"])),
    ).rejects.toMatchObject({
      name: "ExecutorClientError",
      kind: "rejected",
      statusCode: 400,
      details: {
        code: "EXECUTOR_CAPABILITY_UNSUPPORTED",
        unsupportedCapabilities: ["browser.playwright"],
        supportedCapabilities: ["runtime.mock", "artifact.log"],
        hint: "Use cube-ai-agent-sandbox image.",
      },
    } satisfies Partial<ExecutorClientError>);
  });
});

describe("ExecutorClient.validatePlanCapabilities", () => {
  it("accepts plans when every required capability is supported", async () => {
    const client = new ExecutorClient({
      baseUrl: "http://executor.test",
      callbackUrl: "http://server.test/api/executor/events",
      fetchImpl: async () => {
        throw new Error("fetch should not be called when capabilities are supplied");
      },
    });
    const capabilities = createCapabilities(["runtime.mock", "artifact.log"]);

    await expect(
      client.validatePlanCapabilities(
        createPlan(["runtime.mock", "artifact.log"]),
        capabilities,
      ),
    ).resolves.toEqual(capabilities);
  });

  it("rejects unknown required capability names before dispatch", async () => {
    const client = new ExecutorClient({
      baseUrl: "http://executor.test",
      callbackUrl: "http://server.test/api/executor/events",
    });

    await expect(
      client.validatePlanCapabilities(
        createPlan(["browser.quantum"]),
        createCapabilities(),
      ),
    ).rejects.toMatchObject({
      name: "ExecutorClientError",
      kind: "rejected",
      details: {
        code: "EXECUTOR_CAPABILITY_UNKNOWN",
        unknownCapabilities: ["browser.quantum"],
      },
    } satisfies Partial<ExecutorClientError>);
  });

  it("rejects unsupported required capabilities before dispatch", async () => {
    const client = new ExecutorClient({
      baseUrl: "http://executor.test",
      callbackUrl: "http://server.test/api/executor/events",
    });

    await expect(
      client.validatePlanCapabilities(
        createPlan(["browser.playwright"]),
        createCapabilities(["runtime.mock", "artifact.log"]),
      ),
    ).rejects.toMatchObject({
      name: "ExecutorClientError",
      kind: "rejected",
      details: {
        code: "EXECUTOR_CAPABILITY_UNSUPPORTED",
        unsupportedCapabilities: ["browser.playwright"],
        supportedCapabilities: ["runtime.mock", "artifact.log"],
      },
    } satisfies Partial<ExecutorClientError>);
  });
});

describe("getExecutorCapabilityMismatchReason", () => {
  it("formats unsupported capability errors for mission runtime surfaces", () => {
    const error = new ExecutorClientError(
      "ExecutionPlan requires unsupported executor capabilities: browser.playwright",
      "rejected",
      undefined,
      {
        details: {
          code: "EXECUTOR_CAPABILITY_UNSUPPORTED",
          unsupportedCapabilities: ["browser.playwright"],
          supportedCapabilities: ["runtime.mock"],
          hint: "Switch executor mode/image or remove unsupported requiredCapabilities before dispatch.",
        },
      },
    );

    expect(getExecutorCapabilityMismatchReason(error)).toBe(
      "Executor capability mismatch (EXECUTOR_CAPABILITY_UNSUPPORTED): browser.playwright. Hint: Switch executor mode/image or remove unsupported requiredCapabilities before dispatch.",
    );
  });

  it("ignores non-capability executor errors", () => {
    const error = new ExecutorClientError(
      "Executor is unreachable",
      "unavailable",
    );

    expect(getExecutorCapabilityMismatchReason(error)).toBeUndefined();
  });
});
