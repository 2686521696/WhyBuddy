import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Splitter } from "antd";
import { RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { LaunchAttachmentSection } from "@/components/launch/LaunchAttachmentSection";
import { AutopilotLaunchEmptyState } from "@/components/launch/AutopilotLaunchEmptyState";
import { LaunchOperatorActionRail } from "@/components/launch/LaunchOperatorActionRail";
import { RoutePlanningOverlay } from "@/components/launch/RoutePlanningOverlay";
import { LaunchRuntimeMeta } from "@/components/launch/LaunchRuntimeMeta";
import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { CommandInput } from "@/components/nl-command/CommandInput";
import { GlowButton } from "@/components/ui/GlowButton";
import { Button } from "@/components/ui/button";
import {
  AUTOPILOT_LAUNCH_EXAMPLES,
  buildLaunchDestinationPreview,
  type AutopilotLaunchExample,
  type LaunchDestinationPreview,
} from "@/lib/autopilot-launch-examples";
import { useI18n } from "@/i18n";
import { CAN_USE_ADVANCED_RUNTIME } from "@/lib/deploy-target";
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
import { useAppStore } from "@/lib/store";
import { prepareWorkflowAttachments } from "@/lib/workflow-attachments";
import type { WorkflowLaunchResult } from "@/lib/workflow-store";
import { useWorkflowStore } from "@/lib/workflow-store";
import {
  submitUnifiedClarification,
  submitUnifiedLaunch,
} from "@/lib/unified-launch-coordinator";
import { cn } from "@/lib/utils";
import {
  MAX_WORKFLOW_ATTACHMENTS,
  type WorkflowInputAttachment,
} from "@shared/workflow-input";
import type { MissionOperatorActionType } from "@shared/mission/contracts";
import type {
  MissionOperatorActionLoadingMap,
  MissionTaskDetail,
} from "@/lib/tasks-store";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export function getUnifiedLaunchRouteHint(
  locale: string,
  kind: "clarify" | "mission" | "workflow" | "upgrade-required"
) {
  switch (kind) {
    case "workflow":
      return t(
        locale,
        "自动驾驶将选择深度路线：先进入高级编排，完成素材处理后回落到任务焦点。",
        "Autopilot will choose the deep route: enter advanced orchestration first, then return to the task focus."
      );
    case "upgrade-required":
      return t(
        locale,
        "自动驾驶判断这条路线需要高级执行环境，提交时会先切换运行时再继续。",
        "Autopilot determined this route needs the advanced runtime and will switch runtime before continuing."
      );
    case "clarify":
      return t(
        locale,
        "自动驾驶发现目的地信息不足，会先补问关键路标，再继续规划路线。",
        "Autopilot found the destination underspecified and will ask for key waypoints before planning the route."
      );
    default:
      return t(
        locale,
        "自动驾驶将选择快速路线：解析目的地后直接创建 mission 并开始推进。",
        "Autopilot will choose the fast route: parse the destination, create a mission, and start moving."
      );
  }
}

export function getUnifiedLaunchSubmitLabel(
  locale: string,
  options: {
    kind: "clarify" | "mission" | "workflow" | "upgrade-required";
    submitting: boolean;
  }
) {
  if (options.submitting) {
    return t(locale, "提交中...", "Submitting...");
  }
  if (options.kind === "upgrade-required") {
    return t(locale, "切到高级执行", "Switch to advanced");
  }
  if (options.kind === "workflow") {
    return t(locale, "自动驾驶发起", "Autopilot launch");
  }
  if (options.kind === "clarify") {
    return t(locale, "先补路标", "Clarify waypoints");
  }
  return t(locale, "规划路线", "Plan route");
}

export interface UnifiedWorkflowResolution extends WorkflowLaunchResult {
  directive: string;
  attachmentCount: number;
  requestedAt: number;
}

function getPreviewConfidenceClass(confidence: LaunchDestinationPreview["confidence"]) {
  if (confidence === "high") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (confidence === "medium") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function getPreviewConfidenceLabel(
  locale: string,
  confidence: LaunchDestinationPreview["confidence"]
) {
  if (confidence === "high") {
    return t(locale, "高置信", "High confidence");
  }
  if (confidence === "medium") {
    return t(locale, "中置信", "Medium confidence");
  }
  return t(locale, "需补路标", "Needs waypoints");
}

export const UNIFIED_LAUNCH_EXPLANATION_LAYER_MARKERS = [
  "destination-preview",
  "confidence",
  "attachment-influence",
  "missing-waypoints",
  "waypoints-complete",
] as const;

function getMissingFieldLabel(
  locale: string,
  field: LaunchDestinationPreview["missingFields"][number]
) {
  switch (field) {
    case "goal":
      return t(locale, "目标", "Goal");
    case "deliverable":
      return t(locale, "交付物", "Deliverable");
    case "constraints":
      return t(locale, "约束", "Constraints");
    case "timeline":
      return t(locale, "时间线", "Timeline");
    case "successCriteria":
      return t(locale, "成功标准", "Success criteria");
  }
}

function PreviewValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[12px] border border-white/80 bg-white/64 px-2 py-1.5">
      <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-stone-400">
        {label}
      </div>
      <div className="mt-0.5 line-clamp-2 text-[10px] font-semibold leading-4 text-stone-700">
        {value}
      </div>
    </div>
  );
}

function DestinationPreviewCard({
  preview,
  locale,
}: {
  preview: LaunchDestinationPreview;
  locale: string;
}) {
  const missingLabels = preview.missingFields.map(field =>
    getMissingFieldLabel(locale, field)
  );
  const constraintText =
    preview.constraints.length > 0
      ? preview.constraints.join(" / ")
      : t(locale, "暂未识别", "Not detected");
  const successText =
    preview.successCriteria.length > 0
      ? preview.successCriteria.join(" / ")
      : t(locale, "暂未识别", "Not detected");

  return (
    <div
      className="mt-2 rounded-[18px] border border-[#d8e6dd]/80 bg-[linear-gradient(135deg,rgba(247,253,249,0.94),rgba(255,248,239,0.82))] p-2 shadow-[0_12px_30px_rgba(75,105,85,0.08)] motion-reduce:transition-none"
      data-testid="autopilot-destination-preview-card"
      data-explanation-layer={UNIFIED_LAUNCH_EXPLANATION_LAYER_MARKERS[0]}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#267064]">
            {t(locale, "目的地预览", "Destination preview")}
          </div>
          <div className="mt-0.5 text-[10px] leading-4 text-stone-600">
            {t(
              locale,
              "先看系统理解到的目标、交付物和缺口，再选择路线发车。",
              "Review the interpreted goal, deliverable, and gaps before choosing a route."
            )}
          </div>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-1 text-[9px] font-semibold",
            getPreviewConfidenceClass(preview.confidence)
          )}
          data-explanation-layer={UNIFIED_LAUNCH_EXPLANATION_LAYER_MARKERS[1]}
        >
          {getPreviewConfidenceLabel(locale, preview.confidence)}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
        <PreviewValue label={t(locale, "目标", "Goal")} value={preview.goal} />
        <PreviewValue
          label={t(locale, "交付物", "Deliverable")}
          value={preview.deliverable}
        />
        <PreviewValue
          label={t(locale, "时间线", "Timeline")}
          value={preview.timeline ?? t(locale, "暂未识别", "Not detected")}
        />
        <PreviewValue
          label={t(locale, "推荐模式", "Route mode")}
          value={preview.route.mode}
        />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <PreviewValue
          label={t(locale, "约束", "Constraints")}
          value={constraintText}
        />
        <PreviewValue
          label={t(locale, "成功标准", "Success criteria")}
          value={successText}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-semibold">
        <span
          className="rounded-full border border-[#d8e6dd] bg-white/70 px-2 py-0.5 text-[#267064]"
          data-explanation-layer={UNIFIED_LAUNCH_EXPLANATION_LAYER_MARKERS[2]}
        >
          {preview.attachmentInfluence.summary}
        </span>
        {missingLabels.length > 0 ? (
          <span
            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700"
            data-explanation-layer={UNIFIED_LAUNCH_EXPLANATION_LAYER_MARKERS[3]}
          >
            {t(locale, "缺少：", "Missing: ")}
            {missingLabels.join(" / ")}
          </span>
        ) : (
          <span
            className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700"
            data-explanation-layer={UNIFIED_LAUNCH_EXPLANATION_LAYER_MARKERS[4]}
          >
            {t(locale, "目的地路标完整", "Destination waypoints complete")}
          </span>
        )}
      </div>
    </div>
  );
}

function LaunchDestinationExamples({
  locale,
  onSelect,
}: {
  locale: string;
  onSelect: (example: AutopilotLaunchExample) => void;
}) {
  return (
    <div className="mt-2 rounded-[18px] border border-[#ead8c3]/70 bg-[#fffaf4]/72 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a5d32]">
            {t(locale, "目的地示例", "Destination examples")}
          </div>
          <div className="mt-0.5 text-[10px] leading-4 text-stone-600">
            {t(
              locale,
              "不确定怎么输入时，先点一个示例；系统会填入目的地并立即生成路线预览。",
              "Pick an example to fill a destination and immediately preview routes."
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {AUTOPILOT_LAUNCH_EXAMPLES.map(example => (
          <button
            key={example.kind}
            type="button"
            className="group rounded-full border border-[#ead8c3]/80 bg-white/78 px-2.5 py-1 text-left text-[10px] font-semibold text-[#9a5d32] transition hover:border-[#d9a47c] hover:bg-[#fff7ed]"
            onClick={() => onSelect(example)}
            title={example.description}
          >
            {locale === "zh-CN" ? example.label : example.englishLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

export function UnifiedLaunchComposer({
  createMission,
  activeTaskTitle,
  activeTaskDetail,
  operatorActionLoading,
  onSubmitOperatorAction,
  onTaskResolved,
  onWorkflowResolved,
  onOpenCreateDialog,
  onRefresh,
  refreshing = false,
  compact = false,
  bare = false,
  dense = false,
  hideHeader = false,
  hideInputLabel = false,
  hideClarificationPanel = false,
  className,
}: {
  createMission: TaskHubCreateMission;
  activeTaskTitle?: string | null;
  activeTaskDetail?: MissionTaskDetail | null;
  operatorActionLoading?: MissionOperatorActionLoadingMap;
  onSubmitOperatorAction?: (payload: {
    action: MissionOperatorActionType;
    reason?: string;
  }) => void | Promise<void>;
  onTaskResolved?: (result: TaskHubCommandSubmissionResult) => void;
  onWorkflowResolved?: (result: UnifiedWorkflowResolution) => void;
  onOpenCreateDialog?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  compact?: boolean;
  bare?: boolean;
  dense?: boolean;
  hideHeader?: boolean;
  hideInputLabel?: boolean;
  hideClarificationPanel?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const taskHubSession = useNLCommandStore(
    useShallow(selectTaskHubLaunchSession)
  );
  const setDraftText = useNLCommandStore(state => state.setDraftText);
  const clearError = useNLCommandStore(state => state.clearError);
  const {
    draftText,
    currentDialog,
    currentCommand,
    commands,
    loading: loadingCommand,
  } = taskHubSession;
  const loadingWorkflow = useWorkflowStore(state => state.isSubmitting);
  const [attachments, setAttachments] = useState<WorkflowInputAttachment[]>([]);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] =
    useState<LaunchRouteCandidateId | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDense = dense;
  const isCompact = compact;
  const isBare = bare;
  const submitting = loadingCommand || loadingWorkflow || isPreparingFiles;

  const routePlan = useMemo(
    () =>
      buildLaunchRoutePlan({
        text: draftText,
        attachments,
        runtimeMode,
      }),
    [attachments, draftText, runtimeMode]
  );
  const decision = routePlan.decision;
  const selectedCandidate =
    routePlan.candidates.find(
      candidate => candidate.id === selectedRouteId && candidate.available
    ) ??
    routePlan.candidates.find(
      candidate => candidate.id === routePlan.recommendedRouteId
    ) ??
    routePlan.candidates[0];
  const hasDraftDestination =
    draftText.trim().length > 0 || attachments.length > 0;
  const destinationPreview = useMemo(
    () =>
      hasDraftDestination
        ? buildLaunchDestinationPreview({
            text: draftText,
            attachments,
            runtimeMode,
          })
        : null,
    [attachments, draftText, hasDraftDestination, runtimeMode]
  );
  const commandHistory = useMemo(
    () => commands.map(command => command.commandText),
    [commands]
  );

  const submitLabel = useMemo(() => {
    return getUnifiedLaunchSubmitLabel(locale, {
      kind: selectedCandidate?.launchKind ?? decision.kind,
      submitting,
    });
  }, [decision.kind, locale, selectedCandidate?.launchKind, submitting]);
  const hasActiveClarification = currentDialog?.status === "active";

  async function handleSubmit(
    commandText: string,
    routeIdOverride?: LaunchRouteCandidateId
  ) {
    clearError();
    if (!commandText.trim() || submitting) {
      return;
    }

    const submissionCandidate =
      routePlan.candidates.find(
        candidate => candidate.id === routeIdOverride && candidate.available
      ) ?? selectedCandidate;

    if (
      decision.kind === "upgrade-required" ||
      submissionCandidate?.launchKind === "upgrade-required"
    ) {
      if (!CAN_USE_ADVANCED_RUNTIME) {
        toast(
          t(
            locale,
            "当前部署只支持前端预览，无法切换到高级执行。",
            "This deployment only supports frontend preview and cannot switch to advanced execution."
          )
        );
        return;
      }

      await setRuntimeMode("advanced");
      toast.success(
        t(
          locale,
          "已切换到高级执行模式，再次提交即可真实执行。",
          "Switched to advanced runtime. Submit again to run for real."
        )
      );
      return;
    }

    try {
      const result = await submitUnifiedLaunch({
        text: commandText,
        attachments,
        runtimeMode,
        selectedRouteId: submissionCandidate?.id,
        userId: "current-user",
        priority: "medium",
      });

      if (result.route === "workflow") {
        onWorkflowResolved?.({
          workflowId: result.workflowId,
          missionId: result.missionId,
          deduped: result.deduped,
          directive: commandText,
          attachmentCount: attachments.length,
          requestedAt: Date.now(),
        });
        setAttachments([]);
        setAttachmentError(null);
        setDraftText("");
        toast.success(
          t(
            locale,
            result.missionId
              ? "已进入高级编排，并成功关联任务焦点。"
              : "已进入高级编排，正在等待任务焦点回落。",
            result.missionId
              ? "Advanced workflow started and linked back to the mission focus."
              : "Advanced workflow started and is waiting to link back to a mission."
          )
        );
        return;
      }

      if (
        result.route === "mission" &&
        result.status === "created" &&
        result.missionId
      ) {
        onTaskResolved?.({
          commandId: result.commandId,
          commandText,
          missionId: result.missionId,
          relatedMissionIds: [result.missionId],
          autoSelectedMissionId: result.missionId,
          status: "created",
          createdAt: Date.now(),
        });
        setAttachments([]);
        setAttachmentError(null);
        toast.success(
          t(
            locale,
            "智能入口已直接创建任务，并自动聚焦到新任务。",
            "The smart launcher created a mission directly and focused the new task."
          )
        );
        return;
      }

      toast(
        t(
          locale,
          "先补完下方问题，系统再继续创建任务。",
          "Answer the questions below and the system will continue creating the mission."
        )
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(locale, "统一发起失败。", "Unified launch failed.")
      );
    }
  }

  async function handleClarificationAnswer(
    questionId: string,
    text: string,
    selectedOptions?: string[]
  ) {
    if (!currentCommand) {
      return;
    }

    try {
      const result = await submitUnifiedClarification({
        commandId: currentCommand.commandId,
        answer: {
          questionId,
          text,
          selectedOptions,
          timestamp: Date.now(),
        },
      });

      if (
        result?.route === "mission" &&
        result.status === "created" &&
        result.missionId
      ) {
        onTaskResolved?.({
          commandId: result.commandId,
          commandText: currentCommand.commandText,
          missionId: result.missionId,
          relatedMissionIds: [result.missionId],
          autoSelectedMissionId: result.missionId,
          status: "created",
          createdAt: Date.now(),
        });
        toast.success(
          t(
            locale,
            "补充信息已完成，任务已经进入主队列。",
            "Clarification is complete and the mission has entered the queue."
          )
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(locale, "补充信息提交失败。", "Failed to submit clarification.")
      );
    }
  }

  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    setAttachmentError(null);
    setIsPreparingFiles(true);
    try {
      const prepared = await prepareWorkflowAttachments(files);
      let overflowed = false;
      setAttachments(current => {
        const seen = new Set(
          current.map(item => `${item.name}:${item.size}:${item.mimeType}`)
        );
        const next = [...current];
        for (const item of prepared) {
          const key = `${item.name}:${item.size}:${item.mimeType}`;
          if (seen.has(key)) {
            continue;
          }
          if (next.length >= MAX_WORKFLOW_ATTACHMENTS) {
            overflowed = true;
            break;
          }
          next.push(item);
          seen.add(key);
        }
        return next;
      });
      if (overflowed) {
        setAttachmentError(
          t(
            locale,
            `最多附件 ${MAX_WORKFLOW_ATTACHMENTS} 个，超出的文件已忽略。`,
            `Only ${MAX_WORKFLOW_ATTACHMENTS} attachments are allowed. Extra files were skipped.`
          )
        );
      }
    } catch (error) {
      setAttachmentError(
        error instanceof Error
          ? error.message
          : t(locale, "文件准备失败。", "Failed to prepare files.")
      );
    } finally {
      setIsPreparingFiles(false);
    }
  }

  async function handleExampleSelected(example: AutopilotLaunchExample) {
    clearError();
    setDraftText(example.input.text);
    setAttachments(example.input.attachments ?? []);
    setSelectedRouteId(example.routeId);
    setAttachmentError(null);
    if (example.input.runtimeMode !== runtimeMode) {
      await setRuntimeMode(example.input.runtimeMode);
    }
  }

  const composerInputShell = (
    <div className="rounded-[16px] bg-white/82 p-2.5">
      <CommandInput
        onSubmit={handleSubmit}
        loading={submitting}
        commandHistory={commandHistory}
        value={draftText}
        onTextChange={setDraftText}
        hideLabel={hideInputLabel}
        dense={isDense}
        rows={isCompact ? 2 : 3}
        placeholder={t(
          locale,
          "输入目的地：目标、约束、交付物、截止时间；系统会自动规划路线、组队、澄清并推进...",
          "Enter the destination: goal, constraints, deliverable, deadline. Autopilot plans the route, forms the fleet, clarifies, and drives..."
        )}
        submitLabel={submitLabel}
        sendingLabel={submitLabel}
        hideSubmitButton
      />

      {!hasDraftDestination ? (
        <AutopilotLaunchEmptyState
          locale={locale}
          onSelectExample={example => {
            void handleExampleSelected(example);
          }}
        />
      ) : null}

      {destinationPreview ? (
        <DestinationPreviewCard preview={destinationPreview} locale={locale} />
      ) : null}

      {hasDraftDestination ? (
        <RoutePlanningOverlay
          routePlan={routePlan}
          selectedRouteId={selectedCandidate?.id ?? selectedRouteId}
          locale={locale}
          onSelect={item => {
            if (item.available) {
              setSelectedRouteId(item.id);
            }
          }}
          onConfirmRoute={item => {
            if (item.available) {
              setSelectedRouteId(item.id);
              void handleSubmit(draftText, item.id);
            }
          }}
          confirming={submitting}
          confirmDisabled={!draftText.trim() || submitting}
        />
      ) : null}

      <LaunchRuntimeMeta
        locale={locale}
        runtimeMode={runtimeMode}
        attachmentCount={attachments.length}
        isPreparingFiles={isPreparingFiles}
        maxAttachments={MAX_WORKFLOW_ATTACHMENTS}
        onPickFiles={() => fileInputRef.current?.click()}
        operatorActionRail={
          activeTaskDetail ? (
            <LaunchOperatorActionRail
              detail={activeTaskDetail}
              loadingByAction={operatorActionLoading}
              onSubmitAction={onSubmitOperatorAction}
              trailingAction={
                <GlowButton
                  type="button"
                  disabled={!draftText.trim() || submitting}
                  className="h-7.5 shrink-0 rounded-full px-2.5 text-[11px] font-semibold shadow-[0_10px_24px_rgba(94,139,114,0.18)]"
                  onClick={() => void handleSubmit(draftText)}
                >
                  <Send className="size-3.5" />
                  {submitLabel}
                </GlowButton>
              }
            />
          ) : undefined
        }
        onSubmit={() => void handleSubmit(draftText)}
        submitLabel={submitLabel}
        submitDisabled={!draftText.trim() || submitting}
      />
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px] leading-4 text-stone-600 sm:grid-cols-4">
        {[
          t(locale, "目的地解析", "Destination"),
          t(locale, "路线规划", "Route"),
          t(locale, "编队执行", "Fleet"),
          t(locale, "接管/证据", "Takeover / Evidence"),
        ].map(item => (
          <span
            key={item}
            className="rounded-full border border-[#ead8c3]/80 bg-[#fff7ed]/78 px-2 py-0.5 text-center font-semibold text-[#9a5d32]"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <section
      className={cn(
        !isBare &&
          "rounded-[24px] border border-stone-200/70 bg-[linear-gradient(180deg,rgba(255,252,248,0.96),rgba(247,240,233,0.88))] shadow-[0_18px_40px_rgba(98,73,48,0.08)]",
        isBare ? "p-1" : isDense ? "p-3" : "p-4",
        className
      )}
    >
      {!hideHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              <Sparkles className="size-4" />
              {t(locale, "任务自动驾驶", "Task Autopilot")}
            </div>
            <div className="mt-1 text-sm text-stone-700">
              {activeTaskTitle
                ? t(
                    locale,
                    `围绕当前焦点“${activeTaskTitle}”输入目的地，系统会规划路线并在关键点请求接管。`,
                    `Enter a destination around "${activeTaskTitle}"; the system plans the route and asks for takeover at key points.`
                  )
                : t(
                    locale,
                    "像导航一样输入目的地：系统自动拆目标、选路线、组队执行，并保留可接管的证据轨迹。",
                    "Enter a destination like navigation: the system splits the goal, chooses a route, forms a fleet, and keeps takeover-ready evidence."
                  )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenCreateDialog ? (
              <Button
                type="button"
                variant="outline"
                onClick={onOpenCreateDialog}
              >
                {t(locale, "新建任务", "New task")}
              </Button>
            ) : null}
            {onRefresh ? (
              <Button
                type="button"
                variant="outline"
                disabled={refreshing}
                onClick={onRefresh}
              >
                <RefreshCw
                  className={cn("size-4", refreshing && "animate-spin")}
                />
                {t(locale, "刷新", "Refresh")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          hideHeader ? "" : isDense ? "mt-3" : "mt-4",
          isBare ? "space-y-2" : "space-y-3"
        )}
      >
        <LaunchAttachmentSection
          attachments={attachments}
          attachmentError={attachmentError}
          onRemoveAttachment={attachmentId =>
            setAttachments(current =>
              current.filter(item => item.id !== attachmentId)
            )
          }
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={event => void handleFilesSelected(event)}
        />

        {hasActiveClarification && currentDialog && !hideClarificationPanel ? (
          <Splitter
            layout="vertical"
            lazy
            className={cn(
              "launch-clarification-splitter min-h-0 rounded-[20px] border border-stone-200/75 bg-[linear-gradient(180deg,rgba(255,252,248,0.74),rgba(247,240,233,0.64))] p-2 shadow-[0_14px_34px_rgba(98,73,48,0.08)]",
              isDense ? "gap-2" : "gap-3"
            )}
          >
            <Splitter.Panel
              min={84}
              defaultSize="42%"
              collapsible={{ end: true, showCollapsibleIcon: true }}
            >
              <div className="min-h-0 overflow-y-auto pr-1">
                <ClarificationPanel
                  dialog={currentDialog}
                  onAnswer={handleClarificationAnswer}
                  className="bg-transparent"
                />
              </div>
            </Splitter.Panel>
            <Splitter.Panel min={168}>{composerInputShell}</Splitter.Panel>
          </Splitter>
        ) : (
          composerInputShell
        )}
      </div>
    </section>
  );
}
