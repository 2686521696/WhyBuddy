/**
 * SlideRule — 产品视图（/sliderule）· 全屏画布 + 浮层 HUD
 *
 * 沉浸布局（默认 product / minimal）：
 * - 画布占满视口
 * - 顶部左：话题 + 指标 + 角色并行流
 * - 顶部右：架构调用过程（console + 流式节拍）
 * - 底部居中：IM 输入浮层
 *
 * ?im=dev / engineering 保留左右分栏工程驾驶舱。
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
import {
  PROJECTION_DENSITY_STORAGE_KEY,
  SLIDERULE_TERMINAL_NODE_ID,
  type ProjectionDensity,
} from "./sliderule/sliderule-projection-constants";

const HINT_CHIPS_SPLIT = [
  "路线对比一下",
  "澄清权限边界",
  "分析安全风险",
  "拆解成 SPEC Tree",
  "生成可行性报告",
  "效果预览",
];

function TypewriterText({ text, active }: { text: string; active: boolean }) {
  const [shown, setShown] = useState(active ? 0 : text.length);

  useEffect(() => {
    if (!active) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const step = Math.max(2, Math.ceil(text.length / 400));
    const id = window.setInterval(() => {
      setShown((prev) => {
        if (prev >= text.length) {
          window.clearInterval(id);
          return text.length;
        }
        return Math.min(text.length, prev + step);
      });
    }, 24);
    return () => window.clearInterval(id);
  }, [text, active]);

  return (
    <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{text.slice(0, shown)}</div>
  );
}

function ImStreamingPlaceholder() {
  return (
    <p className="m-0 flex items-center gap-2 text-sm text-slate-400">
      <span className="inline-flex gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-slate-300" />
        <span className="size-1.5 animate-pulse rounded-full bg-slate-300 [animation-delay:120ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-slate-300 [animation-delay:240ms]" />
      </span>
      架构节点推进中…
    </p>
  );
}

function LiveActionIndicator({ liveAction }: { liveAction: LiveAction }) {
  return (
    <div
      className={
        liveAction.external ? autopilotTheme.liveActionExternal : autopilotTheme.liveActionThink
      }
    >
      {!liveAction.external && (
        <span className="mr-2 inline-flex gap-1 align-middle">
          <span className="size-1.5 animate-pulse rounded-full bg-slate-400" />
          <span className="size-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms]" />
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
      className="text-slate-500 hover:text-slate-700 hover:underline"
    >
      证据链
    </a>
  );

  if (turn.main) {
    parts.push(
      <button
        key="challenge"
        type="button"
        onClick={() => onChallenge(turn.main!.artifactId)}
        className="text-slate-500 hover:text-slate-700 hover:underline"
      >
        质疑这轮结论
      </button>
    );
    parts.push(
      <span key="source" className="text-slate-400">
        {turn.main.realLlm ? "真实推演" : "规则推演"}
      </span>
    );
  }

  if (turn.assistantSource === "fallback") {
    const fallbackHint =
      narrationFallbackHint(turn.narrationReason) ||
      "叙述服务暂不可用，本条为系统模板回复（产物与结论状态不受影响）";
    parts.push(
      <span key="fallback" className="text-slate-400" title={fallbackHint}>
        模板回复
      </span>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-slate-300">·</span>}
          {part}
        </React.Fragment>
      ))}
    </div>
  );
}

function SlideRuleImmersion({
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
  handleResolveInteractiveGate,
  handleTerminalAction,
  focusNodeId,
  lineageHighlightIds,
  onEvidenceRefClick,
  projectionDensity,
  onProjectionDensityChange,
  viewMode,
  onViewModeChange,
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
  onExportDeliverables,
  stop,
  deliverablesOpen,
  setDeliverablesOpen,
  openDeliverables,
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
  reasoningViewModel: ReturnType<typeof deriveSlideRuleReasoningViewModel>;
  graphNodeCount: number;
  graphRevision: string;
  handleGraphNodeClick: (node: BrainstormReasoningNode) => void;
  handleResolveInteractiveGate?: (gateNodeId: string, choice: string | null) => void;
  handleTerminalAction: (action: "report" | "lineage" | "export") => void;
  focusNodeId: string | null;
  lineageHighlightIds: string[];
  onEvidenceRefClick: (artifactId: string) => void;
  projectionDensity: ProjectionDensity;
  onProjectionDensityChange: (density: ProjectionDensity) => void;
  viewMode: "overview" | "collaboration" | "reasoning";
  onViewModeChange: (mode: "overview" | "collaboration" | "reasoning") => void;
  imSurfaceMode: ReturnType<typeof resolveImSurfaceMode>;
  latestTurn: UiTurn | null;
  latestTurnId: string | null;
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
}) {
  const sessionId = sessionState.sessionId || "sliderule-v51-product";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const composerHints = useMemo(
    () => deriveComposerHintChips(sessionState),
    [sessionState]
  );

  // 澄清卡片可关闭；待回答问题集合变化时重新出现。
  const clarifications = pendingClarifications ?? [];
  const clarifyKey = clarifications.map((c) => c.id).join("|");
  const [clarifyHidden, setClarifyHidden] = useState(false);
  useEffect(() => {
    setClarifyHidden(false);
  }, [clarifyKey]);
  const showClarify = clarifications.length > 0 && !clarifyHidden && !!answerClarifications;

  return (
    <div className={autopilotTheme.immersionPage}>
      <div className={autopilotTheme.immersionCanvas}>
        {graphNodeCount > 0 ? (
          <ReasoningFlowSurface
            viewModel={reasoningViewModel}
            initialScale={0.88}
            graphRevision={graphRevision}
            className="absolute inset-0"
            showChrome={false}
            showBottomChrome
            onNodeClick={handleGraphNodeClick}
            onResolveInteractiveGate={handleResolveInteractiveGate}
            externalHighlightedIds={lineageHighlightIds}
            focusNodeId={focusNodeId}
            onTerminalAction={handleTerminalAction}
            terminalCanExport={reasoningViewModel.terminalMeta?.canExport}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 pb-[16vh] pt-24">
            <img
              src="/assets/SlideRule_transparent_cropped.png"
              alt="SlideRule"
              className="w-[min(82vw,360px)] object-contain opacity-[0.35] drop-shadow-[0_14px_30px_rgb(15_23_42/0.08)]"
              title="SlideRule"
            />
          </div>
        )}
      </div>

      <div className={autopilotTheme.immersionOverlayTop}>
        <SlideRuleTopHud
          state={sessionState}
          goal={goal}
          turnCount={uiTurns.length}
          isRunning={isRunning}
          driveLoopCount={
            latestTurn?.routeFacts.rounds?.length ??
            (latestTurn && latestTurn.routeFacts.planSelectedCount ? 1 : 0)
          }
          telemetry={reasoningViewModel.telemetry}
          executorMode={executorMode}
          projectionDensity={projectionDensity}
          onProjectionDensityChange={onProjectionDensityChange}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          onResetSession={resetSession}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenDeliverables={openDeliverables}
        />
        <div className={autopilotTheme.immersionOverlayArchRow}>
          <ArchitectureProcessPanel
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
          />
        </div>
      </div>

      {imSurfaceMode === "minimal" && latestTurn && (
        <div className="pointer-events-none absolute left-1/2 top-[42%] z-10 w-[min(90%,480px)] -translate-x-1/2">
          <div className="pointer-events-auto rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-lg backdrop-blur-xl">
            {(() => {
              const finalStep = finalNarrationStep(latestTurn.steps);
              const narrationText = finalStep?.text ?? latestTurn.assistant;
              if (!narrationText && latestTurn.status === "streaming") {
                return <ImStreamingPlaceholder />;
              }
              if (!narrationText) return null;
              return (
                <TypewriterText
                  text={narrationText}
                  active={
                    latestTurn.id === latestTurnId &&
                    (latestTurn.status === "streaming" ||
                      (finalStep != null && latestTurn.status === "complete"))
                  }
                />
              );
            })()}
            {latestTurn.status === "complete" && (
              <TurnFootnote
                turn={latestTurn}
                sessionId={sessionId}
                onChallenge={challengeTurn}
              />
            )}
          </div>
        </div>
      )}

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
            latestUserText={latestTurn?.user}
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
  handleResolveInteractiveGate,
  handleTerminalAction,
  focusNodeId,
  lineageHighlightIds,
  onEvidenceRefClick,
  projectionDensity,
  onProjectionDensityChange,
  viewMode,
  onViewModeChange,
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
  handleResolveInteractiveGate?: (gateNodeId: string, choice: string | null) => void;
  handleTerminalAction: (action: "report" | "lineage" | "export") => void;
  focusNodeId: string | null;
  lineageHighlightIds: string[];
  onEvidenceRefClick: (artifactId: string) => void;
  projectionDensity: ProjectionDensity;
  onProjectionDensityChange: (density: ProjectionDensity) => void;
  viewMode: "overview" | "collaboration" | "reasoning";
  onViewModeChange: (mode: "overview" | "collaboration" | "reasoning") => void;
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
            className={`${autopilotTheme.goal} ${!goal ? "text-slate-400" : ""}`}
            data-testid="sliderule-goal-display"
          >
            {goal || "输入你的想法，开始推演…"}
          </div>
        </div>
        <div className="flex items-center gap-3 pl-4">
          <button
            type="button"
            onClick={openDeliverables}
            data-testid="sliderule-deliverables-open"
            className={autopilotTheme.auditBtn}
            title="交付物（报告 / 规格树 / 文档 / 提示词包 / 架构图 / 交接包）"
          >
            交付物
          </button>
          <button
            type="button"
            onClick={resetSession}
            disabled={isRunning}
            data-testid="sliderule-reset-session"
            className={autopilotTheme.auditBtn}
            title={isRunning ? "推演进行中，请稍后再重置" : "清空本轮对话与持久化状态，重新开始"}
          >
            重置会话
          </button>
          <a href="/sliderule/dev" className={autopilotTheme.devLink} title="打开工程驾驶舱">
            Dev
          </a>
        </div>
      </header>

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
      />

      <div className={autopilotTheme.split}>
        <section className={autopilotTheme.flowPanelWide} aria-label="推演路径">
          <div className={autopilotTheme.flowPanelHeader}>
            <span className={autopilotTheme.label}>推演路径</span>
            <div className="flex min-w-0 flex-col items-end gap-0.5">
              {isRunning && liveAction ? (
                <LiveActionIndicator liveAction={liveAction} />
              ) : (
                <span className="text-[10px] text-slate-400">
                  {graphNodeCount > 0
                    ? `${graphNodeCount} 节点 · 点击可质疑`
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
                onResolveInteractiveGate={handleResolveInteractiveGate}
                externalHighlightedIds={lineageHighlightIds}
                focusNodeId={focusNodeId}
                onTerminalAction={handleTerminalAction}
                terminalCanExport={reasoningViewModel.terminalMeta?.canExport}
              />
            ) : (
              <div className={autopilotTheme.flowEmpty}>
                发送第一条消息后，推演路径会在这里展开。
              </div>
            )}
          </div>
        </section>

        <section className={autopilotTheme.imPanel} aria-label="对话">
          <main ref={imScrollRef} className={autopilotTheme.main}>
            <div className="space-y-6">
              {uiTurns.length === 0 && (
                <div className={autopilotTheme.emptyState}>
                  欢迎来到 SlideRule V5。
                  <p className={autopilotTheme.emptyHint}>
                    在下方输入你的目标或质疑，系统会从丰富的能力池中动态挑选 (capability × role) 进行推演。
                    没有固定阶段，一切由当前状态和你的输入驱动。
                  </p>
                </div>
              )}
              {uiTurns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  <div className="flex justify-end">
                    <div className={autopilotTheme.userBubble}>{turn.user}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200/80 bg-white px-4 py-4 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
                    {/* M7 收尾: turn-route 在 marathon 模式下默认隐藏（沉浸 + 避免机制词）。single 模式可见；toggle 仍可强展 */}
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
                      <div className="cursor-pointer text-[10px] text-slate-400" onClick={() => toggleRouteExpanded(turn.id)} title="M7: marathon 收敛中隐藏 turn-route 详情（点击展开内部审计）">— 持续推演（route 隐藏，点击展开） —</div>
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
                placeholder="工程路径完整 IM…"
                disabled={isRunning}
                className={autopilotTheme.input}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim()}
                className={autopilotTheme.sendBtn}
              >
                {isRunning ? "停止" : "发送"}
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
      />
    </div>
  );
}

export default function SlideRule() {
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
  } = useSlideRuleSession({
    sessionId: IS_GITHUB_PAGES ? GITHUB_PAGES_DEMO_SESSION_ID : "sliderule-v51-product",
    documentTitle: IS_GITHUB_PAGES ? "SlideRule · 演示" : "SlideRule",
    initialGoal: IS_GITHUB_PAGES ? GITHUB_PAGES_DEMO_GOAL : undefined,
  });

  const imSurfaceMode = useMemo(() => resolveImSurfaceMode(), []);
  const isImmersion = imSurfaceMode !== "engineering";
  const latestTurn = uiTurns.length > 0 ? uiTurns[uiTurns.length - 1] : null;
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

  useEffect(() => {
    if (reasoningViewModel.terminalNode) {
      setFocusNodeId(SLIDERULE_TERMINAL_NODE_ID);
    }
  }, [reasoningViewModel.terminalNode?.id, sessionState.goal?.status]);

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

  const handleGraphNodeClick = useCallback(
    (node: BrainstormReasoningNode) => {
      const producedArtifactId = (node as { producedArtifactId?: string }).producedArtifactId;
      if (producedArtifactId) {
        challengeTurn(producedArtifactId);
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
    handleResolveInteractiveGate,
    handleTerminalAction,
    focusNodeId,
    lineageHighlightIds,
    onEvidenceRefClick: handleEvidenceRefClick,
    projectionDensity,
    onProjectionDensityChange: handleProjectionDensityChange,
    viewMode,
    onViewModeChange,
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
  };

  if (isImmersion) {
    return <SlideRuleImmersion {...shared} />;
  }

  return <SlideRuleSplitEngineering {...shared} />;
}
