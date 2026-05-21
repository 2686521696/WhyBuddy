import { describe, expect, it, vi } from "vitest";

import type { SkillBinding } from "../../../../shared/skill-contracts.js";

import { createCoreSkillRegistryAdapter } from "./skill-registry-adapter.js";

function makeBinding(skillId: string): SkillBinding {
  return {
    skillId,
    version: "1.0.0",
    enabled: true,
    resolvedSkill: {
      id: skillId,
      name: "Execution Playbook",
      category: "code",
      summary: "Produce executable steps.",
      prompt: "Context: {context}\nInput: {input}",
      requiredMcp: [],
      version: "1.0.0",
      tags: ["code"],
      enabled: true,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
    },
    mcpBindings: [],
  };
}

describe("createCoreSkillRegistryAdapter", () => {
  it("loads a core SkillRegistry skill as a role-scoped handle", async () => {
    const resolveSkills = vi.fn(() => [makeBinding("execution-playbook")]);
    const adapter = createCoreSkillRegistryAdapter(
      { resolveSkills },
      { now: () => new Date("2026-05-21T00:00:00.000Z") },
    );

    const handle = await adapter.loadForRole({
      roleId: "role-runtime-executor",
      skillId: "execution-playbook",
    });

    expect(resolveSkills).toHaveBeenCalledWith(["execution-playbook"]);
    expect(handle).not.toBeNull();
    expect(handle?.skillId).toBe("execution-playbook");
    expect(handle?.roleId).toBe("role-runtime-executor");
    expect(handle?.loadedAt).toBe("2026-05-21T00:00:00.000Z");
  });

  it("renders prompt skills through invoke instead of returning an empty placeholder", async () => {
    const adapter = createCoreSkillRegistryAdapter(
      { resolveSkills: () => [makeBinding("execution-playbook")] },
      { now: () => new Date("2026-05-21T00:00:00.000Z") },
    );
    const handle = await adapter.loadForRole({
      roleId: "role-runtime-executor",
      skillId: "execution-playbook",
    });

    const output = await handle?.invoke({
      context: { stage: "spec_docs" },
      input: "Generate implementation steps",
    });

    expect(output).toMatchObject({
      skillId: "execution-playbook",
      roleId: "role-runtime-executor",
      version: "1.0.0",
    });
    expect(String((output as { renderedPrompt?: string }).renderedPrompt)).toContain(
      "spec_docs",
    );
    expect(String((output as { renderedPrompt?: string }).renderedPrompt)).toContain(
      "Generate implementation steps",
    );
  });

  it("returns null when the core registry cannot resolve the skill", async () => {
    const adapter = createCoreSkillRegistryAdapter(
      { resolveSkills: () => [] },
      { now: () => new Date("2026-05-21T00:00:00.000Z") },
    );

    await expect(
      adapter.loadForRole({
        roleId: "role-runtime-executor",
        skillId: "missing",
      }),
    ).resolves.toBeNull();
  });
});
