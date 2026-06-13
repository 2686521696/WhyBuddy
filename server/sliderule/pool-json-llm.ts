/**
 * SlideRule V5.1 — route auxiliary capabilities through the 5-key LLM pool
 * (BLUEPRINT_SPEC_DOCS_LLM_POOL_*), leaving the primary LLM for orchestrate + report.write.
 *
 * Performance: spec_docs pool is fast because it fires keys in parallel (runConcurrent).
 * SlideRule defaults to the same "race" semantics — first successful key wins, not 5× serial wait.
 */

import { readEnvCompat } from "../../shared/env/read-env-compat.js";
import {
  callLlmWithPoolKey,
  createLlmKeyPool,
  parseKeyPoolFromEnv,
  type LlmKeyPool,
  type LlmKeyPoolConfig,
  type LlmKeyPoolEntry,
} from "../routes/blueprint/llm-key-pool.js";

const POOL_DIALOGUE_CAPS = new Set([
  "intent.clarify",
  "gap.ask",
  "question.expand",
  "route.generate",
  "route.compare",
  "requirement.write",
  "structure.decompose",
]);

const POOL_DELIBERATION_CAPS = new Set([
  "counter.argue",
  "critique.generate",
  "rebuttal.resolve",
  "synthesis.merge",
]);

let cachedPool: LlmKeyPool | null | undefined;

/** Test / env hot-reload helper */
export function resetSlideRuleCapabilityPoolCache(): void {
  cachedPool = undefined;
}

export function resolveSlideRulePoolTimeoutMs(poolDefault?: number): number {
  const raw = readEnvCompat("SLIDERULE_POOL_TIMEOUT_MS");
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // Thinking models can be slow, but 300s serial retry × 5 keys is unacceptable for product UX.
  return Math.min(poolDefault ?? 300_000, 90_000);
}

/** parallel (race) | sequential — default parallel to match spec_docs pool UX. */
export function resolveSlideRulePoolRaceMode(): "parallel" | "sequential" {
  const raw = (readEnvCompat("SLIDERULE_POOL_RACE_MODE") || "parallel").toLowerCase();
  return raw === "sequential" ? "sequential" : "parallel";
}

/** When pool is configured, skip duplicate primary LLM hop (same endpoint / cooldown waste). */
export function shouldSkipPrimaryLlmAfterPoolExhausted(): boolean {
  if (readEnvCompat("SLIDERULE_SKIP_PRIMARY_AFTER_POOL") === "0") return false;
  return isSlideRuleCapabilityPoolEnabled();
}

export function isSlideRuleCapabilityPoolEnabled(): boolean {
  if (readEnvCompat("SLIDERULE_CAPABILITY_POOL_ENABLED") === "0") return false;
  return getSlideRuleCapabilityPool() !== null;
}

export function getSlideRuleCapabilityPool(): LlmKeyPool | null {
  if (cachedPool !== undefined) return cachedPool;
  const config = parseKeyPoolFromEnv();
  if (!config) {
    cachedPool = null;
    return null;
  }
  cachedPool = createLlmKeyPool(config);
  return cachedPool;
}

/** Primary LLM reserved for scheduling + final report; pool handles parallel aux caps. */
export function shouldRouteCapabilityToPool(capabilityId: string): boolean {
  if (capabilityId === "report.write" || capabilityId === "orchestrate.plan") return false;
  return (
    POOL_DIALOGUE_CAPS.has(capabilityId) ||
    POOL_DELIBERATION_CAPS.has(capabilityId) ||
    capabilityId === "risk.analyze"
  );
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export type PoolJsonLlmResult<T> = {
  json: T;
  model: string;
  poolLabel: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
  };
};

function buildPoolResult<T extends Record<string, unknown>>(
  json: T,
  config: LlmKeyPoolConfig,
  entry: LlmKeyPoolEntry,
  raw: string,
  systemPrompt: string,
  userPrompt: string
): PoolJsonLlmResult<T> {
  const inTok = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
  const outTok = Math.ceil(raw.length / 4);
  return {
    json,
    model: config.model,
    poolLabel: entry.label,
    usage: {
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: inTok + outTok,
      model: `${config.model}@${entry.label}`,
    },
  };
}

async function tryPoolKeyOnce<T extends Record<string, unknown>>(
  entry: LlmKeyPoolEntry,
  config: LlmKeyPoolConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<PoolJsonLlmResult<T> | null> {
  const raw = await callLlmWithPoolKey(entry, config, systemPrompt, userPrompt);
  const json = extractJsonObject(raw);
  if (!json) return null;
  return buildPoolResult(json as T, config, entry, raw, systemPrompt, userPrompt);
}

/** Race all pool keys; resolve on first valid JSON (matches spec_docs concurrency UX). */
async function callPoolJsonLlmParallel<T extends Record<string, unknown>>(
  pool: LlmKeyPool,
  config: LlmKeyPoolConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<PoolJsonLlmResult<T> | null> {
  const keys = [...config.keys];
  if (keys.length === 0) return null;

  return new Promise((resolve) => {
    let settled = false;
    let pending = keys.length;
    let failures = 0;

    const finish = (result: PoolJsonLlmResult<T> | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    for (const entry of keys) {
      tryPoolKeyOnce<T>(entry, config, systemPrompt, userPrompt)
        .then((result) => {
          if (result) {
            finish(result);
            return;
          }
          failures += 1;
          pending -= 1;
          if (pending === 0) finish(null);
        })
        .catch((e) => {
          failures += 1;
          pending -= 1;
          console.warn(
            `[sliderule-pool] key ${entry.label} failed:`,
            String((e as Error)?.message || e).slice(0, 160)
          );
          if (pending === 0) {
            if (failures > 0) {
              console.warn(`[sliderule-pool] race exhausted (${failures}/${keys.length} keys failed)`);
            }
            finish(null);
          }
        });
    }
  });
}

async function callPoolJsonLlmSequential<T extends Record<string, unknown>>(
  pool: LlmKeyPool,
  config: LlmKeyPoolConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<PoolJsonLlmResult<T> | null> {
  const attempts = Math.max(1, pool.size);
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    const entry = pool.next();
    try {
      const result = await tryPoolKeyOnce<T>(entry, config, systemPrompt, userPrompt);
      if (result) return result;
      lastErr = new Error("pool_json_parse_failed");
    } catch (e) {
      lastErr = e;
      console.warn(
        `[sliderule-pool] key ${entry.label} failed:`,
        String((e as Error)?.message || e).slice(0, 160)
      );
    }
  }

  if (lastErr) {
    console.warn(
      "[sliderule-pool] all keys exhausted:",
      String((lastErr as Error)?.message || lastErr).slice(0, 160)
    );
  }
  return null;
}

export async function callPoolJsonLlm<T extends Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.3
): Promise<PoolJsonLlmResult<T> | null> {
  void temperature; // pool HTTP uses fixed temperature in callLlmWithPoolKey today
  const pool = getSlideRuleCapabilityPool();
  if (!pool || readEnvCompat("SLIDERULE_CAPABILITY_POOL_ENABLED") === "0") return null;

  const config: LlmKeyPoolConfig = {
    ...pool.config,
    timeoutMs: resolveSlideRulePoolTimeoutMs(pool.config.timeoutMs),
  };

  const mode = resolveSlideRulePoolRaceMode();
  if (mode === "parallel") {
    return callPoolJsonLlmParallel<T>(pool, config, systemPrompt, userPrompt);
  }
  return callPoolJsonLlmSequential<T>(pool, config, systemPrompt, userPrompt);
}

export function formatPoolSummaryTag(model: string, poolLabel: string): string {
  return `[pool-llm:${model}#${poolLabel}]`;
}