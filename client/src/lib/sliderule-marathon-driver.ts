/**
 * M2: MarathonDriver — thin orchestration layer on top of driveReasoningSession.
 * Inner spine (gates, ledger, single-writer, GCOV) zero change.
 * "自主决定 WHAT，机械裁决 WHETHER" — replay at drive layer.
 *
 * Per spec: reuses driveReasoningSession in loop; handles stopReasons for auto-seed (stub frontier for now).
 * stopSignal (M1) propagated.
 * Mode: "single" (current default, bypass) vs "marathon" (autopilot).
 */

import type { V5SessionState, CapabilityCostRecord } from "@shared/blueprint/v5-reasoning-state";
import type { ReentryStopReason } from "./sliderule-runtime";
import * as SlideRuleRuntime from "./sliderule-runtime";
import { buildStructuredReport } from "@shared/blueprint/sliderule-report-builder";
import { buildCapabilityPrompt } from "@shared/blueprint/sliderule-capability-prompts";

export type MarathonStopReason =
  | "user_interrupted" // M1
  | "session_budget_exhausted" // M5
  | "frontier_exhausted" // M3
  | "await_human"; // M4 true gap, resumable

export interface MarathonOptions {
  stopSignal: AbortSignal;
  budget: { maxTokens?: number; declaredAt: string };
  policy: { autoConfirmRoute?: string; autoWaiveNonBlockingGaps?: boolean };
  onRoundComplete?: (digest: any, round: any) => void;
  /** Passthrough to each inner driveReasoningSession round (BYOK pool executor etc.). */
  executor?: SlideRuleRuntime.DriveReasoningOptions["executor"];
  router?: SlideRuleRuntime.DriveReasoningOptions["router"];
  maxLoopsPerMessage?: SlideRuleRuntime.DriveReasoningOptions["maxLoopsPerMessage"];
  onCapabilityRound?: SlideRuleRuntime.DriveReasoningOptions["onCapabilityRound"];
  onLoopComplete?: SlideRuleRuntime.DriveReasoningOptions["onLoopComplete"];
}

export interface MarathonResult {
  finalState: V5SessionState;
  rounds: Array<{
    loopTurnId: string;
    stopReason: ReentryStopReason | MarathonStopReason;
    seed?: string; // auto-seeded for next
  }>;
  stopReason: MarathonStopReason;
  publishClosure?: any;
}

export type DriveFullStatus =
  | "python_success"
  | "timeout"
  | "python_unavailable"
  | "fallback";

async function driveMarathonViaPython(
  state: V5SessionState,
  seedText: string,
  opts: MarathonOptions
): Promise<MarathonResult | null> {
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch("/api/sliderule/drive-marathon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts.stopSignal,
      body: JSON.stringify({
        state,
        seedText,
        budget: opts.budget,
        policy: opts.policy,
        maxRounds: 8,
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.backend !== "python" || body?.budgetAuthority !== "python" || !body?.state) return null;
    const rounds = Array.isArray(body.rounds) ? body.rounds : [];
    for (const round of rounds) {
      opts.onRoundComplete?.({}, round);
    }
    const finalState = body.publishClosure
      ? { ...(body.state as V5SessionState), publishClosure: body.publishClosure }
      : (body.state as V5SessionState);
    return {
      finalState,
      rounds,
      stopReason: (body.stopReason || "await_human") as MarathonStopReason,
      publishClosure: body.publishClosure,
    };
  } catch {
    return null;
  }
}

export function classifyDriveFullStatus(
  result:
    | { finalState?: V5SessionState | null; error?: string | null; status?: number | null }
    | null
    | undefined
): DriveFullStatus {
  if (result?.finalState) return "python_success";
  const error = String(result?.error || "").toLowerCase();
  if (error.includes("timeout") || result?.status === 504) return "timeout";
  if (error.includes("python_unavailable") || error.includes("unavailable")) {
    return "python_unavailable";
  }
  return "fallback";
}

export async function driveFullViaPython(
  state: V5SessionState,
  userText: string,
  opts: { stopSignal?: AbortSignal; maxLoops?: number; turnId?: string } = {}
): Promise<{ finalState: V5SessionState; stopReason?: string; loops?: any[]; publishClosure?: any } | null> {
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch("/api/sliderule/drive-full", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts.stopSignal,
      body: JSON.stringify({
        state,
        userText,
        max_loops: opts.maxLoops ?? 10,
        turnId: opts.turnId,
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.backend !== "python" || !body?.state) return null;
    const finalState: any = { ...(body.state as V5SessionState) };
    if (body.publishClosure !== undefined) {
      finalState.publishClosure = body.publishClosure;
    }
    if (body.skillRuntimeGraph !== undefined) {
      finalState.skillRuntimeGraph = body.skillRuntimeGraph;
    }
    return {
      finalState,
      stopReason: body.stopReason || "completed",
      publishClosure: body.publishClosure,
      loops: opts.turnId
        ? [
            {
              loopTurnId: opts.turnId,
              plan: { selected: [], reason: "python_drive_full", expectedArtifacts: [] },
              committedArtifactIds: [],
              stopSignal: "drive_full",
            },
          ]
        : [],
    };
  } catch {
    return null;
  }
}

/** Skill IDs emitted by the Python SSE stream. */
export type SkillId = "dataModel" | "workflow" | "rbac" | "page" | "aigc" | "appBundle";

export interface DriveFullStreamOpts {
  stopSignal?: AbortSignal;
  maxLoops?: number;
  turnId?: string;
  /** Called each time one of the 5 skill systems starts (post-closure sequence). */
  onSkillActivated?: (skillId: SkillId, label: string) => void;
  /** Called when a skill finishes, with its real closure evidence + graph. */
  onSkillCompleted?: (
    skillId: SkillId,
    hasError: boolean,
    detail?: {
      mermaid?: string | null;
      evidencePresent?: boolean;
      evidenceRef?: string | null;
      artifactId?: string | null;
      digest?: string | null;
      edges?: Array<Record<string, any>> | null;
    }
  ) => void;
  /** Called for each reasoning-engine step (evidence.search, risk.analyze ...). */
  onReasoningStep?: (label: string, loop?: number) => void;
}

/**
 * SSE version of driveFullViaPython.
 *
 * Connects to /api/sliderule/drive-full-stream and consumes the event stream.
 * Calls opts.onSkillActivated / onSkillCompleted as events arrive so the UI
 * can highlight the active thumbnail in real time.
 * Returns the same shape as driveFullViaPython on completion, or null on error.
 */
export async function driveFullViaPythonStream(
  state: V5SessionState,
  userText: string,
  opts: DriveFullStreamOpts = {}
): Promise<{ finalState: V5SessionState; stopReason?: string; loops?: any[]; publishClosure?: any } | null> {
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch("/api/sliderule/drive-full-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts.stopSignal,
      body: JSON.stringify({
        state,
        userText,
        max_loops: opts.maxLoops ?? 10,
        turnId: opts.turnId,
      }),
    });
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalState: V5SessionState | null = null;
    let publishClosure: any = undefined;
    let stopReason = "completed";

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE lines: "data: {...}\n\n"
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";  // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        let event: any;
        try { event = JSON.parse(jsonStr); } catch { continue; }

        switch (event.type) {
          case "reasoning_step":
            opts.onReasoningStep?.(event.label as string, event.loop as number | undefined);
            break;
          case "skill_start":
            opts.onSkillActivated?.(event.skill as SkillId, event.label as string);
            break;
          case "skill_result":
            opts.onSkillCompleted?.(event.skill as SkillId, Boolean(event.error), {
              mermaid: (event.mermaid as string | null) ?? null,
              evidencePresent: event.evidencePresent as boolean | undefined,
              evidenceRef: (event.evidenceRef as string | null) ?? null,
              artifactId: (event.artifactId as string | null) ?? null,
              digest: (event.digest as string | null) ?? null,
              edges: (event.edges as Array<Record<string, any>> | null) ?? null,
            });
            break;
          case "publish_closure":
            publishClosure = event.data;
            break;
          case "complete":
            if (event.state) {
              finalState = event.state as V5SessionState;
              if (publishClosure !== undefined) {
                (finalState as any).publishClosure = publishClosure;
              }
            }
            break outer;
          case "error":
            return null;
        }
      }
    }

    if (!finalState) return null;
    return {
      finalState,
      stopReason,
      publishClosure,
      loops: opts.turnId
        ? [
            {
              loopTurnId: opts.turnId,
              plan: { selected: [], reason: "python_drive_full_stream", expectedArtifacts: [] },
              committedArtifactIds: [],
              stopSignal: "drive_full_stream",
            },
          ]
        : [],
    };
  } catch {
    return null;
  }
}

export interface FrontierProposal {
  seed: string;
  rationale: string;
  prompt: string; // explicit prompt used (or would-be via buildCapabilityPrompt single truth)
  ledgerEntry: {
    type: "frontier_propose";
    proposedSeed: string;
    rationale: string;
    promptSnippet: string;
    at: string;
    deDupeChecked: boolean;
  };
}

export async function proposeFrontier(
  state: V5SessionState,
  digest: { title: string; summary: string; content: string },
  previousFrontiers: string[]
): Promise<FrontierProposal> {
  // M3 真实 frontier.propose: prompt (single-truth build) + rationale + ledger
  // Use buildCapabilityPrompt (B1 truth) + report context for a "frontier.propose" derivation.
  // We call with report.write (guaranteed supported) to get authoritative context block, then craft explicit frontier prompt.
  // The actual seed is deterministically derived from real digest "下一步工程化分支" + goal (no halluc freeform).
  const turnId = `frontier-${Date.now()}`;
  // Build a context-rich prompt via the single source of truth (even if capId is synthetic, contract falls back gracefully)
  const promptRes = buildCapabilityPrompt({
    capabilityId: "frontier.propose",
    state,
    inputArtifactIds: (state.artifacts || []).slice(-6).map((a: any) => a.id),
    roleId: "autopilot",
    turnId,
  });
  const basePrompt = `${promptRes.systemPrompt}\n\n${promptRes.userPrompt}`;

  // Derive concrete next frontier seed from the *real* digest (K1 supply priority: front-load the last report content)
  const branchMatch = (digest.content || "").match(/下一步工程化分支[:：]\s*([\s\S]{20,400}?)(?:\n\n|provenance|收敛|$)/i);
  const branchText = branchMatch ? branchMatch[1].trim().replace(/\n+/g, " ") : "";
  const goalText = (state.goal?.text || "当前目标").slice(0, 80);
  // Produce a focused, deduped question seed (userText style for next drive)
  let proposedSeed = `基于上轮收敛「${digest.title}」继续：${branchText ? branchText.slice(0, 180) : "探索下一可执行闭环与证据补强"}？（目标：${goalText}）`;
  proposedSeed = proposedSeed.replace(/\s+/g, " ").slice(0, 420);

  const rationale = `M3 frontier.propose: 从结构化 digest（buildStructuredReport 9段）中提取「下一步工程化分支」+ 目标片段，生成自治下一轮 seed。优先 K1 供给最近 digest 内容（~24k 截断由调用方控制）。rationale 避免重复 previousFrontiers（M3 de-dupe）。此 propose 显式记录 prompt（B1 契约）+ rationale + ledger，便于 audit 与 replay。`;

  // M3 de-dupe
  const deDupeChecked = previousFrontiers.includes(proposedSeed);
  if (deDupeChecked || previousFrontiers.length >= 3) {
    // still return a proposal; caller decides exhausted
    proposedSeed = proposedSeed + " [variant-" + (previousFrontiers.length + 1) + "]";
  }

  const ledgerEntry = {
    type: "frontier_propose" as const,
    proposedSeed,
    rationale,
    promptSnippet: basePrompt.slice(0, 600) + (basePrompt.length > 600 ? "..." : ""),
    at: new Date().toISOString(),
    deDupeChecked,
  };

  return {
    seed: proposedSeed,
    rationale,
    prompt: basePrompt,
    ledgerEntry,
  };
}

export function createRoundDigest(state: V5SessionState, recentArtifactIds: string[]): { title: string; summary: string; content: string; supersededIds: string[] } {
  // M6 真实 digest: 直接使用 buildStructuredReport（生产 baseline 9段 schema）
  const inputIds = recentArtifactIds.length > 0
    ? recentArtifactIds
    : (state.artifacts || []).slice(-5).map((a: any) => a.id);
  const built = buildStructuredReport({ state, inputArtifactIds: inputIds, roleId: "digest-autopilot", turnLabel: "marathon-round" });

  // M6 superseded (独立于 stale): 标记本轮参与 digest 的 artifacts（供画布分组/K1 压缩）
  const supersededIds = [...new Set(inputIds)];

  return { ...built, supersededIds };
}

export async function driveMarathon(
  state: V5SessionState,
  seedText: string,
  opts: MarathonOptions
): Promise<MarathonResult> {
  const pythonResult = await driveMarathonViaPython(state, seedText, opts);
  if (pythonResult) return pythonResult;

  const rounds: MarathonResult["rounds"] = [];
  let working = state;
  let currentSeed = seedText;
  let stopReason: MarathonStopReason = "await_human";
  const previousFrontiers: string[] = [];
  // TS THIN COMPAT CONSUMER ONLY (review finding 3):
  // - Named budget policy + marathon stop (session_budget_exhausted) owned by PYTHON_AUTHORITY in slide-rule-python/services/slide_rule_budget.py + drive_marathon (defaults to real drive_reasoning_turn).
  // - This TS driveMarathon first tries Python /api (driveMarathonViaPython); local loop retained ONLY as compat/offline fallback when fetch fails or Python unavailable.
  // - Residual risk: when Python API unreachable, TS fallback executes digest/frontier/re-entry (no Python inner gates in that case). Documented in migration status. Production prefers Python.

  // M4: AutopilotPolicy (explicit, audit-able; attached for TopHud/raw export)
  const policy = {
    autoConfirmRoute: "primary",
    autoWaiveNonBlockingGaps: true,
    declaredAt: new Date().toISOString(),
  };
  (working as any).autopilotPolicy = policy;

  while (true) {
    if (opts.stopSignal.aborted) {
      stopReason = "user_interrupted";
      break;
    }

    const driveRes = await SlideRuleRuntime.driveReasoningSession(working, {
      turnSeedId: `marathon-${Date.now()}`,
      userText: currentSeed,
      abortSignal: opts.stopSignal,
      executor: opts.executor,
      router: opts.router,
      maxLoopsPerMessage: opts.maxLoopsPerMessage,
      onCapabilityRound: opts.onCapabilityRound,
      onLoopComplete: opts.onLoopComplete,
    });

    const lastStop = driveRes.stopReason;
    const loopTurnId = driveRes.loops[driveRes.loops.length - 1]?.loopTurnId || `m-${Date.now()}`;
    rounds.push({ loopTurnId, stopReason: lastStop });

    working = driveRes.finalState;

    // thin compat: costLedger not accumulated for budget decisions here (PYTHON_AUTHORITY in Python budget/marathon); only inner drive + Python policy own max* stops. (HUD uses may read ledger directly.)

    // M6: 真实 digest (buildStructuredReport 9段) + 质量门概念（digest 本身由 report 契约保证，内层 drive 已过 gates）
    let digestForRound: any = { title: "轮次小结", summary: "", content: "" };
    if (lastStop === "convergence_signal" || lastStop === "coverage_sufficient") {
      const recentIds = (working.artifacts || []).slice(-6).map((a: any) => a.id);
      const digest = createRoundDigest(working, recentIds);
      digestForRound = digest;

      // M6: 应用 superseded（画布分组/优先供给依据）
      if (!working.supersededArtifactIds) working.supersededArtifactIds = [];
      working.supersededArtifactIds = [...new Set([...(working.supersededArtifactIds || []), ...digest.supersededIds])];

      // K1 供给优先：把 digest 内容前置到下一 seed（截断 24000 char 保护上下文预算）
      const k1DigestSupply = (digest.content || "").slice(0, 24000);

      // M3: 真实 frontier.propose（prompt + rationale + ledger）
      const proposal = await proposeFrontier(working, digest, previousFrontiers);
      const frontierLedger = proposal.ledgerEntry;

      // 记录到 decisionLedger（append-only，M3/M4/M6 可审计）
      if (!working.decisionLedger) working.decisionLedger = [];
      (working.decisionLedger as any[]).push({
        id: `frontier-${Date.now()}`,
        turnId: loopTurnId,
        source: "autopilot_frontier",
        reason: proposal.rationale,
        frontierProposal: frontierLedger,
        at: frontierLedger.at,
      });

      // 也追加到 conversation 便于 UI 可见 auto-seed 痕迹
      if (!working.conversation) working.conversation = [];
      (working.conversation as any[]).push({
        id: `frontier-note-${Date.now()}`,
        role: "system",
        text: `[M3 frontier.propose] ${proposal.seed}\nrationale: ${proposal.rationale.slice(0, 200)}`,
        timestamp: new Date().toISOString(),
      });

      previousFrontiers.push(proposal.seed);

      const exhausted = previousFrontiers.length > 4 || previousFrontiers.filter((f, i, a) => a.indexOf(f) !== i).length > 0;
      if (exhausted) {
        stopReason = "frontier_exhausted";
        if (opts.onRoundComplete) opts.onRoundComplete({ ...digest, frontier: proposal, k1Supply: k1DigestSupply.slice(0, 1200) }, rounds[rounds.length - 1]);
        break;
      }

      // 下一轮 seed = K1 优先 digest supply + frontier 问题
      currentSeed = `${k1DigestSupply.slice(0, 1800)}\n\n${proposal.seed}`;
      if (opts.onRoundComplete) {
        opts.onRoundComplete({ ...digest, frontier: proposal, k1Supply: k1DigestSupply.slice(0, 1200) }, rounds[rounds.length - 1]);
      }
      // continue to next marathon round
    } else if (lastStop === "await_ready") {
      stopReason = "await_human"; // M4 human-only
      if (opts.onRoundComplete) opts.onRoundComplete(digestForRound, rounds[rounds.length - 1]);
      break;
    } else if (lastStop === "await_confirm") {
      // M4: policy 代答（显式 ledger trace）
      currentSeed = `auto-confirmed per policy (${policy.autoConfirmRoute}); digest continued`;
      if (!working.decisionLedger) working.decisionLedger = [];
      (working.decisionLedger as any[]).push({
        id: `policy-confirm-${Date.now()}`,
        turnId: loopTurnId,
        source: "autopilot_policy",
        reason: `M4 policy代答: ${policy.autoConfirmRoute}`,
        autopilotPolicy: policy,
        at: new Date().toISOString(),
      });
      if (opts.onRoundComplete) opts.onRoundComplete(digestForRound, rounds[rounds.length - 1]);
    } else if (lastStop === "user_interrupted") {
      stopReason = "user_interrupted";
      break;
    } else if (lastStop === "budget_exhausted") {
      currentSeed = "继续基于前轮（内层 budget 后回 marathon session 预算）";
    } else {
      if (opts.onRoundComplete) opts.onRoundComplete(digestForRound, rounds[rounds.length - 1]);
      break;
    }

    // no TS session budget decision here (maxTokens etc removed). session_budget_exhausted + reentry now PYTHON_AUTHORITY default via /api (drive_marathon + real inner driver). Fallback below only for API-unavailable case (see review minor finding 3 + status residual risk note). TS only thin compat.
  }

  return { finalState: working, rounds, stopReason };
}

// Mode type re-exported from runtime for consistency
import type { SlideRuleDriveMode } from "./sliderule-runtime";
export type { SlideRuleDriveMode };
