/**
 * SlideRule product view (/sliderule): ONE unified surface (studio skeleton).
 *
 * - Single header row: brand/topic + STATUS summary + actions (交付物/重置会话/Dev)
 * - Left column: conversation (single empty state: logo watermark + hero + chips)
 * - Right rail: SkillThumbnailBar + system screens ⟷ 推演过程 (execution timeline + skill linkage)
 * - Bottom center: single ComposerDock (深思一轮/持续推演), clarification cards above it
 *
 * The old chat/reasoning/studio surface toggle was removed (2026-07): one page,
 * one mental model. The v4 pan/zoom reasoning canvas is gone from this page;
 * ?im=dev still opens the split engineering cockpit with the flow canvas.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrainstormReasoningNode } from "@shared/blueprint";
import { ReasoningFlowSurface } from "@/components/autopilot/ReasoningFlowSurface";
import { useSlideRuleSession } from "./sliderule/useSlideRuleSession";
import { autopilotTheme } from "./sliderule/autopilot-theme";
import type { LiveAction } from "@shared/blueprint/capability-process-labels";
import { narrationFallbackHint } from "@/lib/sliderule-narrator";
import { TurnRouteTimeline } from "./sliderule/TurnRouteTimeline";
import { finalNarrationStep } from "./sliderule/turn-route-steps";
import { deriveSlideRuleReasoningViewModel } from "./sliderule/derive-reasoning-view-model";
import {
  deriveCrossRuntimeGraphSummary,
  derivePublishClosureSummary,
  selectPublishClosureSummary,
  type CrossRuntimeGraphSummary,
  type PublishClosureSummary,
} from "./sliderule/derive-cross-runtime-summary";
import { resolveImSurfaceMode } from "./sliderule/im-surface-mode";
import { SlideRuleStatusBar } from "./sliderule/SlideRuleStatusBar";
import { SlideRuleTopHud } from "./sliderule/SlideRuleTopHud";
import { SettingsDialog } from "./sliderule/SettingsDialog";
import { ClarificationCard, type ClarificationItem } from "./sliderule/ClarificationCard";
import { DeliverablesPanel } from "./sliderule/DeliverablesPanel";
import { ArchitectureProcessPanel } from "./sliderule/ArchitectureProcessPanel";
import { ComposerDock } from "./sliderule/ComposerDock";
import { deriveComposerHintChips } from "./sliderule/derive-composer-hints";
import type { UiTurn } from "./sliderule/types";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import {
  GITHUB_PAGES_DEMO_SESSION_ID,
  GITHUB_PAGES_DEMO_GOAL,
} from "./sliderule/github-pages-sliderule-demo";

import {
  deriveLineageHighlightNodeIds,
  graphNodeIdForArtifact,
} from "./sliderule/derive-lineage-highlight";

import { downloadSlideRuleDeliveryMd } from "./sliderule/serialize-sliderule-delivery-md";
import { deriveLatestTurnFromState } from "./sliderule/derive-persisted-turn";
import {
  PROJECTION_DENSITY_STORAGE_KEY,
  SLIDERULE_TERMINAL_NODE_ID,
  type ProjectionDensity,
} from "./sliderule/sliderule-projection-constants";
import { fetchJsonSafe, isPythonBackendFailure, isDegradedApiError, getLegacyFallbackReason } from "@/lib/api-client";
import { deriveApplication, slideRule } from "@/lib/skills/slideRule";
import { SlideRuleStudio } from "./sliderule/SlideRuleStudio";

// Python full-path E2E wiring (105): /agent-loop/sliderule and /sliderule
// render this component, while turn/evidence/report calls surface Python
// provenance through the delegated /api/sliderule path.

const HINT_CHIPS_SPLIT = [
  "Compare routes",
  "澄清权限边界",
  "分析安全风险",
  "Break into SPEC Tree",
  "Generate feasibility report",
  "效果预览",
];

function LiveActionIndicator({ liveAction }: { liveAction: LiveAction }) {
  return (
    <div
      className={
        liveAction.external ? autopilotTheme.liveActionExternal : autopilotTheme.liveActionThink
      }
    >
      {!liveAction.external && (
        <span className="mr-2 inline-flex gap-1 align-middle">
          <span className="size-1.5 animate-pulse rounded-full bg-stone-400" />
          <span className="size-1.5 animate-pulse rounded-full bg-stone-400 [animation-delay:120ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-stone-400 [animation-delay:240ms]" />
        </span>
      )}
      {liveAction.label}
    </div>
  );
}

function TurnFootnote({
  turn,
  sessionId,
  onChallenge,
}: {
  turn: UiTurn;
  sessionId: string;
  onChallenge: (artifactId: string) => void;
}) {
  const parts: React.ReactNode[] = [];

  parts.push(
    <a
      key="evidence"
      href={`/sliderule/dev?session=${encodeURIComponent(sessionId)}`}
      className="text-stone-500 hover:text-stone-700 hover:underline"
    >
      Evidence chain
    </a>
  );

  if (turn.main) {
    parts.push(
      <button
        key="challenge"
        type="button"
        onClick={() => onChallenge(turn.main!.artifactId)}
        className="text-stone-500 hover:text-stone-700 hover:underline"
      >
        质疑这轮结论
      </button>
    );
    parts.push(
      <span key="source" className="text-stone-400">
        {turn.main.realLlm ? "真实推演" : "规则推演"}
      </span>
    );
  }

  if (turn.assistantSource === "fallback") {
    const fallbackHint =
      narrationFallbackHint(turn.narrationReason) ||
      "叙述服务暂不可用，本条为系统模板回复（产物与结论状态不受影响）";
    parts.push(
      <span key="fallback" className="text-stone-400" title={fallbackHint}>
        模板回复
      </span>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-stone-500">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-stone-300">·</span>}
          {part}
        </React.Fragment>
      ))}
    </div>
  );
}

function textFromStep(step: UiTurn["steps"][number] | null | undefined): string {
  if (!step) return "";
  if (step.kind === "narration" || step.kind === "step_narration") return step.text;
  if (step.kind === "chip") return step.label;
  if (step.kind === "capability_fail") return step.message;
  return "";
}

function assistantTextForTurn(turn: UiTurn, publishClosure?: PublishClosureSummary | null): string {
  const assistant = turn.assistant?.trim();
  if (assistant) return assistant;
  const finalStepText = finalNarrationStep(turn.steps)?.text?.trim();
  if (finalStepText) return finalStepText;
  // 不再回退到最后一枚过程 chip（会把「指令已接收 · 启动推理」当成回答复读）；
  // 过程细节由 TurnStepsDisclosure 折叠承载，这里只给结论句。
  if (publishClosure) {
    const status = publishClosure.blocked ? "发布闭环被阻塞" : "五系统推演完成，发布闭环已收口";
    return `${status}：${publishClosure.evidencePresentCount}/${publishClosure.skillCount} 个系统证据可用，版本钉扎${publishClosure.versionPinsChecked ? "已检查" : "未完成"}。`;
  }
  return turn.status === "streaming" ? "正在整理推演结果..." : "本轮已完成，但还没有生成可展示的回答。";
}

/**
 * TurnStepsDisclosure — Claude 式过程折叠。
 * 运行中：实时流出最近 3 步（部分可见），「展开」看全程；
 * 完成后：折叠成一行「推演过程 · N 步」，点开回看全部——过程不打扰结论。
 */
function TurnStepsDisclosure({ turn }: { turn: UiTurn }) {
  const [expanded, setExpanded] = React.useState(false);
  const stepTexts = turn.steps.map(textFromStep).filter(Boolean);
  if (stepTexts.length === 0) return null;
  const streaming = turn.status === "streaming";
  const visible = expanded ? stepTexts : streaming ? stepTexts.slice(-3) : [];

  return (
    <div className="mt-1" data-testid="sliderule-turn-steps">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-stone-400 transition-colors hover:text-stone-600"
        data-testid="sliderule-turn-steps-toggle"
      >
        <span className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
        推演过程 · {stepTexts.length} 步{streaming && !expanded ? "（实时）" : ""}
      </button>
      {visible.length > 0 && (
        <div className={`mt-1 space-y-1 border-l border-[#EFEBE2] pl-3 ${expanded ? "max-h-64 overflow-y-auto" : ""}`}>
          {visible.map((t, i) => (
            <div key={i} className="text-xs leading-5 text-stone-400">
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 前两条为内置演示域（确定性 fixture，秒出、不调 LLM）；
// 第三条为新颖域，走真实 LLM 五系统生成——用户从 chips 就能体验两条路径。
const EXAMPLE_PROMPTS = [
  "做一个采购审批应用，含采购单、经理审批、财务确认和字段权限",
  "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理",
  "做一个连锁健身房管理系统，包含私教排期、会员卡核销和器材保养",
] as const;

/**
 * ClaudeChatSurface — 统一页左栏对话区（Claude 风格轻量 prose 布局）。
 * 头部动作（交付物 / 重置会话 / Dev）由页面唯一顶栏承担；这里只负责对话流与
 * 唯一空态（古典 logo 水印 + hero 文案 + 3 个示例 chips）。
 */
function ClaudeChatSurface({
  uiTurns,
  isRunning,
  liveAction,
  latestTurn,
  publishClosure,
  llmDraft = "",
  onChallenge,
}: {
  uiTurns: UiTurn[];
  isRunning: boolean;
  liveAction: LiveAction | null;
  latestTurn: UiTurn | null;
  publishClosure?: PublishClosureSummary | null;
  /** 五系统 LLM 生成的实时草稿（llm_delta 累积；仅运行中展示尾部）。 */
  llmDraft?: string;
  onChallenge: (id: string) => void;
}) {
  const latestStepText = latestTurn ? textFromStep(latestTurn.steps.at(-1)) : "";
  const thinkingText =
    liveAction?.label ||
    latestStepText ||
    (publishClosure
      ? publishClosure.blocked
        ? "发布闭环被阻塞，等待下一步修正"
        : "发布闭环完成"
      : "正在推演...");

  return (
    <div className="relative z-0 flex h-full flex-col overflow-hidden bg-[#FAF9F5] text-[#1F1E1B]">
      {/* Chat area */}
      <div className="mx-auto flex min-h-0 w-full max-w-[780px] flex-1 flex-col overflow-y-auto px-4 pb-4 pt-4 sm:px-6">
        {uiTurns.length === 0 ? (
          /* THE single empty state — classical logo watermark + hero copy + 3 example prompts */
          <div
            className="flex h-full flex-col items-center justify-center gap-6 text-center"
            data-testid="sliderule-empty-state"
          >
            <img
              src="/assets/sliderule-logo.png"
              alt="SlideRule"
              className="w-[min(56%,220px)] object-contain opacity-[0.9] drop-shadow-[0_14px_30px_rgb(68_60_44/0.12)]"
              title="SlideRule"
            />
            <div>
              <div className="font-display text-[26px] font-medium tracking-tight text-[#1F1E1B]">我能帮你把意图推演成应用闭环</div>
              <div className="mt-2 text-sm text-stone-500">
                发一句业务目标，SlideRule 串起五系统，输出可校验的企业应用数字孪生。
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-[520px]">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isRunning}
                  onClick={() => {
                    // Dispatch a custom event so ComposerDock can pick it up
                    window.dispatchEvent(new CustomEvent("sliderule:fill-prompt", { detail: { text: prompt } }));
                  }}
                  className="w-full rounded-xl border border-[#E7E2D9] bg-white px-4 py-3 text-left text-sm text-stone-700 transition-colors hover:border-[#D8D1C4] hover:bg-[#F5F1EA] disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6 py-2">
            {uiTurns.map((turn) => {
              const answer = assistantTextForTurn(turn, publishClosure);
              return (
                <section key={turn.id} className="space-y-4">
                  {/* User bubble — right; hidden for turns restored from persisted state (no user text) */}
                  {turn.user && (
                    <div className="flex justify-end">
                      <div className="max-w-[520px] rounded-2xl bg-[#F8E8E0] px-4 py-2.5 text-[15px] leading-7 text-[#1F1E1B]">
                        {turn.user}
                      </div>
                    </div>
                  )}

                  {/* Assistant reply — left, prose, no card.
                      Claude 式：运行中流式吐最近几步（可展开全程）；
                      完成后过程折叠为一行，只留结论句 + 状态。 */}
                  <div className="max-w-[640px]">
                    {turn.status === "streaming" ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-stone-500">
                          <span className="inline-flex gap-0.5">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-300" style={{ animationDelay: `${i * 120}ms` }} />
                            ))}
                          </span>
                          {thinkingText}
                        </div>
                        <TurnStepsDisclosure turn={turn} />
                        {/* LLM 实时想法：五系统生成期间流式滚出原始草稿尾部
                            （新颖意图路径独有；确定性域秒出、无此窗口） */}
                        {llmDraft && (
                          <div data-testid="sliderule-llm-draft" className="rounded-xl border border-[#E7E2D9] bg-[#2A2620] px-3 py-2.5">
                            <div className="mb-1.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-stone-400">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#D97757]" />
                              LLM 实时输出 · 五系统模型起草中 · {llmDraft.length} 字符
                            </div>
                            <pre className="max-h-40 overflow-hidden whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-stone-300">
                              {llmDraft.length > 900 ? `...${llmDraft.slice(-900)}` : llmDraft}
                              <span className="animate-pulse text-[#D97757]">▊</span>
                            </pre>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2 text-[15px] leading-7 text-stone-800">
                        <div className="prose prose-stone max-w-none prose-p:my-1 whitespace-pre-wrap">{answer}</div>
                        <TurnStepsDisclosure turn={turn} />
                        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
                          {publishClosure && (
                            <span className="rounded-full bg-[#F0EDE5] px-2 py-0.5">
                              {publishClosure.blocked ? "blocked" : "closed"} {publishClosure.evidencePresentCount}/{publishClosure.skillCount}
                            </span>
                          )}
                          {turn.main && (
                            <button
                              type="button"
                              onClick={() => onChallenge(turn.main!.artifactId)}
                              className="rounded-full bg-[#F0EDE5] px-2 py-0.5 hover:bg-[#E7E2D9]"
                            >
                              质疑本轮
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部六系统标签行已移除（用户反馈：终端用户不关心内部 skill 名，
          只添乱）——闭环状态在每轮回答的 closed x/6 pill 与右栏看板已有，
          交付物入口由顶栏承担。 */}
    </div>
  );
}

function DriveFullStatusBanner({
  status,
  className = "",
}: {
  status?: "idle" | "loading" | "python_success" | "timeout" | "python_unavailable" | "fallback";
  className?: string;
}) {
  if (!status || status === "idle" || status === "python_success") return null;
  const text =
    status === "loading"
      ? "/drive-full loading Python..."
      : status === "timeout"
      ? "/drive-full timeout"
      : status === "python_unavailable"
      ? "/drive-full Python unavailable"
      : "/drive-full fallback";
  return (
    <div
      data-testid="sliderule-drive-full-status"
      data-status={status}
      className={`pointer-events-auto rounded border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800 shadow-sm ${className}`}
      title={text}
    >
      {text}
    </div>
  );
}

export function deriveNoIntentRuntimeProjection({
  pythonPublishClosure,
  pythonSkillRuntimeGraph,
}: {
  pythonPublishClosure?: PublishClosureSummary | null;
  pythonSkillRuntimeGraph?: unknown;
}): {
  crossRuntimeGraph: CrossRuntimeGraphSummary | null;
  publishClosure: PublishClosureSummary | null;
} {
  const runtimeCross = pythonSkillRuntimeGraph
    ? deriveCrossRuntimeGraphSummary(pythonSkillRuntimeGraph as any, { exampleLimit: 5 })
    : null;
  const closure = pythonPublishClosure ?? null;
  return {
    crossRuntimeGraph:
      runtimeCross ||
      (closure
        ? {
            edgeCount: 0,
            allowedCount: 0,
            blockedCount: 0,
            skillCount: closure.skillCount || 0,
            evidenceCount: closure.evidencePresentCount || 0,
            examples: [],
          }
        : null),
    publishClosure: closure,
  };
}

export function deriveImmediatePythonRuntimeProjection({
  pythonPublishClosure,
  pythonSkillRuntimeGraph,
}: {
  pythonPublishClosure?: PublishClosureSummary | null;
  pythonSkillRuntimeGraph?: unknown;
}): {
  crossRuntimeGraph: CrossRuntimeGraphSummary | null;
  publishClosure: PublishClosureSummary | null;
} | null {
  if (!pythonPublishClosure && !pythonSkillRuntimeGraph) return null;
  return deriveNoIntentRuntimeProjection({
    pythonPublishClosure,
    pythonSkillRuntimeGraph,
  });
}

export async function loadPythonRuntimeProjectionFromSession(
  sessionId: string,
  fetcher: typeof fetch = fetch
): Promise<{
  crossRuntimeGraph: CrossRuntimeGraphSummary | null;
  publishClosure: PublishClosureSummary | null;
} | null> {
  const response = await fetcher(
    `/api/sliderule/sessions/${encodeURIComponent(sessionId)}`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const state = body?.state && typeof body.state === "object" ? body.state : body;
  return deriveImmediatePythonRuntimeProjection({
    pythonPublishClosure: state?.publishClosure ?? null,
    pythonSkillRuntimeGraph: state?.skillRuntimeGraph ?? null,
  });
}

/**
 * SlideRuleUnified — 唯一产品界面（studio 骨架，无模式切换）。
 *
 * - 顶部单行 header：品牌/话题 + STATUS 摘要（待细化/话题/阶段）+ 动作（交付物/设置/重置会话/Dev）。
 * - 左栏：对话流（含唯一空态：古典 logo 水印 + hero 文案 + 示例 chips）。
 * - 右栏：SkillThumbnailBar + 内容区（六系统画面 ⟷「推演过程」执行时间线 + SKILL LINKAGE）。
 * - 底部：唯一 ComposerDock（深思一轮/持续推演），澄清卡片浮在其上。
 *
 * 旧的 pan/zoom 推理画布（v4 面）已从本页移除；工程画布仍可经 ?im=dev 进入
 * SlideRuleSplitEngineering 查看。
 */
function SlideRuleUnified({
  goal,
  uiTurns,
  input,
  setInput,
  isRunning,
  liveAction,
  sessionState,
  sendMessage,
  challengeTurn,
  resetSession,
  retryCapability,
  toggleRouteExpanded,
  onEvidenceRefClick,
  projectionDensity,
  onProjectionDensityChange,
  latestTurn,
  executorMode,
  driveMode,
  setDriveMode,
  marathonBudget,
  setMarathonBudget,
  pendingClarifications,
  answerClarifications,
  generateDeliverables,
  onExportDeliverables,
  stop,
  deliverablesOpen,
  setDeliverablesOpen,
  openDeliverables,
  embedded = false,
  pythonApiError,
  pythonStatusMsg,
  retryPythonBackend,
  crossRuntimeGraph,
  publishClosure,
  driveFullStatus,
  activeSkillId = null,
  skillContents = {},
  latestMermaid = null,
  llmDraft = "",
}: {
  goal: string;
  uiTurns: UiTurn[];
  input: string;
  setInput: (v: string) => void;
  isRunning: boolean;
  liveAction: LiveAction | null;
  sessionState: ReturnType<typeof useSlideRuleSession>["sessionState"];
  sendMessage: () => void;
  challengeTurn: (id: string) => void;
  resetSession: () => void;
  retryCapability: ReturnType<typeof useSlideRuleSession>["retryCapability"];
  toggleRouteExpanded: (turnId: string) => void;
  onEvidenceRefClick: (artifactId: string) => void;
  projectionDensity: ProjectionDensity;
  onProjectionDensityChange: (density: ProjectionDensity) => void;
  latestTurn: UiTurn | null;
  executorMode: ReturnType<typeof useSlideRuleSession>["executorMode"];
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  marathonBudget?: { maxTokens: number; declaredAt: string };
  setMarathonBudget?: (b: { maxTokens: number; declaredAt: string }) => void;
  pendingClarifications?: ClarificationItem[];
  answerClarifications?: (answers: Array<{ gapId: string; answer: string }>) => void;
  generateDeliverables: () => void;
  onExportDeliverables: () => void;
  stop?: () => void;
  deliverablesOpen: boolean;
  setDeliverablesOpen: (open: boolean) => void;
  openDeliverables: () => void;
  embedded?: boolean;
  pythonApiError?: any;
  pythonStatusMsg?: string;
  retryPythonBackend?: () => void;
  crossRuntimeGraph?: CrossRuntimeGraphSummary | null;
  publishClosure?: PublishClosureSummary | null;
  driveFullStatus?: "idle" | "loading" | "python_success" | "timeout" | "python_unavailable" | "fallback";
  /** SSE-driven active skill highlighting for the right rail */
  activeSkillId?: import("@/lib/sliderule-marathon-driver").SkillId | null;
  skillContents?: Partial<Record<import("@/lib/sliderule-marathon-driver").SkillId, string>>;
  latestMermaid?: string | null;
  /** 五系统 LLM 生成的实时草稿（llm_delta 累积）。 */
  llmDraft?: string;
}) {
  const sessionId = sessionState.sessionId || "sliderule-v51-product";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const composerHints = useMemo(
    () => deriveComposerHintChips(sessionState),
    [sessionState]
  );

  // Clarification cards can be hidden; they reappear when pending questions change.
  const clarifications = pendingClarifications ?? [];
  const clarifyKey = clarifications.map((c) => c.id).join("|");
  const [clarifyHidden, setClarifyHidden] = useState(false);
  useEffect(() => {
    setClarifyHidden(false);
  }, [clarifyKey]);
  const showClarify = clarifications.length > 0 && !clarifyHidden && !!answerClarifications;

  // Conversation column: live turns during/after a run; after reload uiTurns is
  // empty but the latest turn is rebuilt from persisted state — surface it so the
  // page restores instead of falling back to the empty state.
  const conversationTurns = uiTurns.length > 0 ? uiTurns : latestTurn ? [latestTurn] : [];

  const driveLoopCount =
    latestTurn?.routeFacts.rounds?.length ??
    (latestTurn && latestTurn.routeFacts.planSelectedCount ? 1 : 0);

  return (
    <div className={`${autopilotTheme.immersionPage} flex flex-col`}>
      {/* ONE header row — brand/topic + STATUS summary + actions */}
      <div className="relative z-20 shrink-0 border-b border-[#E7E2D9]/70 bg-[#FAF9F5]/90 px-3 backdrop-blur sm:px-4">
        <SlideRuleTopHud
          state={sessionState}
          goal={goal}
          turnCount={uiTurns.length}
          isRunning={isRunning}
          driveLoopCount={driveLoopCount}
          executorMode={executorMode}
          publishClosure={publishClosure}
          onResetSession={resetSession}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenDeliverables={openDeliverables}
          embedded={embedded}
        />
        {/* Python backend failure visible + recoverable status/retry for core SlideRule workflows (105 req 2) */}
        {(pythonApiError || pythonStatusMsg) && (
          <div className="mb-2 inline-flex rounded border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800 shadow-sm" title={pythonStatusMsg}>
            Python backend: {pythonStatusMsg || "degraded/timeout"} ·
            <button type="button" onClick={retryPythonBackend} className="ml-2 underline">Retry</button>
            {getLegacyFallbackReason(pythonApiError) && <span className="ml-2 text-amber-600">fallback active</span>}
            {isDegradedApiError(pythonApiError) && <span className="ml-1">(degraded envelope)</span>}
          </div>
        )}
        <DriveFullStatusBanner status={driveFullStatus} className="mb-2 inline-flex" />
      </div>

      {/* Studio body — left conversation column + right skill rail */}
      <div className="relative z-0 min-h-0 flex-1 pb-[104px]">
        <SlideRuleStudio
          chatSlot={
            <ClaudeChatSurface
              uiTurns={conversationTurns}
              isRunning={isRunning}
              liveAction={liveAction}
              latestTurn={latestTurn}
              publishClosure={publishClosure}
              llmDraft={isRunning ? llmDraft : ""}
              onChallenge={challengeTurn}
            />
          }
          activeSkillId={activeSkillId}
          publishClosure={publishClosure}
          latestMermaid={latestMermaid}
          skillContents={skillContents}
          skillRuntimeGraph={
            (sessionState as { skillRuntimeGraph?: import("./sliderule/system-screens/five-system-model").SkillRuntimeGraphLike | null })
              .skillRuntimeGraph ?? null
          }
          isRunning={isRunning}
          processSlot={
            <ArchitectureProcessPanel
              variant="rail"
              liveAction={isRunning ? liveAction : null}
              latestTurn={
                latestTurn
                  ? {
                      id: latestTurn.id,
                      routeFacts: latestTurn.routeFacts,
                      steps: latestTurn.steps,
                      actions: latestTurn.actions,
                      status: latestTurn.status,
                      routeLitCount: latestTurn.routeLitCount,
                      routeExpanded: latestTurn.routeExpanded,
                    }
                  : null
              }
              sessionId={sessionId}
              isRunning={isRunning}
              onToggleRoute={
                latestTurn ? () => toggleRouteExpanded(latestTurn.id) : undefined
              }
              onRetryCapability={
                latestTurn
                  ? (params) => retryCapability(latestTurn.id, params)
                  : undefined
              }
              crossRuntimeGraph={crossRuntimeGraph}
              publishClosure={publishClosure}
            />
          }
          className="h-full"
        />
      </div>

      {/* Single bottom composer + clarification cards */}
      <div className={autopilotTheme.immersionOverlayBottom}>
        <div className="pointer-events-none flex w-full max-w-2xl flex-col items-center">
          {showClarify && (
            <ClarificationCard
              questions={clarifications}
              onSubmit={(answers) => answerClarifications?.(answers)}
              onClose={() => setClarifyHidden(true)}
            />
          )}

          <ComposerDock
            input={input}
            setInput={setInput}
            sendMessage={sendMessage}
            isRunning={isRunning}
            goal={goal}

            hintChips={composerHints}
            driveMode={driveMode}
            setDriveMode={setDriveMode}
            stop={stop}
          />
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projectionDensity={projectionDensity}
        onProjectionDensityChange={onProjectionDensityChange}
        driveMode={driveMode}
        setDriveMode={setDriveMode}
        marathonBudget={marathonBudget}
        setMarathonBudget={setMarathonBudget}
      />

      <DeliverablesPanel
        open={deliverablesOpen}
        onClose={() => setDeliverablesOpen(false)}
        sessionState={sessionState}
        isRunning={isRunning}
        onGenerate={() => generateDeliverables()}
        onExportMd={() => onExportDeliverables()}
        onEvidenceRefClick={onEvidenceRefClick}
        publishClosure={publishClosure}
      />
    </div>
  );
}

function SlideRuleSplitEngineering({
  goal,
  uiTurns,
  input,
  setInput,
  isRunning,
  liveAction,
  sessionState,
  sendMessage,
  challengeTurn,
  resetSession,
  toggleRouteExpanded,
  retryCapability,
  reasoningViewModel,
  graphNodeCount,
  graphRevision,
  handleGraphNodeClick,
  handleNodeEditSubmit,
  handleResolveInteractiveGate,
  handleTerminalAction,
  focusNodeId,
  lineageHighlightIds,
  onEvidenceRefClick,
  projectionDensity,
  onProjectionDensityChange,
  imSurfaceMode,
  latestTurn,
  latestTurnId,
  executorMode,
  driveMode,
  setDriveMode,
  generateDeliverables,
  onExportDeliverables,
  stop,
  deliverablesOpen,
  setDeliverablesOpen,
  openDeliverables,
  publishClosure,
  driveFullStatus,
}: {
  goal: string;
  uiTurns: UiTurn[];
  input: string;
  setInput: (v: string) => void;
  isRunning: boolean;
  liveAction: LiveAction | null;
  sessionState: ReturnType<typeof useSlideRuleSession>["sessionState"];
  sendMessage: () => void;
  challengeTurn: (id: string) => void;
  resetSession: () => void;
  toggleRouteExpanded: (id: string) => void;
  retryCapability: ReturnType<typeof useSlideRuleSession>["retryCapability"];
  reasoningViewModel: ReturnType<typeof deriveSlideRuleReasoningViewModel>;
  graphNodeCount: number;
  graphRevision: string;
  handleGraphNodeClick: (node: BrainstormReasoningNode) => void;
  handleNodeEditSubmit: (node: BrainstormReasoningNode, text: string) => void;
  handleResolveInteractiveGate?: (gateNodeId: string, choice: string | null) => void;
  handleTerminalAction: (action: "report" | "lineage" | "export") => void;
  focusNodeId: string | null;
  lineageHighlightIds: string[];
  onEvidenceRefClick: (artifactId: string) => void;
  projectionDensity: ProjectionDensity;
  onProjectionDensityChange: (density: ProjectionDensity) => void;
  imSurfaceMode: ReturnType<typeof resolveImSurfaceMode>;
  latestTurn: UiTurn | null;
  latestTurnId: string | null;
  executorMode: ReturnType<typeof useSlideRuleSession>["executorMode"];
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  generateDeliverables: () => void;
  onExportDeliverables: () => void;
  stop?: () => void;
  deliverablesOpen: boolean;
  setDeliverablesOpen: (open: boolean) => void;
  openDeliverables: () => void;
  publishClosure?: PublishClosureSummary | null;
  driveFullStatus?: "idle" | "loading" | "python_success" | "timeout" | "python_unavailable" | "fallback";
}) {
  const imScrollRef = useRef<HTMLElement>(null);
  const imBottomRef = useRef<HTMLDivElement>(null);
  const imAtBottomRef = useRef(true);

  const imScrollSignature = useMemo(
    () =>
      uiTurns
        .map((t) => {
          const last = t.steps[t.steps.length - 1];
          const lastBody =
            last && "text" in last
              ? last.text.length
              : last && "label" in last
              ? last.label.length
              : 0;
          return `${t.id}:${t.status}:${t.routeLitCount}:${t.steps.length}:${t.actions.length}:${last?.id ?? ""}:${lastBody}`;
        })
        .join("|"),
    [uiTurns]
  );

  useEffect(() => {
    const el = imScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      imAtBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= 32;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!isRunning && !imAtBottomRef.current) return;
    requestAnimationFrame(() => {
      imBottomRef.current?.scrollIntoView({ block: "end" });
      if (imScrollRef.current) {
        imScrollRef.current.scrollTop = imScrollRef.current.scrollHeight;
      }
      imAtBottomRef.current = true;
    });
  }, [imScrollSignature, isRunning, uiTurns.length]);

  return (
    <div className={autopilotTheme.page}>
      <header className={autopilotTheme.header}>
        <img
          src="/assets/sliderule_icon_flat_transparent.png"
          alt="SlideRule"
          className="mr-2 h-5 w-5 shrink-0 self-center opacity-70"
          title="SlideRule"
        />
        <div className="min-w-0 flex-1">
          <div className={autopilotTheme.label}>我的想法</div>
          <div
            className={`${autopilotTheme.goal} ${!goal ? "text-stone-400" : ""}`}
            data-testid="sliderule-goal-display"
          >
            {goal || "Enter an idea to start SlideRule."}
          </div>
        </div>
        <div className="flex items-center gap-3 pl-4">
          <button
            type="button"
            onClick={openDeliverables}
            data-testid="sliderule-deliverables-open"
            className={autopilotTheme.auditBtn}
            title="Deliverables (report / spec tree / docs / prompt pack / architecture / handoff)"
          >
            Deliverables
          </button>
          <button
            type="button"
            onClick={resetSession}
            disabled={isRunning}
            data-testid="sliderule-reset-session"
            className={autopilotTheme.auditBtn}
            title={isRunning ? "SlideRule is running; reset later." : "Clear this conversation and restart."}
          >
            重置会话
          </button>
          <a href="/sliderule/dev" className={autopilotTheme.devLink} title="Open engineering cockpit">
            Dev
          </a>
        </div>
      </header>

      <DriveFullStatusBanner status={driveFullStatus} className="mx-6 mt-2 inline-flex" />

      <SlideRuleStatusBar
        state={sessionState}
        turnCount={uiTurns.length}
        isRunning={isRunning}
        driveLoopCount={
          latestTurn?.routeFacts.rounds?.length ??
          (latestTurn && latestTurn.routeFacts.planSelectedCount ? 1 : 0)
        }
        closureReason={latestTurn?.routeFacts.closureReason ?? null}
        executorMode={executorMode}
        publishClosure={publishClosure}
      />

      <div className={autopilotTheme.split}>
        <section className={autopilotTheme.flowPanelWide} aria-label="推演路径">
          <div className={autopilotTheme.flowPanelHeader}>
            <span className={autopilotTheme.label}>推演路径</span>
            <div className="flex min-w-0 flex-col items-end gap-0.5">
              {isRunning && liveAction ? (
                <LiveActionIndicator liveAction={liveAction} />
              ) : (
                <span className="text-[10px] text-stone-400">
                  {graphNodeCount > 0
                    ? `${graphNodeCount} nodes - click to inspect`
                    : "发送消息后展开推理地图"}
                </span>
              )}
            </div>
          </div>
          <div className={`${autopilotTheme.flowPanelBody} relative`}>
            {graphNodeCount > 0 ? (
              <ReasoningFlowSurface
                viewModel={reasoningViewModel}
                initialScale={0.82}
                graphRevision={graphRevision}
                className="absolute inset-0"
                showChrome
                onNodeClick={handleGraphNodeClick}
                onNodeEditSubmit={handleNodeEditSubmit}
                onResolveInteractiveGate={handleResolveInteractiveGate}
                externalHighlightedIds={lineageHighlightIds}
                focusNodeId={focusNodeId}
                onTerminalAction={handleTerminalAction}
                terminalCanExport={reasoningViewModel.terminalMeta?.canExport}
              />
            ) : (
              <div className={autopilotTheme.flowEmpty}>
                Send the first message to unfold the reasoning path here.
              </div>
            )}
          </div>
        </section>

        <section className={autopilotTheme.imPanel} aria-label="对话">
          <main ref={imScrollRef} className={autopilotTheme.main}>
            <div className="space-y-6">
              {uiTurns.length === 0 && (
                <div className={autopilotTheme.emptyState}>
                  Welcome to SlideRule V5.
                  <p className={autopilotTheme.emptyHint}>
                    Enter a goal or challenge below; the system dynamically selects capability x role steps.
                    There are no fixed stages; current state and your input drive the route.
                  </p>
                </div>
              )}
              {uiTurns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  <div className="flex justify-end">
                    <div className={autopilotTheme.userBubble}>{turn.user}</div>
                  </div>
                  <div className="rounded-lg border border-[#E7E2D9]/80 bg-white px-4 py-4 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
                    {/* M7 close-out: turn-route is hidden by default in marathon mode; single mode remains visible and toggle can expand it. */}
                    {(driveMode !== "marathon" || turn.routeExpanded) && (
                      <TurnRouteTimeline
                        facts={turn.routeFacts}
                        steps={turn.steps}
                        actions={turn.actions}
                        sessionId={sessionState.sessionId || "sliderule-v51-product"}
                        expanded={turn.routeExpanded || turn.status === "streaming"}
                        onToggle={() => toggleRouteExpanded(turn.id)}
                        litCount={turn.routeLitCount}
                        streaming={turn.status === "streaming"}
                        liveAction={
                          turn.id === latestTurnId && turn.status === "streaming"
                            ? liveAction
                            : null
                        }
                        surfaceMode={imSurfaceMode}
                        retrying={isRunning}
                        onRetryCapability={(params) => retryCapability(turn.id, params)}
                        reasoningEvents={sessionState.reasoningEvents}
                      />
                    )}
                    {driveMode === "marathon" && !turn.routeExpanded && (
                      <div className="cursor-pointer text-[10px] text-stone-400" onClick={() => toggleRouteExpanded(turn.id)} title="Marathon route details are hidden; click to expand.">Continuing SlideRule. Click to expand route.</div>
                    )}
                    {turn.status === "complete" && (
                      <TurnFootnote
                        turn={turn}
                        sessionId={sessionState.sessionId || "sliderule-v51-product"}
                        onChallenge={challengeTurn}
                      />
                    )}
                  </div>
                </div>
              ))}
              <div ref={imBottomRef} className="h-px shrink-0" aria-hidden />
            </div>
          </main>

          <footer className={autopilotTheme.footer}>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Engineering path IM..."
                disabled={isRunning}
                className={autopilotTheme.input}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim()}
                className={autopilotTheme.sendBtn}
              >
                {isRunning ? "Stop" : "Send"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {HINT_CHIPS_SPLIT.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setInput(hint)}
                  className={autopilotTheme.hintChip}
                >
                  {hint}
                </button>
              ))}
            </div>
          </footer>
        </section>
      </div>



      <DeliverablesPanel
        open={deliverablesOpen}
        onClose={() => setDeliverablesOpen(false)}
        sessionState={sessionState}
        isRunning={isRunning}
        onGenerate={() => generateDeliverables()}
        onExportMd={() => onExportDeliverables()}
        onEvidenceRefClick={onEvidenceRefClick}
        publishClosure={publishClosure}
      />
    </div>
  );
}

export default function SlideRule({ embedded = false }: { embedded?: boolean } = {}) {
  const {
    goal,
    uiTurns,
    input,
    setInput,
    isRunning,
    liveAction,
    sessionState,
    executorMode,
    sendMessage,
    challengeTurn,
    resetSession,
    toggleRouteExpanded,
    retryCapability,
    driveMode,
    setDriveMode,
    marathonBudget,
    setMarathonBudget,
    resolveInteractiveGate,
    pendingClarifications,
    answerClarifications,
    generateDeliverables,
    stop,
    driveFullStatus,
    activeSkillId,
    skillContents,
    latestMermaid,
    llmDraft,
  } = useSlideRuleSession({
    sessionId: IS_GITHUB_PAGES ? GITHUB_PAGES_DEMO_SESSION_ID : "sliderule-v51-product",
    documentTitle: IS_GITHUB_PAGES ? "SlideRule · 演示" : "SlideRule",
    initialGoal: IS_GITHUB_PAGES ? GITHUB_PAGES_DEMO_GOAL : undefined,
  });

  // Python backend error/timeout/degraded/legacy status + retry for core SlideRule workflow (105)
  const [pythonApiError, setPythonApiError] = useState<any>(null);
  const [pythonStatusMsg, setPythonStatusMsg] = useState<string>("");
  const probePythonBackend = useCallback(async () => {
    try {
      const res = await fetchJsonSafe<{ status?: string }>("/api/sliderule/health");
      if (!res.ok) {
        setPythonApiError(res.error);
        setPythonStatusMsg(
          `Python backend ${res.error.kind}${res.error.status ? " " + res.error.status : ""}: ${res.error.message} ${getLegacyFallbackReason(res.error) || ""}`
        );
      } else {
        setPythonApiError(null);
        setPythonStatusMsg("");
      }
    } catch {
      setPythonApiError({ kind: "degraded", message: "probe failed", source: "network", retryable: true } as any);
      setPythonStatusMsg("Python backend probe unreachable; retry available");
    }
  }, []);
  useEffect(() => {
    // probe once on mount for visibility of python failure states in main workflow
    probePythonBackend();
  }, [probePythonBackend]);

  const retryPythonBackend = useCallback(() => {
    setPythonStatusMsg("retrying Python backend...");
    probePythonBackend();
  }, [probePythonBackend]);

  const imSurfaceMode = useMemo(() => resolveImSurfaceMode(), []);
  const isImmersion = imSurfaceMode !== "engineering";
  // Rebuild the latest turn from persisted session state after refresh when uiTurns is empty.
  const restoredLatestTurn = useMemo(
    () => (uiTurns.length === 0 ? deriveLatestTurnFromState(sessionState) : null),
    [uiTurns.length, sessionState]
  );
  const latestTurn = uiTurns.length > 0 ? uiTurns[uiTurns.length - 1] : restoredLatestTurn;
  const latestTurnId = latestTurn?.id ?? null;

  const [projectionDensity, setProjectionDensity] = useState<ProjectionDensity>(() => {
    try {
      const stored = localStorage.getItem(PROJECTION_DENSITY_STORAGE_KEY);
      return stored === "detailed" ? "detailed" : "compact";
    } catch {
      return "compact";
    }
  });
  const VIEW_MODE_STORAGE_KEY = "sliderule:view-mode:v1";
  const [viewMode, setViewMode] = useState<"overview" | "collaboration" | "reasoning">(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      return stored === "collaboration" || stored === "reasoning" ? stored : "overview";
    } catch {
      return "overview";
    }
  });
  const onViewModeChange = useCallback((m: "overview" | "collaboration" | "reasoning") => {
    setViewMode(m);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, m);
    } catch {}
  }, []);

  const [lineageHighlightIds, setLineageHighlightIds] = useState<string[]>([]);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [deliverablesOpen, setDeliverablesOpen] = useState(false);
  const openDeliverables = useCallback(() => setDeliverablesOpen(true), []);
  // pythonPublishClosure: authoritative Python-produced evidence from /drive-full (persisted in sessionState);
  // used by select to prefer over TS preview. See useEffect below for the prefer/fallback decision.
  const sessionEvidence = sessionState as {
    publishClosure?: PublishClosureSummary | null;
    skillRuntimeGraph?: unknown;
  };
  const pythonPublishClosure = sessionEvidence.publishClosure ?? null;
  const pythonSkillRuntimeGraph = sessionEvidence.skillRuntimeGraph ?? null;
  // Seed initial from python /drive-full for immediate visibility of pass-through at root render
  // (useEffect will refine with derive result; static smoke renders use the initial).
  const initialProjection = deriveNoIntentRuntimeProjection({
    pythonPublishClosure,
    pythonSkillRuntimeGraph,
  });
  const [crossRuntimeGraph, setCrossRuntimeGraph] =
    useState<CrossRuntimeGraphSummary | null>(initialProjection.crossRuntimeGraph);
  const [publishClosure, setPublishClosure] =
    useState<PublishClosureSummary | null>(pythonPublishClosure ?? null);
  const visiblePythonRuntimeProjection = deriveImmediatePythonRuntimeProjection({
    pythonPublishClosure,
    pythonSkillRuntimeGraph,
  });
  const visibleCrossRuntimeGraph =
    visiblePythonRuntimeProjection?.crossRuntimeGraph ?? crossRuntimeGraph;
  const visiblePublishClosure =
    visiblePythonRuntimeProjection?.publishClosure ?? publishClosure;

  useEffect(() => {
    if (visiblePythonRuntimeProjection || pythonPublishClosure || pythonSkillRuntimeGraph) return;
    let cancelled = false;
    loadPythonRuntimeProjectionFromSession(sessionState.sessionId || "sliderule-v51-product")
      .then((projection) => {
        if (cancelled || !projection) return;
        setCrossRuntimeGraph(projection.crossRuntimeGraph);
        setPublishClosure(projection.publishClosure);
      })
      .catch(() => {
        // Missing persisted projection is a valid fail-closed state; local preview can still render.
      });
    return () => {
      cancelled = true;
    };
  }, [
    sessionState.sessionId,
    visiblePythonRuntimeProjection,
    pythonPublishClosure,
    pythonSkillRuntimeGraph,
  ]);

  useEffect(() => {
    const intent = goal || latestTurn?.user || "";
    const immediatePythonProjection = deriveImmediatePythonRuntimeProjection({
      pythonPublishClosure,
      pythonSkillRuntimeGraph,
    });
    if (immediatePythonProjection) {
      setCrossRuntimeGraph(immediatePythonProjection.crossRuntimeGraph);
      setPublishClosure(immediatePythonProjection.publishClosure);
    }
    if (!intent.trim()) {
      if (!immediatePythonProjection) {
        setCrossRuntimeGraph(null);
        setPublishClosure(null);
      }
      return;
    }
    let cancelled = false;
    // DataModel field changes (deriveDataModelChangedRefs + createDataModelPageBindingImpactEvidence)
    // -> .pageBindingImpactEvidence on datamodel resolve() surface
    // -> DM_PAGE_BINDING_IMPACT_EVIDENCE added to runtimeEvidence ONLY on positive (fail-closed negatives excluded)
    // -> flows via orchestrator crossRuntimeGraph + slideRule.publishGate().runtimeClosure (AppBundle evaluate)
    // -> derive*Summary -> UI publishClosure/crossRuntimeGraph. This is the 119 DM->Page binding runtime closure path.
    //
    // NOTE — generate() 降级行为 (P4):
    // deriveApplication() 内部调用每个 Skill 的 generate(intent)。
    // 当前 appBundleSkill.generate() 只识别"采购/purchase"和"请假/leave"两个意图词；
    // 其他意图会抛出 Error，被 deriveApplication 的 try/catch 降级为空 crossRuntimeGraph。
    // 此处的结果 (result.spec.skills) 已包含五系统 resolve 产出——publishGate 仍能正常校验闭包。
    // 待 LLM generate() 实现后，覆盖面将从fixture扩展到任意意图，不需要修改此处。
    deriveApplication(intent)
      .then((result) => {
        if (cancelled) return;
        // Page field binding evidence closed in publish/runtime via create+evaluate against real DM SSOT in closure path (119).
        // publishGate receives the skills (containing datamodel model + page) so runtimeClosure now computes
        // Page->datamodel field binding evidence using real upstream SSOT surface (no temp private field).
        const publishGate = slideRule.publishGate(result.spec.skills);
        const runtimeCross = pythonSkillRuntimeGraph
          ? deriveCrossRuntimeGraphSummary(pythonSkillRuntimeGraph as any, { exampleLimit: 5 })
          : null;
        setCrossRuntimeGraph(
          runtimeCross || deriveCrossRuntimeGraphSummary(result.crossRuntimeGraph, { exampleLimit: 5 })
        );
        const previewClosure = derivePublishClosureSummary(
          publishGate.runtimeClosure,
          { blockerLimit: 3 }
        );
        // Core page selection logic (119 objective):
        // Prefer Python-produced closure evidence (from persisted sessionState via Python /drive-full)
        // when present. Fall back to local TS previewClosure ONLY when Python one is absent.
        // This is the explicit prefer-python-over-preview behavior required for frontend.
        const preferredClosure = selectPublishClosureSummary(pythonPublishClosure, previewClosure);
        setPublishClosure(preferredClosure);
      })
      .catch(() => {
        if (!cancelled) {
          setCrossRuntimeGraph(
            pythonSkillRuntimeGraph
              ? deriveCrossRuntimeGraphSummary(pythonSkillRuntimeGraph as any, { exampleLimit: 5 })
              : null
          );
          // fail-closed: on derive error, still select python (if present from session) else null;
          // never fabricate a preview here.
          setPublishClosure(selectPublishClosureSummary(pythonPublishClosure, null));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [goal, latestTurn?.user, pythonPublishClosure, pythonSkillRuntimeGraph]);

  const reasoningViewModel = useMemo(
    () =>
      deriveSlideRuleReasoningViewModel(sessionState, {
        liveAction: isRunning ? liveAction : null,
        density: projectionDensity,
        viewMode,
        latestUiTurn: latestTurn,
        lineageHighlightIds,
      }),
    [
      sessionState,
      isRunning,
      liveAction,
      projectionDensity,
      viewMode,
      latestTurn,
      lineageHighlightIds,
    ]
  );
  const graphNodeCount = reasoningViewModel.visibleNodes.length;
  const graphRevision = `${sessionState.sessionId}-${graphNodeCount}-${sessionState.artifacts?.length ?? 0}-${projectionDensity}-${isRunning}`;

  // Focus terminal only when it newly appears within the current session.
  // On refresh, keep the first frame stable and let fit frame the whole graph.
  const terminalMountedRef = useRef(false);
  const prevTerminalIdRef = useRef<string | null>(null);
  useEffect(() => {
    const tid = reasoningViewModel.terminalNode?.id ?? null;
    const wasMounted = terminalMountedRef.current;
    const prevTid = prevTerminalIdRef.current;
    prevTerminalIdRef.current = tid;
    terminalMountedRef.current = true;
    if (!wasMounted) return; // Do not focus on initial mount or refresh.
    if (tid && tid !== prevTid) setFocusNodeId(SLIDERULE_TERMINAL_NODE_ID);
  }, [reasoningViewModel.terminalNode?.id]);

  const handleProjectionDensityChange = useCallback((density: ProjectionDensity) => {
    setProjectionDensity(density);
    if (density === "compact") {
      setLineageHighlightIds([]);
    }
    try {
      localStorage.setItem(PROJECTION_DENSITY_STORAGE_KEY, density);
    } catch {
      /* ignore */
    }
  }, []);

  // Plain node clicks no longer open challenge dialogs; edits are handled inline.
  // Keep this callback side-effect free for future selection/focus hooks.
  const handleGraphNodeClick = useCallback((_node: BrainstormReasoningNode) => {}, []);

  // Inline node edit confirmation triggers a rerun with user input.
  const handleNodeEditSubmit = useCallback(
    (node: BrainstormReasoningNode, text: string) => {
      const producedArtifactId = (node as { producedArtifactId?: string }).producedArtifactId;
      if (producedArtifactId && text.trim()) {
        challengeTurn(producedArtifactId, text.trim());
      }
    },
    [challengeTurn]
  );

  const handleResolveInteractiveGate = useCallback((gateNodeId: string, choice: string | null) => {
    resolveInteractiveGate(gateNodeId, choice);
  }, [resolveInteractiveGate]);

  const handleTerminalAction = useCallback(
    (action: "report" | "lineage" | "export") => {
      if (action === "report") {
        openDeliverables();
        return;
      }
      if (action === "lineage") {
        if (projectionDensity === "compact") {
          setProjectionDensity("detailed");
          try {
            localStorage.setItem(PROJECTION_DENSITY_STORAGE_KEY, "detailed");
          } catch {
            /* ignore */
          }
        }
        const ids = deriveLineageHighlightNodeIds(sessionState);
        setLineageHighlightIds(ids);
        if (ids[0]) setFocusNodeId(ids[0]);
        return;
      }
      if (action === "export" && reasoningViewModel.terminalMeta?.canExport) {
        downloadSlideRuleDeliveryMd(sessionState);
      }
    },
    [sessionState, reasoningViewModel.terminalMeta?.canExport, projectionDensity, openDeliverables]
  );

  const handleEvidenceRefClick = useCallback(
    (artifactId: string) => {
      if (projectionDensity === "compact") {
        setProjectionDensity("detailed");
        try {
          localStorage.setItem(PROJECTION_DENSITY_STORAGE_KEY, "detailed");
        } catch {
          /* ignore */
        }
      }
      const nodeId = graphNodeIdForArtifact(sessionState, artifactId);
      if (nodeId) {
        setLineageHighlightIds([nodeId]);
        setFocusNodeId(nodeId);
      }
    },
    [sessionState, projectionDensity]
  );

  const shared = {
    goal,
    uiTurns,
    input,
    setInput,
    isRunning,
    liveAction,
    sessionState,
    sendMessage,
    challengeTurn,
    resetSession,
    retryCapability,
    toggleRouteExpanded,
    reasoningViewModel,
    graphNodeCount,
    graphRevision,
    handleGraphNodeClick,
    handleNodeEditSubmit,
    handleResolveInteractiveGate,
    handleTerminalAction,
    focusNodeId,
    lineageHighlightIds,
    onEvidenceRefClick: handleEvidenceRefClick,
    projectionDensity,
    onProjectionDensityChange: handleProjectionDensityChange,
    imSurfaceMode,
    latestTurn,
    latestTurnId,
    executorMode,
    driveMode,
    setDriveMode,
    marathonBudget,
    setMarathonBudget,
    pendingClarifications,
    answerClarifications,
    generateDeliverables,
    stop,
    onExportDeliverables: () => downloadSlideRuleDeliveryMd(sessionState),
    deliverablesOpen,
    setDeliverablesOpen,
    openDeliverables,
    embedded,
    pythonApiError,
    pythonStatusMsg,
    retryPythonBackend,
    crossRuntimeGraph: visibleCrossRuntimeGraph,
    publishClosure: visiblePublishClosure,
    driveFullStatus,
    activeSkillId,
    skillContents,
    latestMermaid,
    llmDraft,
  };

  if (isImmersion) {
    return (
      <div
        data-testid="sliderule-root"
        data-python-provenance="via-delegation"
        data-paths="/agent-loop/sliderule /sliderule"
        data-backend="python-fullpath-e2e"
        data-runtime-publish-closure={visiblePublishClosure ? "present" : "absent"}
        data-runtime-skill-graph={visibleCrossRuntimeGraph ? "present" : "absent"}
      >
        <SlideRuleUnified {...shared} />
      </div>
    );
  }

  return (
    <div
      data-testid="sliderule-root"
      data-python-provenance="via-delegation"
      data-paths="/agent-loop/sliderule /sliderule"
      data-backend="python-fullpath-e2e"
      data-runtime-publish-closure={visiblePublishClosure ? "present" : "absent"}
      data-runtime-skill-graph={visibleCrossRuntimeGraph ? "present" : "absent"}
    >
      <SlideRuleSplitEngineering {...shared} />
    </div>
  );
}
