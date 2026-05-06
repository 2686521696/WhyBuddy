import {
  EXECUTOR_CAPABILITIES,
  EXECUTOR_CAPABILITY_SET,
  EXECUTOR_CONTRACT_VERSION,
  type ExecutionPlanJob,
  type ExecutorCapabilities,
  type ExecutorCapability,
} from "../../../shared/executor/contracts.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LobsterExecutorConfig } from "./types.js";
import { ExecutorCapabilityError } from "./errors.js";

const BASE_ARTIFACT_TYPES = ["file", "log", "json"];
const BASE_PREVIEW_TYPES = ["text", "json"];
const DEFAULT_TIMEOUT_MS = 300_000;
const AGENT_IMAGE_MANIFEST_PATH = resolve(
  "services",
  "lobster-executor",
  "agent-image",
  "capabilities.json",
);

function uniqueCapabilities(values: string[]): ExecutorCapability[] {
  const seen = new Set<string>();
  const result: ExecutorCapability[] = [];
  for (const value of values) {
    if (!EXECUTOR_CAPABILITY_SET.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value as ExecutorCapability);
  }
  return result;
}

function hasLLMConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.LLM_API_KEY?.trim());
}

function isAgentSandboxImage(config: LobsterExecutorConfig): boolean {
  return /cube-ai-agent-sandbox(?::|$)/.test(config.aiImage);
}

function readAgentImageManifest(): {
  capabilities: ExecutorCapability[];
  artifactTypes: string[];
  previewTypes: string[];
} | null {
  if (!existsSync(AGENT_IMAGE_MANIFEST_PATH)) return null;

  try {
    const raw = JSON.parse(readFileSync(AGENT_IMAGE_MANIFEST_PATH, "utf-8")) as {
      capabilities?: unknown;
      artifactTypes?: unknown;
      previewTypes?: unknown;
    };
    return {
      capabilities: uniqueCapabilities(
        Array.isArray(raw.capabilities)
          ? raw.capabilities.filter((value): value is string => typeof value === "string")
          : [],
      ),
      artifactTypes: Array.isArray(raw.artifactTypes)
        ? raw.artifactTypes.filter((value): value is string => typeof value === "string")
        : [],
      previewTypes: Array.isArray(raw.previewTypes)
        ? raw.previewTypes.filter((value): value is string => typeof value === "string")
        : [],
    };
  } catch {
    return null;
  }
}

function resolveModeCapabilities(
  mode: LobsterExecutorConfig["executionMode"],
  config: LobsterExecutorConfig,
  dockerStatus: ExecutorCapabilities["docker"]["status"],
): { capabilities: ExecutorCapability[]; warnings: string[] } {
  const warnings: string[] = [];
  const capabilities: string[] = [
    "executor.cancel",
    "executor.pause",
    "executor.resume",
    "artifact.file",
    "artifact.log",
    "artifact.json",
    "preview.text",
    "preview.json",
  ];

  if (config.callbackSecret) {
    capabilities.push("executor.callback.hmac");
  }

  if (hasLLMConfig()) {
    capabilities.push("ai.llm");
  }

  if (mode === "mock") {
    capabilities.push("runtime.mock", "node");
    warnings.push("Mock mode simulates execution and does not provide container isolation.");
  } else if (mode === "native") {
    capabilities.push("runtime.native", "node");
    warnings.push("Native mode executes on the host process and does not provide Docker isolation.");
  } else {
    if (dockerStatus === "connected") {
      capabilities.push(
        "runtime.docker",
        "node",
        "security.readonly-rootfs",
        "security.no-new-privileges",
        "security.resource-limits",
      );
      if (isAgentSandboxImage(config)) {
        const manifest = readAgentImageManifest();
        if (manifest) {
          capabilities.push(...manifest.capabilities);
        } else {
          warnings.push("Agent sandbox image selected, but capabilities manifest could not be read.");
        }
      }
    } else {
      warnings.push("Configured for real mode, but Docker health check is currently disconnected.");
    }
  }

  return { capabilities: uniqueCapabilities(capabilities), warnings };
}

export function createExecutorCapabilities(
  config: LobsterExecutorConfig,
  options: {
    dockerStatus?: ExecutorCapabilities["docker"]["status"];
    now?: Date;
  } = {},
): ExecutorCapabilities {
  const mode = config.executionMode;
  const dockerStatus =
    options.dockerStatus ?? (mode === "real" ? "connected" : "disconnected");
  const { capabilities, warnings } = resolveModeCapabilities(
    mode,
    config,
    dockerStatus,
  );
  const manifest =
    mode === "real" && dockerStatus === "connected" && isAgentSandboxImage(config)
      ? readAgentImageManifest()
      : null;

  return {
    executor: "lobster",
    service: config.serviceName,
    version: EXECUTOR_CONTRACT_VERSION,
    timestamp: (options.now ?? new Date()).toISOString(),
    mode,
    docker: {
      status: dockerStatus,
      lifecycle: mode === "real" && dockerStatus === "connected",
      host: config.dockerHost,
    },
    image: {
      defaultImage: config.defaultImage,
      aiImage: config.aiImage,
      activeImage: config.aiImage || config.defaultImage,
    },
    capabilities,
    artifactTypes: [...new Set([...BASE_ARTIFACT_TYPES, ...(manifest?.artifactTypes ?? [])])],
    previewTypes: [...new Set([...BASE_PREVIEW_TYPES, ...(manifest?.previewTypes ?? [])])],
    limits: {
      memory: config.maxMemory,
      cpus: config.maxCpus,
      pids: config.maxPids,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxConcurrentJobs: config.maxConcurrentJobs,
    },
    warnings,
  };
}

export function getRequiredCapabilities(planJob: ExecutionPlanJob): string[] {
  const raw = planJob.payload?.requiredCapabilities;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(value => {
    if (typeof value !== "string") return ["<non-string-capability>"];
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  });
}

export function validateRequiredCapabilities(
  planJob: ExecutionPlanJob,
  supportedCapabilities: readonly ExecutorCapability[],
): void {
  const required = getRequiredCapabilities(planJob);
  if (required.length === 0) return;

  const unknown = required.filter(value => !EXECUTOR_CAPABILITY_SET.has(value));
  if (unknown.length > 0) {
    throw new ExecutorCapabilityError(
      `Executor job requires unknown capabilities: ${unknown.join(", ")}`,
      "EXECUTOR_CAPABILITY_UNKNOWN",
      unknown,
      [...supportedCapabilities],
      `Use one of the known capabilities: ${EXECUTOR_CAPABILITIES.join(", ")}`,
    );
  }

  const supported = new Set(supportedCapabilities);
  const unsupported = required.filter(value => !supported.has(value as ExecutorCapability));
  if (unsupported.length > 0) {
    throw new ExecutorCapabilityError(
      `Executor does not support required capabilities: ${unsupported.join(", ")}`,
      "EXECUTOR_CAPABILITY_UNSUPPORTED",
      unsupported,
      [...supportedCapabilities],
      "Use cube-ai-agent-sandbox image, change executor mode, or remove unsupported requirements.",
    );
  }
}
