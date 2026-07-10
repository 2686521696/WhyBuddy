/**
 * SlideRule product view (/sliderule): ONE unified surface (studio skeleton).
 *
 * - Single header row: brand/topic + STATUS summary + actions (交付物/重置会话/Dev)
 * - Left column: conversation (single empty state: logo watermark + hero + chips)
 * - Right rail: SkillThumbnailBar + system screens ⟷ 推演过程 (execution timeline + skill linkage)
 * - Bottom center: single ComposerDock (+ 实用动作菜单 / ✨优化提示词), clarification cards above it
 *
 * The old chat/reasoning/studio surface toggle was removed (2026-07): one page,
 * one mental model. The v4 pan/zoom reasoning canvas is gone from this page;
 * ?im=dev still opens the split engineering cockpit with the flow canvas.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  getExternalStoreMessages,
  useExternalStoreRuntime,
  useMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ChevronRight, ClipboardCheck, Dumbbell, Users } from "lucide-react";
import type { BrainstormReasoningNode } from "@shared/blueprint";
import { ReasoningFlowSurface } from "@/components/autopilot/ReasoningFlowSurface";
import { useSlideRuleSession } from "./sliderule/useSlideRuleSession";
import { autopilotTheme } from "./sliderule/autopilot-theme";
import type { LiveAction } from "@shared/blueprint/capability-process-labels";
import { CAPABILITY_PROCESS_LABELS } from "@shared/blueprint/capability-process-labels";
import { LlmLiveOutput } from "./sliderule/LlmLiveOutput";

/** llm_delta 来源标签 → 实时块标题（能力 id / "five-system-model" / "closure.summary"）。 */
function llmDraftTitle(label: string | null | undefined): string {
  if (!label || label === "five-system-model") return "五系统模型起草中";
  if (label === "closure.summary") return "正在整理推演总结";
  const entry = (
    CAPABILITY_PROCESS_LABELS as Record<string, { liveLabel?: unknown }>
  )[label];
  const live =
    typeof entry?.liveLabel === "function"
      ? (entry.liveLabel as (ctx: object) => string)({})
      : (entry?.liveLabel as string | undefined);
  return live ? live.replace(/^⚡\s*/, "") : `正在执行 ${label}`;
}
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
import {
  parseFiveSystemModelFromPerSkillEvidence,
  summarizeClosureForChat,
} from "./sliderule/system-screens/five-system-model";
import { SlideRuleStatusBar } from "./sliderule/SlideRuleStatusBar";
import { SlideRuleTopHud } from "./sliderule/SlideRuleTopHud";
import { SESSION_CHANGED_EVENT } from "./agent-loop/dashboard/SidebarSessions";
import {
  ClarificationCard,
  type ClarificationItem,
} from "./sliderule/ClarificationCard";
import { DeliverablesPanel } from "./sliderule/DeliverablesPanel";
import { ComposerDock } from "./sliderule/ComposerDock";
import { EXAMPLE_INTENT_TEXTS } from "./sliderule/example-intents";
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
import { deriveTurnPhases } from "./sliderule/derive-turn-phases";
import {
  PROJECTION_DENSITY_STORAGE_KEY,
  SLIDERULE_TERMINAL_NODE_ID,
  type ProjectionDensity,
} from "./sliderule/sliderule-projection-constants";
import {
  fetchJsonSafe,
  isPythonBackendFailure,
  isDegradedApiError,
  getLegacyFallbackReason,
} from "@/lib/api-client";
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
        liveAction.external
          ? autopilotTheme.liveActionExternal
          : autopilotTheme.liveActionThink
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

function textFromStep(
  step: UiTurn["steps"][number] | null | undefined
): string {
  if (!step) return "";
  if (step.kind === "narration" || step.kind === "step_narration")
    return step.text;
  if (step.kind === "chip") return step.label;
  if (step.kind === "capability_fail") return step.message;
  return "";
}

function assistantTextForTurn(
  turn: UiTurn,
  publishClosure?: PublishClosureSummary | null,
  goalText?: string
): string {
  const assistant = turn.assistant?.trim();
  if (assistant) return assistant;
  const finalStepText = finalNarrationStep(turn.steps)?.text?.trim();
  if (finalStepText) return finalStepText;
  // 不再回退到最后一枚过程 chip（会把「指令已接收 · 启动推理」当成回答复读）；
  // 过程细节由 TurnPhaseTimeline 分阶段折叠承载，这里给零 LLM 模板总结（方案 A）：
  // 事实全部来自五系统模型 + 闭环证据，替换旧的机械状态行。
  if (publishClosure) {
    // 方案 B 优先：python 真 LLM 收口总结（结合推演全程上下文）；
    // 缺失（未配通道/上游失败）回落零 LLM 模板 A——总结永远有，但从不编造。
    if (publishClosure.chatSummary?.trim())
      return publishClosure.chatSummary.trim();
    const model = parseFiveSystemModelFromPerSkillEvidence(
      publishClosure.perSkillEvidence as Parameters<
        typeof parseFiveSystemModelFromPerSkillEvidence
      >[0]
    );
    return summarizeClosureForChat(model, {
      goalText: turn.user || goalText,
      blocked: !!publishClosure.blocked,
      evidencePresentCount: publishClosure.evidencePresentCount ?? 0,
      skillCount: publishClosure.skillCount ?? 6,
      versionPinsChecked: !!publishClosure.versionPinsChecked,
    });
  }
  return turn.status === "streaming"
    ? "正在整理推演结果..."
    : "本轮已完成，但还没有生成可展示的回答。";
}

/**
 * TurnPhaseTimeline — Claude 式分阶段过程叙事（V5.2 闭环的阶段结构）。
 * 运行中：已完成阶段折叠成 ✓ 标题行，当前阶段展开、实时流出步骤；
 * 完成后：整体折叠为一行「推演过程 · M 阶段 · N 步」，点开按阶段回放。
 */
function TurnPhaseTimeline({
  turn,
  llmDraft = "",
  publishClosure,
}: {
  turn: UiTurn;
  llmDraft?: string;
  publishClosure?: PublishClosureSummary | null;
}) {
  const streaming = turn.status === "streaming";
  const [expanded, setExpanded] = React.useState(false);
  // 手动展开的已完成阶段（运行中默认只展开当前阶段）
  const [openPhases, setOpenPhases] = React.useState<Record<string, boolean>>(
    {}
  );
  const stepTexts = turn.steps.map(textFromStep).filter(Boolean);
  const phases = React.useMemo(
    () =>
      deriveTurnPhases({
        stepTexts,
        streaming,
        llmDraft,
        closure: publishClosure
          ? {
              blocked: !!publishClosure.blocked,
              evidencePresentCount: publishClosure.evidencePresentCount ?? 0,
              skillCount: publishClosure.skillCount ?? 6,
            }
          : null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stepTexts.join("\n"), streaming, llmDraft, publishClosure]
  );
  if (phases.length === 0) return null;

  const totalSteps = stepTexts.length;
  const showBody = streaming || expanded;

  return (
    <div className="mt-1" data-testid="sliderule-turn-phases">
      {!streaming && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-xs text-stone-400 transition-colors hover:text-stone-600"
          data-testid="sliderule-turn-steps-toggle"
        >
          <span
            className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            ›
          </span>
          推演过程 · {phases.length} 阶段 · {totalSteps} 步
        </button>
      )}
      {showBody && (
        <div className="mt-1.5 space-y-1.5">
          {phases.map(phase => {
            const running = phase.status === "running";
            const open =
              running || !!openPhases[phase.id] || (!streaming && expanded);
            return (
              <div key={phase.id} data-testid={`sliderule-phase-${phase.id}`}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenPhases(prev => ({ ...prev, [phase.id]: !open }))
                  }
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs transition-colors hover:bg-[#eef0f4] hover:text-stone-700"
                >
                  {running ? (
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#1677ff]" />
                  ) : (
                    <span className="shrink-0 text-emerald-500">✓</span>
                  )}
                  <span
                    className={
                      running ? "font-medium text-stone-700" : "text-stone-500"
                    }
                  >
                    {phase.title}
                  </span>
                  <span className="text-[10px] text-stone-300">
                    {phase.lines.length} 步
                  </span>
                  {/* 可展开暗示（用户反馈：完成阶段看不出能点开）——箭头随展开态旋转 */}
                  {!running && phase.lines.length > 0 && (
                    <span
                      className={`inline-block text-[10px] text-stone-300 transition-transform ${open ? "rotate-90" : ""}`}
                    >
                      ›
                    </span>
                  )}
                </button>
                {open && phase.lines.length > 0 && (
                  <div className="ml-1 mt-1 space-y-1 border-l border-[#e8eaee] pl-4">
                    {(running ? phase.lines.slice(-4) : phase.lines).map(
                      (t, i) => (
                        <div
                          key={i}
                          className="text-xs leading-5 text-stone-400"
                        >
                          {t}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 文案单一来源 example-intents.ts（+ 菜单「填入示例意图」共用）；
// 这里只补空态 chips 的图标配色。
const EXAMPLE_PROMPTS: ReadonlyArray<{
  text: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
}> = [
  {
    text: EXAMPLE_INTENT_TEXTS[0],
    icon: ClipboardCheck,
    iconBg: "bg-[#e6f4ff]",
    iconColor: "text-[#0958d9]",
  },
  {
    text: EXAMPLE_INTENT_TEXTS[1],
    icon: Users,
    iconBg: "bg-[#E6F4FF]",
    iconColor: "text-[#1677ff]",
  },
  {
    text: EXAMPLE_INTENT_TEXTS[2],
    icon: Dumbbell,
    iconBg: "bg-[#ECFDF3]",
    iconColor: "text-[#16a34a]",
  },
];

/**
 * ClaudeChatSurface — 统一页左栏对话区（Claude 风格轻量 prose 布局）。
 * 头部动作（交付物 / 重置会话 / Dev）由页面唯一顶栏承担；这里只负责对话流与
 * 唯一空态（古典 logo 水印 + hero 文案 + 3 个示例 chips）。
 */
// --- assistant-ui 迁移（左栏 IM 地基）--------------------------------------
// 滚动跟随 / 消息列表 / 空态分支由 Thread 原语接管（Viewport 自带贴底跟随，
// 替换此前手写的 stick-to-bottom）；语义时间线、实时流、结论块是差异化
// 内容，保留为自定义消息渲染，不外包给通用库。

/** uiTurns（用户+助手成对）→ 扁平消息项；turn 原对象随消息绑定回取。 */
type ImItem = { id: string; role: "user" | "assistant"; turn: UiTurn };

/** 轮次之外的渲染上下文（草稿流/闭环/话题），经 context 传给自定义消息组件——
 *  组件定义在模块层保持身份稳定（每帧重建会让 Messages 整列重挂）。 */
const ImSurfaceContext = React.createContext<{
  publishClosure?: PublishClosureSummary | null;
  llmDraft: string;
  llmDraftLabel: string | null;
  goalText?: string;
  thinkingText: string;
  isRunning: boolean;
  onChallenge: (id: string) => void;
}>({
  llmDraft: "",
  llmDraftLabel: null,
  thinkingText: "",
  isRunning: false,
  onChallenge: () => {},
});

const convertImMessage = (m: ImItem): ThreadMessageLike => ({
  id: m.id,
  role: m.role,
  // 文本部件只为 assistant-ui 的消息模型成立（复制/无障碍语义用真文本）；
  // 实际渲染由自定义组件对着原 turn 输出，不读部件。
  content: [
    { type: "text", text: m.role === "user" ? (m.turn.user ?? "") : "" },
  ],
});

/** 从 assistant-ui 消息取回绑定的原始 turn（ExternalStore 转换时自动绑定）。 */
function useImTurn(): ImItem | null {
  const message = useMessage();
  const items = getExternalStoreMessages<ImItem>(message as never);
  return items[0] ?? null;
}

function ImUserMessage() {
  const item = useImTurn();
  // 从持久化状态恢复的轮次没有用户文本——整条不渲染（与迁移前一致）
  if (!item?.turn.user) return null;
  const text = item.turn.user;
  return (
    <div className="group mb-4 flex flex-col items-end">
      {/* 品牌暖色点缀（用户裁决：冷调壳体下暖色只留 logo 与用户气泡） */}
      <div className="max-w-[520px] rounded-lg bg-[#F7E7DE] px-4 py-2.5 text-[15px] leading-7 text-[#1f2329]">
        {text}
      </div>
      {/* 迭代环：意图原文回填输入条，改半句再推（悬停显现，不抢注意力） */}
      <button
        type="button"
        data-testid="sliderule-edit-rerun"
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent("sliderule:fill-prompt", { detail: { text } })
          );
        }}
        className="mt-1 rounded-full px-2 py-0.5 text-[11px] text-stone-400 opacity-0 transition-opacity hover:bg-[#e9edf2] hover:text-stone-600 focus:opacity-100 group-hover:opacity-100"
      >
        编辑重跑
      </button>
    </div>
  );
}

function ImAssistantMessage() {
  const item = useImTurn();
  const ctx = React.useContext(ImSurfaceContext);
  if (!item) return null;
  const { turn } = item;
  const {
    publishClosure,
    llmDraft,
    llmDraftLabel,
    goalText,
    thinkingText,
    onChallenge,
  } = ctx;
  const answer = assistantTextForTurn(turn, publishClosure, goalText);
  return (
    <div className="mb-6 max-w-[640px]">
      {turn.status === "streaming" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <span className="inline-flex gap-0.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-300"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
            {thinkingText}
          </div>
          <TurnPhaseTimeline
            turn={turn}
            llmDraft={llmDraft}
            publishClosure={publishClosure}
          />
          {/* LLM 实时想法：每一步真 LLM 调用（risk.analyze / report.write /
              五系统起草…）期间实时流出。随内容生长，滚动由 Viewport 统一负责 */}
          {llmDraft && (
            <LlmLiveOutput
              title={llmDraftTitle(llmDraftLabel)}
              text={llmDraft}
              formatJson={llmDraftLabel === "five-system-model"}
            />
          )}
        </div>
      ) : (
        <div className="space-y-2 text-[15px] leading-7 text-stone-800">
          {/* Claude 式顺序：折叠的推演过程 + 闭环徽标在前，总结正文在后
              （items-start：展开过程时徽标停在首行不跟着下坠） */}
          <div className="flex flex-wrap items-start gap-2 text-xs text-stone-400">
            <TurnPhaseTimeline turn={turn} publishClosure={publishClosure} />
            {publishClosure && (
              <span className="mt-1 rounded-full bg-[#e9edf2] px-2 py-0.5">
                {publishClosure.blocked ? "blocked" : "closed"}{" "}
                {publishClosure.evidencePresentCount}/
                {publishClosure.skillCount}
              </span>
            )}
          </div>
          {/* 思考流留档：推演中每步 LLM 的完整输出，完成后保留成可折叠
              记录（Claude 式）——想法不消失，要看随时点开 */}
          {turn.steps.some(s => s.kind === "llm_output") && (
            <div className="space-y-1.5" data-testid="sliderule-llm-archives">
              {turn.steps.map(s =>
                s.kind === "llm_output" ? (
                  <LlmLiveOutput
                    key={s.id}
                    title={s.title}
                    text={s.text}
                    formatJson={s.formatJson}
                    done
                  />
                ) : null
              )}
            </div>
          )}
          <div className="prose prose-stone max-w-none prose-p:my-1 whitespace-pre-wrap">
            {answer}
          </div>
          {(turn.main || turn.user) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
              {turn.main && (
                <button
                  type="button"
                  onClick={() => onChallenge(turn.main!.artifactId)}
                  className="rounded-full bg-[#e9edf2] px-2 py-0.5 hover:bg-[#e5e7eb]"
                >
                  质疑本轮
                </button>
              )}
              {/* 迭代环：同题重发（基于当前推演状态再推一次，非回滚重放） */}
              {turn.user && (
                <button
                  type="button"
                  data-testid="sliderule-rerun-turn"
                  disabled={ctx.isRunning}
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("sliderule:resend-prompt", {
                        detail: { text: turn.user },
                      })
                    );
                  }}
                  className="rounded-full bg-[#e9edf2] px-2 py-0.5 hover:bg-[#e5e7eb] disabled:cursor-not-allowed disabled:opacity-50"
                  title="以同一句意图基于当前推演状态再推一轮"
                >
                  重新推演
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// export：仅供测试静态渲染（页面内唯一消费方仍是本文件）
export function ClaudeChatSurface({
  uiTurns,
  isRunning,
  liveAction,
  latestTurn,
  publishClosure,
  llmDraft = "",
  llmDraftLabel = null,
  goalText,
  onChallenge,
}: {
  uiTurns: UiTurn[];
  isRunning: boolean;
  liveAction: LiveAction | null;
  latestTurn: UiTurn | null;
  publishClosure?: PublishClosureSummary | null;
  /** LLM 实时草稿（llm_delta 累积；仅运行中展示尾部）。 */
  llmDraft?: string;
  /** 当前草稿来源：能力 id 或 "five-system-model"（决定实时块标题）。 */
  llmDraftLabel?: string | null;
  /** 会话话题（恢复的轮次没有 turn.user，总结用它兜底） */
  goalText?: string;
  onChallenge: (id: string) => void;
}) {
  const latestStepText = latestTurn
    ? textFromStep(latestTurn.steps.at(-1))
    : "";
  const thinkingText =
    liveAction?.label ||
    latestStepText ||
    (publishClosure
      ? publishClosure.blocked
        ? "发布闭环被阻塞，等待下一步修正"
        : "发布闭环完成"
      : "正在推演...");

  const items = useMemo<ImItem[]>(
    () =>
      uiTurns.flatMap(turn => [
        ...(turn.user
          ? ([{ id: `${turn.id}-user`, role: "user", turn }] as ImItem[])
          : []),
        { id: `${turn.id}-assistant`, role: "assistant" as const, turn },
      ]),
    [uiTurns]
  );

  const runtime = useExternalStoreRuntime<ImItem>({
    messages: items,
    isRunning,
    convertMessage: convertImMessage,
    // 输入条是自定义 ComposerDock（语音/优化提示词/示例填充），不走 Thread 原语的
    // Composer——onNew 是适配器必填项，但当前没有 UI 会触发它。
    onNew: async () => {},
  });

  const ctxValue = useMemo(
    () => ({
      publishClosure,
      llmDraft,
      llmDraftLabel,
      goalText,
      thinkingText,
      isRunning,
      onChallenge,
    }),
    [
      publishClosure,
      llmDraft,
      llmDraftLabel,
      goalText,
      thinkingText,
      isRunning,
      onChallenge,
    ]
  );

  return (
    <div className="relative z-0 flex h-full flex-col overflow-hidden bg-[#f7f8fa] text-[#1f2329]">
      {/* Chat area — Viewport 自带贴底跟随（增量到达自动滚底、回翻停住） */}
      <AssistantRuntimeProvider runtime={runtime}>
        <ImSurfaceContext.Provider value={ctxValue}>
          <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
            <ThreadPrimitive.Viewport className="mx-auto flex min-h-0 w-full max-w-[780px] flex-1 flex-col overflow-y-auto px-4 pb-4 pt-4 sm:px-6">
              <ThreadPrimitive.Empty>
                {/* THE single empty state — classical logo watermark + hero copy + 3 example prompts */}
                <div
                  className="flex h-full flex-col items-center justify-center gap-6 text-center"
                  data-testid="sliderule-empty-state"
                >
                  <img
                    src={`${import.meta.env.BASE_URL}assets/sliderule-logo.png`}
                    alt="SlideRule"
                    className="w-[min(56%,220px)] object-contain opacity-[0.9] drop-shadow-[0_14px_30px_rgb(15_23_42/0.12)]"
                    title="SlideRule"
                  />
                  <div>
                    <div className="font-display text-[26px] font-medium tracking-tight text-[#1f2329]">
                      我能帮你把意图推演成应用闭环
                    </div>
                    <div className="mt-2 text-sm text-stone-500">
                      发一句业务目标，SlideRule
                      串起五系统，输出可校验的企业应用数字孪生。
                    </div>
                  </div>
                  <div className="flex flex-col gap-2.5 w-full max-w-[560px]">
                    {EXAMPLE_PROMPTS.map(
                      ({ text, icon: Icon, iconBg, iconColor }) => (
                        <button
                          key={text}
                          type="button"
                          disabled={isRunning}
                          onClick={() => {
                            // Dispatch a custom event so ComposerDock can pick it up
                            window.dispatchEvent(
                              new CustomEvent("sliderule:fill-prompt", {
                                detail: { text },
                              })
                            );
                          }}
                          className="group flex w-full items-center gap-3 rounded-lg border border-[#e5e7eb] bg-white px-4 py-3 text-left text-sm text-stone-700 shadow-[0_2px_10px_rgb(15_23_42/0.05)] transition-all hover:border-[#d3d8e0] hover:shadow-[0_4px_16px_rgb(15_23_42/0.09)] disabled:opacity-50"
                        >
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBg}`}
                          >
                            <Icon className={`h-4 w-4 ${iconColor}`} />
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate"
                            title={text}
                          >
                            {text}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-stone-300 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      )
                    )}
                  </div>
                </div>
              </ThreadPrimitive.Empty>
              <div className="py-2">
                <ThreadPrimitive.Messages
                  components={{
                    UserMessage: ImUserMessage,
                    AssistantMessage: ImAssistantMessage,
                  }}
                />
              </div>
            </ThreadPrimitive.Viewport>
          </ThreadPrimitive.Root>
        </ImSurfaceContext.Provider>
      </AssistantRuntimeProvider>

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
  status?:
    | "idle"
    | "loading"
    | "python_success"
    | "timeout"
    | "python_unavailable"
    | "fallback";
  className?: string;
}) {
  // "loading" 不再展示：正常运行时左栏已有思考行 + 实时步骤流，这条横幅
  // 是纯重复（用户去重审查）；横幅只保留异常态（timeout/unavailable/fallback）。
  if (
    !status ||
    status === "idle" ||
    status === "python_success" ||
    status === "loading"
  )
    return null;
  const text =
    status === "timeout"
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
    ? deriveCrossRuntimeGraphSummary(pythonSkillRuntimeGraph as any, {
        exampleLimit: 5,
      })
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
  const state =
    body?.state && typeof body.state === "object" ? body.state : body;
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
 * - 底部：唯一 ComposerDock（+ 实用动作菜单 / ✨优化提示词），澄清卡片浮在其上。
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
  latestTurn,
  executorMode,
  driveMode,
  setDriveMode,
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
  llmDraftLabel = null,
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
  latestTurn: UiTurn | null;
  executorMode: ReturnType<typeof useSlideRuleSession>["executorMode"];
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  pendingClarifications?: ClarificationItem[];
  answerClarifications?: (
    answers: Array<{ gapId: string; answer: string }>
  ) => void;
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
  driveFullStatus?:
    | "idle"
    | "loading"
    | "python_success"
    | "timeout"
    | "python_unavailable"
    | "fallback";
  /** SSE-driven active skill highlighting for the right rail */
  activeSkillId?: import("@/lib/sliderule-marathon-driver").SkillId | null;
  skillContents?: Partial<
    Record<import("@/lib/sliderule-marathon-driver").SkillId, string>
  >;
  latestMermaid?: string | null;
  /** LLM 实时草稿（llm_delta 累积）+ 当前来源标签。 */
  llmDraft?: string;
  llmDraftLabel?: string | null;
}) {
  const sessionId = sessionState.sessionId || "sliderule-v51-product";
  const composerHints = useMemo(
    () => deriveComposerHintChips(sessionState),
    [sessionState]
  );

  // Clarification cards can be hidden; they reappear when pending questions change.
  const clarifications = pendingClarifications ?? [];
  const clarifyKey = clarifications.map(c => c.id).join("|");
  const [clarifyHidden, setClarifyHidden] = useState(false);
  useEffect(() => {
    setClarifyHidden(false);
  }, [clarifyKey]);
  const showClarify =
    clarifications.length > 0 && !clarifyHidden && !!answerClarifications;

  // Conversation column: live turns during/after a run; after reload uiTurns is
  // empty but the latest turn is rebuilt from persisted state — surface it so the
  // page restores instead of falling back to the empty state.
  const conversationTurns =
    uiTurns.length > 0 ? uiTurns : latestTurn ? [latestTurn] : [];

  const driveLoopCount =
    latestTurn?.routeFacts.rounds?.length ??
    (latestTurn && latestTurn.routeFacts.planSelectedCount ? 1 : 0);

  return (
    <div className={`${autopilotTheme.immersionPage} flex flex-col`}>
      {/* ONE header row — brand/topic + STATUS summary + actions */}
      <div className="relative z-20 shrink-0 border-b border-[#e5e7eb]/70 bg-[#f7f8fa]/90 px-3 backdrop-blur sm:px-4">
        <SlideRuleTopHud
          state={sessionState}
          goal={goal}
          turnCount={uiTurns.length}
          isRunning={isRunning}
          driveLoopCount={driveLoopCount}
          executorMode={executorMode}
          publishClosure={publishClosure}
          onResetSession={resetSession}
          onOpenDeliverables={openDeliverables}
          embedded={embedded}
        />
        {/* Python backend failure visible + recoverable status/retry for core SlideRule workflows (105 req 2)。
            GitHub Pages 静态演示本就无后端：降级横幅是预期内噪音，不展示。 */}
        {!IS_GITHUB_PAGES && (pythonApiError || pythonStatusMsg) && (
          <div
            className="mb-2 inline-flex rounded border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800 shadow-sm"
            title={pythonStatusMsg}
          >
            Python backend: {pythonStatusMsg || "degraded/timeout"} ·
            <button
              type="button"
              onClick={retryPythonBackend}
              className="ml-2 underline"
            >
              Retry
            </button>
            {getLegacyFallbackReason(pythonApiError) && (
              <span className="ml-2 text-amber-600">fallback active</span>
            )}
            {isDegradedApiError(pythonApiError) && (
              <span className="ml-1">(degraded envelope)</span>
            )}
          </div>
        )}
        <DriveFullStatusBanner
          status={driveFullStatus}
          className="mb-2 inline-flex"
        />
      </div>

      {/* Studio body — left conversation column + right skill rail */}
      <div className="relative z-0 min-h-0 flex-1 pb-[104px]">
        <SlideRuleStudio
          chatSlot={
            <ClaudeChatSurface
              uiTurns={conversationTurns}
              isRunning={isRunning}
              goalText={goal}
              liveAction={liveAction}
              latestTurn={latestTurn}
              publishClosure={publishClosure}
              llmDraft={isRunning ? llmDraft : ""}
              llmDraftLabel={llmDraftLabel}
              onChallenge={challengeTurn}
            />
          }
          activeSkillId={activeSkillId}
          publishClosure={publishClosure}
          latestMermaid={latestMermaid}
          skillContents={skillContents}
          skillRuntimeGraph={
            (
              sessionState as {
                skillRuntimeGraph?:
                  | import("./sliderule/system-screens/five-system-model").SkillRuntimeGraphLike
                  | null;
              }
            ).skillRuntimeGraph ?? null
          }
          sessionId={sessionId}
          appTitle={goal ? goal.slice(0, 24) : undefined}
          // 用户还没输入时不显示右侧舞台：欢迎页独占全宽，首条消息后舞台登场
          stageVisible={conversationTurns.length > 0 || isRunning}
          // 推演中右侧实时渲染：部分五系统模型 → 应用实时长出来；没成形前只报"推演中"
          isRunning={isRunning}
          llmDraft={isRunning ? llmDraft : ""}
          llmDraftLabel={llmDraftLabel}
          liveActionLabel={isRunning ? (liveAction?.label ?? null) : null}
          className="h-full"
        />
        {/* 右栏「推演过程」标签页已移除：左栏对话流本身就是实时推演过程
            （步骤流 + LLM 实时草稿），右栏只保留系统画面（用户反馈去重）。 */}
      </div>

      {/* Single bottom composer + clarification cards */}
      <div className={autopilotTheme.immersionOverlayBottom}>
        <div className="pointer-events-none flex w-full max-w-2xl flex-col items-center">
          {showClarify && (
            <ClarificationCard
              questions={clarifications}
              onSubmit={answers => answerClarifications?.(answers)}
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
            stop={stop}
          />
        </div>
      </div>

      {/* 设置弹窗已收敛到侧栏「设置」整页（SettingsPage），HUD 不再挂设置入口 */}
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
  handleResolveInteractiveGate?: (
    gateNodeId: string,
    choice: string | null
  ) => void;
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
  driveFullStatus?:
    | "idle"
    | "loading"
    | "python_success"
    | "timeout"
    | "python_unavailable"
    | "fallback";
}) {
  const imScrollRef = useRef<HTMLElement>(null);
  const imBottomRef = useRef<HTMLDivElement>(null);
  const imAtBottomRef = useRef(true);

  const imScrollSignature = useMemo(
    () =>
      uiTurns
        .map(t => {
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
          src={`${import.meta.env.BASE_URL}assets/sliderule_icon_flat_transparent.png`}
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
            title={
              isRunning
                ? "SlideRule is running; reset later."
                : "Clear this conversation and restart."
            }
          >
            重置会话
          </button>
          <a
            href="/sliderule/dev"
            className={autopilotTheme.devLink}
            title="Open engineering cockpit"
          >
            Dev
          </a>
        </div>
      </header>

      <DriveFullStatusBanner
        status={driveFullStatus}
        className="mx-6 mt-2 inline-flex"
      />

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
                    Enter a goal or challenge below; the system dynamically
                    selects capability x role steps. There are no fixed stages;
                    current state and your input drive the route.
                  </p>
                </div>
              )}
              {uiTurns.map(turn => (
                <div key={turn.id} className="space-y-2">
                  <div className="flex justify-end">
                    <div className={autopilotTheme.userBubble}>{turn.user}</div>
                  </div>
                  <div className="rounded border border-[#e5e7eb]/80 bg-white px-4 py-4 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
                    {/* M7 close-out: turn-route is hidden by default in marathon mode; single mode remains visible and toggle can expand it. */}
                    {(driveMode !== "marathon" || turn.routeExpanded) && (
                      <TurnRouteTimeline
                        facts={turn.routeFacts}
                        steps={turn.steps}
                        actions={turn.actions}
                        sessionId={
                          sessionState.sessionId || "sliderule-v51-product"
                        }
                        expanded={
                          turn.routeExpanded || turn.status === "streaming"
                        }
                        onToggle={() => toggleRouteExpanded(turn.id)}
                        litCount={turn.routeLitCount}
                        streaming={turn.status === "streaming"}
                        liveAction={
                          turn.id === latestTurnId &&
                          turn.status === "streaming"
                            ? liveAction
                            : null
                        }
                        surfaceMode={imSurfaceMode}
                        retrying={isRunning}
                        onRetryCapability={params =>
                          retryCapability(turn.id, params)
                        }
                        reasoningEvents={sessionState.reasoningEvents}
                      />
                    )}
                    {driveMode === "marathon" && !turn.routeExpanded && (
                      <div
                        className="cursor-pointer text-[10px] text-stone-400"
                        onClick={() => toggleRouteExpanded(turn.id)}
                        title="Marathon route details are hidden; click to expand."
                      >
                        Continuing SlideRule. Click to expand route.
                      </div>
                    )}
                    {turn.status === "complete" && (
                      <TurnFootnote
                        turn={turn}
                        sessionId={
                          sessionState.sessionId || "sliderule-v51-product"
                        }
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
                onChange={e => setInput(e.target.value)}
                onKeyDown={e =>
                  e.key === "Enter" && !e.shiftKey && sendMessage()
                }
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
              {HINT_CHIPS_SPLIT.map(hint => (
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

const ACTIVE_SESSION_KEY = "sliderule:active-session-id";

/**
 * 会话壳（Claude 式）：管理"当前会话 id"，切换/新建时以 key=sessionId
 * 整树重挂——hook 对新 id 走 loadOrCreateSessionState 完整水合，
 * 运行时排练数据（localStorage 按 id 分键）自动隔离，零状态串味。
 * 会话选择入口在侧栏（SidebarSessions），通过 window 事件通知这里。
 */
export default function SlideRule({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    if (IS_GITHUB_PAGES) return GITHUB_PAGES_DEMO_SESSION_ID;
    try {
      return (
        localStorage.getItem(ACTIVE_SESSION_KEY) || "sliderule-v51-product"
      );
    } catch {
      return "sliderule-v51-product";
    }
  });

  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    const onChanged = (ev: Event) => {
      const id = (ev as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (id) setActiveSessionId(id);
    };
    window.addEventListener(SESSION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, onChanged);
  }, []);

  return (
    <SlideRuleSessionBody
      key={activeSessionId}
      embedded={embedded}
      activeSessionId={activeSessionId}
    />
  );
}

function SlideRuleSessionBody({
  embedded,
  activeSessionId,
}: {
  embedded: boolean;
  activeSessionId: string;
}) {
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
    llmDraftLabel,
  } = useSlideRuleSession({
    sessionId: IS_GITHUB_PAGES ? GITHUB_PAGES_DEMO_SESSION_ID : activeSessionId,
    documentTitle: IS_GITHUB_PAGES ? "SlideRule · 演示" : undefined,
    initialGoal: IS_GITHUB_PAGES ? GITHUB_PAGES_DEMO_GOAL : undefined,
  });

  // 浏览器标签标题跟随当前会话话题（像 Claude 的标签页那样一眼识别会话）
  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    document.title = goal
      ? `${goal.slice(0, 24)} · SlideRule`
      : "新会话 · SlideRule";
  }, [goal]);

  // 迭代环：消息上的「重新推演」经事件总线把该轮意图原文程序化重发
  // （与空态示例卡的 fill-prompt 同一套事件模式，免去跨层 prop 钻孔）。
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (text) void sendMessageRef.current(text);
    };
    window.addEventListener("sliderule:resend-prompt", handler);
    return () => window.removeEventListener("sliderule:resend-prompt", handler);
  }, []);

  // Python backend error/timeout/degraded/legacy status + retry for core SlideRule workflow (105)
  const [pythonApiError, setPythonApiError] = useState<any>(null);
  const [pythonStatusMsg, setPythonStatusMsg] = useState<string>("");
  const probePythonBackend = useCallback(async () => {
    try {
      const res = await fetchJsonSafe<{ status?: string }>(
        "/api/sliderule/health"
      );
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
      setPythonApiError({
        kind: "degraded",
        message: "probe failed",
        source: "network",
        retryable: true,
      } as any);
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
    () =>
      uiTurns.length === 0 ? deriveLatestTurnFromState(sessionState) : null,
    [uiTurns.length, sessionState]
  );
  const latestTurn =
    uiTurns.length > 0 ? uiTurns[uiTurns.length - 1] : restoredLatestTurn;
  const latestTurnId = latestTurn?.id ?? null;

  const [projectionDensity, setProjectionDensity] = useState<ProjectionDensity>(
    () => {
      try {
        const stored = localStorage.getItem(PROJECTION_DENSITY_STORAGE_KEY);
        return stored === "detailed" ? "detailed" : "compact";
      } catch {
        return "compact";
      }
    }
  );
  const VIEW_MODE_STORAGE_KEY = "sliderule:view-mode:v1";
  const [viewMode, setViewMode] = useState<
    "overview" | "collaboration" | "reasoning"
  >(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      return stored === "collaboration" || stored === "reasoning"
        ? stored
        : "overview";
    } catch {
      return "overview";
    }
  });
  const onViewModeChange = useCallback(
    (m: "overview" | "collaboration" | "reasoning") => {
      setViewMode(m);
      try {
        localStorage.setItem(VIEW_MODE_STORAGE_KEY, m);
      } catch {}
    },
    []
  );

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
    useState<CrossRuntimeGraphSummary | null>(
      initialProjection.crossRuntimeGraph
    );
  const [publishClosure, setPublishClosure] =
    useState<PublishClosureSummary | null>(pythonPublishClosure ?? null);
  const visiblePythonRuntimeProjection = deriveImmediatePythonRuntimeProjection(
    {
      pythonPublishClosure,
      pythonSkillRuntimeGraph,
    }
  );
  const visibleCrossRuntimeGraph =
    visiblePythonRuntimeProjection?.crossRuntimeGraph ?? crossRuntimeGraph;
  const visiblePublishClosure =
    visiblePythonRuntimeProjection?.publishClosure ?? publishClosure;

  useEffect(() => {
    if (
      visiblePythonRuntimeProjection ||
      pythonPublishClosure ||
      pythonSkillRuntimeGraph
    )
      return;
    let cancelled = false;
    loadPythonRuntimeProjectionFromSession(
      sessionState.sessionId || "sliderule-v51-product"
    )
      .then(projection => {
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
      .then(result => {
        if (cancelled) return;
        // Page field binding evidence closed in publish/runtime via create+evaluate against real DM SSOT in closure path (119).
        // publishGate receives the skills (containing datamodel model + page) so runtimeClosure now computes
        // Page->datamodel field binding evidence using real upstream SSOT surface (no temp private field).
        const publishGate = slideRule.publishGate(result.spec.skills);
        const runtimeCross = pythonSkillRuntimeGraph
          ? deriveCrossRuntimeGraphSummary(pythonSkillRuntimeGraph as any, {
              exampleLimit: 5,
            })
          : null;
        setCrossRuntimeGraph(
          runtimeCross ||
            deriveCrossRuntimeGraphSummary(result.crossRuntimeGraph, {
              exampleLimit: 5,
            })
        );
        const previewClosure = derivePublishClosureSummary(
          publishGate.runtimeClosure,
          { blockerLimit: 3 }
        );
        // Core page selection logic (119 objective):
        // Prefer Python-produced closure evidence (from persisted sessionState via Python /drive-full)
        // when present. Fall back to local TS previewClosure ONLY when Python one is absent.
        // This is the explicit prefer-python-over-preview behavior required for frontend.
        const preferredClosure = selectPublishClosureSummary(
          pythonPublishClosure,
          previewClosure
        );
        setPublishClosure(preferredClosure);
      })
      .catch(() => {
        if (!cancelled) {
          setCrossRuntimeGraph(
            pythonSkillRuntimeGraph
              ? deriveCrossRuntimeGraphSummary(pythonSkillRuntimeGraph as any, {
                  exampleLimit: 5,
                })
              : null
          );
          // fail-closed: on derive error, still select python (if present from session) else null;
          // never fabricate a preview here.
          setPublishClosure(
            selectPublishClosureSummary(pythonPublishClosure, null)
          );
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

  const handleProjectionDensityChange = useCallback(
    (density: ProjectionDensity) => {
      setProjectionDensity(density);
      if (density === "compact") {
        setLineageHighlightIds([]);
      }
      try {
        localStorage.setItem(PROJECTION_DENSITY_STORAGE_KEY, density);
      } catch {
        /* ignore */
      }
    },
    []
  );

  // Plain node clicks no longer open challenge dialogs; edits are handled inline.
  // Keep this callback side-effect free for future selection/focus hooks.
  const handleGraphNodeClick = useCallback(
    (_node: BrainstormReasoningNode) => {},
    []
  );

  // Inline node edit confirmation triggers a rerun with user input.
  const handleNodeEditSubmit = useCallback(
    (node: BrainstormReasoningNode, text: string) => {
      const producedArtifactId = (node as { producedArtifactId?: string })
        .producedArtifactId;
      if (producedArtifactId && text.trim()) {
        challengeTurn(producedArtifactId, text.trim());
      }
    },
    [challengeTurn]
  );

  const handleResolveInteractiveGate = useCallback(
    (gateNodeId: string, choice: string | null) => {
      resolveInteractiveGate(gateNodeId, choice);
    },
    [resolveInteractiveGate]
  );

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
    [
      sessionState,
      reasoningViewModel.terminalMeta?.canExport,
      projectionDensity,
      openDeliverables,
    ]
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
    llmDraftLabel,
  };

  if (isImmersion) {
    return (
      <div
        data-testid="sliderule-root"
        data-python-provenance="via-delegation"
        data-paths="/agent-loop/sliderule /sliderule"
        data-backend="python-fullpath-e2e"
        data-runtime-publish-closure={
          visiblePublishClosure ? "present" : "absent"
        }
        data-runtime-skill-graph={
          visibleCrossRuntimeGraph ? "present" : "absent"
        }
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
      data-runtime-publish-closure={
        visiblePublishClosure ? "present" : "absent"
      }
      data-runtime-skill-graph={visibleCrossRuntimeGraph ? "present" : "absent"}
    >
      <SlideRuleSplitEngineering {...shared} />
    </div>
  );
}
