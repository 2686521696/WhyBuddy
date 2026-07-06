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
import { mergePublishClosureForPersistedTurn } from "./derive-persisted-turn";
import { createHttpSlideRuleSessionStore } from "@/lib/sliderule-http-store";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { loadByokPool, validateByokPool } from "@/lib/sliderule-byok-config";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { TurnStep, UiTurn, WhyArtifact, SlideRuleExecutorMode } from "./types";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import * as Marathon from "@/lib/sliderule-marathon-driver";
import {
  createGithubPagesSlideRuleSeedSession,
  createGithubPagesSlideRuleSessionStore,
  loadOrSeedGithubPagesDemoSession,
} from "./github-pages-sliderule-demo";

// 105 Python full-path: product /agent-loop/sliderule + /sliderule use this hook + http store.
// Sessions: Node thin-compat proxy. Turns/evidence/report: delegated to slide-rule-python (python-rag provenance).
// Smoke (updated) starts here and asserts the path.

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

/**
 * Frontend session store adapter for Python evidence projection persistence.
 * Explicitly carries the (python /drive-full) publishClosure and skillRuntimeGraph evidence
 * projections through load/save roundtrips. Old sessions without the keys remain compatible.
 * No network/DB/provider calls; pure local shape passthrough + defaults.
 * Positive: when present on loaded or drive-final, preserved on persist.
 * Fail-closed negative: missing fields stay absent (preview may still apply).
 */
function preservePythonEvidenceProjection(state: V5SessionState): V5SessionState {
  const pc = (state as any).publishClosure;
  const sg = (state as any).skillRuntimeGraph;
  if (pc === undefined && sg === undefined) return state;
  const next: any = { ...state };
  if (pc !== undefined) next.publishClosure = pc;
  if (sg !== undefined) next.skillRuntimeGraph = sg;
  return next as V5SessionState;
}

async function persistSession(state: V5SessionState): Promise<V5SessionState> {
  const toSave = preservePythonEvidenceProjection(state);
  return SlideRuleRuntime.saveSessionState(toSave);
}

async function prepareVisibleResetSessionState(
  sessionId: string,
  deleteSession?: (sessionId: string) => Promise<void>,
  saveSession: (state: V5SessionState) => Promise<V5SessionState> = persistSession
): Promise<V5SessionState> {
  try {
    await deleteSession?.(sessionId);
  } catch {
    // Reset must remain visible even when the backend delete route is unavailable.
  }

  const empty = sanitizeLegacyEmptySeed(createEmptySessionState(sessionId));
  try {
    return await saveSession(empty);
  } catch {
    return empty;
  }
}

/** 已闭环会话：goal 已 clear / 相位 done / 发布闭环证据齐 6。 */
function isClosedSessionState(state: V5SessionState): boolean {
  if (state.goal?.status === "clear") return true;
  if ((state as any).runtimePhase === "done") return true;
  const pc: any = (state as any).publishClosure;
  return !!pc && pc.blocked === false && Number(pc.evidencePresentCount ?? 0) >= 6;
}

/**
 * 新应用意图启发式。用于"已闭环话题里输入新想法"的自动开新话题——intake 的
 * new_goal 只认空会话，否则新意图落进旧话题，gate 已通过会秒回 closed 6/6
 * （零推演，用户误读为造假）。两种命中方式：
 *   1. 动词（做/搭建/设计/构建/开发…）+ 载体名词（系统/应用/平台…）；
 *   2. 裸名词短语（「智能财务自动化办公系统」）：无标点、以载体名词收尾、
 *      不以修改类动词开头（把/改/优化…是对旧话题的 refine，不能误开新话题）。
 */
export function looksLikeNewAppIntent(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 6) return false;
  const noun = /(系统|应用|平台|工具|app|小程序|管理端|门户|网站)/i;
  if (!noun.test(t)) return false;
  const verb = /(做一?个|搭建|设计一?个|构建|开发一?个|建一?个|来一?个|帮我做|我想要|我要做|create|build|design)/i;
  if (verb.test(t)) return true;
  // 裸名词短语：refine 动词开头的不算（那是对旧话题的修改指令）
  if (/^(把|将|改|修改|调整|优化|完善|去掉|删除|增加|加上|补充|重新|再|请|帮我改)/.test(t)) return false;
  return /^[一-龥A-Za-z0-9\s·\-]{3,38}(系统|应用|平台|门户|网站|小程序)$/.test(t);
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
  const [driveFullStatus, setDriveFullStatus] = useState<
    "idle" | "loading" | "python_success" | "timeout" | "python_unavailable" | "fallback"
  >("idle");

  // SSE-driven: which of the 6 skill systems is currently executing on Python side.
  // null = none active (before run starts or after completion).
  const [activeSkillId, setActiveSkillId] = useState<SkillId | null>(null);

  // Accumulated per-skill content from SSE skill_result events (raw model/mermaid).
  const [skillContents, setSkillContents] = useState<Partial<Record<SkillId, string>>>({});
  const [latestMermaid, setLatestMermaid] = useState<string | null>(null);

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
      // browser-llm on localhost only swaps the LLM executor; the durable store still applies.
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
      // Pages: browser-llm -> pilot demo; localhost: browser-llm -> server-llm.
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
        const hydrated = preservePythonEvidenceProjection(loaded);
        setSessionState(hydrated);
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
      const loadedState = preservePythonEvidenceProjection(
        sanitizeLegacyEmptySeed(
          await SlideRuleRuntime.loadOrCreateSessionState(sessionState.sessionId || sessionId)
        )
      );

      // 已闭环话题 + 新应用意图（非干预轮）→ 自动开新话题。
      // intake 的 new_goal 只认空会话；若新意图落进已闭环的旧话题，服务端权威
      // 会话 gate 已通过 → 秒回 closed 6/6（零推演、旧证据），用户必然误读。
      // 语义与右上角"重置会话"一致（同 sessionId、清空服务端会话），但保留
      // 本地聊天流，并用可见 chip 明示切换。
      let workingState = loadedState;
      let autoNewTopic = false;
      let closedTopicFollowUp = false;
      if (!IS_GITHUB_PAGES && !intervention && isClosedSessionState(loadedState)) {
        if (
          looksLikeNewAppIntent(userText) &&
          userText.trim() !== (loadedState.goal?.text || "").trim()
        ) {
          workingState = await prepareVisibleResetSessionState(
            loadedState.sessionId || sessionState.sessionId || sessionId,
            SlideRuleRuntime.deleteSlideRuleSession,
            persistSession
          );
          autoNewTopic = true;
        } else {
          // 识别不出新意图 → 留在旧话题，但必须明示，否则秒回 closed 6/6
          // 会被读成"假装推演"。
          closedTopicFollowUp = true;
        }
      }

      const goalStatusBefore = workingState.goal?.status;
      const staleArtifactIdsBefore = [...(workingState.staleArtifactIds || [])];

      const { preparedState } = SlideRuleRuntime.intakeMessage(workingState, {
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

      setLiveAction({ label: "正在规划本轮动作...", external: false });

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

      // Immediate reaction so user sees something right after pressing send (before any network)
      if (autoNewTopic) {
        appendStep({
          id: `${turnId}-new-topic`,
          kind: "chip",
          capabilityId: "intent.parse" as any,
          roleId: "system",
          label: "上一话题已闭环 · 检测到新意图，已自动开启新话题",
          realLlm: false,
          loopTurnId: turnId,
          progressType: "thinking",
        });
      }
      if (closedTopicFollowUp) {
        appendStep({
          id: `${turnId}-closed-followup`,
          kind: "chip",
          capabilityId: "intent.parse" as any,
          roleId: "system",
          label: "本话题已闭环，此轮按旧话题追问处理 · 要开始新应用请说「做一个××系统」或点右上角重置会话",
          realLlm: false,
          loopTurnId: turnId,
          progressType: "thinking",
        });
      }
      appendStep({
        id: `${turnId}-intake`,
        kind: "chip",
        capabilityId: "intent.parse" as any,
        roleId: "system",
        label: "指令已接收 · 启动推理",
        realLlm: false,
        loopTurnId: turnId,
        progressType: "thinking",
      });
      setLiveAction({ label: "规划第一轮能力与路线...", external: false });

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
              ? "外部证据未接地 - 本轮转为规则推演"
              : `提交闸未通过${payload.gateMessage ? ` - ${payload.gateMessage}` : ""}`
            : "能力执行失败，可以重试";
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
      let driveErrored = false;
      try {
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
          drive = {
            finalState: marathonRes.finalState,
            stopReason: marathonRes.stopReason,
            loops: [],
            publishClosure: marathonRes.publishClosure,
          };
          usedMarathonDriver = true;
        } else {
          const { classifyDriveFullStatus, driveFullViaPythonStream } = await import("@/lib/sliderule-marathon-driver");
          setDriveFullStatus("loading");
          // PYTHON_AUTHORITY: /drive-full-stream 以已持久化会话为权威起点（防伪造，
          // 见 routes/sliderule_full.py drive_full_stream）。intake 后的 goal 必须先
          // 落盘，否则 Python 侧以旧的空 goal 推演，闭环 fail-closed 成 0/6。
          try {
            await persistSession(preparedState);
          } catch {
            // 持久化失败时仍继续驱动：请求体里的 state 会作为无持久化会话的兜底。
          }
          const pythonDrive = await driveFullViaPythonStream(preparedState, userText.trim(), {
            stopSignal: controller.signal,
            turnId,
            onSkillActivated: (skillId, _label) => {
              setActiveSkillId(skillId);
            },
            onSkillCompleted: (skillId, _hasError, detail) => {
              // Accumulate per-skill content for the right-panel screens:
              // mermaid (cross-skill edge projection) first, then the gate-PASSED
              // five-system model section as a fenced JSON block. The screens'
              // extractMermaid/extractFlow read the leading mermaid; the
              // five-system-model parser reads the fenced JSON. Deterministic
              // domains carry no modelSection — screens degrade honestly.
              const mermaid = detail?.mermaid ?? null;
              const modelSection = detail?.modelSection ?? null;
              const parts: string[] = [];
              if (mermaid) parts.push(mermaid);
              if (modelSection && typeof modelSection === "object") {
                // skillId → model key: dataModel→datamodel, appBundle→appbundle, rest identity.
                const modelKey = skillId.toLowerCase();
                try {
                  parts.push("```json\n" + JSON.stringify({ [modelKey]: modelSection }) + "\n```");
                } catch {
                  // unserializable — keep mermaid-only content
                }
              }
              if (parts.length > 0) {
                const content = parts.join("\n\n");
                setSkillContents((prev) => ({ ...prev, [skillId]: content }));
              }
              if (mermaid) {
                setLatestMermaid(mermaid);
              }
            },
          });
          setDriveFullStatus(classifyDriveFullStatus(pythonDrive));
          drive = pythonDrive
            ? {
                finalState: pythonDrive.finalState,
                stopReason: pythonDrive.stopReason || "completed",
                loops: pythonDrive.loops || [],
                publishClosure: pythonDrive.publishClosure,
              }
            : await SlideRuleRuntime.driveReasoningSession(preparedState, driveOpts as any);
          usedMarathonDriver = false;
        }
      } catch (driveErr: any) {
        driveErrored = true;
        // Graceful: don't leave the turn dangling as "streaming" forever.
        const errMsg = driveErr?.message || String(driveErr);
        appendStep({
          id: `${turnId}-drive-err`,
          kind: "capability_fail",
          capabilityId: "intent.parse" as any,
          roleId: "system",
          loopTurnId: turnId,
          capabilityRunId: `${turnId}-drive-err`,
          runIndex: 0,
          message: `驱动执行失败（已降级显示）：${errMsg.slice(0, 140)}`,
        });
        // Try to at least persist the intake state so graph has something
        try {
          const snap = SlideRuleRuntime.deriveNodeStatus ? SlideRuleRuntime.deriveNodeStatus(preparedState) : preparedState;
          await persistSession(snap);
          applyPersistedState(snap);
        } catch {}
        setUiTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  status: "complete",
                  assistant: `推演中断：${errMsg.slice(0, 200)}（可重试或换指令）`,
                  assistantSource: "fallback",
                }
              : t
          )
        );
        // fall through to finally cleanup
        drive = { finalState: preparedState, stopReason: "error", loops: [] };
      }

      let final = (drive && drive.finalState) || preparedState;
      final = mergePublishClosureForPersistedTurn(final, (drive as any)?.publishClosure);
      try {
        final = await persistSession(final);
        applyPersistedState(final);
      } catch (pErr) {
        // non-fatal for UI
        applyPersistedState(final);
      }

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
          lastDigestNote = `\n\n【M6 真实 digest 过质量门 + 9 段结构化报告】${digest.title}\n${(digest.content || "").slice(0, 380)}...\n\n【M3 真实 frontier.propose (prompt+rationale+ledger)】\nseed: ${proposal.seed}\nprompt(节选): ${proposal.prompt.slice(0, 220)}...\nrationale: ${proposal.rationale}\nledgerEntry: ${JSON.stringify(proposal.ledgerEntry).slice(0, 180)}`;
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
              assistant: (last.assistant || "") + (lastDigestNote || `\n\n[M3/M6] 持续推演已自动生成下一条前沿线索（见 ledger）。`),
            },
          ];
        });
      }

      // M4 demo complete: if marathon await_human (G_READY) or policy path, fire real Notification (user permission)
      if (!driveErrored && driveMode === "marathon" && (drive.stopReason === "await_ready" || drive.stopReason === "coverage_sufficient" /* after auto */)) {
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("SlideRule 持续推演", { body: "本轮已收敛或需要人工确认。点击后可继续 marathon。" });
          } else if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
            Notification.requestPermission().then((p) => {
              if (p === "granted") new Notification("SlideRule Marathon", { body: "可以恢复自动驾驶。" });
            });
          }
        } catch {}
      }

      if (driveErrored) {
        // Error already surfaced a completed turn + snapshot state in catch handler.
        // Skip all success post-processing (would reference possibly bad dummy drive data).
      } else {
        const firstLoop = drive.loops[0];
        const lastLoop = drive.loops[drive.loops.length - 1];
        firstLoopPlanCountRef.value = firstLoop?.plan.selected.length ?? 0;

        const rounds = buildTurnRoundsFromDrive(final.decisionLedger, drive);
        const displayLoopId = firstLoop?.loopTurnId ?? turnId;
        const dledger = latestDledgerForTurn(final.decisionLedger, displayLoopId);
        const planSource = dledger?.source ?? "local_heuristic";
        const planError = firstLoop?.plan?.error || lastLoop?.plan?.error;
        const planOrchestrateReason =
          planSource === "local_heuristic"
            ? "orchestrate_unreachable"
            : planError
            ? `python_${planError}`
            : null;
        // planError / python_* from Python-owned degraded (planner_timeout etc) propagated for UI status visibility (allowed pages file)
        const planReason = firstLoop?.plan.reason ?? lastLoop?.plan.reason ?? firstLoop?.plan?.message;
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

      // Prefer the exact DLEDGER.chose list for selectedCapabilities. This ensures the
      // final routeFacts (and thus the right-upper C_RISK/C_SYN/C_TOOL tree in TurnRouteTimeline)
      // matches what ORCH actually scheduled, even for completed turns and after refresh.
      const finalSelected = (dledger && Array.isArray(dledger.chose) && dledger.chose.length > 0)
        ? dledger.chose.map((cid: any) => ({ capabilityId: String(cid), roleId: "agent" }))
        : selectedCapabilities;

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
        planSelectedCount: finalSelected.length,
        planSource,
        planOrchestrateReason,
        dledgerDecisionId: dledger?.id ?? null,
        rounds,
        selectedCapabilities: finalSelected,
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
      } // end of else (success path for live drive updates)
      setNextGateShouldFail(false);
    } finally {
      setIsRunning(false);
      setLiveAction(null);
      setActiveSkillId(null);  // clear highlighted skill thumbnail after run ends
    }
  };

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
    setLiveAction(null);
  }, []);

  const resolveInteractiveGate = useCallback((gateNodeId: string, choice: string | null) => {
    // Pragmatic bridge to existing text-driven G_CONFIRM logic in intakeMessage.
    // "选择方案 ..." triggers userPicksRoute (clears await_confirm, proceeds with choice).
    // Reject text triggers userRejectsRouteSelection (stales route_options, re-compare).
    const text = choice
      ? "选择方案 A"
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
        loaded = preservePythonEvidenceProjection(sanitizeLegacyEmptySeed(loaded));

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

  // If a reason is provided, re-run directly; otherwise ask for a challenge prompt.
  const challengeTurn = async (artifactId: string, reason?: string) => {
    const text =
      (reason && reason.trim()) ||
      window.prompt("你想如何质疑这轮结论？", "这个结论的依据不够充分，请重新推演。") ||
      "这个结论的依据不够充分，请重新推演。";
    await runTurn(text, {
      targetArtifactId: artifactId,
      intent: "challenge",
      text,
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
      const fresh = await prepareVisibleResetSessionState(
        sid,
        SlideRuleRuntime.deleteSlideRuleSession,
        persistSession
      );
      setSessionState(fresh);
    }
    setUiTurns([]);
    setInput("");
    setLiveAction(null);
    setNextGateShouldFail(false);
    setDriveFullStatus("idle");
  }, [isRunning, sessionState.sessionId, sessionId]);

  // G_READY clarification cards: unanswered open_question gaps with V4-style structured options.
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

  // Generate deliverables by sending one intent through the existing S19 pipeline.
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
    // M5: real marathon budget, surfaced to the HUD for synchronization.
    marathonBudget,
    setMarathonBudget: (b: { maxTokens: number; declaredAt: string }) => setMarathonBudget(b),
    driveFullStatus,
    // SSE live skill highlight — which of the 6 systems is currently executing.
    activeSkillId,
    // Accumulated per-skill content from SSE events (for system screen renderers).
    skillContents,
    latestMermaid,
    sendMessage,
    runTurn,
    challengeTurn,
    resetSession,
    toggleRouteExpanded,
    retryCapability,
    resolveInteractiveGate,
  };
}

export const __sessionEvidenceTestHelpers = {
  preservePythonEvidenceProjection,
  prepareVisibleResetSessionState,
};
