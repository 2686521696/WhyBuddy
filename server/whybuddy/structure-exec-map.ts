/**
 * S13–S14 · structure.decompose server executor (/whybuddy execute-capability).
 */

import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import {
  buildStructurePrompt,
  redactStructurePrompt,
  collectStructureUpstreamSummary,
  runStructureDecomposePipeline,
} from "../../shared/blueprint/whybuddy-structure-chain.js";
import { getAIConfig } from "../core/ai-config.js";
import { callLLMJsonWithUsage } from "../core/llm-client.js";
import { callPoolJsonLlm, formatPoolSummaryTag } from "./pool-json-llm.js";
import type { RawExecutorResult } from "./capability-exec-map.js";

export {
  validateSpecTreeInvariants,
  buildTemplateTree,
  SpecTreeShapeSchema,
} from "../../shared/blueprint/whybuddy-structure-chain.js";
export type { SpecTreeNode, SpecTreeResponse } from "../../shared/blueprint/whybuddy-structure-chain.js";

export type StructureLlmFn = (
  systemPrompt: string,
  userPrompt: string,
  attempt: number
) => Promise<Record<string, unknown> | null>;

let structureLlmOverride: StructureLlmFn | undefined;

/** Test-only seam for S13/S14 mock retry paths. */
export function __setStructureLlmForTests(fn: StructureLlmFn | undefined): void {
  structureLlmOverride = fn;
}

const STRUCTURE_SYSTEM_PROMPT =
  "You are a SPEC Tree generator for WhyBuddy V5.1. Return ONLY JSON: " +
  '{"nodes":[{"id","parentId?","title","summary","type":"root|requirement|design|task|evidence","evidenceRef"}]} ' +
  "Rules: exactly 1 root, unique ids, parent reachable, no cycles, every node has evidenceRef.";

async function callStructureLlm(
  systemPrompt: string,
  userPrompt: string,
  attempt: number
): Promise<{ json: Record<string, unknown> | null; model?: string; tag?: string }> {
  if (structureLlmOverride) {
    const json = await structureLlmOverride(systemPrompt, userPrompt, attempt);
    return { json, model: "test-mock" };
  }
  const config = getAIConfig();
  const poolEnabled =
    process.env.WHYBUDDY_CAPABILITY_POOL_ENABLED !== "0" &&
    Boolean(process.env.BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS?.trim());
  if (poolEnabled) {
    const pooled = await callPoolJsonLlm<Record<string, unknown>>(systemPrompt, userPrompt, 0.2);
    if (pooled?.json) {
      return {
        json: pooled.json,
        model: pooled.model,
        tag: formatPoolSummaryTag(pooled.model, pooled.poolLabel),
      };
    }
  }
  if (!config.apiKey) return { json: null };
  try {
    const { json } = await callLLMJsonWithUsage<Record<string, unknown>>(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model: config.model, temperature: 0.2, timeoutMs: Math.min(config.timeoutMs, 90_000) }
    );
    return { json: json && typeof json === "object" ? json : null, model: config.model };
  } catch {
    return { json: null };
  }
}

export async function executeStructureDecomposeMapped(
  state: V5SessionState,
  inputArtifactIds: string[] = [],
  _roleId?: string,
  turnId?: string
): Promise<RawExecutorResult & { payload?: { schemaPassed: boolean; invariantPassed: boolean; gateLedger: string[] } }> {
  const goalText = state.goal?.text || "目标";
  const upstream = collectStructureUpstreamSummary(state, inputArtifactIds);
  const prompt = buildStructurePrompt({ goalText, upstreamSummary: upstream, turnId });
  const { redacted, redactionCount } = redactStructurePrompt(prompt);
  const gateLedgerPrefix = ["C_PROMPT:built", `C_REDACT:applied:${redactionCount}`];

  const result = await runStructureDecomposePipeline({
    goalText,
    userPrompt: redacted,
    gateLedgerPrefix,
    systemPrompt: STRUCTURE_SYSTEM_PROMPT,
    llmCall: async (attempt) => {
      const { json } = await callStructureLlm(STRUCTURE_SYSTEM_PROMPT, redacted, attempt);
      return json;
    },
  });

  return {
    title: result.title,
    summary: result.summary,
    content: result.content,
    provenance: result.provenance,
    payload: {
      ...result.payload,
      promptExcerpt: prompt.slice(0, 240),
      redactedExcerpt: redacted.slice(0, 240),
    },
  };
}

export function isStructureCapability(capabilityId: string): boolean {
  return capabilityId === "structure.decompose";
}