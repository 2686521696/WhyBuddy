import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateSandboxSkillManifest } from "../../../shared/executor/skill-manifest.js";
import { SandboxSkillRegistry } from "./skill-registry.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sandbox-skill-registry-"));
  tempRoots.push(root);
  return root;
}

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "sample-skill",
    version: "0.1.0",
    description: "Sample skill",
    enabled: true,
    capabilities: ["artifact.json", "preview.json"],
    runtime: "node",
    entrypoint: "run.js",
    dependencies: [],
    inputs: { schema: "input.schema.json", examples: [] },
    outputs: { artifacts: ["report.json"], previewTypes: ["json"] },
    artifactRules: [
      {
        pattern: "report.json",
        mimeType: "application/json",
        previewType: "json",
      },
    ],
    security: {
      network: "none",
      filesystem: "workspace",
      browser: false,
      credentials: [],
    },
    ...overrides,
  };
}

function writeSkill(
  root: string,
  directory: string,
  manifest: Record<string, unknown>,
  entrypoint = "console.log('skill executed')\n",
): string {
  const skillDir = join(root, directory);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2), "utf-8");
  writeFileSync(join(skillDir, "run.js"), entrypoint, "utf-8");
  writeFileSync(join(skillDir, "input.schema.json"), "{}\n", "utf-8");
  return skillDir;
}

describe("sandbox skill manifest", () => {
  it("accepts valid manifests", () => {
    const validation = validateSandboxSkillManifest(validManifest());

    expect(validation.ok).toBe(true);
    expect(validation.manifest?.name).toBe("sample-skill");
    expect(validation.manifest?.capabilities).toContain("artifact.json");
  });

  it("rejects unknown capabilities with a clear error", () => {
    const validation = validateSandboxSkillManifest(
      validManifest({ capabilities: ["artifact.json", "quantum.browser"] }),
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain(
      'unknown capability "quantum.browser"',
    );
  });

  it("rejects absolute or traversal entrypoints", () => {
    const absolute = validateSandboxSkillManifest(
      validManifest({ entrypoint: "C:\\secret\\run.js" }),
    );
    const traversal = validateSandboxSkillManifest(
      validManifest({ entrypoint: "../run.js" }),
    );

    expect(absolute.ok).toBe(false);
    expect(absolute.errors.join("\n")).toContain("absolute paths are not allowed");
    expect(traversal.ok).toBe(false);
    expect(traversal.errors.join("\n")).toContain("path traversal is not allowed");
  });
});

describe("SandboxSkillRegistry", () => {
  it("loads seed skills and indexes capabilities", () => {
    const registry = new SandboxSkillRegistry("services/lobster-executor/skills");
    const snapshot = registry.snapshot();

    expect(snapshot.skills.map(skill => skill.manifest.name)).toContain(
      "browser-research",
    );
    expect(snapshot.skills.map(skill => skill.manifest.name)).toContain(
      "document-render",
    );
    expect(snapshot.capabilityIndex["browser.playwright"]).toContain(
      "browser-research@0.1.0",
    );
  });

  it("returns ranked matches by capability coverage and safety", () => {
    const root = createTempRoot();
    writeSkill(
      root,
      "safe-json",
      validManifest({
        name: "safe-json",
        capabilities: ["artifact.json", "preview.json"],
        security: {
          network: "none",
          filesystem: "workspace",
          browser: false,
          credentials: [],
        },
      }),
    );
    writeSkill(
      root,
      "network-json",
      validManifest({
        name: "network-json",
        capabilities: ["artifact.json", "preview.json"],
        security: {
          network: "required",
          filesystem: "workspace",
          browser: false,
          credentials: [],
        },
      }),
    );

    const registry = new SandboxSkillRegistry(root);
    const matches = registry.findByCapabilities(["artifact.json", "preview.json"]);

    expect(matches.map(match => match.skill.manifest.name)).toEqual([
      "safe-json",
      "network-json",
    ]);
    expect(matches[0].missingCapabilities).toEqual([]);
  });

  it("does not execute skill code during discovery", () => {
    const root = createTempRoot();
    const marker = join(root, "marker.txt");
    writeSkill(
      root,
      "side-effect-skill",
      validManifest({ name: "side-effect-skill" }),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`,
    );

    const registry = new SandboxSkillRegistry(root);

    expect(registry.list().map(skill => skill.manifest.name)).toContain(
      "side-effect-skill",
    );
    expect(existsSync(marker)).toBe(false);
  });

  it("keeps incompatible skills visible in snapshots", () => {
    const root = createTempRoot();
    const skillDir = join(root, "broken-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "skill.json"),
      JSON.stringify(validManifest({ name: "broken-skill", entrypoint: "missing.js" })),
      "utf-8",
    );

    const registry = new SandboxSkillRegistry(root);
    const broken = registry.snapshot().skills.find(
      skill => skill.manifest.name === "broken-skill",
    );

    expect(broken?.compatible).toBe(false);
    expect(broken?.errors.join("\n")).toContain("entrypoint not found");
    expect(registry.list().map(skill => skill.manifest.name)).not.toContain(
      "broken-skill",
    );
  });
});
