import type { SkillBinding } from "../../../../shared/skill-contracts.js";

import type {
  SkillHandle,
  SkillRegistryDependency,
} from "./skills-binder.js";

export interface CoreSkillRegistryLike {
  resolveSkills(skillIds: string[]): SkillBinding[];
}

export interface CreateCoreSkillRegistryAdapterOptions {
  now?: () => Date;
}

function stringifyForPrompt(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderSkillPrompt(
  prompt: string,
  input: unknown,
): { renderedPrompt: string; contextText: string; inputText: string } {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : undefined;
  const contextText = stringifyForPrompt(record?.context ?? {});
  const inputText = stringifyForPrompt(record?.input ?? input);
  return {
    renderedPrompt: prompt
      .replaceAll("{context}", contextText)
      .replaceAll("{input}", inputText),
    contextText,
    inputText,
  };
}

export function createCoreSkillRegistryAdapter(
  registry: CoreSkillRegistryLike,
  options: CreateCoreSkillRegistryAdapterOptions = {},
): SkillRegistryDependency {
  const now = options.now ?? (() => new Date());
  return {
    async loadForRole({ roleId, skillId }): Promise<SkillHandle | null> {
      const binding = registry.resolveSkills([skillId]).find(item =>
        item.resolvedSkill.id === skillId,
      );
      if (!binding) {
        return null;
      }
      const skill = binding.resolvedSkill;
      const loadedAt = now().toISOString();
      return {
        skillId: skill.id,
        roleId,
        loadedAt,
        async invoke(input: unknown) {
          const rendered = renderSkillPrompt(skill.prompt, input);
          return {
            skillId: skill.id,
            roleId,
            version: skill.version,
            name: skill.name,
            category: skill.category,
            summary: skill.summary,
            renderedPrompt: rendered.renderedPrompt,
            context: rendered.contextText,
            input: rendered.inputText,
            requiredMcp: skill.requiredMcp,
            tags: skill.tags,
          };
        },
      };
    },
  };
}
