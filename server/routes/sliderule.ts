/**
 * SlideRule V5 Session Store HTTP API (pilot durable).
 *
 * Provides the 4 endpoints (surface 100% unchanged from skeleton):
 *   GET    /api/sliderule/sessions           -> list
 *   GET    /api/sliderule/sessions/:sessionId -> load one
 *   PUT    /api/sliderule/sessions/:sessionId -> save (upsert)
 *   DELETE /api/sliderule/sessions/:sessionId -> delete
 *
 * Now backed by durable JSON file (data/sliderule-sessions.json) for the Durable Store Pilot.
 * In-memory Map is a hot cache only. Every mutate flushes to disk (atomic tmp+rename).
 * Loads from disk at module init. Re-init / reload-from-disk supported for smoke/tests only
 * via the test-only __reload endpoint (or the exported helper for direct use).
 *
 * HTTP surface + client HttpSlideRuleSessionStore contract remain identical and swappable.
 * (tsx watch on server/ files will pick up changes live.)
 */

import { readEnvCompat } from "../../shared/env/read-env-compat.js";
import express, { Router, type Request, type Response } from "express";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import { stripProjectionForPersist } from "../../shared/blueprint/sliderule-projection-persist.js";
import { applyReplayOnSave } from "../../shared/blueprint/sliderule-session-replay.js";
import { sanitizeGoalStatusOnPut } from "../../shared/blueprint/sliderule-coverage-gate.js";
import { getAIConfig } from "../core/ai-config.js";
import { callLLM, callLLMJson, callLLMJsonWithUsage } from "../core/llm-client.js";
import { buildStructuredReport } from "../../shared/blueprint/sliderule-report-builder.js";
import {
  buildCapabilityContext,
  formatContextForPrompt,
  classifyCapabilityTier,
} from "../../shared/blueprint/sliderule-capability-context.js";
import {
  getOutputContract,
  renderContractForPrompt,
  renderContractSchema,
} from "../../shared/blueprint/sliderule-output-contracts.js";
import { buildCapabilityPrompt } from "../../shared/blueprint/sliderule-capability-prompts.js";
import { buildFallbackNarration } from "../../shared/blueprint/sliderule-deliverable-sanitize.js";
import type { GoalStatusForNarration } from "../../shared/blueprint/sliderule-deliverable-sanitize.js";
import {
  buildNarrationSystemPrompt,
  buildNarrationUserPrompt,
  capabilityDomainAnchoringBlock,
  detectNarrationHijack,
} from "../../shared/blueprint/sliderule-narration-immunity.js";
import { executeGithubMcpCapability } from "../sliderule/github-mcp-adapter.js";
import { executeRepoStaticInspect } from "../sliderule/repo-static-analyzer.js";
import {
  executeEvidenceSearchMapped,
  executeRepoInspectMapped,
} from "../sliderule/capability-exec-map.js";
import {
  executeStructureDecomposeMapped,
  isStructureCapability,
} from "../sliderule/structure-exec-map.js";
import {
  executeDeliveryCapabilityMapped,
  isDeliveryCapability,
} from "../sliderule/delivery-exec-map.js";
import {
  executeVisualCapabilityMapped,
  isVisualCapability,
} from "../sliderule/visual-exec-map.js";
import {
  executeDeliberationCapabilityMapped,
  isDeliberationCapability,
} from "../sliderule/deliberation-exec-map.js";
import {
  executeDialogueCapability,
  isDialogueCapability,
} from "../sliderule/dialogue-exec-map.js";
import {
  buildCapabilityLlmFallback,
  isLlmContentHijackError,
} from "../sliderule/capability-llm-fallback.js";
import { shouldSkipPrimaryLlmAfterPoolExhausted } from "../sliderule/pool-json-llm.js";
import { executeOrchestratePlan } from "../sliderule/orchestrate-plan.js";
import {
  callPoolJsonLlm,
  formatPoolSummaryTag,
  getSlideRuleCapabilityPool,
  isSlideRuleCapabilityPoolEnabled,
} from "../sliderule/pool-json-llm.js";
import * as fs from "fs";
import * as path from "path";

const router = Router();

// Durable file-backed pilot store.
// - DATA_FILE lives under data/ (runtime artifacts are explicitly gitignored below).
// - Map is hot cache for speed + simple list/GET shaping.
// - load/reload from disk; flushToDisk after every mutate (set/delete/clear) — now returns boolean.
// - Atomic write: write .tmp then renameSync.
const SESSIONS_FILE_ENV = readEnvCompat("SLIDERULE_SESSIONS_FILE");
const DATA_FILE = SESSIONS_FILE_ENV
  ? path.resolve(process.cwd(), SESSIONS_FILE_ENV)
  : path.resolve(process.cwd(), "data", "sliderule-sessions.json");

// Rename-migration shim: the default sessions file used to be data/whybuddy-sessions.json.
// Copy (not move — keep the old file for rollback) once, only when the new file doesn't exist yet.
const LEGACY_DATA_FILE = path.resolve(process.cwd(), "data", "whybuddy-sessions.json");
function migrateLegacySessionsFile(): void {
  if (SESSIONS_FILE_ENV) return; // explicit path → operator owns the location, nothing to migrate
  try {
    if (!fs.existsSync(DATA_FILE) && fs.existsSync(LEGACY_DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.copyFileSync(LEGACY_DATA_FILE, DATA_FILE);
      console.log("[sliderule-store] migrated legacy sessions file:", LEGACY_DATA_FILE, "->", DATA_FILE);
    }
  } catch (e) {
    console.error("[sliderule-store] legacy sessions file migration failed (starting from new file):", (e as Error)?.message || e);
  }
}

const sessions = new Map<string, V5SessionState>();

function loadFromDisk(): void {
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const arr: Array<[string, V5SessionState]> = raw ? JSON.parse(raw) : [];
      sessions.clear();
      for (const [k, v] of arr) {
        if (k && v) sessions.set(k, v);
      }
    }
  } catch (e) {
    // Pilot: never crash the server on bad/partial file; start empty and let next flush repair.
    console.error("[sliderule-store] loadFromDisk failed (starting empty):", (e as Error)?.message || e);
  }
}

function reloadFromDisk(): void {
  sessions.clear();
  loadFromDisk();
}

function flushToDisk(): boolean {
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    const payload = JSON.stringify(Array.from(sessions.entries()), null, 2);
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, DATA_FILE);
    return true;
  } catch (e) {
    console.error("[sliderule-store] flushToDisk failed:", (e as Error)?.message || e);
    return false;
  }
}

// Initial load (runs once when tsx loads this module; watch will re-exec on file change).
migrateLegacySessionsFile();
loadFromDisk();

// GET /api/sliderule/sessions
// Returns { sessions: [...] } for easy consumption (also accepts raw array on client).
router.get("/sessions", (_req: Request, res: Response) => {
  const list = Array.from(sessions.values()).map((s) => ({
    sessionId: s.sessionId,
    goal: s.goal?.text || "",
    createdAt: (s as any).createdAt,
    lastActive: (s as any).lastActive,
    artifactCount: (s.artifacts || []).length,
    phase: (s as any).runtimePhase,
  }));
  res.json({ sessions: list });
});

// GET /api/sliderule/sessions/:sessionId
router.get("/sessions/:sessionId", (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const s = sessions.get(sid);
  if (!s) {
    return res.status(404).json({ error: "not_found", sessionId: sid });
  }
  res.json(s);
});

// PUT /api/sliderule/sessions/:sessionId
// Body: the full V5SessionState (or a partial that we treat as the new truth for the session).
// N1 guard strips unauthorized goal.status=clear writes (GCOV bypass).
router.put("/sessions/:sessionId", express.json({ limit: "2mb" }), (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const body = (req.body || {}) as Partial<V5SessionState> & { sessionId?: string };

  const previous = sessions.get(sid);

  // Force the key from the URL (defense in depth)
  let state: V5SessionState = sanitizeGoalStatusOnPut(
    {
      ...(body as V5SessionState),
      sessionId: sid,
    },
    previous
  );

  // Stamp lastActive for list views (client also does this, server does it too for purity)
  (state as any).lastActive = new Date().toISOString();
  if (!(state as any).createdAt) {
    const existing = sessions.get(sid);
    (state as any).createdAt = (existing as any)?.createdAt || (state as any).lastActive;
  }

  state = applyReplayOnSave(previous, state);
  state = stripProjectionForPersist(state);
  sessions.set(sid, state);
  if (!flushToDisk()) {
    if (previous) sessions.set(sid, previous);
    else sessions.delete(sid);
    return res.status(500).json({ error: "persist_failed" });
  }
  res.status(200).json(state);
});

// DELETE /api/sliderule/sessions/:sessionId
router.delete("/sessions/:sessionId", (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const existed = sessions.delete(sid);
  if (!flushToDisk()) {
    return res.status(500).end();
  }
  // 204 No Content is conventional for successful DELETE even if it didn't exist
  res.status(204).end();
});

// Test-only helper routes (used by smoke + dev tooling for durable pilot verification).
// These are **not** part of the official 4-endpoint contract.
//
// Production isolation:
// - Only registered when NODE_ENV !== "production" (normal dev/test)
// - Or when the explicit escape hatch SLIDERULE_ENABLE_TEST_HELPERS=1 is set.
// This prevents accidental (or malicious) use of __clear / __reload against a
// production-like deployment of the session store.
export const isTestHelperEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  readEnvCompat("SLIDERULE_ENABLE_TEST_HELPERS") === "1";

const enableTestHelpers = isTestHelperEnabled();

// (Optional nicety) allow a manual clear for dev / tests against the real server
// Not part of the official 4-endpoint contract.
if (enableTestHelpers) {
  router.post("/sessions/__clear", (_req: Request, res: Response) => {
    sessions.clear();
    if (!flushToDisk()) {
      return res.status(500).end();
    }
    res.status(204).end();
  });
}

// (Optional nicety) allow a manual reload-from-durable-file for dev / tests against the real server.
// Triggers live server backing re-init from the on-disk JSON (clear + loadFromDisk).
// This is the correct way for the smoke (or any external test) to prove "re-init recovery"
// against the *live* serving process. Not part of the official 4-endpoint contract.
if (enableTestHelpers) {
  router.post("/sessions/__reload", (_req: Request, res: Response) => {
    reloadFromDisk();
    res.status(204).end();
  });
}

type SlideRuleRespondBody = {
  state?: V5SessionState;
  turnId?: string;
  userText?: string;
  intervention?: { intent?: string } | null;
  selected?: Array<{ capabilityId?: string; roleId?: string }>;
  artifacts?: Array<{ kind?: string; title?: string; summary?: string; realLlm?: boolean }>;
  mainArtifact?: { kind?: string; title?: string; content?: string } | null;
  goalStatusBefore?: string;
  planReason?: string | null;
  skipped?: Array<{ capabilityId?: string; reason: string }>;
};

function buildRespondUserPrompt(body: SlideRuleRespondBody): string {
  const goalStatus = (body.state as any)?.goal?.status as GoalStatusForNarration;
  const selected = (body.selected || [])
    .map((s) => `${s.capabilityId || "?"}×${s.roleId || "?"}`)
    .join(", ");
  const artifactSummaries = (body.artifacts || [])
    .map(
      (a, i) =>
        `${i + 1}. [${a.kind || "item"}] ${String(a.title || "").slice(0, 80)} — ${String(a.summary || "").slice(0, 200)}`
    )
    .join("\n");
  const skippedSummary = (body.skipped || [])
    .map((s) => `${s.capabilityId || "?"}:${s.reason}`)
    .join("; ");

  return buildNarrationUserPrompt({
    turnId: String(body.turnId || ""),
    userText: body.userText || "",
    goalText: (body.state as any)?.goal?.text || "",
    goalStatus: goalStatus || "needs_refinement",
    goalStatusBefore: body.goalStatusBefore,
    interventionIntent: body.intervention?.intent,
    selectedCount: (body.selected || []).length,
    selectedLine: selected || "(none)",
    planReason: body.planReason,
    skippedSummary: skippedSummary || undefined,
    artifactSummaries: artifactSummaries || "(none)",
    mainArtifactContent: body.mainArtifact?.content || null,
  });
}

export type NarrationFallbackReason =
  | "no_api_key"
  | "llm_error"
  | "empty_response"
  | "hijacked";

// GET /api/sliderule/ai-topology — 6-AI layout (1 primary scheduler + 5-key aux pool).
router.get("/ai-topology", (_req: Request, res: Response) => {
  const primary = getAIConfig();
  const pool = getSlideRuleCapabilityPool();
  res.json({
    primary: {
      role: "orchestrate + report.write",
      model: primary.model,
      configured: Boolean(primary.apiKey),
    },
    auxPool: {
      enabled: isSlideRuleCapabilityPoolEnabled(),
      size: pool?.size ?? 0,
      model: pool?.config.model ?? null,
      capabilities: [
        "intent.clarify",
        "route.generate",
        "route.compare",
        "requirement.write",
        "risk.analyze",
        "counter.argue",
        "critique.generate",
        "synthesis.merge",
      ],
    },
    parallelSameRound: true,
  });
});

// POST /api/sliderule/orchestrate-plan — scheduling proposal (LLM or heuristic fallback, always 200).
router.post("/orchestrate-plan", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const body = (req.body || {}) as {
    state?: V5SessionState;
    turnId?: string;
    userText?: string;
    intervention?: { intent?: string; targetArtifactId?: string; targetDecisionId?: string } | null;
  };

  if (!body.turnId || !String(body.turnId).trim()) {
    return res.status(400).json({ error: "bad_request", message: "turnId is required" });
  }
  if (!body.state) {
    return res.status(400).json({ error: "bad_request", message: "state is required" });
  }

  const result = await executeOrchestratePlan({
    state: body.state,
    turnId: String(body.turnId),
    userText: String(body.userText || ""),
    intervention: body.intervention ?? null,
  });

  return res.json(result);
});

// POST /api/sliderule/respond — user-facing narration (LLM or deterministic fallback, always 200).
router.post("/respond", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const body = (req.body || {}) as SlideRuleRespondBody;

  if (!body.turnId || !String(body.turnId).trim()) {
    return res.status(400).json({ error: "bad_request", message: "turnId is required" });
  }
  if (!body.state) {
    return res.status(400).json({ error: "bad_request", message: "state is required" });
  }

  const goalStatus = (body.state as any)?.goal?.status as GoalStatusForNarration;
  const selectedCount = (body.selected || []).length;
  const hasMain = Boolean(body.mainArtifact?.content);

  const fallback = () =>
    buildFallbackNarration({
      userText: body.userText || "",
      goalStatus,
      goalStatusBefore: body.goalStatusBefore as GoalStatusForNarration,
      selectedCount,
      interventionIntent: body.intervention?.intent,
      mainArtifactContent: body.mainArtifact?.content || null,
      planReason: body.planReason,
      skipped: body.skipped,
      sanitizeMainArtifact: true,
    });

  try {
    const config = getAIConfig();
    if (!config.apiKey) {
      console.warn("[sliderule] /respond fallback: no_api_key (LLM_API_KEY/OPENAI_API_KEY unset)");
      return res.json({
        text: fallback(),
        source: "fallback" as const,
        reason: "no_api_key" as const,
      });
    }

    const { content, usage } = await callLLM(
      [
        { role: "system", content: buildNarrationSystemPrompt(hasMain, selectedCount) },
        { role: "user", content: buildRespondUserPrompt(body) },
      ],
      {
        model: config.model,
        temperature: 0.4,
        // Align with execute-capability (120s cap). gpt-5.5 + high reasoning often exceeds 45s.
        timeoutMs: Math.min(config.timeoutMs, 120_000),
      } as any
    );

    const text = String(content || "").trim();
    if (!text) {
      console.warn("[sliderule] /respond fallback: empty_response from LLM");
      return res.json({
        text: fallback(),
        source: "fallback" as const,
        reason: "empty_response" as const,
      });
    }

    const hijack = detectNarrationHijack(text);
    if (hijack.hijacked) {
      console.warn("[sliderule] /respond fallback: hijacked —", hijack.reason);
      return res.json({
        text: fallback(),
        source: "fallback" as const,
        reason: "hijacked" as const,
      });
    }

    return res.json({
      text,
      source: "llm" as const,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            model: config.model,
          }
        : undefined,
    });
  } catch (e: any) {
    console.warn("[sliderule] /respond fallback: llm_error —", String(e?.message || e).slice(0, 200));
    return res.json({
      text: fallback(),
      source: "fallback" as const,
      reason: "llm_error" as const,
    });
  }
});

// POST /api/sliderule/execute-capability
// Server-side LLM execution for the SlideRule V5 capability seam
// (risk/report + D1 dialogue + R2 deliberation + F1 mapped caps).
// Reuses the project's unified LLM stack (getAIConfig + callLLMJson) exactly like /autopilot and blueprint routes.
// Input: the same args the LlmCapabilityProvider receives on the client.
// Output: strictly the raw 4-field shape { title, summary, content, provenance? }.
// On any config/LLM error we return 5xx (or throw) so the client LlmCapabilityExecutor reliably falls back
// to PilotRealCapabilityExecutor. This route never touches commitArtifact, Trust Gate, producedBy, or session state.
router.post("/execute-capability", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const {
    capabilityId,
    state,
    inputArtifactIds = [],
    roleId,
    turnId,
    deliberationMaxRounds,
    targetRoleId,
  } = (req.body || {}) as {
    capabilityId?: string;
    state?: V5SessionState;
    inputArtifactIds?: string[];
    roleId?: string;
    turnId?: string;
    deliberationMaxRounds?: number;
    targetRoleId?: string;
  };

  if (!capabilityId || !state || !turnId) {
    return res.status(400).json({ error: "bad_request", message: "capabilityId, state and turnId are required" });
  }

  try {
    // GitHub MCP source/evidence capabilities (P0 Autopilot absorption).
    // These bypass LLM entirely and return the raw executor shape using the
    // existing mcp-github-source reusable modules (url parse + safe http + summary derivation).
    // SlideRule runtime still owns commitArtifact, Trust Gate, producedBy, evidenceRefs, etc.
    if (capabilityId === "source.github.inspect" || capabilityId === "evidence.github.collect") {
      const gh = await executeGithubMcpCapability(capabilityId, state, inputArtifactIds);
      return res.json(gh);
    }

    if (capabilityId === "repo.static.inspect") {
      const result = await executeRepoStaticInspect(capabilityId, state, inputArtifactIds);
      return res.json(result);
    }

    if (capabilityId === "repo.inspect") {
      const result = await executeRepoInspectMapped(state, inputArtifactIds);
      return res.json(result);
    }

    if (capabilityId === "evidence.search") {
      const result = await executeEvidenceSearchMapped(state, inputArtifactIds, roleId);
      return res.json(result);
    }

    if (isStructureCapability(capabilityId)) {
      const result = await executeStructureDecomposeMapped(
        state,
        inputArtifactIds,
        roleId,
        turnId
      );
      return res.json(result);
    }

    if (isDeliveryCapability(capabilityId)) {
      const result = await executeDeliveryCapabilityMapped(capabilityId, state, inputArtifactIds);
      return res.json(result);
    }

    if (isVisualCapability(capabilityId)) {
      const result = await executeVisualCapabilityMapped(capabilityId, state);
      return res.json(result);
    }

    const isLlmBacked =
      isDeliberationCapability(capabilityId) ||
      isDialogueCapability(capabilityId) ||
      capabilityId === "risk.analyze" ||
      capabilityId === "report.write";

    if (!isLlmBacked) {
      const err = new Error(`Server LLM provider does not handle capability: ${capabilityId}`);
      (err as any).status = 400;
      throw err;
    }

    const config = getAIConfig();

    if (isDeliberationCapability(capabilityId)) {
      const result = await executeDeliberationCapabilityMapped({
        capabilityId: capabilityId as any,
        state,
        inputArtifactIds,
        roleId,
        turnId,
        deliberationMaxRounds,
        targetRoleId,
      });
      return res.json(result);
    }

    if (isDialogueCapability(capabilityId)) {
      const result = await executeDialogueCapability({
        capabilityId: capabilityId as any,
        state,
        inputArtifactIds,
        roleId,
        turnId,
      });
      return res.json(result);
    }

    // B1: 使用共享 prompt 构造（单一真相）。server 路由现在是薄壳。
    // 同一套逻辑将被 browser-llm provider 复用。
    const { systemPrompt, userPrompt, maxTokens, temperature } = buildCapabilityPrompt({
      capabilityId,
      state: state as any,
      inputArtifactIds,
      roleId,
      turnId,
    });

    if (capabilityId === "risk.analyze") {
      const pooledRisk = await callPoolJsonLlm<{
        title?: string;
        summary?: string;
        content?: string;
      }>(systemPrompt, userPrompt, temperature);
      if (pooledRisk?.json) {
        const title = String(pooledRisk.json.title || "Risk Analysis").trim();
        const summary = String(pooledRisk.json.summary || "").trim();
        const content = String(pooledRisk.json.content || "").trim() || "Model returned no content.";
        const tag = formatPoolSummaryTag(pooledRisk.model, pooledRisk.poolLabel);
        return res.json({
          title,
          summary: summary ? `${summary} ${tag}` : tag,
          content,
          provenance: "llm" as const,
          usage: pooledRisk.usage,
        });
      }
    } else if (capabilityId === "report.write") {
      // report 走直接 LLM（无 pool 特殊处理）
    }

    if (
      capabilityId === "risk.analyze" &&
      shouldSkipPrimaryLlmAfterPoolExhausted()
    ) {
      throw new Error("pool_exhausted_skip_primary");
    }

    if (!config.apiKey) {
      throw new Error("LLM not configured (no apiKey from getAIConfig)");
    }

    const { json: result, usage } = await callLLMJsonWithUsage<{ title?: string; summary?: string; content?: string }>(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        model: config.model,
        temperature,
        maxTokens,
        timeoutMs: Math.min(config.timeoutMs, 120000),
      } as any
    );

    const title = (result.title || (capabilityId === "risk.analyze" ? "Risk Analysis" : "Evidence Report")).trim();
    const summary = (result.summary || "").trim();
    const content = (result.content || "Model returned no content.").trim();

    return res.json({
      title,
      summary: summary ? `${summary} [server-llm:${config.model}]` : `[server-llm:${config.model}]`,
      content,
      provenance: "llm" as const,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            model: config.model,
          }
        : undefined,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = e?.status || 500;

    if (status === 400 || status === 422) {
      const code = "unsupported_capability";
      return res.status(status).json({ error: code, message: msg.slice(0, 300) });
    }

    if (isLlmContentHijackError(msg)) {
      console.error("[sliderule] /execute-capability hijack blocked:", msg.slice(0, 200));
      return res.status(500).json({ error: "llm_execution_failed", message: msg.slice(0, 300) });
    }

    const fb = buildCapabilityLlmFallback({
      capabilityId,
      state,
      inputArtifactIds,
      roleId,
      turnId,
      reason: msg.slice(0, 120),
    });
    if (fb) {
      console.warn("[sliderule] /execute-capability degraded:", msg.slice(0, 200));
      return res.json(fb);
    }

    console.error("[sliderule] /execute-capability failed:", msg);
    return res.status(500).json({ error: "llm_execution_failed", message: msg.slice(0, 300) });
  }
});

export default router;

/**
 * Durability pilot test helpers (smoke + future server tests only).
 * - Never called from normal request handlers or the public HTTP surface.
 * - Allow the smoke to prove "re-initialize backing from durable file recovers prior writes"
 *   without killing the dev server process (via the __reload endpoint) or for direct use.
 */
export const __SLIDERULE_SESSIONS_FILE = DATA_FILE;

export function __reloadFromDisk(): void {
  reloadFromDisk();
}
