import { afterEach, describe, expect, it, vi } from "vitest";

import type { BlueprintGenerationJob } from "../../../shared/blueprint/index.js";
import { BLUEPRINT_MAIN_STATE_PYTHON_CONTRACT_VERSION } from "../../../shared/blueprint/blueprint-main-state-contract.js";
import {
  projectBlueprintMainStateLocally,
  readBlueprintMainStateWithPythonRuntime,
  updateBlueprintMainStateWithPythonRuntime,
} from "../blueprint/main-state-python-runtime.js";

const FIXED_TIMESTAMP = "2026-06-22T00:00:00.000Z";

function makeJob(overrides: Partial<BlueprintGenerationJob> = {}): BlueprintGenerationJob {
  return {
    id: "job-blueprint-main-state",
    request: {
      projectId: "project-runtime",
      targetText: "Build the bounded state bridge",
    },
    projectId: "project-runtime",
    sourceId: "source-runtime",
    status: "running",
    stage: "spec_tree",
    version: "2026-06-22.runtime",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: "2026-06-22T00:00:01.000Z",
    artifacts: [
      {
        id: "artifact-route-set",
        type: "route_set",
        title: "Route set",
        summary: "Candidate Blueprint routes.",
        createdAt: FIXED_TIMESTAMP,
      },
      {
        id: "artifact-spec-tree",
        type: "spec_tree",
        title: "SPEC tree",
        summary: "Generated tree awaiting review.",
        createdAt: "2026-06-22T00:00:01.000Z",
        staleSince: "2026-06-22T00:00:02.000Z",
        invalidatedBy: {
          stage: "route_generation",
          artifactId: "artifact-route-set",
          artifactType: "route_set",
          reason: "upstream_route_selection_changed",
          triggeredAt: "2026-06-22T00:00:02.000Z",
        },
      },
    ],
    events: [{ id: "event-node-owned" } as BlueprintGenerationJob["events"][number]],
    stageState: { current: { status: "node-owned" } } as BlueprintGenerationJob["stageState"],
    nextAction: { type: "generate", label: "Node action", stage: "spec_docs" } as BlueprintGenerationJob["nextAction"],
    checksLedger: [{ id: "ledger-node-owned" } as BlueprintGenerationJob["checksLedger"][number]],
    staleArtifactIds: ["artifact-spec-tree"],
    ...overrides,
  };
}

function runtimeProjection(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: BLUEPRINT_MAIN_STATE_PYTHON_CONTRACT_VERSION,
    kind: "blueprint.main.state_projection",
    stateAuthority: "node",
    stateMutation: "none",
    jobId: "job-blueprint-main-state",
    projectId: "project-runtime",
    sourceId: "source-runtime",
    version: "2026-06-22.runtime",
    stage: "spec_tree",
    status: "running",
    nodeStatus: "running",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: "2026-06-22T00:00:01.000Z",
    artifacts: [],
    stale: false,
    staleArtifactIds: [],
    ...overrides,
  };
}

function runtimeSuccess(operation: "read" | "project" | "update", overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    operation,
    contractVersion: "blueprint.main-state.runtime.v1",
    runtime: {
      owner: "python",
      mode: "runtime_bridge",
      stateAuthority: "node",
      stateMutation: "none",
      jobStoreOwner: "node",
      eventBusOwner: "node",
      ledgerOwner: "node",
      previewOwner: "node",
      promptPackageOwner: "node",
    },
    jobId: "job-blueprint-main-state",
    projection: runtimeProjection(),
    read: {
      source: "node-job-snapshot",
      projectedAt: "2026-06-22T00:00:03.000Z",
    },
    update: {
      accepted: false,
      reason: "node_state_owner",
      message: "Blueprint main state updates are audited by Python but applied by Node.",
    },
    provenance: "python-blueprint-state-runtime",
    ...overrides,
  };
}

describe("Blueprint main state Python runtime bridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates read/project to Python while sending only a Node-owned job snapshot", async () => {
    vi.stubEnv("BLUEPRINT_MAIN_STATE_PYTHON_RUNTIME", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-blueprint.test/");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "internal-test");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(runtimeSuccess("read")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const job = makeJob();

    const result = await readBlueprintMainStateWithPythonRuntime(job, {
      now: () => "2026-06-22T00:00:03.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.operation).toBe("read");
    expect(result.projection.jobId).toBe("job-blueprint-main-state");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://python-blueprint.test/api/blueprint/main-state/runtime/read",
    );
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": "internal-test",
    });

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({
      operation: "read",
      jobId: "job-blueprint-main-state",
      nodeControl: {
        jobStoreOwner: "node",
        eventBusOwner: "node",
        ledgerOwner: "node",
        previewOwner: "node",
        promptPackageOwner: "node",
      },
    });
    expect(body.job.id).toBe("job-blueprint-main-state");
    expect(body.job.events).toBeUndefined();
    expect(body.job.stageState).toBeUndefined();
    expect(body.job.nextAction).toBeUndefined();
    expect(body.job.checksLedger).toBeUndefined();
  });

  it("falls back to the local Node projection when Python mode is disabled", async () => {
    vi.stubEnv("BLUEPRINT_MAIN_STATE_PYTHON_RUNTIME", "false");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await readBlueprintMainStateWithPythonRuntime(makeJob());

    expect(result.ok).toBe(true);
    expect(result.runtime.owner).toBe("node");
    expect(result.runtime.mode).toBe("local_fallback");
    expect(result.projection.staleArtifactIds).toEqual(["artifact-spec-tree"]);
    expect(result.projection).not.toHaveProperty("events");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns an auditable runtime error instead of pretending Python failures succeeded", async () => {
    vi.stubEnv("BLUEPRINT_MAIN_STATE_PYTHON_RUNTIME", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-blueprint.test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await readBlueprintMainStateWithPythonRuntime(makeJob());

    expect(result).toMatchObject({
      ok: false,
      operation: "read",
      contractVersion: "blueprint.main-state.runtime.v1",
      error: "runtime_unavailable",
      reason: "python_runtime_failed",
      statusCode: 503,
      retryable: true,
      provenance: "node-blueprint-state-python-runtime",
    });
    expect(result).not.toHaveProperty("projection");
  });

  it("preserves Python validation error envelopes without local fallback", async () => {
    vi.stubEnv("BLUEPRINT_MAIN_STATE_PYTHON_RUNTIME", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-blueprint.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          operation: "read",
          contractVersion: "blueprint.main-state.runtime.v1",
          error: "validation_error",
          reason: "node_control_owner_mismatch",
          message: "Blueprint main state runtime requires Node-owned boundaries.",
          statusCode: 400,
          provenance: "python-blueprint-state-runtime",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await readBlueprintMainStateWithPythonRuntime(makeJob());

    expect(result).toMatchObject({
      ok: false,
      operation: "read",
      error: "validation_error",
      reason: "node_control_owner_mismatch",
      statusCode: 400,
      provenance: "python-blueprint-state-runtime",
    });
  });

  it("uses update as a non-mutating Python audit boundary", async () => {
    vi.stubEnv("BLUEPRINT_MAIN_STATE_PYTHON_RUNTIME", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python-blueprint.test");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify(
          runtimeSuccess("update", {
            update: {
              accepted: false,
              reason: "node_state_owner",
              message: "Blueprint main state updates are audited by Python but applied by Node.",
              requestedPatch: { status: "completed" },
            },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await updateBlueprintMainStateWithPythonRuntime(
      makeJob(),
      { status: "completed" },
      { now: () => "2026-06-22T00:00:03.000Z" },
    );

    expect(result.ok).toBe(true);
    expect(result.operation).toBe("update");
    expect(result.update.accepted).toBe(false);
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.operation).toBe("update");
    expect(body.patch).toEqual({ status: "completed" });
  });

  it("keeps local projection available as a pure helper for route shell callers", () => {
    const projection = projectBlueprintMainStateLocally(makeJob());

    expect(projection.contractVersion).toBe(BLUEPRINT_MAIN_STATE_PYTHON_CONTRACT_VERSION);
    expect(projection.stateAuthority).toBe("node");
    expect(projection.stateMutation).toBe("none");
    expect(projection.status).toBe("stale");
    expect(projection.nodeStatus).toBe("running");
  });
});
