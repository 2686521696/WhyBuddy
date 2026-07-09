import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, MoreHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";
import {
  buildLaunchRoutePlan,
} from "@/lib/launch-router";
import {
  selectTaskHubLaunchSession,
  useNLCommandStore,
  type TaskHubCommandSubmissionResult,
  type TaskHubCreateMission,
} from "@/lib/nl-command-store";
import { useWorkflowStore } from "@/lib/workflow-store";
import {
  submitUnifiedLaunch,
} from "@/lib/unified-launch-coordinator";
import { prepareWorkflowAttachments } from "@/lib/workflow-attachments";
import { cn } from "@/lib/utils";
import type { WorkflowInputAttachment } from "@shared/workflow-input";

import { LaunchModeTabBar, type LaunchMode, LAUNCH_MODES } from "./LaunchModeTabBar";
import { LaunchGoalInput } from "./LaunchGoalInput";
import { LaunchRoutePlanningFlow } from "./LaunchRoutePlanningFlow";
import { LaunchCockpitGrid } from "./LaunchCockpitGrid";
import { LaunchOutputChips } from "./LaunchOutputChips";
import { LaunchPanelActionBar } from "./LaunchPanelActionBar";

import type { UnifiedWorkflowResolution } from "./UnifiedLaunchComposer";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export interface LaunchPanelShellProps {
  open: boolean;
  onClose: () => void;
  createMission: TaskHubCreateMission;
  variant?: "modal" | "center" | "dock";
  onTaskResolved?: (result: TaskHubCommandSubmissionResult) => void;
  onWorkflowResolved?: (result: UnifiedWorkflowResolution) => void;
}

export function LaunchPanelShell({
  open,
  onClose,
  createMission,
  variant = "center",
  onTaskResolved,
  onWorkflowResolved,
}: LaunchPanelShellProps) {
  const { locale } = useI18n();
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const taskHubSession = useNLCommandStore(
    useShallow(selectTaskHubLaunchSession)
  );
  const setDraftText = useNLCommandStore(state => state.setDraftText);
  const loadingCommand = taskHubSession.loading;
  const loadingWorkflow = useWorkflowStore(state => state.isSubmitting);

  const [launchMode, setLaunchMode] = useState<LaunchMode>("quick");
  const [attachments, setAttachments] = useState<WorkflowInputAttachment[]>([]);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [selectedOutputTypes, setSelectedOutputTypes] = useState<Set<string>>(
    new Set(["summary", "files"])
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const submitting = loadingCommand || loadingWorkflow || isPreparingFiles;
  const draftText = taskHubSession.draftText;
  const isModal = variant === "modal";
  const isCenterVariant = variant === "center";

  const routePlan = useMemo(
    () =>
      buildLaunchRoutePlan({
        text: draftText,
        attachments,
        runtimeMode,
      }),
    [attachments, draftText, runtimeMode]
  );

  const hasDraftDestination =
    draftText.trim().length > 0 || attachments.length > 0;

  const modeConfig = LAUNCH_MODES.find(m => m.id === launchMode);
  const showAdvanced = modeConfig?.showAdvancedSections ?? false;

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement;
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }

    triggerRef.current?.focus();
    triggerRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !isModal) return;
    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [open, isModal]);

  const handleSubmit = useCallback(async () => {
    if (!hasDraftDestination || submitting) return;

    const selectedRoute = modeConfig?.routeMapping ?? null;

    try {
      const result = await submitUnifiedLaunch({
        text: draftText,
        attachments,
        runtimeMode,
        selectedRouteId: selectedRoute ?? undefined,
      });

      if (result.route === "mission") {
        onTaskResolved?.({
          commandId: result.commandId,
          commandText: draftText,
          missionId: result.missionId,
          relatedMissionIds: result.missionId ? [result.missionId] : [],
          autoSelectedMissionId: result.missionId,
          status: result.status,
          createdAt: Date.now(),
        });
        setDraftText("");
        setAttachments([]);
        onClose();
      } else if (result.route === "workflow") {
        onWorkflowResolved?.({
          workflowId: result.workflowId,
          missionId: result.missionId,
          directive: draftText,
          attachmentCount: attachments.length,
          requestedAt: Date.now(),
          deduped: result.deduped,
        });
        setDraftText("");
        setAttachments([]);
        onClose();
      } else if (result.route === "upgrade-required") {
        toast.info(
          t(
            locale,
            "此任务需要高级执行环境，请先切换运行时。",
            "This task requires the advanced runtime. Please switch first."
          )
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t(locale, "任务提交失败。", "Failed to submit task.")
      );
    }
  }, [
    hasDraftDestination,
    submitting,
    modeConfig,
    draftText,
    attachments,
    runtimeMode,
    onTaskResolved,
    onWorkflowResolved,
    onClose,
    setDraftText,
    locale,
  ]);

  const handleAddAttachment = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleCreateTask = useCallback(async () => {
    if (submitting) return;

    const sourceText = draftText.trim();
    const fallbackTitle = t(locale, "新的发起任务", "New launch task");
    const title = sourceText || fallbackTitle;

    try {
      const missionId = await createMission({
        kind: launchMode,
        title,
        sourceText: sourceText || undefined,
        autoDispatch: false,
      });

      if (missionId) {
        onTaskResolved?.({
          commandId: `manual-${Date.now()}`,
          commandText: title,
          missionId,
          relatedMissionIds: [missionId],
          autoSelectedMissionId: missionId,
          status: "created",
          createdAt: Date.now(),
        });
        toast.success(
          t(locale, "任务已创建并落入队列。", "Task created and added to the queue.")
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t(locale, "创建任务失败。", "Failed to create task.")
      );
    }
  }, [
    createMission,
    draftText,
    launchMode,
    locale,
    onTaskResolved,
    submitting,
  ]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setIsPreparingFiles(true);
      try {
        const prepared = await prepareWorkflowAttachments(Array.from(files));
        setAttachments(current => {
          const seen = new Set(
            current.map(item => `${item.name}:${item.size}:${item.mimeType}`)
          );
          const next = [...current];
          for (const item of prepared) {
            const key = `${item.name}:${item.size}:${item.mimeType}`;
            if (!seen.has(key)) {
              next.push(item);
              seen.add(key);
            }
          }
          return next;
        });
      } catch {
        toast.error(
          t(locale, "附件处理失败。", "Failed to process attachments.")
        );
      } finally {
        setIsPreparingFiles(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [locale]
  );

  const handleToggleOutput = useCallback((id: string) => {
    setSelectedOutputTypes(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const portalTarget = typeof document !== "undefined" ? document.body : null;
  const panelStyle = isModal
    ? {
        backgroundColor: "var(--card, #ffffff)",
        color: "var(--card-foreground, #0f172a)",
        borderColor: "var(--border, #e2e8f0)",
        boxShadow:
          "0 22px 56px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.48)",
      }
    : {
        color: "var(--card-foreground, #0f172a)",
        borderColor: "rgba(203,213,225,0.72)",
        boxShadow:
          "0 24px 58px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.86)",
      };

  const content = (
    <AnimatePresence>
      {open && (
        <>
          {isModal ? (
            <motion.div
              key="launch-panel-backdrop"
              className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              aria-hidden="true"
              data-testid="launch-panel-backdrop"
            />
          ) : null}

          <div
            className={cn(
              "fixed z-[60] flex",
              isModal
                ? "inset-0 items-center justify-center p-4 max-md:items-end max-md:p-0"
                : "pointer-events-none inset-x-0 px-3 max-md:px-2",
              isCenterVariant
                ? "top-[clamp(4.75rem,10vh,7rem)] justify-center max-md:top-auto max-md:bottom-3"
                : !isModal && "bottom-4 justify-center max-md:bottom-2"
            )}
            data-testid="launch-panel-container"
            data-variant={variant}
          >
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal={isModal}
              aria-labelledby="launch-panel-title"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className={cn(
                "pointer-events-auto flex w-full flex-col overflow-hidden border",
                isModal
                  ? "bg-white shadow-lg md:max-h-[calc(100vh-120px)] md:max-w-[760px] md:rounded-xl max-md:max-h-[90vh] max-md:max-w-full max-md:rounded-t-xl max-md:rounded-b-none"
                  : "max-h-[min(74vh,650px)] max-w-[min(92vw,700px)] rounded-[18px] bg-white/90 shadow-lg backdrop-blur-xl max-md:max-h-[min(72svh,560px)]",
                variant === "dock" && "max-w-[min(94vw,760px)]"
              )}
              style={panelStyle}
              data-testid="launch-panel-shell"
              data-variant={variant}
            >
              <div
                className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
                style={{ borderColor: "rgba(226,232,240,0.78)" }}
              >
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                    Autopilot Control
                  </div>
                  <h2
                    id="launch-panel-title"
                    className="mt-0.5 text-sm font-semibold leading-5"
                    style={{ color: "var(--card-foreground, #0f172a)" }}
                  >
                    {t(locale, "任务自动驾驶", "Task Autopilot")}
                    <span
                      className="ml-2 text-xs font-normal"
                      style={{ color: "var(--muted-foreground, #64748b)" }}
                    >
                      Autopilot Control
                    </span>
                  </h2>
                  <p
                    className="truncate text-xs"
                    style={{ color: "var(--muted-foreground, #64748b)" }}
                  >
                    {t(
                      locale,
                      "让系统帮你自主规划、执行与验证，完成复杂任务",
                      "Let the system autonomously plan, execute and verify complex tasks"
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-black/5"
                    style={{
                      borderColor: "var(--border, #e2e8f0)",
                      color: "var(--muted-foreground, #64748b)",
                    }}
                    data-testid="launch-panel-refresh"
                  >
                    <RefreshCw size={12} />
                    {t(locale, "刷新", "Refresh")}
                  </button>
                  <button
                    type="button"
                    className="flex items-center justify-center rounded-md border p-1 transition-colors hover:bg-black/5"
                    style={{
                      borderColor: "var(--border, #e2e8f0)",
                      color: "var(--muted-foreground, #64748b)",
                    }}
                    data-testid="launch-panel-more"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md p-1 transition-colors hover:bg-black/5"
                    aria-label={t(locale, "关闭面板", "Close panel")}
                    data-testid="launch-panel-close"
                  >
                    <X size={18} style={{ color: "var(--muted-foreground, #64748b)" }} />
                  </button>
                </div>
              </div>

              <LaunchModeTabBar
                mode={launchMode}
                onModeChange={setLaunchMode}
                compact={!isModal}
              />

              <div className="flex-1 overflow-y-auto overscroll-contain">
                <LaunchGoalInput
                  ref={textareaRef}
                  value={draftText}
                  onChange={setDraftText}
                  maxLength={2000}
                  autoFocus
                  compact={!isModal}
                />

                {showAdvanced && (
                  <div className="space-y-2 px-4 pb-3">
                    <LaunchRoutePlanningFlow
                      hasDraftDestination={hasDraftDestination}
                      routePlan={routePlan}
                    />
                    <LaunchCockpitGrid
                      runtimeMode={runtimeMode}
                      compact={!isModal}
                    />
                    <LaunchOutputChips
                      selectedTypes={selectedOutputTypes}
                      onToggle={handleToggleOutput}
                    />
                  </div>
                )}
              </div>

              <LaunchPanelActionBar
                mode={launchMode}
                onSubmit={handleSubmit}
                onAddAttachment={handleAddAttachment}
                onCreateTask={handleCreateTask}
                submitting={submitting}
                disabled={!hasDraftDestination}
                attachmentCount={attachments.length}
                compact={!isModal}
              />

              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileChange}
                aria-hidden="true"
              />
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  return portalTarget ? createPortal(content, portalTarget) : content;
}
