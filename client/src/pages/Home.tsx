import { createRef, useCallback, useEffect, useMemo } from "react";
import { ArrowRight, Settings2, Waves } from "lucide-react";
import { useLocation } from "wouter";

import { AppSidebar } from "@/components/AppSidebar";
import { ChatPanel } from "@/components/ChatPanel";
import { GitHubRepoBadge } from "@/components/GitHubRepoBadge";
import { LoadingScreen } from "@/components/LoadingScreen";
import { OfficeTaskCockpit } from "@/components/office/OfficeTaskCockpit";
import { AgentDetailDrawer } from "@/components/scene/AgentDetailDrawer";
import { OfficeNoticeBoard } from "@/components/scene/OfficeNoticeBoard";
import { Scene3D } from "@/components/Scene3D";
import { TelemetryDashboard } from "@/components/TelemetryDashboard";
import { UEOverlayChrome, type HUDDefinition } from "@/components/ue-overlay";
import { WorkflowPanel } from "@/components/WorkflowPanel";
import {
  useViewportResizeState,
  useViewportTier,
  useViewportWidth,
} from "@/hooks/useViewportTier";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useWorkflowRuntimeBootstrap } from "@/hooks/useWorkflowRuntimeBootstrap";
import { useI18n } from "@/i18n";
import { CAN_USE_ADVANCED_RUNTIME, IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { buildOfficeNoticeBoardSnapshot } from "@/lib/scene-agent-detail";
import { useAppStore } from "@/lib/store";
import { useTelemetryStore } from "@/lib/telemetry-store";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/lib/workflow-store";

const HOME_DESKTOP_CHROME_CSS = `
.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 252, 255, 0.66) 58%, rgba(236, 249, 255, 0.36) 100%) !important;
  border-color: rgba(186, 230, 253, 0.48) !important;
  color: #334155 !important;
  box-shadow: 18px 0 58px rgba(14, 165, 233, 0.1), inset -1px 0 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(30px) saturate(1.18);
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] * {
  color: inherit;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button {
  border-color: transparent;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button:hover {
  border-color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.54) !important;
  color: #0f172a !important;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button[aria-current="page"] {
  background: rgba(255, 255, 255, 0.86) !important;
  border-color: rgba(186, 230, 253, 0.82) !important;
  box-shadow: 0 18px 40px rgba(14, 165, 233, 0.18), 0 6px 18px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.96);
  color: #0f172a !important;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button[aria-current="page"] *,
.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button[aria-current="page"] svg {
  color: inherit;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] [data-sidebar-status-card="glass"] {
  background: rgba(255, 255, 255, 0.48) !important;
  border-color: rgba(255, 255, 255, 0.58) !important;
}

.home-first-screen-cockpit > .pointer-events-none.absolute.inset-0.z-20 > section {
  justify-content: center;
  padding-bottom: clamp(24px, 8vh, 96px);
}
`;

export default function Home() {
  const isSceneReady = useAppStore(state => state.isSceneReady);
  const hydrateAIConfig = useAppStore(state => state.hydrateAIConfig);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const locale = useAppStore(state => state.locale);
  const toggleLocale = useAppStore(state => state.toggleLocale);
  const toggleConfig = useAppStore(state => state.toggleConfig);
  const selectedPet = useAppStore(state => state.selectedPet);
  const setSelectedPet = useAppStore(state => state.setSelectedPet);
  const fetchTelemetry = useTelemetryStore(state => state.fetchInitial);
  const telemetrySnapshot = useTelemetryStore(state => state.snapshot);
  const ensureTasksReady = useTasksStore(state => state.ensureReady);
  const missionTasks = useTasksStore(state => state.tasks);
  const missionDetailsById = useTasksStore(state => state.detailsById);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const selectTask = useTasksStore(state => state.selectTask);
  const agents = useWorkflowStore(state => state.agents);
  const workflows = useWorkflowStore(state => state.workflows);
  const heartbeatStatuses = useWorkflowStore(state => state.heartbeatStatuses);
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const toggleWorkflowPanel = useWorkflowStore(
    state => state.toggleWorkflowPanel
  );
  const openWorkflowPanel = useWorkflowStore(state => state.openWorkflowPanel);
  const { isMobile } = useViewportTier();
  const viewportWidth = useViewportWidth();
  const resizeActive = useViewportResizeState();
  const { copy } = useI18n();
  const [, setLocation] = useLocation();
  const { startDemo } = useDemoMode();
  const ueVideoRef = useMemo(() => createRef<HTMLVideoElement>(), []);

  useWorkflowRuntimeBootstrap({
    heartbeatReportLimit: 18,
    deferSecondary: true,
  });

  const handleStartDemo = useCallback(async () => {
    try {
      const { DEMO_BUNDLE } = await import("@/runtime/demo-data/bundle");
      await startDemo(DEMO_BUNDLE as any);
      setLocation("/tasks");
    } catch (err) {
      console.warn("[Home] Demo bundle not available yet:", err);
    }
  }, [setLocation, startDemo]);

  useEffect(() => {
    hydrateAIConfig().catch(error => {
      console.error("[Home] Failed to load AI config:", error);
    });
  }, [hydrateAIConfig]);

  useEffect(() => {
    if (runtimeMode === "frontend") {
      disconnectSocket();
    }
  }, [disconnectSocket, runtimeMode]);

  useEffect(() => {
    if (isSceneReady && runtimeMode === "advanced") {
      fetchTelemetry();
    }
  }, [fetchTelemetry, isSceneReady, runtimeMode]);

  useEffect(() => {
    ensureTasksReady().catch(error => {
      console.warn("[Home] Failed to hydrate mission summaries:", error);
    });
  }, [ensureTasksReady]);

  const agentCount = agents.length || 18;
  const activeWorkflows =
    missionTasks.length > 0
      ? missionTasks.filter(
          task => task.status === "running" || task.status === "waiting"
        ).length
      : workflows.filter(
          workflow =>
            workflow.status === "running" || workflow.status === "pending"
        ).length;

  const noticeBoardSnapshot = useMemo(() => {
    if (!isMobile) return null;

    return buildOfficeNoticeBoardSnapshot({
      locale,
      runtimeMode,
      missionTasks,
      missionDetailsById,
      workflows,
      heartbeatStatuses,
      totalTokens:
        (telemetrySnapshot?.totalTokensIn ?? 0) +
        (telemetrySnapshot?.totalTokensOut ?? 0),
      totalCost: telemetrySnapshot?.totalCost ?? 0,
    });
  }, [
    heartbeatStatuses,
    isMobile,
    locale,
    missionDetailsById,
    missionTasks,
    runtimeMode,
    telemetrySnapshot,
    workflows,
  ]);

  const handleOpenCurrentMission = selectedTaskId
    ? () => {
        selectTask(selectedTaskId);
        setLocation(`/tasks/${selectedTaskId}`);
      }
    : undefined;
  const isZh = locale === "zh-CN";
  const fullWorkbenchLabel = isZh ? "任务工作台" : copy.home.enterTasks;
  const workflowLabel = isZh ? "打开工作流" : copy.home.openWorkflow;
  const demoLabel = isZh ? "载入演示" : copy.home.liveDemo;
  const configLabel = isZh ? "运行时配置" : copy.home.openConfig;
  const frontendModeLabel = isZh ? "前端模式" : "Frontend";
  const advancedModeLabel = isZh ? "高级模式" : "Advanced";
  const officeNavLabel = isZh ? "办公室" : copy.toolbar.primaryNav.office.label;
  const moreNavLabel = isZh ? "更多" : copy.toolbar.primaryNav.more.label;
  const heroSubtitle = isZh
    ? "智能协同 · 自动执行 · 结果闭环"
    : "Intelligent collaboration · autonomous execution · closed-loop delivery";
  const runtimeChipLabel = isZh
    ? `当前模式：${runtimeMode === "advanced" ? "高级模式" : "前端模式"}`
    : copy.home.runtimeChip(
        copy.toolbar.runtimeLabels[
          runtimeMode === "advanced" ? "advanced" : "frontend"
        ]
      );

  const localeLabel =
    locale === "zh-CN" ? copy.common.englishShort : copy.common.chineseShort;
  const scenePerformanceProfile =
    resizeActive && !isMobile ? "resizing" : "balanced";
  const desktopSidebarWidth = isMobile ? 0 : viewportWidth >= 1280 ? 248 : 64;
  const sceneLayer = (
    <Scene3D
      performanceProfile={scenePerformanceProfile}
      sidebarWidth={desktopSidebarWidth}
    />
  );
  const hudDefinitions: HUDDefinition[] = useMemo(
    () =>
      agents.slice(0, 8).flatMap(agent => [
        {
          id: `${agent.id}-name`,
          type: "nameTag",
          characterId: agent.id,
          data: { name: agent.name },
        },
        {
          id: `${agent.id}-status`,
          type: "statusIcon",
          characterId: agent.id,
          data: {
            icon: agent.status === "idle" ? "o" : "*",
            status: agent.status,
          },
        },
      ]),
    [agents]
  );
  const desktopGlassClass = resizeActive
    ? "border-slate-200/90 bg-[hsl(var(--background))]/96 shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
    : "border-white/64 bg-[rgba(248,250,252,0.78)] shadow-[0_10px_28px_rgba(15,23,42,0.08)] backdrop-blur";
  const utilityChipClass = resizeActive
    ? "border-slate-200/90 bg-[hsl(var(--background))]/96 shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
    : "border-white/68 bg-[rgba(248,250,252,0.82)] shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur";

  return (
    <div className="relative h-[100svh] w-screen overflow-hidden bg-[linear-gradient(180deg,#eef6fb_0%,#f7fbfd_48%,#e5f1f4_100%)]">
      <style>{HOME_DESKTOP_CHROME_CSS}</style>
      {isMobile ? (
        sceneLayer
      ) : (
        <UEOverlayChrome
          videoElement={ueVideoRef}
          mediaLayer={sceneLayer}
          hudDefinitions={hudDefinitions}
          viewportWidth={viewportWidth}
          overlayTone="clear"
          backgroundClassName="bg-[linear-gradient(180deg,#eef6fb_0%,#f7fbfd_48%,#e5f1f4_100%)]"
          sidebar={
            <div className="home-desktop-sidebar-shell h-full">
              <AppSidebar
                collapsed={viewportWidth < 1280}
                onToggleCollapse={() => undefined}
                embedded
              />
            </div>
          }
        >
          {isSceneReady ? (
            <div className="home-desktop-workspace relative h-full min-h-0">
              <div
                className="absolute inset-x-0 top-0 z-[60] px-3 py-2 xl:px-4"
                data-testid="home-desktop-toolbar"
                style={{ pointerEvents: "auto" }}
              >
                <div className="relative flex items-center justify-between gap-2">
                  <div
                    className="pointer-events-none fixed left-1/2 top-3 z-[70] flex -translate-x-1/2 justify-center"
                    data-testid="home-desktop-center-controls"
                  >
                    <div className="pointer-events-auto flex items-center gap-2">
                      <div
                        className={cn(
                          "flex items-center gap-1 rounded-[16px] border p-0.5",
                          desktopGlassClass
                        )}
                      >
                        <button
                          onClick={() => void setRuntimeMode("frontend")}
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                            runtimeMode === "frontend"
                              ? "bg-sky-50 text-slate-950 shadow-sm"
                              : "text-slate-500 hover:text-slate-950"
                          }`}
                        >
                          {frontendModeLabel}
                        </button>
                        {CAN_USE_ADVANCED_RUNTIME && (
                          <button
                            onClick={() => void setRuntimeMode("advanced")}
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                              runtimeMode === "advanced"
                                ? "bg-[#0f766e] text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-950"
                            }`}
                          >
                            {advancedModeLabel}
                          </button>
                        )}
                      </div>

                      <div
                        className={cn(
                          "flex items-center gap-1 rounded-[16px] border p-0.5",
                          desktopGlassClass
                        )}
                      >
                        <button
                          type="button"
                          className="rounded-full bg-[#0f766e] px-3 py-1 text-[11px] font-semibold text-white shadow-sm"
                        >
                          {officeNavLabel}
                        </button>
                        <button
                          type="button"
                          onClick={() => setLocation("/debug")}
                          className="rounded-full px-3 py-1 text-[11px] font-semibold text-slate-500 transition-all hover:text-slate-950"
                        >
                          {moreNavLabel}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={toggleLocale}
                        className={cn(
                          "rounded-[16px] border px-3 py-[7px] text-[11px] font-semibold text-slate-500 transition-colors hover:bg-white hover:text-slate-950",
                          desktopGlassClass
                        )}
                        title={copy.app.localeSwitch}
                      >
                        {localeLabel}
                      </button>
                    </div>
                  </div>

                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setLocation("/tasks")}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950",
                        utilityChipClass
                      )}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      {fullWorkbenchLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => openWorkflowPanel()}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950",
                        utilityChipClass
                      )}
                    >
                      <Waves className="h-3.5 w-3.5" />
                      {workflowLabel}
                    </button>
                    <button
                      type="button"
                      onClick={handleStartDemo}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950",
                        utilityChipClass
                      )}
                    >
                      {demoLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleConfig()}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950",
                        utilityChipClass
                      )}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      {configLabel}
                    </button>
                    {IS_GITHUB_PAGES && <GitHubRepoBadge />}
                    <div
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold text-slate-700",
                        utilityChipClass
                      )}
                    >
                      {runtimeChipLabel}
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="pointer-events-none fixed left-1/2 top-[clamp(68px,8vh,96px)] z-[58] w-[min(720px,calc(100vw-560px))] -translate-x-1/2 text-center"
                data-testid="home-desktop-scene-title"
              >
                <h1 className="text-3xl font-black leading-none text-slate-950 drop-shadow-[0_10px_28px_rgba(255,255,255,0.72)] 2xl:text-4xl">
                  Cube Pets Office
                </h1>
                <p className="mt-2 text-sm font-semibold text-slate-600 2xl:text-base">
                  {heroSubtitle}
                </p>
              </div>

              <OfficeTaskCockpit
                resizeActive={resizeActive}
                className="home-first-screen-cockpit"
              />

              <ChatPanel />
              <WorkflowPanel />
              <TelemetryDashboard />
            </div>
          ) : null}
        </UEOverlayChrome>
      )}

      <div className="pointer-events-none absolute inset-0 z-[5]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(228,241,252,0.72),rgba(228,241,252,0)_38%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,251,247,0.42),rgba(255,251,247,0)_30%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.07),rgba(59,130,246,0)_32%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(15,118,110,0.1),rgba(15,118,110,0)_24%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#f5f9fd]/46 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#dbeafe]/32 to-transparent" />
        <div className="absolute inset-0 shadow-[inset_0_0_160px_rgba(15,23,42,0.08)]" />
      </div>

      {isSceneReady && isMobile ? (
        <div className="pointer-events-none absolute inset-x-0 z-[18] flex justify-center px-3 top-[calc(env(safe-area-inset-top)+108px)]">
          <div className="pointer-events-auto w-full max-w-none rounded-[28px] studio-shell px-4 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
            <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">
              {copy.home.officeEyebrow}
            </p>
            <div className="mt-3 space-y-3">
              <div className="min-w-0">
                <h1
                  className="text-xl font-semibold tracking-tight text-slate-950"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {copy.home.officeTitle}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  {copy.home.mobileHint}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setLocation("/tasks")}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#115e59]"
                >
                  {copy.home.enterTasks}
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleWorkflowPanel()}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white/85 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950"
                >
                  {copy.home.openWorkflow}
                </button>
                <button
                  type="button"
                  onClick={() => toggleConfig()}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white/85 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950"
                >
                  {copy.home.openConfig}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600">
                {copy.home.runtimeChip(
                  copy.toolbar.runtimeLabels[
                    runtimeMode === "advanced" ? "advanced" : "frontend"
                  ]
                )}
              </span>
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600">
                {copy.home.agentChip(agentCount)}
              </span>
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600">
                {copy.home.workflowChip(activeWorkflows)}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {!isSceneReady && <LoadingScreen />}

      {isSceneReady && isMobile && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+270px)] z-[18] px-3">
            <div className="pointer-events-auto">
              {noticeBoardSnapshot ? (
                <OfficeNoticeBoard
                  locale={locale}
                  snapshot={noticeBoardSnapshot}
                  onOpenTasks={() => setLocation("/tasks")}
                  onOpenWorkflow={() => openWorkflowPanel()}
                  onOpenCurrentTask={handleOpenCurrentMission}
                />
              ) : null}
            </div>
          </div>
          <ChatPanel />
          <WorkflowPanel />
          <TelemetryDashboard />
        </>
      )}

      <AgentDetailDrawer
        agentId={selectedPet}
        open={isMobile && Boolean(selectedPet)}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            setSelectedPet(null);
          }
        }}
      />
    </div>
  );
}
