import type {
  ExecutionPlanJob,
  ExecutorCapability,
} from "../../../shared/executor/contracts.js";
import type {
  SandboxSkillJobPayload,
  SandboxSkillManifest,
  SandboxSkillRef,
} from "../../../shared/executor/skill-manifest.js";
import { ValidationError } from "./errors.js";
import { getRequiredCapabilities } from "./capabilities.js";
import {
  SandboxSkillRegistry,
  sandboxSkillKey,
  type SandboxSkillRecord,
} from "./skill-registry.js";
import type { LobsterExecutorConfig } from "./types.js";

export interface SandboxSkillBinding {
  manifest: SandboxSkillManifest;
  directory: string;
  input: Record<string, unknown>;
  requiredCapabilities: ExecutorCapability[];
  autoSelected: boolean;
}

const EXECUTOR_OWNED_CAPABILITY_PREFIXES = [
  "runtime.",
  "executor.",
  "security.",
] as const;

function toSkillRequiredCapabilities(
  requiredCapabilities: readonly string[],
): string[] {
  return requiredCapabilities.filter(
    capability =>
      !EXECUTOR_OWNED_CAPABILITY_PREFIXES.some(prefix =>
        capability.startsWith(prefix),
      ),
  );
}

function parseSkillRef(raw: unknown): SandboxSkillRef | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("payload.skillRef must be an object");
  }

  const candidate = raw as Record<string, unknown>;
  const name =
    typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name.trim()
      : "";
  if (!name) {
    throw new ValidationError("payload.skillRef.name is required");
  }

  const version =
    typeof candidate.version === "string" && candidate.version.trim()
      ? candidate.version.trim()
      : undefined;
  return { name, version };
}

function parseSkillInput(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("payload.skillInput must be an object when provided");
  }
  return raw as Record<string, unknown>;
}

function parseSkillPolicy(raw: unknown): NonNullable<SandboxSkillJobPayload["skillPolicy"]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const candidate = raw as Record<string, unknown>;
  return {
    allowNetwork: candidate.allowNetwork === true,
    allowCredentials: candidate.allowCredentials === true,
    allowFilesystemWrite: candidate.allowFilesystemWrite === true,
    autoSelect: candidate.autoSelect === true,
  };
}

function ensureUnambiguousSkillPayload(
  planJob: ExecutionPlanJob,
  payload: Record<string, unknown>,
): void {
  const command = payload.command;
  const hasCommand =
    Array.isArray(command) &&
    command.some(item => typeof item === "string" && item.trim());
  if (hasCommand) {
    throw new ValidationError(
      "payload.skillRef cannot be combined with payload.command",
    );
  }

  if (payload.browserTask !== undefined) {
    throw new ValidationError(
      "payload.skillRef cannot be combined with payload.browserTask",
    );
  }

  if (planJob.kind !== "execute" && planJob.kind !== "custom") {
    throw new ValidationError(
      `payload.skillRef can only be used by execute/custom jobs, got ${planJob.kind}`,
    );
  }
}

function assertSkillUsable(record: SandboxSkillRecord): void {
  if (!record.compatible || record.disabled) {
    const reasons = record.errors.length > 0 ? record.errors.join("; ") : "disabled";
    throw new ValidationError(
      `Sandbox skill ${sandboxSkillKey(record.manifest)} is not usable: ${reasons}`,
    );
  }
}

function assertSkillCapabilities(
  record: SandboxSkillRecord,
  requiredCapabilities: readonly string[],
): ExecutorCapability[] {
  const skillCapabilities = new Set(record.manifest.capabilities);
  const skillRequiredCapabilities = toSkillRequiredCapabilities(requiredCapabilities);
  const missing = skillRequiredCapabilities.filter(
    capability => !skillCapabilities.has(capability as ExecutorCapability),
  );
  if (missing.length > 0) {
    throw new ValidationError(
      `Sandbox skill ${sandboxSkillKey(record.manifest)} does not support required capabilities: ${missing.join(", ")}`,
    );
  }
  return skillRequiredCapabilities as ExecutorCapability[];
}

function assertSkillGovernance(
  record: SandboxSkillRecord,
  config: LobsterExecutorConfig,
  policy: NonNullable<SandboxSkillJobPayload["skillPolicy"]>,
): void {
  const { security } = record.manifest;
  if (security.credentials.length > 0 && !policy.allowCredentials) {
    throw new ValidationError(
      `Sandbox skill ${sandboxSkillKey(record.manifest)} requires credentials and must be explicitly allowed`,
    );
  }

  if (security.network === "required" && config.securityLevel === "strict" && !policy.allowNetwork) {
    throw new ValidationError(
      `Sandbox skill ${sandboxSkillKey(record.manifest)} requires network access; set payload.skillPolicy.allowNetwork=true or use a less restrictive executor security level`,
    );
  }

  if (security.filesystem === "workspace-write" && !policy.allowFilesystemWrite) {
    throw new ValidationError(
      `Sandbox skill ${sandboxSkillKey(record.manifest)} requests workspace-write filesystem access and must be explicitly allowed`,
    );
  }
}

function selectSkillRecord(
  registry: SandboxSkillRegistry,
  skillRef: SandboxSkillRef | undefined,
  requiredCapabilities: readonly string[],
  autoSelect: boolean,
): { record: SandboxSkillRecord; autoSelected: boolean } | undefined {
  if (skillRef) {
    const record = registry.get(skillRef.name, skillRef.version);
    if (!record) {
      throw new ValidationError(
        `Sandbox skill ${skillRef.version ? `${skillRef.name}@${skillRef.version}` : skillRef.name} was not found`,
      );
    }
    return { record, autoSelected: false };
  }

  if (!autoSelect) return undefined;
  if (requiredCapabilities.length === 0) {
    throw new ValidationError(
      "payload.skillPolicy.autoSelect requires payload.requiredCapabilities",
    );
  }

  const [match] = registry.findByCapabilities(requiredCapabilities);
  if (!match) {
    throw new ValidationError(
      `No sandbox skill matches required capabilities: ${requiredCapabilities.join(", ")}`,
    );
  }
  return { record: match.skill, autoSelected: true };
}

export function resolveSandboxSkillBinding(
  planJob: ExecutionPlanJob,
  config: LobsterExecutorConfig,
): SandboxSkillBinding | undefined {
  const payload = (planJob.payload ?? {}) as Record<string, unknown>;
  const skillRef = parseSkillRef(payload.skillRef);
  const skillPolicy = parseSkillPolicy(payload.skillPolicy);
  const requiredCapabilities = getRequiredCapabilities(planJob);

  const selected = selectSkillRecord(
    new SandboxSkillRegistry(config.skillRoot),
    skillRef,
    toSkillRequiredCapabilities(requiredCapabilities),
    skillPolicy.autoSelect === true,
  );
  if (!selected) return undefined;

  ensureUnambiguousSkillPayload(planJob, payload);
  assertSkillUsable(selected.record);
  const skillRequiredCapabilities = assertSkillCapabilities(
    selected.record,
    requiredCapabilities,
  );
  assertSkillGovernance(selected.record, config, skillPolicy);

  return {
    manifest: selected.record.manifest,
    directory: selected.record.directory,
    input: parseSkillInput(payload.skillInput),
    requiredCapabilities: skillRequiredCapabilities,
    autoSelected: selected.autoSelected,
  };
}
