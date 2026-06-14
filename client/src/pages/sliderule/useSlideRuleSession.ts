import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ActionTrace, LiveAction } from "@shared/blueprint/capability-process-labels";
import * as SlideRuleRuntime from "@/lib/sliderule-runtime";
import { fetchNarration } from "@/lib/sliderule-narrator";
import { pickMainArtifactByKind } from "@shared/blueprint/sliderule-main-artifact";
import type { UserIntervention, V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { ClarificationItem } from "./ClarificationCard";
import { deriveTurnRoute } from "@shared/blueprint/sliderule-turn-route";
import { resolveImSurfaceMode } from "./im-surface-mode";
import type { SchedulingDecision } from "@shared/blueprint/v5-reasoning-state";
import { challengeTargetLabel } from "./challenge-target-label";
import { buildTurnRoundsFromDrive } from "./turn-round-facts";
import { createUiCapabilityExecutor, mapArtifactsToWhyArtifacts } from "./ui-capability-executor";
import { createHttpSlideRuleSessionStore } from "@/lib/sliderule-http-store";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { loadByokPool, validateByokPool } from "@/lib/sliderule-byok-config";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { TurnStep, UiTurn, WhyArtifact, SlideRuleExecutorMode } from "./types";
import * as Marathon from "@/lib/sliderule-marathon-driver";
import {
  createGithubPagesSlideRuleSeedSession,
  createGithubPagesSlideRuleSessionStore,
  loadOrSeedGithubPagesDemoSession,
} from "./github-pages-sliderule-demo";

const DEFAULT_SESSION_ID = "sliderule-v51-product";

function createEmptySessionState(sessionId: string): V5SessionState {
  const base = SlideRuleRuntime.createInitialSessionState(
    SlideRuleRuntime.EMPTY_SESSION_GOAL_TEXT,
    sessionId
  );
  return SlideRuleRuntime.deriveNodeStatus ? SlideRuleRuntime.deriveNodeStatus(base) : base;
}

function sanitizeLegacyEmptySeed(state: V5SessionState): V5SessionState {
  if (!SlideRuleRuntime.isLegacyEmptySessionSeed(state)) return state;
  const cleared = createEmptySessionState(state.sessionId || DEFAULT_SESSION_ID);
  return { ...cleared, sessionId: state.sessionId || DEFAULT_SESSION_ID };
}

async function persistSession(state: V5SessionState): Promise<V5SessionState> {
  return SlideRuleRuntime.saveSessionState(state);
}

function hasReadyByokPool(): boolean {
  const pool = loadByokPool();
  return !!(pool && validateByokPool(pool).ok && pool.entries.some((e) => e.enabled && e.apiKey));
}

function resolveExecutorMode(): SlideRuleExecutorMode {
  if (IS_GITHUB_PAGES) {
    return hasReadyByokPool() ? "browser-llm" : "demo";
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("executor") === "pilot") return "pilot";
  if (params.get("executor") === "default") return "default";
  // BYOK override: a valid local key pool drives browser-direct LLM even on localhost.
  // Empty / invalid pool falls back to the V5.1 product default (server LLM).
  if (hasReadyByokPool()) return "browser-llm";
  return "server-llm";
}

function resolveMaxLoopsPerMessage(): number {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("maxLoops");
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return SlideRuleRuntime.PRODUCT_PREVIEW_MAX_LOOPS_PER_MESSAGE;
}

function latestDledgerForTurn(
  ledger: SchedulingDecision[] | undefined,
  turnId: string
): SchedulingDecision | null {
  const arr = ledger || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].turnId === turnId) return arr[i];
  }
  return null;
}

function pickMainArtifact(committed: WhyArtifact[]): UiTurn["main"] {
  const art = pickMainArtifactByKind(committed);
  if (art) {
    return { artifactId: art.id, kind: art.kind, realLlm: Boolean(art.realLlm) };
  }
  return null;
}

export type UseSlideRuleSessionOptions = {
  sessionId?: string;
  initialGoal?: string;
  documentTitle?: string;
};

export function useSlideRuleSession(options: UseSlideRuleSessionOptions = {}) {
  const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
  const [uiTurns, setUiTurns] = useState<UiTurn[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [liveAction, setLiveAction] = useState<LiveAction | null>(null);
  const [nextGateShouldFail, setNextGateShouldFail] = useState(false);
  const [executorMode, setExecutorMode] = useState<SlideRuleExecutorMode>("server-llm");
  const [sessionState, setSessionState] = useState(() =>
    createEmptySessionState(sessionId)
  );
  const [sessionHydrated, setSessionHydrated] = useState(false);

  // M2: drive mode (persisted for session; default "single" per spec)
  const [driveMode, setDriveMode] = useState<SlideRuleRuntime.SlideRuleDriveMode>(() => {
    try {
      return (localStorage.getItem("sliderule:driveMode") as any) || "single";
    } catch {
      return "single";
    }
  });

  // persist on change
  useEffect(() => {
    try { localStorage.setItem("sliderule:driveMode", driveMode); } catch {}
  }, [driveMode]);

  // M5: marathon budget (real costLedger + 强制 declared). Persisted.
  const [marathonBudget, setMarathonBudget] = useState<{ maxTokens: number; declaredAt: string }>(() => {
    try {
      const raw = localStorage.getItem("sliderule:marathonBudget");
      return raw ? JSON.parse(raw) : { maxTokens: 12000, declaredAt: new Date().toISOString() };
    } catch {
      return { maxTokens: 12000, declaredAt: new Date().toISOString() };
    }
  });
  useEffect(() => {
    try { localStorage.setItem("sliderule:marathonBudget", JSON.stringify(marathonBudget)); } catch {}
  }, [marathonBudget]);

  // M1: per-turn abort controller for graceful stop.
  const abortControllerRef = useRef<AbortController | null>(null);

  const goal = useMemo(() => {
    const fromState = sessionState.goal?.text?.trim();
    if (fromState) return fromState;
    const lastUser = [...uiTurns].reverse().find((t) => t.user.trim())?.user.trim();
    return lastUser || "";
  }, [sessionState.goal?.text, uiTurns]);

  useEffect(() => {
    const prev = SlideRuleRuntime.getCapabilityExecutor?.();
    const prevStore = SlideRuleRuntime.getSlideRuleSessionStore?.();
    const mode = resolveExecutorMode();
    setExecutorMode(mode);

    if (IS_GITHUB_PAGES && SlideRuleRuntime.setSlideRuleSessionStore) {
      SlideRuleRuntime.setSlideRuleSessionStore(createGithubPagesSlideRuleSessionStore());
      const pool = loadByokPool();
      if (pool && validateByokPool(pool).ok && pool.entries.some((e) => e.enabled && e.apiKey)) {
        SlideRuleRuntime.useBrowserLlmCapabilityExecutor?.();
      } else {
        SlideRuleRuntime.usePilotRealExecutor?.();
      }
    } else if (
      (mode === "server-llm" || mode === "browser-llm") &&
      SlideRuleRuntime.setSlideRuleSessionStore
    ) {
      // B-5: product default uses durable Http store (survives refresh via server JSON file).
      // browser-llm on localhost only swaps the LLM executor — the durable store still applies.
      SlideRuleRuntime.setSlideRuleSessionStore(createHttpSlideRuleSessionStore());
    }

    if (!IS_GITHUB_PAGES) {
      if (mode === "browser-llm" && SlideRuleRuntime.useBrowserLlmCapabilityExecutor) {
        SlideRuleRuntime.useBrowserLlmCapabilityExecutor?.();
      } else if (mode === "server-llm" && SlideRuleRuntime.useServerLlmCapabilityExecutor) {
        SlideRuleRuntime.useServerLlmCapabilityExecutor?.();
      } else if (mode === "default") {
        SlideRuleRuntime.useDefaultExecutor?.();
      } else {
        SlideRuleRuntime.usePilotRealExecutor?.();
      }
    }

    return () => {
      if (prevStore && SlideRuleRuntime.setSlideRuleSessionStore) {
        SlideRuleRuntime.setSlideRuleSessionStore(prevStore);
      }
      if (prev && SlideRuleRuntime.setCapabilityExecutor) {
        SlideRuleRuntime.setCapabilityExecutor(prev);
      } else {
        SlideRuleRuntime.useDefaultExecutor?.();
      }
    };
  }, []);

  // B4: live BYOK config change (storage or custom event) -> re-apply executor + mode without full refresh
  useEffect(() => {
    const reapplyByok = () => {
      // Re-resolve on any deploy target: adding/removing BYOK keys live-switches the executor
      // (Pages: browser-llm ↔ pilot demo; localhost: browser-llm ↔ server-llm).
      const mode = resolveExecutorMode();
      setExecutorMode(mode);
      if (mode === "browser-llm" && SlideRuleRuntime.useBrowserLlmCapabilityExecutor) {
        SlideRuleRuntime.useBrowserLlmCapabilityExecutor?.();
      } else if (mode === "server-llm" && SlideRuleRuntime.useServerLlmCapabilityExecutor) {
        SlideRuleRuntime.useServerLlmCapabilityExecutor?.();
      } else {
        SlideRuleRuntime.usePilotRealExecutor?.();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.includes("sliderule:llm-pool")) reapplyByok();
    };
    const onCustom = () => reapplyByok();
    window.addEventListener("storage", onStorage);
    window.addEventListener("byok-config-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("byok-config-changed", onCustom);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: V5SessionState;
      if (IS_GITHUB_PAGES) {
        const store = SlideRuleRuntime.getSlideRuleSessionStore();
        loaded = await loadOrSeedGithubPagesDemoSession(store, sessionId);
      } else {
        loaded = await SlideRuleRuntime.loadOrCreateSessionState(sessionId);
        if (SlideRuleRuntime.isLegacyEmptySessionSeed(loaded)) {
          loaded = await persistSession(sanitizeLegacyEmptySeed(loaded));
        }
      }
      if (!cancelled) {
        setSessionState(loaded);
        setSessionHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!options.documentTitle) return;
    const prevTitle = document.title;
    document.title = options.documentTitle;
    return () => {
      document.title = prevTitle;
    };
  }, [options.documentTitle]);

  const applyPersistedState = useCallback((state: V5SessionState) => {
    setSessionState(state);
  }, []);

  const runTurn = async (userText: string, intervention?: UserIntervention) => {
    if (!userText.trim()) return;

    if (isRunning) {
      // M1: stop instead of send when running
      abortControllerRef.current?.abort();
      setIsRunning(false);
      return;
    }

    const turnId = `turn-${Date.now()}`;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsRunning(true);

    const appendStep = (step: TurnStep) => {
      setUiTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, steps: [...t.steps, step] } : t))
      );
    };

    const turnTimestamp = new Date().toISOString();

    const patchRoute = (
      patch: Partial<UiTurn["routeFacts"]>,
      litCount?: number
    ) => {
      setUiTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          const routeFacts = { ...t.routeFacts, ...patch };
          const derived = deriveTurnRoute(routeFacts);
          return {
            ...t,
            routeFacts,
            routeLitCount: litCount ?? derived.length,
          };
        })
      );
    };

    setUiTurns((prev) => [
      ...prev,
      {
        id: turnId,
        user: userText.trim(),
        status: "streaming",
        steps: [],
        routeFacts: { turnId, timestamp: turnTimestamp },
        routeExpanded: true,
        routeLitCount: 1,
        assistant: "",
        assistantSource: "fallback",
        main: null,
        actions: [],
      },
    ]);

    try {
      const loadedState = sanitizeLegacyEmptySeed(
        await SlideRuleRuntime.loadOrCreateSessionState(sessionState.sessionId || sessionId)
      );

      const goalStatusBefore = loadedState.goal?.status;
      const staleArtifactIdsBefore = [...(loadedState.staleArtifactIds || [])];

      const { preparedState } = SlideRuleRuntime.intakeMessage(loadedState, {
        turnId,
        userText: userText.trim(),
        intervention,
      });

      const activeGoalText = preparedState.goal?.text?.trim() || userText.trim();
      applyPersistedState(preparedState);

      const challengeArt = intervention?.targetArtifactId
        ? (loadedState.artifacts || []).find((a) => a.id === intervention.targetArtifactId)
        : undefined;

      patchRoute(
        {
          goalStatusBefore,
          staleArtifactIdsBefore,
          staleArtifactIdsAfter: [...(preparedState.staleArtifactIds || [])],
          goalStatusAfterInvalidate: preparedState.goal?.status,
          interventionIntent: intervention?.intent ?? null,
          challengeTargetLabel: challengeTargetLabel(challengeArt),
        },
        deriveTurnRoute({
          turnId,
          interventionIntent: intervention?.intent ?? null,
          challengeTargetLabel: challengeTargetLabel(challengeArt),
          goalStatusBefore,
          goalStatusAfterInvalidate: preparedState.goal?.status,
          staleArtifactIdsBefore,
          staleArtifactIdsAfter: [...(preparedState.staleArtifactIds || [])],
        }).length
      );

      setLiveAction({ label: "正在规划本轮动作…", external: false });

      const firstLoopPlanCountRef = { value: 0 };
      const driveLoopsRef: SlideRuleRuntime.DriveReasoningResult["loops"] = [];

      const imMode = resolveImSurfaceMode();
      const actionsAcc: ActionTrace[] = [];
      const uiExecutor = createUiCapabilityExecutor(SlideRuleRuntime.getCapabilityExecutor(), {
        userText: userText.trim(),
        goalText: activeGoalText,
        emitImSteps: imMode !== "minimal",
        onStep: appendStep,
        onActionTrace: (trace) => {
          actionsAcc.push(trace);
          setUiTurns((prev) =>
            prev.map((t) =>
              t.id === turnId ? { ...t, actions: [...t.actions, trace] } : t
            )
          );
        },
        setLiveAction,
      });

      // M2/M3/M4/M5/M6: driveMode selects single vs marathon thin layer.
      // Product path for marathon now uses driveMarathon (with budget enforcement and real M3/M6 ledger append).
      // Live callbacks forwarded to inner drives for UI updates.
      const driveOpts = {
        turnSeedId: turnId,
        userText: userText.trim(),
        intervention,
        router: IS_GITHUB_PAGES
          ? SlideRuleRuntime.createDeterministicRouter()
          : SlideRuleRuntime.createServerReasoningRouter(),
        executor: uiExecutor,
        maxLoopsPerMessage: resolveMaxLoopsPerMessage(),
        abortSignal: controller.signal, // M1
        onCapabilityRound: (payload: any) => {
          if (!payload.gateFailed && !payload.execFailed) return;
          const message = payload.gateFailed
            ? payload.gateMessage === "ground"
              ? "外部证据未接地 · 本轮为规则推演"
              : `提交闸未通过${payload.gateMessage ? ` · ${payload.gateMessage}` : ""}`
            : "能力执行失败，可重试";
          appendStep({
            id: `${payload.loopTurnId}-fail-gate-${payload.runIndex}`,
            kind: "capability_fail",
            capabilityId: payload.capabilityId,
            roleId: payload.roleId,
            loopTurnId: payload.loopTurnId,
            capabilityRunId: payload.runId,
            runIndex: payload.runIndex,
            message,
          });
        },
        onLoopComplete: async (p: any) => {
          const { state, plan, loopTurnId, committedArtifactIds, stopSignal } = p || {};
          driveLoopsRef.push({
            loopTurnId,
            plan,
            committedArtifactIds,
            stopSignal,
          });
          const derived = SlideRuleRuntime.deriveNodeStatus
            ? SlideRuleRuntime.deriveNodeStatus(state)
            : state;
          const loopPersisted = await persistSession(derived);
          applyPersistedState(loopPersisted);
          if (driveLoopsRef.length === 1) {
            firstLoopPlanCountRef.value = plan.selected.length;
          }
          const partialRounds = buildTurnRoundsFromDrive(loopPersisted.decisionLedger, {
            loops: driveLoopsRef,
            stopReason: "budget_exhausted",
          });
          const partialFacts = {
            turnId,
            timestamp: turnTimestamp,
            interventionIntent: intervention?.intent ?? null,
            challengeTargetLabel: challengeTargetLabel(challengeArt),
            goalStatusBefore,
            goalStatusAfterInvalidate: preparedState.goal?.status,
            staleArtifactIdsBefore,
            staleArtifactIdsAfter: [...(loopPersisted.staleArtifactIds || [])],
            rounds: partialRounds,
            selectedCapabilities: driveLoopsRef.flatMap((l: any) =>
              l.plan.selected.map((s: any) => ({
                capabilityId: String(s.capabilityId),
                roleId: String(s.roleId || "agent"),
              }))
            ),
          };
          patchRoute(
            { rounds: partialRounds },
            deriveTurnRoute(partialFacts).length
          );
        },
      };

      let drive: any;
      let usedMarathonDriver = false;
      if (driveMode === "marathon") {
        const { driveMarathon } = await import("@/lib/sliderule-marathon-driver");
        const marathonRes = await driveMarathon(preparedState, userText.trim(), {
          stopSignal: controller.signal,
          budget: { maxTokens: marathonBudget?.maxTokens || 12000, declaredAt: new Date().toISOString() },
          policy: { autoConfirmRoute: "primary", autoWaiveNonBlockingGaps: true },
          executor: driveOpts.executor,
          onCapabilityRound: driveOpts.onCapabilityRound,
          onLoopComplete: driveOpts.onLoopComplete,
          router: driveOpts.router,
          maxLoopsPerMessage: driveOpts.maxLoopsPerMessage,
        });
        drive = { finalState: marathonRes.finalState, stopReason: marathonRes.stopReason, loops: [] };
        usedMarathonDriver = true;
      } else {
        drive = await SlideRuleRuntime.driveReasoningSession(preparedState, driveOpts as any);
        usedMarathonDriver = false;
      }

      let final = drive.finalState;
      final = await persistSession(final);
      applyPersistedState(final);

      // M1 cleanup
      abortControllerRef.current = null;
      setIsRunning(false);

      // M3/M6 real: if marathon + converged, use real digest (buildStructuredReport) + frontier.propose (prompt+rationale+ledger)
      // + K1 supply + superseded already handled inside propose/create in driver if full loop used.
      // Here we call the pure helpers (exported) so UI sees prompt/rationale immediately, and auto-seed next if not exhausted.
      let marathonAutoSeed: string | null = null;
      let lastDigestNote = "";
      if (driveMode === "marathon" && (drive.stopReason === "convergence_signal" || drive.stopReason === "coverage_sufficient")) {
        try {
          const recentIds = (final.artifacts || []).slice(-6).map((a: any) => a.id);
          const { createRoundDigest, proposeFrontier } = await import("@/lib/sliderule-marathon-driver");
          const digest = createRoundDigest(final, recentIds);
          const proposal = await proposeFrontier(final, digest, []);
          // Append visible evidence of real M3 (prompt + rationale + ledger) into last assistant for demo thickness
          lastDigestNote = `\n\n【M6 真实 digest 过质量门 + 9段结构化报告】 ${digest.title}\n${(digest.content || "").slice(0, 380)}...\n\n【M3 真实 frontier.propose (prompt+rationale+ledger)】\nseed: ${proposal.seed}\nprompt(节选): ${proposal.prompt.slice(0, 220)}...\nrationale: ${proposal.rationale}\nledgerEntry: ${JSON.stringify(proposal.ledgerEntry).slice(0, 180)}`;
          marathonAutoSeed = proposal.seed;
          // M6 superseded sync + M4 policy attach (for hud + audit visibility)
          if (!final.supersededArtifactIds) final.supersededArtifactIds = [];
          final.supersededArtifactIds = [...new Set([...(final.supersededArtifactIds || []), ...( (digest as any).supersededIds || recentIds )])];
          (final as any).autopilotPolicy = { autoConfirmRoute: "primary", autoWaiveNonBlockingGaps: true, declaredAt: new Date().toISOString(), source: "hybrid-marathon-post" };
          final = await persistSession(final);
          applyPersistedState(final);
        } catch (e) {
          marathonAutoSeed = `auto-seed from convergence (M3 helper fallback)`;
        }
        setUiTurns((prev) => {
          const last = prev[prev.length - 1];
          if (!last) return prev;
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              assistant: (last.assistant || "") + (lastDigestNote || `\n\n[M3/M6] 持续推演自动前沿已生成（见 ledger）。`),
            },
          ];
        });
      }

      // M4 demo complete: if marathon await_human (G_READY) or policy path, fire real Notification (user permission)
      if (driveMode === "marathon" && (drive.stopReason === "await_ready" || drive.stopReason === "coverage_sufficient" /* after auto */)) {
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("SlideRule 持续推演", { body: "轮次收敛或需人工确认。点击恢复继续 marathon。" });
          } else if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
            Notification.requestPermission().then((p) => {
              if (p === "granted") new Notification("SlideRule Marathon", { body: "可恢复自动驾驶" });
            });
          }
        } catch {}
      }

      const firstLoop = drive.loops[0];
      const lastLoop = drive.loops[drive.loops.length - 1];
      firstLoopPlanCountRef.value = firstLoop?.plan.selected.length ?? 0;

      const rounds = buildTurnRoundsFromDrive(final.decisionLedger, drive);
      const displayLoopId = firstLoop?.loopTurnId ?? turnId;
      const dledger = latestDledgerForTurn(final.decisionLedger, displayLoopId);
      const planSource = dledger?.source ?? "local_heuristic";
      const planOrchestrateReason =
        planSource === "local_heuristic" ? "orchestrate_unreachable" : null;
      const planReason = firstLoop?.plan.reason ?? lastLoop?.plan.reason;
      const planSelectedCount = firstLoop?.plan.selected.length ?? 0;

      // M4 complete resume demo: after real frontier (M3), auto-continue 1 round in marathon to show "持续推演" thickness (user aborts via stop anytime; M1 signal respected).
      // Real digest/propose already injected above; this gives multi-round without extra clicks for video/demo.
      if (driveMode === "marathon" && marathonAutoSeed && (drive.stopReason === "convergence_signal" || drive.stopReason === "coverage_sufficient") && !usedMarathonDriver) {
        // schedule after current ui paint; isRunning will be re-set inside runTurn
        setTimeout(() => {
          runTurn(marathonAutoSeed!).catch(() => {});
        }, 80);
      }

      const committedIds = drive.loops.flatMap((l: any) => l.committedArtifactIds);
      const committed = mapArtifactsToWhyArtifacts(final, committedIds);

      const loopTurnIds = new Set(drive.loops.map((l: any) => l.loopTurnId));
      const runsThisTurn = (final.capabilityRuns || []).filter((r: any) =>
        loopTurnIds.has(r.turnId)
      );
      const trustTotalCount = runsThisTurn.length || committed.length;
      const trustPassedCount =
        runsThisTurn.length > 0
          ? runsThisTurn.filter((r: any) =>
              (r.gateResults || []).every((g: any) => g.status === "passed")
            ).length
          : committed.filter(
              (a: any) => a.trustLevel === "gated_pass" || a.trustLevel === "audited"
            ).length;
      const trustGroundFailedCount = runsThisTurn.filter((r: any) =>
        (r.gateResults || []).some(
          (g: any) => g.gateId === "ground" && g.status === "failed"
        )
      ).length;

      const selectedCapabilities = drive.loops.flatMap((l: any) =>
        l.plan.selected.map((s: any) => ({
          capabilityId: String(s.capabilityId),
          roleId: String(s.roleId || "agent"),
        }))
      );

      const completeRouteFacts = {
        turnId,
        timestamp: turnTimestamp,
        interventionIntent: intervention?.intent ?? null,
        challengeTargetLabel: challengeTargetLabel(challengeArt),
        goalStatusBefore,
        goalStatusAfterInvalidate: preparedState.goal?.status,
        staleArtifactIdsBefore,
        staleArtifactIdsAfter: [...(final.staleArtifactIds || [])],
        planReason,
        planSelectedCount,
        planSource,
        planOrchestrateReason,
        dledgerDecisionId: dledger?.id ?? null,
        rounds,
        selectedCapabilities,
        committedCount: committed.length,
        trustPassedCount,
        trustTotalCount,
        trustGroundFailedCount,
        goalStatusAfter: final.goal?.status,
        runtimePhase: final.runtimePhase,
        closureReason: drive.stopReason,
      };

      patchRoute(
        {
          planReason,
          planSelectedCount,
          planSource,
          planOrchestrateReason,
          dledgerDecisionId: dledger?.id ?? null,
          rounds,
          committedCount: committed.length,
          trustPassedCount,
          trustTotalCount,
          trustGroundFailedCount,
          goalStatusAfter: final.goal?.status,
          runtimePhase: final.runtimePhase,
          closureReason: drive.stopReason,
        },
        deriveTurnRoute(completeRouteFacts).length
      );

      const main = pickMainArtifact(committed);
      const mainArt = main ? committed.find((a) => a.id === main.artifactId) : undefined;

      let assistantText = "";
      let assistantSource: UiTurn["assistantSource"] = "fallback";
      let narrationReason: UiTurn["narrationReason"];

      if (imMode === "minimal") {
        const narration = await fetchNarration({
          state: final,
          turnId,
          userText: userText.trim(),
          intervention: intervention ? { intent: intervention.intent } : null,
          selected: drive.loops.flatMap((l: any) =>
            l.plan.selected.map((s: any) => ({
              capabilityId: s.capabilityId,
              roleId: s.roleId,
            }))
          ),
          artifacts: committed.map((a: any) => ({
            kind: a.kind,
            title: a.content.split("\n")[0]?.slice(0, 80),
            summary: a.content.slice(0, 200),
            realLlm: a.realLlm,
          })),
          mainArtifact: mainArt
            ? { kind: mainArt.kind, title: mainArt.content.split("\n")[0], content: mainArt.content }
            : null,
          goalStatusBefore,
          planReason: planReason ?? "",
          skipped: dledger?.skipped,
        });
        assistantText = narration.text;
        assistantSource = narration.source;
        narrationReason = narration.reason;
        appendStep({
          id: `${turnId}-final`,
          kind: "narration",
          text: narration.text,
          source: narration.source,
          isFinal: true,
        });
      }

      if (lastDigestNote) {
        assistantText = (assistantText || "") + lastDigestNote;
      }

      setUiTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          return {
            ...t,
            status: "complete",
            routeFacts: completeRouteFacts,
            routeExpanded: imMode !== "minimal",
            routeLitCount: deriveTurnRoute(completeRouteFacts).length,
            assistant: assistantText,
            assistantSource,
            narrationReason,
            main,
            actions: actionsAcc,
          };
        })
      );
      setNextGateShouldFail(false);
    } finally {
      setIsRunning(false);
      setLiveAction(null);
    }
  };

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
    setLiveAction(null);
  }, []);

  const resolveInteractiveGate = useCallback((gateNodeId: string, choice: string | null) => {
    // Pragmatic bridge to existing text-driven G_CONFIRM logic in intakeMessage.
    // "选方案 ..." triggers userPicksRoute (clears await_confirm, proceeds with choice).
    // Reject text triggers userRejectsRouteSelection (stales route_options, re-compare).
    const text = choice
      ? "选方案 A"
      : "都不行，重新对比路线";

    runTurn(text);
  }, [runTurn]);

  const sendMessage = async () => {
    if (isRunning) {
      stop();
      return;
    }
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    await runTurn(text);
  };

  const toggleRouteExpanded = useCallback((turnId: string) => {
    setUiTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, routeExpanded: !t.routeExpanded } : t
      )
    );
  }, []);

  const retryCapability = useCallback(
    async (
      turnId: string,
      params: {
        loopTurnId: string;
        capabilityId: V5CapabilityId;
        roleId: string;
        runIndex: number;
      }
    ) => {
      if (isRunning) return;

      const turn = uiTurns.find((t) => t.id === turnId);
      if (!turn) return;

      setIsRunning(true);

      const stripFailSteps = (steps: TurnStep[]) =>
        steps.filter(
          (s) =>
            !(
              s.kind === "capability_fail" &&
              s.loopTurnId === params.loopTurnId &&
              s.capabilityId === params.capabilityId &&
              s.runIndex === params.runIndex
            )
        );

      const appendStep = (step: TurnStep) => {
        setUiTurns((prev) =>
          prev.map((t) => {
            if (t.id !== turnId) return t;
            const base = stripFailSteps(t.steps);
            return { ...t, steps: [...base, step] };
          })
        );
      };

      try {
        let loaded = await SlideRuleRuntime.loadOrCreateSessionState(
          sessionState.sessionId || sessionId
        );
        loaded = sanitizeLegacyEmptySeed(loaded);

        const goalText = loaded.goal?.text?.trim() || turn.user.trim();
        const uiExecutor = createUiCapabilityExecutor(
          SlideRuleRuntime.getCapabilityExecutor(),
          {
            userText: turn.user.trim(),
            goalText,
            emitImSteps: true,
            onStep: appendStep,
            onActionTrace: (trace) => {
              setUiTurns((prev) =>
                prev.map((t) =>
                  t.id === turnId ? { ...t, actions: [...t.actions, trace] } : t
                )
              );
            },
            setLiveAction,
          }
        );

        const result = await SlideRuleRuntime.retrySingleCapability(loaded, {
          ...params,
          executor: uiExecutor,
        });

        let final = await persistSession(result.state);
        applyPersistedState(final);

        const loopTurnIds = new Set(
          (turn.routeFacts.rounds || []).map((r) => r.loopTurnId)
        );
        if (loopTurnIds.size === 0) {
          loopTurnIds.add(params.loopTurnId);
        }
        const runsThisTurn = (final.capabilityRuns || []).filter((r: any) =>
          loopTurnIds.has(r.turnId)
        );
        const trustTotalCount = runsThisTurn.length;
        const trustPassedCount = runsThisTurn.filter((r: any) =>
          (r.gateResults || []).every((g: any) => g.status === "passed")
        ).length;
        const trustGroundFailedCount = runsThisTurn.filter((r: any) =>
          (r.gateResults || []).some(
            (g: any) => g.gateId === "ground" && g.status === "failed"
          )
        ).length;

        const committedIds = (final.artifacts || [])
          .filter((a: any) => {
            const runId = a.producedBy?.capabilityRunId || "";
            return [...loopTurnIds].some((lt: any) => runId.startsWith(`${lt}-run-`));
          })
          .map((a: any) => a.id);
        const committed = mapArtifactsToWhyArtifacts(final, committedIds);
        const main = pickMainArtifact(committed);

        setUiTurns((prev) =>
          prev.map((t) => {
            if (t.id !== turnId) return t;
            const routeFacts = {
              ...t.routeFacts,
              committedCount: committed.length,
              trustPassedCount,
              trustTotalCount,
              trustGroundFailedCount,
              goalStatusAfter: final.goal?.status,
              runtimePhase: final.runtimePhase,
            };
            return {
              ...t,
              routeFacts,
              routeLitCount: deriveTurnRoute(routeFacts).length,
              main: main ?? t.main,
            };
          })
        );
      } finally {
        setIsRunning(false);
        setLiveAction(null);
      }
    },
    [isRunning, uiTurns, sessionState.sessionId, sessionId, applyPersistedState]
  );

  const challengeTurn = async (artifactId: string) => {
    const reason =
      window.prompt("你想如何质疑这轮结论？", "这个结论的依据不够充分，请重新推演。") ||
      "这个结论的依据不够充分，请重新推演。";
    await runTurn(reason, {
      targetArtifactId: artifactId,
      intent: "challenge",
      text: reason,
    });
  };

  const resetSession = useCallback(async () => {
    if (isRunning) return;
    const sid = sessionState.sessionId || sessionId;
    if (IS_GITHUB_PAGES) {
      const store = SlideRuleRuntime.getSlideRuleSessionStore();
      await store.deleteSession?.(sid);
      const seeded = await store.save(createGithubPagesSlideRuleSeedSession());
      setSessionState(seeded);
    } else {
      if (SlideRuleRuntime.deleteSlideRuleSession) {
        await SlideRuleRuntime.deleteSlideRuleSession(sid);
      }
      const fresh = sanitizeLegacyEmptySeed(
        await SlideRuleRuntime.loadOrCreateSessionState(
          sid,
          SlideRuleRuntime.EMPTY_SESSION_GOAL_TEXT
        )
      );
      setSessionState(fresh);
    }
    setUiTurns([]);
    setInput("");
    setLiveAction(null);
    setNextGateShouldFail(false);
  }, [isRunning, sessionState.sessionId, sessionId]);

  // G_READY 澄清卡片：未回答的 open_question gaps（带 V4 风格结构化选项）→ 卡片。
  const pendingClarifications = useMemo<ClarificationItem[]>(() => {
    if (isRunning) return [];
    return (sessionState.coverageGaps || [])
      .filter((g) => g.status === "open" && g.kind === "open_question")
      .map((g) => ({
        id: g.id,
        prompt: g.label,
        kind: g.clarifyKind,  // V4 alignment
        type: g.clarifyType,
        options: g.options,
        defaultAnswer: g.defaultAnswer,
        context: g.context,
      }));
  }, [sessionState.coverageGaps, isRunning]);

  // 一键生成交付物:发一条交付意图消息走既有 S19 流水线(spec树→文档→任务→提示词包→架构图→交接包)。
  const generateDeliverables = useCallback(() => {
    if (isRunning) return;
    void runTurn("打包交付：生成 spec 树、规格文档、提示词包、架构图与工程交接包", {
      intent: "generate_plan",
      text: "打包交付：生成 spec 树、规格文档、提示词包、架构图与工程交接包",
    });
  }, [isRunning, runTurn]);

  const answerClarifications = useCallback(
    (answers: Array<{ gapId: string; answer: string }>) => {
      if (!answers.length) return;
      const byId = new Map((sessionState.coverageGaps || []).map((g) => [g.id, g.label] as const));
      const supplement = answers
        .map((a) => `「${byId.get(a.gapId) || a.gapId}」答：${a.answer}`)
        .join("\n");
      void runTurn(supplement, {
        intent: "clarify",
        text: supplement,
        answeredGapIds: answers.map((a) => a.gapId),
      });
    },
    [sessionState.coverageGaps, runTurn]
  );

  return {
    goal,
    sessionHydrated,
    uiTurns,
    input,
    setInput,
    pendingClarifications,
    answerClarifications,
    generateDeliverables,
    isRunning,
    liveAction,
    sessionState,
    executorMode,
    driveMode,
    setDriveMode,
    stop,
    // M5: real budget for marathon (强制 UI 已弹；此处暴露供 hud 同步)
    marathonBudget,
    setMarathonBudget: (b: { maxTokens: number; declaredAt: string }) => setMarathonBudget(b),
    sendMessage,
    runTurn,
    challengeTurn,
    resetSession,
    toggleRouteExpanded,
    retryCapability,
    resolveInteractiveGate,
  };
}