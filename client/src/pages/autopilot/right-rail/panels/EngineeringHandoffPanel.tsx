/**
 * Autopilot 驾驶舱右栏收敛 — `EngineeringHandoffPanel`
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1（8 个 Sub_Stage_Panel 的规范落点与命名冻结）
 * - 需求 2.7（`EngineeringHandoffPanel` 只接受 `{ jobId, locale }` +
 *   面板私有字段 `promptPackages / initialPlans / initialRuns /
 *   onLandingPlansChange / onEngineeringRunsChange`）
 * - 需求 3（Rendering_Parity，零行为变更）
 * - 需求 5（`BlueprintProgressPanel` 组合化，`/specs` 兼容）
 * - 需求 6.1（`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时消费 Canonical_Panel_Directory）
 * - 需求 7（独立可合入、单面板 PR、回滚安全）
 * - 需求 8（单向依赖与循环 import 守卫）
 * - 需求 10（零后端契约变更 + 零 testid drift）
 *
 * 本文件从 `client/src/pages/specs/BlueprintProgressPanel.tsx::EngineeringLandingWorkbenchPanel`
 * （~行 1800–2549）逐字符搬运函数体，并按 design.md「面板抽离总表」第 7 行
 * 把组件名从 `EngineeringLandingWorkbenchPanel` 更名为 `EngineeringHandoffPanel`
 * （对齐 `AutopilotRailSubStage === "engineering_handoff"` 契约）。
 *
 * 调整点：
 * 1. 组件更名为 `EngineeringHandoffPanel`
 * 2. 签名切换到 `EngineeringHandoffPanelProps = Pick<AutopilotRightRailProps, "jobId" | "locale">`
 *    + 面板私有字段 `promptPackages / initialPlans / initialRuns /
 *    onLandingPlansChange / onEngineeringRunsChange`
 * 3. 必要的辅助函数与常量（`panelText` / `blueprintCopy` / `formatEffectPreviewDate` /
 *    `parseWorkbenchLines` / `engineeringRunStatusLabel` / `PROMPT_PLATFORM_OPTIONS` /
 *    `promptPlatformLabel` / `ENGINEERING_RUN_STATUS_OPTIONS`）同步复制到本文件，
 *    保持 canonical panel 的独立可编译性
 *
 * 兼容性说明：
 * - 原 local function 的依赖数组、`useMemo / useState / useEffect / useCallback` 语义、
 *   JSX 结构、className 与 data-testid 均保持逐字符一致
 * - 辅助函数 `blueprintCopy / panelText / formatEffectPreviewDate /
 *   engineeringRunStatusLabel` 在原实现里通过 `useAppStore.getState().locale`
 *   读取 locale；canonical panel 禁止 import `@/lib/store`（需求 2.9 / 8.2），
 *   因此改为接收 `locale: AppLocale` 参数，`locale` 由
 *   `AutopilotRightRailProps.locale` / `BlueprintProgressPanel` 组合时注入。
 *   输出行为等价。
 * - `ENGINEERING_RUN_STATUS_OPTIONS` 的 label 在原实现里为中文字面量，
 *   保持逐字符一致（未做 locale 化，与原行为等价）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";

import {
  CheckCircle2,
  Clipboard,
  ListChecks,
  PackageCheck,
  PlayCircle,
  RefreshCw,
  Send,
  Terminal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ApiRequestError } from "@/lib/api-client";
import { blueprintCopy as translateBlueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import {
  createBlueprintEngineeringRun,
  fetchBlueprintEngineeringLanding,
  fetchBlueprintEngineeringRuns,
  generateBlueprintEngineeringLanding,
  type BlueprintEngineeringLandingPlan,
  type BlueprintEngineeringRun,
  type BlueprintEngineeringRunStatus,
  type BlueprintPromptPackage,
  type BlueprintPromptTargetPlatform,
} from "@/lib/blueprint-api";

import type { AutopilotRightRailProps } from "@/pages/autopilot/right-rail/types";

import { HandoffTrustBundle } from "./handoff-trust/HandoffTrustBundle";

/**
 * Spec 1 冻结的 `AutopilotRightRailProps` 字段子集，严格对应 design.md
 * 「面板抽离总表」第 7 行：`Pick<AutopilotRightRailProps, "jobId" | "locale">`。
 *
 * 本面板额外接受 canonical-panel 私有字段：
 * - `promptPackages`：对应原 local function 的 `promptPackages` 参数；
 *   未传时默认空数组
 * - `initialPlans`：对应原 local function 的 `initialPlans` 参数
 * - `initialRuns`：对应原 local function 的 `initialRuns` 参数
 * - `onLandingPlansChange` / `onEngineeringRunsChange`：对应原 local function 的回写回调
 *
 * `<AutopilotRightRail>` 在 fabric stage 调用本面板时默认不传这组字段，
 * 由 `BlueprintProgressPanel` 组合时注入。
 */
export type EngineeringHandoffPanelProps = Pick<
  AutopilotRightRailProps,
  "jobId" | "locale"
> & {
  promptPackages?: BlueprintPromptPackage[];
  initialPlans?: BlueprintEngineeringLandingPlan[];
  initialRuns?: BlueprintEngineeringRun[];
  onLandingPlansChange?: (plans: BlueprintEngineeringLandingPlan[]) => void;
  onEngineeringRunsChange?: (runs: BlueprintEngineeringRun[]) => void;
};

// region Helpers: locale-aware copy 工具
function blueprintCopy(value: string | undefined, locale: AppLocale): string {
  return translateBlueprintCopy(value, locale);
}

function panelText(zh: string, en: string, locale: AppLocale): string {
  return locale === "zh-CN" ? zh : en;
}

function formatGeneratedAt(value: string, locale: AppLocale): string {
  if (!value) return locale === "zh-CN" ? "待同步" : "Pending sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatEffectPreviewDate(
  value: string | undefined,
  locale: AppLocale
): string {
  if (!value) return locale === "zh-CN" ? "预览草稿" : "Preview draft";
  return formatGeneratedAt(value, locale);
}

function parseWorkbenchLines(value: string): string[] {
  return value
    .split(/\r?\n|;/)
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function engineeringRunStatusLabel(
  status: BlueprintEngineeringRunStatus,
  locale: AppLocale
): string {
  const translated = blueprintCopy(status, locale);
  if (translated !== status) return translated;

  return status
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
// endregion

// region Helpers: prompt platform options
const PROMPT_PLATFORM_OPTIONS: Array<{
  id: "all" | BlueprintPromptTargetPlatform;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "cursor", label: "Cursor" },
  { id: "kiro", label: "Kiro" },
  { id: "trae", label: "Trae" },
  { id: "windsurf", label: "Windsurf" },
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
];

function promptPlatformLabel(platform: BlueprintPromptTargetPlatform): string {
  return (
    PROMPT_PLATFORM_OPTIONS.find(option => option.id === platform)?.label ??
    platform
  );
}
// endregion

// region Engineering run status options
const ENGINEERING_RUN_STATUS_OPTIONS: Array<{
  id: BlueprintEngineeringRunStatus;
  label: string;
}> = [
  { id: "passed", label: "通过" },
  { id: "running", label: "进行中" },
  { id: "failed", label: "失败" },
  { id: "blocked", label: "阻塞" },
  { id: "completed", label: "已完成" },
  { id: "planned", label: "计划中" },
];
// endregion

/**
 * `EngineeringHandoffPanel` —— 对应 `AutopilotRailSubStage === "engineering_handoff"`。
 *
 * 函数体逐字符搬运自 `BlueprintProgressPanel.tsx::EngineeringLandingWorkbenchPanel`，
 * 组件更名为 `EngineeringHandoffPanel`，并把内部辅助函数
 * `panelText / blueprintCopy / formatEffectPreviewDate / engineeringRunStatusLabel`
 * 从「读 store.locale」改为「接收 props.locale」，以满足需求 2.9 与 8.2
 * （canonical panel 禁止 import `@/lib/store`）。
 *
 * `promptPackages` 在 `<AutopilotRightRail>` 直接渲染路径中为可选；
 * 顶层包装内部将其默认为 `[]`，与原 local function 在无上游 promptPackages
 * 时的降级语义一致（此时 `handleGenerateLanding` / UI 仍可运作，仅无
 * prompt 包可选）。
 */
export const EngineeringHandoffPanel: FC<EngineeringHandoffPanelProps> = ({
  jobId,
  locale,
  promptPackages,
  initialPlans,
  initialRuns,
  onLandingPlansChange,
  onEngineeringRunsChange,
}) => {
  return (
    <EngineeringHandoffPanelInner
      jobId={jobId}
      promptPackages={promptPackages ?? []}
      initialPlans={initialPlans}
      initialRuns={initialRuns}
      onLandingPlansChange={onLandingPlansChange}
      onEngineeringRunsChange={onEngineeringRunsChange}
      locale={locale}
    />
  );
};

function EngineeringHandoffPanelInner({
  jobId,
  promptPackages,
  initialPlans,
  initialRuns,
  onLandingPlansChange,
  onEngineeringRunsChange,
  locale,
}: {
  jobId?: string | null;
  promptPackages: BlueprintPromptPackage[];
  initialPlans?: BlueprintEngineeringLandingPlan[];
  initialRuns?: BlueprintEngineeringRun[];
  onLandingPlansChange?: (plans: BlueprintEngineeringLandingPlan[]) => void;
  onEngineeringRunsChange?: (runs: BlueprintEngineeringRun[]) => void;
  locale: AppLocale;
}) {
  const [plans, setPlans] = useState<BlueprintEngineeringLandingPlan[]>(
    initialPlans ?? []
  );
  const [runs, setRuns] = useState<BlueprintEngineeringRun[]>(
    initialRuns ?? []
  );
  const [selectedPlanId, setSelectedPlanId] = useState(
    initialPlans?.[0]?.id ?? ""
  );
  const [selectedPromptPackageId, setSelectedPromptPackageId] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<
    "all" | BlueprintPromptTargetPlatform
  >("all");
  const [runStatus, setRunStatus] =
    useState<BlueprintEngineeringRunStatus>("passed");
  const [runSummary, setRunSummary] = useState("");
  const [runLogs, setRunLogs] = useState("");
  const [runVerification, setRunVerification] = useState("");
  const [runChangedFiles, setRunChangedFiles] = useState("");
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    setPlans(initialPlans ?? []);
    setSelectedPlanId(current =>
      initialPlans?.some(plan => plan.id === current)
        ? current
        : (initialPlans?.[0]?.id ?? "")
    );
  }, [initialPlans]);

  useEffect(() => {
    setRuns(initialRuns ?? []);
  }, [initialRuns]);

  const activePlan = useMemo(
    () => plans.find(plan => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );
  const selectedPromptPackage = useMemo(
    () =>
      promptPackages.find(
        promptPackage => promptPackage.id === selectedPromptPackageId
      ) ?? null,
    [promptPackages, selectedPromptPackageId]
  );
  const activePlanPackageIds = useMemo(() => {
    if (!activePlan) return [];
    return Array.from(
      new Set(
        [activePlan.promptPackageId, ...activePlan.sourcePromptPackageIds]
          .map(value => value ?? "")
          .filter(Boolean)
      )
    );
  }, [activePlan]);
  const boundPromptPackages = useMemo(() => {
    if (!activePlanPackageIds.length) return [];
    const ids = new Set(activePlanPackageIds);
    return promptPackages.filter(promptPackage => ids.has(promptPackage.id));
  }, [activePlanPackageIds, promptPackages]);
  const planRuns = useMemo(() => {
    if (!activePlan) return runs;
    return runs.filter(
      run => !run.landingPlanId || run.landingPlanId === activePlan.id
    );
  }, [activePlan, runs]);
  const canGenerateLanding = Boolean(jobId);
  const canRecordRun = Boolean(jobId && activePlan && runSummary.trim());

  const publishPlans = useCallback(
    (nextPlans: BlueprintEngineeringLandingPlan[]) => {
      setPlans(nextPlans);
      setSelectedPlanId(current =>
        nextPlans.some(plan => plan.id === current)
          ? current
          : (nextPlans[0]?.id ?? "")
      );
      onLandingPlansChange?.(nextPlans);
    },
    [onLandingPlansChange]
  );

  const publishRuns = useCallback(
    (nextRuns: BlueprintEngineeringRun[]) => {
      setRuns(nextRuns);
      onEngineeringRunsChange?.(nextRuns);
    },
    [onEngineeringRunsChange]
  );

  const handleRefreshLanding = useCallback(async () => {
    if (!jobId) return;

    setLoadingPlans(true);
    setError(null);

    try {
      const result = await fetchBlueprintEngineeringLanding(jobId);
      if (result.ok) {
        publishPlans(result.data.landingPlans);
      } else if (result.error.status === 404) {
        publishPlans([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoadingPlans(false);
    }
  }, [jobId, publishPlans]);

  const handleRefreshRuns = useCallback(async () => {
    if (!jobId) return;

    setLoadingRuns(true);
    setError(null);

    try {
      const result = await fetchBlueprintEngineeringRuns(jobId);
      if (result.ok) {
        publishRuns(result.data.engineeringRuns);
      } else if (result.error.status === 404) {
        publishRuns([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoadingRuns(false);
    }
  }, [jobId, publishRuns]);

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([handleRefreshLanding(), handleRefreshRuns()]);
  }, [handleRefreshLanding, handleRefreshRuns]);

  const handleGenerateLanding = useCallback(async () => {
    if (!jobId) return;

    setGenerating(true);
    setError(null);

    try {
      const result = await generateBlueprintEngineeringLanding(jobId, {
        promptPackageId: selectedPromptPackageId || undefined,
        platform: selectedPlatform === "all" ? undefined : selectedPlatform,
      });
      if (result.ok) {
        publishPlans(result.data.landingPlans);
      } else if (result.error.status === 404) {
        publishPlans([]);
      } else {
        setError(result.error);
      }
    } finally {
      setGenerating(false);
    }
  }, [jobId, publishPlans, selectedPlatform, selectedPromptPackageId]);

  const handleRecordRun = useCallback(async () => {
    if (!jobId || !activePlan || !runSummary.trim()) return;

    setRecording(true);
    setError(null);

    const verificationResults = parseWorkbenchLines(runVerification).map(
      (item, index) => ({
        title: item,
        command: activePlan.verificationCommands[index]?.command ?? "",
        status: runStatus,
        summary: item,
      })
    );

    try {
      const result = await createBlueprintEngineeringRun(jobId, {
        landingPlanId: activePlan.id,
        status: runStatus,
        summary: runSummary.trim(),
        logs: parseWorkbenchLines(runLogs),
        verificationResults,
        changedFiles: parseWorkbenchLines(runChangedFiles),
      });
      if (result.ok) {
        const nextRuns = [
          result.data.engineeringRun,
          ...runs.filter(run => run.id !== result.data.engineeringRun.id),
        ];
        publishRuns(nextRuns);

        if (result.data.landingPlan) {
          publishPlans([
            result.data.landingPlan,
            ...plans.filter(plan => plan.id !== result.data.landingPlan?.id),
          ]);
        }

        setRunSummary("");
        setRunLogs("");
        setRunVerification("");
        setRunChangedFiles("");
      } else {
        setError(result.error);
      }
    } finally {
      setRecording(false);
    }
  }, [
    activePlan,
    jobId,
    plans,
    publishPlans,
    publishRuns,
    runChangedFiles,
    runLogs,
    runStatus,
    runSummary,
    runVerification,
    runs,
  ]);

  useEffect(() => {
    if (!jobId || plans.length > 0) return;
    void handleRefreshLanding();
  }, [handleRefreshLanding, jobId, plans.length]);

  useEffect(() => {
    if (!jobId || runs.length > 0) return;
    void handleRefreshRuns();
  }, [handleRefreshRuns, jobId, runs.length]);

  return (
    <div className="grid gap-3" data-testid="engineering-landing-workbench">
      {/* autopilot-v4-frontend-alignment 任务 56–58：信任层交付包（校验台账摘要 +
          可追溯矩阵 + 未决项），作为附加 section 挂在交付工作台顶部；缺数据时
          优雅省略，既有 spec md/zip 导出与落地计划逻辑保持不变。 */}
      {jobId ? <HandoffTrustBundle jobId={jobId} locale={locale} /> : null}

      {/* Header chrome removed: SubStageCard 已提供标题 / apiPath / summary / 状态胶囊 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="gap-2 rounded-none border-[#CCCCCC] bg-white font-black text-black hover:bg-[#F3F3F3]"
          disabled={!jobId || loadingPlans || loadingRuns || generating}
          onClick={handleRefreshAll}
          data-testid="engineering-landing-refresh-button"
        >
          <RefreshCw
            className={cn(
              "size-3.5",
              (loadingPlans || loadingRuns) && "animate-spin"
            )}
            aria-hidden="true"
          />
          {panelText("刷新", "Refresh", locale)}
        </Button>
        <Button
          type="button"
          className="gap-2 rounded-none bg-black font-black text-white hover:bg-[#333]"
          disabled={!canGenerateLanding || loadingPlans || generating}
          onClick={handleGenerateLanding}
          data-testid="engineering-landing-generate-button"
        >
          {generating ? (
            <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-3.5" aria-hidden="true" />
          )}
          {panelText("生成落地计划", "Generate landing plan", locale)}
        </Button>
      </div>

      {error ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <div className="font-black text-rose-950">{error.message}</div>
          <p className="mt-1 font-semibold leading-6 text-rose-700">
            {error.detail}
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
          {panelText("提示词来源", "Prompt source", locale)}
          <select
            value={selectedPromptPackageId}
            onChange={event => setSelectedPromptPackageId(event.target.value)}
            className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
            data-testid="engineering-landing-package-select"
          >
            <option value="">
              {panelText("全部提示词包", "All prompt packages", locale)}
            </option>
            {promptPackages.map(promptPackage => (
              <option key={promptPackage.id} value={promptPackage.id}>
                {promptPlatformLabel(promptPackage.targetPlatform)} /{" "}
                {blueprintCopy(promptPackage.title, locale)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap content-end gap-2">
          {PROMPT_PLATFORM_OPTIONS.map(option => {
            const selected = selectedPlatform === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-black transition",
                  selected
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                )}
                onClick={() => setSelectedPlatform(option.id)}
                aria-pressed={selected}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(240px,0.78fr)_minmax(0,1.22fr)]">
        <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("落地计划", "Landing plans", locale)}
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
            >
              {panelText(
                `${plans.length} 个计划`,
                `${plans.length} plans`,
                locale
              )}
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[340px] pr-2">
            <div
              className="grid gap-2"
              data-testid="engineering-landing-plan-list"
            >
              {plans.length ? (
                plans.map(plan => {
                  const selected = activePlan?.id === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      className={cn(
                        "w-full rounded-[14px] border px-3 py-3 text-left transition",
                        selected
                          ? "border-slate-950 bg-white"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                      onClick={() => setSelectedPlanId(plan.id)}
                      aria-pressed={selected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-black text-slate-900">
                          {blueprintCopy(plan.title, locale)}
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                          {promptPlatformLabel(plan.platform)}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(plan.summary, locale)}
                      </div>
                      <div className="mt-2 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        {formatEffectPreviewDate(
                          plan.updatedAt ?? plan.createdAt,
                          locale
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  {panelText(
                    "暂无工程落地计划。提示词包就绪后即可生成落地计划。",
                    "No engineering landing plan yet. Generate one after prompt packages are ready.",
                    locale
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-3 rounded-[14px] border border-slate-200 bg-white px-3 py-3">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("提示词包绑定", "Prompt package binding", locale)}
            </div>
            <div className="mt-2 text-xs font-semibold leading-5 text-slate-600">
              {boundPromptPackages.length
                ? boundPromptPackages
                    .slice(0, 3)
                    .map(promptPackage =>
                      blueprintCopy(promptPackage.title, locale)
                    )
                    .join(" / ")
                : selectedPromptPackage
                  ? blueprintCopy(selectedPromptPackage.title, locale)
                  : panelText(
                      "提示词包交接会绑定到这里。",
                      "Prompt package handoff will bind here.",
                      locale
                    )}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <Clipboard className="size-3.5" aria-hidden="true" />
                  {panelText("落地详情", "Landing details", locale)}
                </div>
                <h4 className="mt-2 text-base font-black text-slate-950">
                  {activePlan?.title
                    ? blueprintCopy(activePlan.title, locale)
                    : panelText(
                        "工程落地已就绪",
                        "Engineering landing ready",
                        locale
                      )}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
              >
                {activePlan
                  ? promptPlatformLabel(activePlan.platform)
                  : panelText("未选择计划", "No plan selected", locale)}
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {activePlan?.summary
                ? blueprintCopy(activePlan.summary, locale)
                : panelText(
                    "工作台已连接，正在等待工程落地内容。",
                    "Workbench is connected and waiting for engineering landing content.",
                    locale
                  )}
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <PackageCheck className="size-3.5" aria-hidden="true" />
                {panelText("平台交接", "Platform handoffs", locale)}
              </div>
              {activePlan?.handoffs.length ? (
                <div
                  className="mt-3 grid gap-2"
                  data-testid="engineering-platform-handoffs"
                >
                  {activePlan.handoffs.map(handoff => (
                    <div
                      key={handoff.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black text-slate-900">
                          {blueprintCopy(handoff.label, locale)}
                        </div>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                          {promptPlatformLabel(handoff.platform)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(handoff.summary, locale)}
                      </div>
                      {handoff.instructions.length ? (
                        <ul className="mt-2 grid gap-1">
                          {handoff.instructions.slice(0, 4).map(instruction => (
                            <li
                              key={`${handoff.id}-${instruction}`}
                              className="text-xs font-semibold leading-5 text-slate-600"
                            >
                              {blueprintCopy(instruction, locale)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                  {panelText(
                    "生成落地计划后，平台交接会显示在这里。",
                    "Platform handoffs will appear here after a landing plan is generated.",
                    locale
                  )}
                </div>
              )}
            </div>

            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <ListChecks className="size-3.5" aria-hidden="true" />
                步骤
              </div>
              {activePlan?.steps.length ? (
                <div
                  className="mt-3 grid gap-2"
                  data-testid="engineering-landing-steps"
                >
                  {activePlan.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black text-slate-900">
                          {index + 1}. {blueprintCopy(step.title, locale)}
                        </div>
                        {step.status ? (
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                            {blueprintCopy(step.status, locale)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(step.summary, locale)}
                      </div>
                      {step.commands.length ? (
                        <div className="mt-2 grid gap-1">
                          {step.commands.slice(0, 3).map(command => (
                            <code
                              key={`${step.id}-${command}`}
                              className="rounded-[10px] bg-slate-950 px-2 py-1 text-[11px] font-semibold text-slate-100"
                            >
                              {command}
                            </code>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                  {panelText(
                    "生成落地计划后，工程步骤会显示在这里。",
                    "Engineering steps will appear here after a landing plan is generated.",
                    locale
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
              <Terminal className="size-3.5" aria-hidden="true" />
              验证命令
            </div>
            {activePlan?.verificationCommands.length ? (
              <div
                className="mt-3 grid gap-2"
                data-testid="engineering-verification-commands"
              >
                {activePlan.verificationCommands.map(command => (
                  <div
                    key={command.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="text-sm font-black text-slate-900">
                      {blueprintCopy(command.title, locale)}
                    </div>
                    <code className="mt-2 block overflow-auto rounded-[10px] bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-100">
                      {command.command}
                    </code>
                    {command.expected ? (
                      <div className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(command.expected, locale)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                {panelText(
                  "生成落地计划后，验证命令会显示在这里。",
                  "Verification commands will appear here after a landing plan is generated.",
                  locale
                )}
              </div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)]">
            <div
              className="rounded-[16px] border border-slate-200 bg-white p-4"
              data-testid="engineering-run-recorder"
            >
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <PlayCircle className="size-3.5" aria-hidden="true" />
                执行记录器
              </div>
              <div className="mt-3 grid gap-3">
                <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                  状态
                  <select
                    value={runStatus}
                    onChange={event =>
                      setRunStatus(
                        event.target.value as BlueprintEngineeringRunStatus
                      )
                    }
                    className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  >
                    {ENGINEERING_RUN_STATUS_OPTIONS.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <textarea
                  value={runSummary}
                  onChange={event => setRunSummary(event.target.value)}
                  className="min-h-[76px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-400"
                  placeholder="执行摘要"
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <textarea
                    value={runLogs}
                    onChange={event => setRunLogs(event.target.value)}
                    className="min-h-[76px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                    placeholder="日志"
                  />
                  <textarea
                    value={runVerification}
                    onChange={event => setRunVerification(event.target.value)}
                    className="min-h-[76px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                    placeholder="验证结果"
                  />
                  <textarea
                    value={runChangedFiles}
                    onChange={event => setRunChangedFiles(event.target.value)}
                    className="min-h-[76px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                    placeholder="变更文件"
                  />
                </div>
                <Button
                  type="button"
                  className="w-fit gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
                  disabled={!canRecordRun || recording}
                  onClick={handleRecordRun}
                  data-testid="engineering-run-record-button"
                >
                  {recording ? (
                    <RefreshCw
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  )}
                  记录执行
                </Button>
              </div>
            </div>

            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-black uppercase tracking-normal text-slate-500">
                  工程执行记录
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
                >
                  {planRuns.length} 条记录
                </Badge>
              </div>
              <div
                className="mt-3 grid gap-2"
                data-testid="engineering-run-list"
              >
                {planRuns.length ? (
                  planRuns.map(run => (
                    <div
                      key={run.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-black text-slate-900">
                          {engineeringRunStatusLabel(run.status, locale)}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                          {formatEffectPreviewDate(
                            run.recordedAt ?? run.updatedAt ?? run.createdAt,
                            locale
                          )}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(run.summary, locale)}
                      </div>
                      {run.changedFiles.length ? (
                        <div className="mt-2 text-[11px] font-semibold leading-5 text-slate-600">
                          {run.changedFiles.slice(0, 3).join(" / ")}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                    {panelText(
                      "暂无工程执行记录。",
                      "No engineering run records yet.",
                      locale
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
