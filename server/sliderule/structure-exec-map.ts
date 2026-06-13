/**
 * S13–S14 · structure.decompose server executor (/sliderule execute-capability).
 */

import { readEnvCompat } from "../../shared/env/read-env-compat.js";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import {
  buildStructurePrompt,
  redactStructurePrompt,
  collectStructureUpstreamSummary,
  runStructureDecomposePipeline,
} from "../../shared/blueprint/sliderule-structure-chain.js";
import {
  enrichStructureUpstream,
  buildRichStructureContextForOldDerivation,
  buildRichSpecTreePromptFromOld,
  tryDeriveWithOldPipeline,
} from "./structure-derivation-adapter.js";
import { getOutputContract, renderContractForPrompt } from "../../shared/blueprint/sliderule-output-contracts.js";
import { getAIConfig } from "../core/ai-config.js";
import { callLLMJsonWithUsage } from "../core/llm-client.js";
import { callPoolJsonLlm, formatPoolSummaryTag } from "./pool-json-llm.js";
import type { RawExecutorResult } from "./capability-exec-map.js";

export {
  validateSpecTreeInvariants,
  buildTemplateTree,
  SpecTreeShapeSchema,
} from "../../shared/blueprint/sliderule-structure-chain.js";
export type { SpecTreeNode, SpecTreeResponse } from "../../shared/blueprint/sliderule-structure-chain.js";

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
  "You are a SPEC Tree generator for SlideRule V5.1. Return ONLY JSON: " +
  '{"nodes":[{"id","parentId?","title","summary","type":"root|requirement|design|task|evidence","evidenceRef"}]} ' +
  "Rules: exactly 1 root, unique ids, parent reachable, no cycles, every node has evidenceRef. " +
  "Per K2 output contract: nodes >= max(8, success criteria * 2), depth >=3, every requirement node must have EARS-style acceptance + evidenceRef.";

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
    readEnvCompat("SLIDERULE_CAPABILITY_POOL_ENABLED") !== "0" &&
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
  const baseUpstream = collectStructureUpstreamSummary(state, inputArtifactIds);
  // K5: 适配层复用旧管线上下文 (buildRichSpecTreePromptFromOld + route/repo extracts)
  // 保持 V5 prompt 结构 (C_PROMPT 等) 以便红action + pipeline + G_SCHEMA/G_INV/ledger 复用。
  // 追加旧 prompt builder 的 rich payload 作为额外上下文指导 (parent/route/repo/schema)。
  // 同时加 K2 contract。 pilot 仍 template。
  const upstream = enrichStructureUpstream(baseUpstream, state, inputArtifactIds);
  const prompt = buildStructurePrompt({ goalText, upstreamSummary: upstream, turnId });
  const richOld = buildRichSpecTreePromptFromOld(state, inputArtifactIds);
  const contract = getOutputContract("structure.decompose");
  const contractBlock = contract ? "\n\n" + renderContractForPrompt(contract) : "";
  const fullUserPrompt = `${prompt}\n\n[rich context reused from old derivation pipeline]\n${richOld}` + contractBlock;
  const { redacted, redactionCount } = redactStructurePrompt(fullUserPrompt);
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

  // K5 explicit: attempt full old derivation pipeline as fallback / backfill (for nodes, comparison, or when primary enriched LLM path is weak).
  // This makes the "tryDeriveWithOldPipeline" reuse visible and exercised in the live structure executor (not just prompt enrichment).
  // Safe: non-blocking, only attaches if successful.
  try {
    const old = await tryDeriveWithOldPipeline(state, inputArtifactIds);
    if (old && old.nodes && old.nodes.length > 0) {
      (result as any).oldDerivationFallback = { nodes: old.nodes, fromOldDerivation: true };
    }
  } catch {
    // silent; primary path always wins
  }

  return {
    title: result.title,
    summary: result.summary,
    content: result.content,
    provenance: result.provenance,
    payload: {
      ...result.payload,
      promptExcerpt: fullUserPrompt.slice(0, 800), // larger to capture rich old context for K5 verification
      redactedExcerpt: redacted.slice(0, 240),
    },
  };
}

export function isStructureCapability(capabilityId: string): boolean {
  return capabilityId === "structure.decompose";
}