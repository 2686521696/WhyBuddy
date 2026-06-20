import { afterEach, describe, expect, it, vi } from "vitest";

import type { BlueprintGenerationJob } from "../../../shared/blueprint/index.js";
import type { BlueprintJobRuntimeResult } from "../../../shared/blueprint/jobs/types.js";
import { createMemoryBlueprintJobStore } from "../blueprint.js";
import { buildBlueprintServiceContext } from "../blueprint/context.js";
import { createJobService } from "../blueprint/jobs/service.js";

const FIXED_TIMESTAMP = "2026-06-20T00:00:00.000Z";

function makeJob(
  id = "job-1",
  overrides: Partial<BlueprintGenerationJob> = {},
): BlueprintGenerationJob {
  return {
    id,
    request: {
      projectId: "project-1",
      targetText: "Build a job runtime proxy",
    },
    status: "running",
    stage: "spec_tree",
    version: "v1",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    artifacts: [],
    events: [],
    ...overrides,
  };
}

function makeRuntimeJob(
  overrides: Partial<BlueprintJobRuntimeResult["job"]> = {},
): NonNullable<BlueprintJobRuntimeResult["job"]> {
  return {
    id: "job-1",
    status: "running",
    stage: "spec_tree",
    version: "v1",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    artifacts: [],
    events: [],
    ...overrides,
  };
}

function successResponse(
  action: BlueprintJobRuntimeResult["action"],
  overrides: Partial<BlueprintJobRuntimeResult> = {},
): BlueprintJobRuntimeResult {
  return {
    ok: true,
    action,
    contractVersion: "blueprint.job-runtime.proxy.v1",
    runtime: {
      owner: "python",
      persistenceOwner: "node",
      mode: "proxy_contract",
    },
    job: makeRuntimeJob(),
    ...overrides,
  };
}

function makeService(initialJobs: BlueprintGenerationJob[] = [makeJob()]) {
  const jobStore = createMemoryBlueprintJobStore(initialJobs);
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const ctx = buildBlueprintServiceContext({
    jobStore,
    logger,
    now: () => new Date(FIXED_TIMESTAMP),
  });
  return { service: createJobService(ctx), jobStore, logger };
}

describe("Blueprint job runtime Python proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates start/status/read to Python without moving persistence out of Node", async () => {
    vi.stubEnv("BLUEPRINT_JOB_RUNTIME_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test/");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "internal-test");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url) => {
        const action = String(url).split("/").pop() as BlueprintJobRuntimeResult["action"];
        return new Response(JSON.stringify(successResponse(action)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const { service, jobStore } = makeService([]);

    const started = await service.startJob({
      id: "job-1",
      request: { projectId: "project-1", targetText: "Build a proxy" },
      stage: "spec_tree",
      now: FIXED_TIMESTAMP,
    });
    const status = await service.getJobStatus("job-1");
    const read = await service.readJob("job-1");

    expect(started.ok).toBe(true);
    expect(status.ok).toBe(true);
    expect(read.ok).toBe(true);
    expect(jobStore.get("job-1")?.id).toBe("job-1");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "http://python.test/api/blueprint/jobs/runtime/start",
      "http://python.test/api/blueprint/jobs/runtime/status",
      "http://python.test/api/blueprint/jobs/runtime/read",
    ]);
    const startBody = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(startBody.job.id).toBe("job-1");
    expect(startBody.nodeControl.persistenceOwner).toBe("node");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": "internal-test",
    });
  });

  it("keeps not_found as a stable proxy result", async () => {
    vi.stubEnv("BLUEPRINT_JOB_RUNTIME_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          action: "status",
          contractVersion: "blueprint.job-runtime.proxy.v1",
          error: "not_found",
          message: "Blueprint job missing was not found in the Node job store.",
          jobId: "missing",
        } satisfies BlueprintJobRuntimeResult),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { service } = makeService([]);

    await expect(service.getJobStatus("missing")).resolves.toMatchObject({
      ok: false,
      action: "status",
      error: "not_found",
      jobId: "missing",
    });
  });

  it("delegates cancel and never maps cancelled to completed", async () => {
    vi.stubEnv("BLUEPRINT_JOB_RUNTIME_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify(
          successResponse("cancel", {
            cancelRequested: true,
            job: makeRuntimeJob({
              status: "cancelled",
              error: {
                code: "cancelled",
                message: "Cancelled by user",
                stage: "spec_tree",
              },
            }),
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { service, jobStore } = makeService([makeJob()]);

    const result = await service.cancelJob("job-1", {
      reason: "user_cancelled",
      now: FIXED_TIMESTAMP,
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("cancel");
    expect(result.job?.status).toBe("cancelled");
    expect(result.job?.status).not.toBe("completed");
    expect(jobStore.get("job-1")?.status).toBe("failed");
    expect(jobStore.get("job-1")?.error?.code).toBe("cancelled");
  });

  it("returns runtime_error when the Python proxy is unreachable", async () => {
    vi.stubEnv("BLUEPRINT_JOB_RUNTIME_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const { service, logger } = makeService([makeJob()]);

    await expect(service.readJob("job-1")).resolves.toMatchObject({
      ok: false,
      action: "read",
      error: "runtime_error",
      jobId: "job-1",
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});
