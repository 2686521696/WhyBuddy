import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";
import {
  buildLaunchRoutePlan,
  type LaunchRouteCandidateId,
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
  onTaskResolved?: (result: TaskHubCommandSubmissionResult) => void;
  onWorkflowResolved?: (result: UnifiedWorkflowResolution) => void;
}

export function LaunchPanelShell({
  open,
  onClose,
  createMission,
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

  // Focus trap: focus textarea on open
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement;
      // Small delay to let animation start
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      // Restore focus on close
      triggerRef.current?.focus();
      triggerRef.current = null;
    }
  }, [open]);

  // Escape key handler
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

  // Focus trap: Tab cycling within panel
  useEffect(() => {
    if (!open) return;
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
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [open]);

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

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setIsPreparingFiles(true);
      try {
        const prepared = await prepareWorkflowAttachments(
          Array.from(files),
          attachments
        );
        setAttachments(prepared);
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
    [attachments, locale]
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

  const content = (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="launch-panel-backdrop"
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
            data-testid="launch-panel-backdrop"
          />

          {/* Panel container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 max-md:items-end max-md:p-0"
            data-testid="launch-panel-container"
          >
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="launch-panel-title"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className={cn(
                "flex w-full flex-col overflow-hidden border shadow-lg",
                // Desktop: centered, max 720px
                "md:max-w-[720px] md:max-h-[85vh] md:rounded-xl",
                // Tablet: centered, max 90vw
                "max-md:max-w-[90vw]",
                // Mobile: bottom sheet
                "max-md:max-w-full max-md:max-h-[90vh] max-md:rounded-t-xl max-md:rounded-b-none"
              )}
              style={{
                backgroundColor: "var(--card, #ffffff)",
                color: "var(--card-foreground, #0f172a)",
                borderColor: "var(--border, #e2e8f0)",
                borderRadius: undefined,
                boxShadow:
                  "0 22px 56px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.48)",
              }}
              data-testid="launch-panel-shell"
            >
              {/* Header */}
              <div
                className="flex items-center justify-between border-b px-4 py-3"
                style={{ borderColor: "var(--border, #e2e8f0)" }}
              >
                <div>
                  <h2
                    id="launch-panel-title"
                    className="text-sm font-semibold"
                    style={{ color: "var(--card-foreground, #0f172a)" }}
                  >
                    {t(locale, "任务自动驾驶", "Task Autopilot Control")}
                  </h2>
                  <p
                    className="text-xs"
                    style={{ color: "var(--muted-foreground, #64748b)" }}
                  >
                    {t(
                      locale,
                      "输入目标，选择模式，启动任务",
                      "Enter your goal, choose a mode, and launch"
                    )}
                  </p>
                </div>
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

              {/* Mode Tab Bar */}
              <LaunchModeTabBar
                mode={launchMode}
                onModeChange={setLaunchMode}
              />

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto">
                {/* Goal Input */}
                <LaunchGoalInput
                  ref={textareaRef}
                  value={draftText}
                  onChange={setDraftText}
                  maxLength={2000}
                  autoFocus
                />

                {/* Advanced sections - only in non-quick modes */}
                {showAdvanced && (
                  <div className="space-y-3 px-4 pb-3">
                    <LaunchRoutePlanningFlow
                      hasDraftDestination={hasDraftDestination}
                      routePlan={routePlan}
                    />
                    <LaunchCockpitGrid runtimeMode={runtimeMode} />
                    <LaunchOutputChips
                      selectedTypes={selectedOutputTypes}
                      onToggle={handleToggleOutput}
                    />
                  </div>
                )}
              </div>

              {/* Action Bar */}
              <LaunchPanelActionBar
                mode={launchMode}
                onSubmit={handleSubmit}
                onAddAttachment={handleAddAttachment}
                submitting={submitting}
                disabled={!hasDraftDestination}
                attachmentCount={attachments.length}
              />

              {/* Hidden file input */}
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
