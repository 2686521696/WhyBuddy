import { describe, expect, it } from "vitest";
import type { ExecutionPlanJob } from "../../../shared/executor/contracts.js";
import { ExecutorCapabilityError } from "./errors.js";
import {
  createExecutorCapabilities,
  validateRequiredCapabilities,
} from "./capabilities.js";
import type { LobsterExecutorConfig } from "./types.js";

function createConfig(
  executionMode: LobsterExecutorConfig["executionMode"],
): LobsterExecutorConfig {
  return {
    host: "127.0.0.1",
    port: 3031,
    dataRoot: "tmp/test",
    serviceName: "lobster-executor",
    executionMode,
    defaultImage: "node:20-slim",
    maxConcurrentJobs: 2,
    callbackSecret: "secret",
    aiImage: "cube-ai-sandbox:latest",
    securityLevel: "strict",
    containerUser: "65534",
    maxMemory: "512m",
    maxCpus: "1.0",
    maxPids: 256,
    tmpfsSize: "64m",
    networkWhitelist: [],
    dockerHost: "/var/run/docker.sock",
  };
}

function createJob(requiredCapabilities?: unknown[]): ExecutionPlanJob {
  return {
    id: "job-1",
    key: "job-1",
    label: "Job 1",
    description: "Run job",
    kind: "execute",
    payload: requiredCapabilities ? { requiredCapabilities } : {},
  };
}

describe("createExecutorCapabilities", () => {
  it("reports Docker lifecycle capabilities for real mode when Docker is connected", () => {
    const capabilities = createExecutorCapabilities(createConfig("real"), {
      dockerStatus: "connected",
      now: new Date("2026-05-04T00:00:00.000Z"),
    });

    expect(capabilities.mode).toBe("real");
    expect(capabilities.docker.lifecycle).toBe(true);
    expect(capabilities.capabilities).toContain("runtime.docker");
    expect(capabilities.capabilities).toContain("security.resource-limits");
  });

  it("adds agent image capabilities from the manifest when the strong sandbox image is selected", () => {
    const config = {
      ...createConfig("real"),
      aiImage: "cube-ai-agent-sandbox:latest",
    };
    const capabilities = createExecutorCapabilities(config, {
      dockerStatus: "connected",
    });

    expect(capabilities.image.activeImage).toBe("cube-ai-agent-sandbox:latest");
    expect(capabilities.capabilities).toContain("browser.playwright");
    expect(capabilities.capabilities).toContain("document.pandoc");
    expect(capabilities.artifactTypes).toContain("html");
    expect(capabilities.previewTypes).toContain("image");
  });

  it("reports native mode as non-container execution", () => {
    const capabilities = createExecutorCapabilities(createConfig("native"), {
      dockerStatus: "disconnected",
    });

    expect(capabilities.mode).toBe("native");
    expect(capabilities.docker.lifecycle).toBe(false);
    expect(capabilities.capabilities).toContain("runtime.native");
    expect(capabilities.warnings.join(" ")).toContain("does not provide Docker isolation");
  });
});

describe("validateRequiredCapabilities", () => {
  it("allows jobs whose required capabilities are supported", () => {
    const supported = createExecutorCapabilities(createConfig("real"), {
      dockerStatus: "connected",
    }).capabilities;

    expect(() =>
      validateRequiredCapabilities(
        createJob(["runtime.docker", "artifact.log"]),
        supported,
      ),
    ).not.toThrow();
  });

  it("rejects unknown required capabilities", () => {
    const supported = createExecutorCapabilities(createConfig("mock")).capabilities;

    expect(() =>
      validateRequiredCapabilities(createJob(["browser.quantum"]), supported),
    ).toThrow(ExecutorCapabilityError);
  });

  it("rejects unsupported required capabilities", () => {
    const supported = createExecutorCapabilities(createConfig("mock")).capabilities;

    try {
      validateRequiredCapabilities(createJob(["browser.playwright"]), supported);
      throw new Error("Expected capability validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutorCapabilityError);
      expect((error as ExecutorCapabilityError).code).toBe(
        "EXECUTOR_CAPABILITY_UNSUPPORTED",
      );
      expect((error as ExecutorCapabilityError).unsupportedCapabilities).toEqual([
        "browser.playwright",
      ]);
    }
  });
});
