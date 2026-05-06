import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

import type { ExecutorCapability } from "../../../shared/executor/contracts.js";
import {
  validateSandboxSkillManifest,
  type SandboxSkillManifest,
} from "../../../shared/executor/skill-manifest.js";

export interface SandboxSkillRecord {
  manifest: SandboxSkillManifest;
  directory: string;
  manifestPath: string;
  compatible: boolean;
  disabled: boolean;
  errors: string[];
}

export interface SandboxSkillMatch {
  skill: SandboxSkillRecord;
  coveredCapabilities: ExecutorCapability[];
  missingCapabilities: string[];
  score: number;
}

export interface SandboxSkillRegistrySnapshot {
  root: string;
  skills: SandboxSkillRecord[];
  capabilityIndex: Record<string, string[]>;
}

export function sandboxSkillKey(
  manifest: Pick<SandboxSkillManifest, "name" | "version">,
): string {
  return `${manifest.name}@${manifest.version}`;
}

function normalizeSkillRoot(root?: string): string {
  return resolve(root || "services/lobster-executor/skills");
}

function isWithinDirectory(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent}\\`) ||
    normalizedChild.startsWith(`${normalizedParent}/`)
  );
}

function readJsonFile(pathname: string): unknown {
  return JSON.parse(readFileSync(pathname, "utf-8"));
}

function safeSkillDirectoryName(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value) && !value.includes("..");
}

export class SandboxSkillRegistry {
  readonly root: string;
  private records: SandboxSkillRecord[] = [];
  private byKey = new Map<string, SandboxSkillRecord>();
  private byName = new Map<string, SandboxSkillRecord[]>();
  private byCapability = new Map<string, SandboxSkillRecord[]>();

  constructor(root?: string) {
    this.root = normalizeSkillRoot(root);
    this.reload();
  }

  reload(): SandboxSkillRegistrySnapshot {
    const records: SandboxSkillRecord[] = [];

    if (existsSync(this.root)) {
      for (const entry of readdirSync(this.root)) {
        if (!safeSkillDirectoryName(entry)) continue;
        const directory = join(this.root, entry);
        if (!statSync(directory).isDirectory()) continue;
        records.push(this.loadSkillDirectory(directory));
      }
    }

    this.records = records.sort((left, right) =>
      sandboxSkillKey(left.manifest).localeCompare(sandboxSkillKey(right.manifest)),
    );
    this.rebuildIndexes();
    return this.snapshot();
  }

  list(options: { includeDisabled?: boolean } = {}): SandboxSkillRecord[] {
    return this.records.filter(record =>
      options.includeDisabled ? true : record.compatible && !record.disabled,
    );
  }

  get(name: string, version?: string): SandboxSkillRecord | null {
    if (version) {
      return this.byKey.get(`${name}@${version}`) ?? null;
    }
    const candidates = this.byName.get(name) ?? [];
    return candidates.find(record => record.compatible && !record.disabled) ?? null;
  }

  findByCapabilities(
    requiredCapabilities: readonly string[],
    options: { includePartial?: boolean } = {},
  ): SandboxSkillMatch[] {
    const uniqueRequired = [...new Set(requiredCapabilities.filter(Boolean))];
    if (uniqueRequired.length === 0) return [];

    return this.list()
      .map(skill => {
        const supported = new Set(skill.manifest.capabilities);
        const coveredCapabilities = uniqueRequired.filter((capability): capability is ExecutorCapability =>
          supported.has(capability as ExecutorCapability),
        );
        const missingCapabilities = uniqueRequired.filter(
          capability => !supported.has(capability as ExecutorCapability),
        );
        const safetyPenalty =
          skill.manifest.security.credentials.length > 0
            ? 0.08
            : skill.manifest.security.network === "required"
              ? 0.04
              : 0;
        const score =
          coveredCapabilities.length / uniqueRequired.length - safetyPenalty;
        return {
          skill,
          coveredCapabilities,
          missingCapabilities,
          score,
        };
      })
      .filter(match =>
        options.includePartial
          ? match.coveredCapabilities.length > 0
          : match.missingCapabilities.length === 0,
      )
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return sandboxSkillKey(left.skill.manifest).localeCompare(
          sandboxSkillKey(right.skill.manifest),
        );
      });
  }

  snapshot(): SandboxSkillRegistrySnapshot {
    const capabilityIndex: Record<string, string[]> = {};
    for (const [capability, records] of this.byCapability.entries()) {
      capabilityIndex[capability] = records.map(record =>
        sandboxSkillKey(record.manifest),
      );
    }
    return {
      root: this.root,
      skills: [...this.records],
      capabilityIndex,
    };
  }

  private loadSkillDirectory(directory: string): SandboxSkillRecord {
    const manifestPath = join(directory, "skill.json");
    try {
      const raw = readJsonFile(manifestPath);
      const validation = validateSandboxSkillManifest(raw);
      if (!validation.ok || !validation.manifest) {
        return this.invalidRecord(directory, manifestPath, validation.errors);
      }

      const manifest = validation.manifest;
      const resolvedDirectory = resolve(directory);
      const entrypointPath = resolve(resolvedDirectory, manifest.entrypoint);
      const errors: string[] = [];
      if (!isWithinDirectory(resolvedDirectory, entrypointPath)) {
        errors.push(`entrypoint escapes skill directory: ${manifest.entrypoint}`);
      } else if (!existsSync(entrypointPath)) {
        errors.push(`entrypoint not found: ${manifest.entrypoint}`);
      }
      return {
        manifest,
        directory: resolvedDirectory,
        manifestPath,
        compatible: errors.length === 0,
        disabled: !manifest.enabled,
        errors,
      };
    } catch (error) {
      return this.invalidRecord(directory, manifestPath, [
        error instanceof Error ? error.message : String(error),
      ]);
    }
  }

  private invalidRecord(
    directory: string,
    manifestPath: string,
    errors: string[],
  ): SandboxSkillRecord {
    const fallbackName = directory.split(/[\\/]/).pop() || "invalid-skill";
    return {
      manifest: {
        name: fallbackName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"),
        version: "0.0.0",
        description: "Invalid sandbox skill manifest",
        enabled: false,
        capabilities: [],
        runtime: "node",
        entrypoint: "missing",
        dependencies: [],
        inputs: { examples: [] },
        outputs: { artifacts: [], previewTypes: [] },
        artifactRules: [],
        security: {
          network: "none",
          filesystem: "workspace",
          browser: false,
          credentials: [],
        },
      },
      directory,
      manifestPath,
      compatible: false,
      disabled: true,
      errors,
    };
  }

  private rebuildIndexes(): void {
    this.byKey = new Map();
    this.byName = new Map();
    this.byCapability = new Map();

    for (const record of this.records) {
      const key = sandboxSkillKey(record.manifest);
      this.byKey.set(key, record);
      const nameRecords = this.byName.get(record.manifest.name) ?? [];
      nameRecords.push(record);
      nameRecords.sort((left, right) =>
        right.manifest.version.localeCompare(left.manifest.version),
      );
      this.byName.set(record.manifest.name, nameRecords);

      if (!record.compatible || record.disabled) continue;
      for (const capability of record.manifest.capabilities) {
        const capabilityRecords = this.byCapability.get(capability) ?? [];
        capabilityRecords.push(record);
        capabilityRecords.sort((left, right) =>
          sandboxSkillKey(left.manifest).localeCompare(sandboxSkillKey(right.manifest)),
        );
        this.byCapability.set(capability, capabilityRecords);
      }
    }
  }
}
