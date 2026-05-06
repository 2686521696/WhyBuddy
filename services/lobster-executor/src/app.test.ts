import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { CreateExecutorJobResponse } from "../../../shared/executor/api.js";
import type { ExecutorJobRequest } from "../../../shared/executor/contracts.js";
import { createLobsterExecutorApp } from "./app.js";
import { createLobsterExecutorService } from "./service.js";
import type {
  LobsterExecutorCapabilitiesResponse,
  LobsterExecutorHealthResponse,
  LobsterExecutorJobDetailResponse,
  LobsterExecutorSandboxSkillsResponse,
  StoredJobRecord,
} from "./types.js";

interface TestHarness {
  baseUrl: string;
  close: () => Promise<void>;
}

const cleanupTasks: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

function createTestRequest(
  jobId: string,
  outcome: "success" | "failed"
): ExecutorJobRequest {
  const missionId = `mission-${jobId}`;
  return {
    version: "2026-03-28",
    requestId: `req-${jobId}`,
    missionId,
    jobId,
    executor: "lobster",
    createdAt: new Date().toISOString(),
    traceId: randomUUID(),
    idempotencyKey: `idem-${jobId}`,
    plan: {
      version: "2026-03-28",
      missionId,
      summary: `Mock execution for ${jobId}`,
      objective: "Verify lobster executor first-phase endpoints",
      requestedBy: "brain",
      mode: "auto",
      steps: [
        {
          key: "dispatch",
          label: "Dispatch",
          description: "Accept the execution request",
        },
      ],
      jobs: [
        {
          id: jobId,
          key: `job-${jobId}`,
          label: `Job ${jobId}`,
          description: "Run mock executor flow",
          kind: "execute",
          payload: {
            runner: {
              kind: "mock",
              outcome,
              steps: 2,
              delayMs: 10,
              logs: ["Booting mock runner", "Finishing mock runner"],
              summary:
                outcome === "success"
                  ? "Mock success path finished"
                  : "Mock failure path finished",
            },
          },
        },
      ],
    },
    callback: {
      eventsUrl: "http://localhost:3999/api/executor/events",
      auth: {
        scheme: "hmac-sha256",
        executorHeader: "x-cube-executor-id",
        timestampHeader: "x-cube-executor-timestamp",
        signatureHeader: "x-cube-executor-signature",
        signedPayload: "timestamp.rawBody",
      },
    },
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function createHarness(): Promise<TestHarness> {
  const dataRoot = join(tmpdir(), `lobster-executor-${randomUUID()}`);
  const service = createLobsterExecutorService({ dataRoot });
  const app = createLobsterExecutorApp(service);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }

  const close = async () => {
    await closeServer(server);
    rmSync(dataRoot, { recursive: true, force: true });
  };
  cleanupTasks.push(close);

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close,
  };
}

async function createHarnessWithConfig(
  config: Parameters<typeof createLobsterExecutorService>[0]["config"],
): Promise<TestHarness> {
  const dataRoot = join(tmpdir(), `lobster-executor-config-${randomUUID()}`);
  const service = createLobsterExecutorService({ dataRoot, config });
  const app = createLobsterExecutorApp(service);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }

  const close = async () => {
    await closeServer(server);
    rmSync(dataRoot, { recursive: true, force: true });
  };
  cleanupTasks.push(close);

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close,
  };
}

async function createSeededHarness(
  status: StoredJobRecord["status"] = "queued"
): Promise<TestHarness & { jobId: string }> {
  const dataRoot = join(tmpdir(), `lobster-executor-seeded-${randomUUID()}`);
  const request = createTestRequest(`seeded-${randomUUID()}`, "success");
  const receivedAt = new Date().toISOString();
  const dataDirectory = join(dataRoot, "jobs", request.missionId, request.jobId);
  const logFile = join(dataDirectory, "executor.log");

  rmSync(dataRoot, { recursive: true, force: true });
  const seededService = createLobsterExecutorService({ dataRoot });
  const record: StoredJobRecord = {
    acceptedResponse: {
      ok: true,
      accepted: true,
      requestId: request.requestId,
      missionId: request.missionId,
      jobId: request.jobId,
      receivedAt,
    },
    request,
    planJob: request.plan.jobs[0],
    status,
    progress: status === "running" ? 42 : 0,
    message: `Job is ${status}`,
    receivedAt,
    artifacts: [],
    events: [],
    dataDirectory,
    logFile,
    executionMode: "mock",
  };

  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(logFile, "", "utf-8");
  (
    seededService as unknown as { jobs: Map<string, StoredJobRecord> }
  ).jobs.set(request.jobId, record);

  const app = createLobsterExecutorApp(seededService);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }

  const close = async () => {
    await closeServer(server);
    rmSync(dataRoot, { recursive: true, force: true });
  };
  cleanupTasks.push(close);

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close,
    jobId: request.jobId,
  };
}

async function waitForJob(
  baseUrl: string,
  jobId: string
): Promise<LobsterExecutorJobDetailResponse["job"]> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/executor/jobs/${jobId}`);
    const body = (await response.json()) as LobsterExecutorJobDetailResponse;
    if (["completed", "failed", "cancelled"].includes(body.job.status)) {
      return body.job;
    }

    await new Promise(resolve => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out while waiting for executor job ${jobId}`);
}

describe("lobster executor app", () => {
  it("returns a health snapshot with queue stats", async () => {
    const harness = await createHarness();

    const response = await fetch(`${harness.baseUrl}/health`);
    const body = (await response.json()) as LobsterExecutorHealthResponse;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.queue.total).toBe(0);
    expect(body.features.createJob).toBe(true);
    expect(body.capabilitiesSummary.total).toBeGreaterThan(0);
  });

  it("returns executor capabilities", async () => {
    const harness = await createHarness();

    const response = await fetch(`${harness.baseUrl}/api/executor/capabilities`);
    const body = (await response.json()) as LobsterExecutorCapabilitiesResponse;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.capabilities.executor).toBe("lobster");
    expect(body.capabilities.mode).toBe("mock");
    expect(body.capabilities.capabilities).toContain("runtime.mock");
    expect(body.capabilities.skills?.count).toBeGreaterThanOrEqual(2);
    expect(body.capabilities.skills?.capabilityIndex["browser.playwright"]).toContain(
      "browser-research@0.1.0",
    );
  });

  it("returns sandbox skills", async () => {
    const harness = await createHarness();

    const response = await fetch(`${harness.baseUrl}/api/executor/skills`);
    const body = (await response.json()) as LobsterExecutorSandboxSkillsResponse;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.skills.map(skill => skill.name)).toContain("browser-research");
    expect(body.skills.map(skill => skill.name)).toContain("document-render");
    expect(body.capabilityIndex["document.pandoc"]).toContain(
      "document-render@0.1.0",
    );
  });

  it("accepts and completes a mock success job", async () => {
    const harness = await createHarness();
    const request = createTestRequest("success-job", "success");

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const accepted = (await response.json()) as CreateExecutorJobResponse;

    expect(response.status).toBe(202);
    expect(accepted.accepted).toBe(true);

    const job = await waitForJob(harness.baseUrl, request.jobId);
    expect(job.status).toBe("completed");
    expect(job.summary).toContain("success");
    expect(job.artifacts.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts jobs when required capabilities are supported", async () => {
    const harness = await createHarness();
    const request = createTestRequest("capability-supported-job", "success");
    request.plan.jobs[0].payload = {
      ...(request.plan.jobs[0].payload || {}),
      requiredCapabilities: ["runtime.mock", "artifact.log"],
    };

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(202);
    const job = await waitForJob(harness.baseUrl, request.jobId);
    expect(job.status).toBe("completed");
  });

  it("rejects jobs when required capabilities are unsupported", async () => {
    const harness = await createHarness();
    const request = createTestRequest("capability-unsupported-job", "success");
    request.plan.jobs[0].payload = {
      ...(request.plan.jobs[0].payload || {}),
      requiredCapabilities: ["browser.playwright"],
    };

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as {
      code?: string;
      unsupportedCapabilities?: string[];
      supportedCapabilities?: string[];
    };

    expect(response.status).toBe(400);
    expect(body.code).toBe("EXECUTOR_CAPABILITY_UNSUPPORTED");
    expect(body.unsupportedCapabilities).toEqual(["browser.playwright"]);
    expect(body.supportedCapabilities).toContain("runtime.mock");
  });

  it("rejects skill jobs that require network while strict mode is active", async () => {
    const dataRoot = join(tmpdir(), `lobster-executor-strict-${randomUUID()}`);
    const harness = await createHarnessWithConfig({
      host: "127.0.0.1",
      port: 0,
      dataRoot,
      serviceName: "lobster-executor",
      executionMode: "real",
      defaultImage: "cube-ai-agent-sandbox:latest",
      maxConcurrentJobs: 1,
      callbackSecret: "",
      aiImage: "cube-ai-agent-sandbox:latest",
      skillRoot: "services/lobster-executor/skills",
      securityLevel: "strict",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    });
    const request = createTestRequest("strict-skill-job", "success");
    request.plan.jobs[0].payload = {
      image: "cube-ai-agent-sandbox:latest",
      requiredCapabilities: ["browser.playwright", "artifact.image"],
      skillRef: { name: "browser-research", version: "0.1.0" },
      skillInput: { url: "https://example.com" },
    };

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("requires network access");
  });

  it("accepts safe skill jobs when skill capabilities match", async () => {
    const harness = await createHarness();
    const request = createTestRequest("safe-skill-job", "success");
    request.plan.jobs[0].payload = {
      requiredCapabilities: ["artifact.json", "preview.json"],
      skillRef: { name: "document-render", version: "0.1.0" },
      skillInput: {
        title: "Spec preview",
        markdown: "# Spec preview\n\nA document-render skill input.",
      },
    };

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(202);
    const job = await waitForJob(harness.baseUrl, request.jobId);
    expect(job.status).toBe("completed");
  });

  it("auto-selects a sandbox skill by required capabilities", async () => {
    const harness = await createHarness();
    const request = createTestRequest("auto-select-skill-job", "success");
    request.plan.jobs[0].payload = {
      requiredCapabilities: ["artifact.json", "preview.json"],
      skillPolicy: { autoSelect: true },
      skillInput: {
        title: "Auto-selected document",
        markdown: "# Auto-selected document",
      },
    };

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(202);
    const job = await waitForJob(harness.baseUrl, request.jobId);
    expect(job.status).toBe("completed");
  });

  it("surfaces a clear missing-skill reason for auto selection", async () => {
    const harness = await createHarness();
    const request = createTestRequest("missing-auto-skill-job", "success");
    request.plan.jobs[0].payload = {
      requiredCapabilities: ["artifact.log", "preview.text"],
      skillPolicy: { autoSelect: true },
      skillInput: {},
    };

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("No sandbox skill matches required capabilities");
    expect(body.error).toContain("artifact.log");
  });

  it("delivers mock job callbacks to the configured events URL", async () => {
    const callbackEvents: Array<{ type?: string; status?: string }> = [];
    const callbackServer = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
      }
      callbackEvents.push(JSON.parse(body).event);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    callbackServer.listen(0, "127.0.0.1");
    await once(callbackServer, "listening");
    cleanupTasks.push(() => closeServer(callbackServer));

    const callbackAddress = callbackServer.address();
    if (!callbackAddress || typeof callbackAddress === "string") {
      throw new Error("Callback server did not expose a TCP address");
    }

    const harness = await createHarness();
    const request = createTestRequest("callback-job", "success");
    request.callback.eventsUrl = `http://127.0.0.1:${callbackAddress.port}/api/executor/events`;

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(202);

    await waitForJob(harness.baseUrl, request.jobId);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (callbackEvents.some(event => event.type === "job.completed")) {
        break;
      }
      await new Promise(resolve => {
        setTimeout(resolve, 25);
      });
    }

    expect(callbackEvents.some(event => event.type === "job.started")).toBe(true);
    expect(callbackEvents.some(event => event.type === "job.completed")).toBe(true);
  });

  it("accepts and finishes a mock failed job", async () => {
    const harness = await createHarness();
    const request = createTestRequest("failed-job", "failed");

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(202);

    const job = await waitForJob(harness.baseUrl, request.jobId);
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("MOCK_FAILURE");
    expect(job.events.some(event => event.type === "job.failed")).toBe(true);
  });

  it("rejects requests whose jobId is not present in the plan", async () => {
    const harness = await createHarness();
    const request = createTestRequest("missing-job", "success");
    request.jobId = "different-job";

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("request.jobId must exist in plan.jobs");
  });

  it("exposes pause and resume routes for executor jobs", async () => {
    const harness = await createSeededHarness("queued");

    const pauseResponse = await fetch(
      `${harness.baseUrl}/api/executor/jobs/${harness.jobId}/pause`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reason: "Wait before dispatch",
          requestedBy: "operator",
          source: "user",
        }),
      }
    );

    const pauseBody = (await pauseResponse.json()) as {
      pauseRequested?: boolean;
      status: string;
      message: string;
    };

    expect(pauseResponse.status).toBe(200);
    expect(pauseBody.pauseRequested).toBe(true);
    expect(pauseBody.status).toBe("queued");
    expect(pauseBody.message).toBe("Wait before dispatch");

    const resumeResponse = await fetch(
      `${harness.baseUrl}/api/executor/jobs/${harness.jobId}/resume`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reason: "Continue dispatch",
          requestedBy: "operator",
          source: "user",
        }),
      }
    );

    const resumeBody = (await resumeResponse.json()) as {
      resumeRequested?: boolean;
      status: string;
      message: string;
    };

    expect(resumeResponse.status).toBe(200);
    expect(resumeBody.resumeRequested).toBe(true);
    expect(resumeBody.status).toBe("queued");
    expect(resumeBody.message).toBe("Continue dispatch");
  });
});
