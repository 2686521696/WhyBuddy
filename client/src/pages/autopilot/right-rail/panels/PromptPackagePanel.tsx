/**
 * Autopilot 驾驶舱右栏收敛 — `PromptPackagePanel`
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1（8 个 Sub_Stage_Panel 的规范落点与命名冻结）
 * - 需求 2.5（`PromptPackagePanel` 只接受 `{ jobId, specTree, effectPreviews, locale }`
 *   + 面板私有字段 `documents / initialPackages / onPackagesChange`）
 * - 需求 3（Rendering_Parity，零行为变更）
 * - 需求 5（`BlueprintProgressPanel` 组合化，`/specs` 兼容）
 * - 需求 6.1（`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时消费 Canonical_Panel_Directory）
 * - 需求 7（独立可合入、单面板 PR、回滚安全）
 * - 需求 8（单向依赖与循环 import 守卫）
 * - 需求 10（零后端契约变更 + 零 testid drift）
 *
 * 本文件从 `client/src/pages/specs/BlueprintProgressPanel.tsx::PromptPackageWorkbenchPanel`
 * （~行 1798–2270）逐字符搬运函数体，仅做以下调整：
 * 1. 组件更名为 `PromptPackagePanel`
 * 2. 签名切换到 `PromptPackagePanelProps = Pick<AutopilotRightRailProps, ...>` +
 *    面板私有字段 `documents / initialPackages / onPackagesChange`
 * 3. 必要的辅助函数与常量（`panelText` / `blueprintCopy` / `formatEffectPreviewDate` /
 *    `PROMPT_PLATFORM_OPTIONS` / `promptPlatformLabel` / `summarizePromptContent`）
 *    同步复制到本文件，保持 canonical panel 的独立可编译性
 *
 * 兼容性说明：
 * - 原 local function 的依赖数组、`useMemo / useState / useEffect / useCallback` 语义、
 *   JSX 结构、className 与 data-testid 均保持逐字符一致
 * - 辅助函数 `blueprintCopy / panelText / formatEffectPreviewDate` 在原实现里
 *   通过 `useAppStore.getState().locale` 读取 locale；canonical panel 禁止 import
 *   `@/lib/store`（需求 2.9 / 8.2），因此改为接收 `locale: AppLocale` 参数，
 *   `locale` 由 `AutopilotRightRailProps.locale` / `BlueprintProgressPanel` 组合时
 *   注入。输出行为等价。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";

import { Clipboard, RefreshCw, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ApiRequestError } from "@/lib/api-client";
import { blueprintCopy as translateBlueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import {
  fetchBlueprintPromptPackages,
  generateBlueprintPromptPackages,
  type BlueprintEffectPreviewSnapshot,
  type BlueprintPromptPackage,
  type BlueprintPromptTargetPlatform,
} from "@/lib/blueprint-api";
import type {
  BlueprintSpecDocument,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import type { AutopilotRightRailProps } from "@/pages/autopilot/right-rail/types";

/**
 * Spec 1 冻结的 `AutopilotRightRailProps` 字段子集，严格对应 design.md
 * 「面板抽离总表」第 5 行。
 *
 * 本面板额外接受三个 canonical-panel 私有字段：
 * - `documents`：对应原 local function 的 documents 参数；未传时从 `specTree.documents` 派生
 * - `initialPackages`：对应原 local function 的 `initialPackages` 参数
 * - `onPackagesChange`：对应原 local function 的 `onPackagesChange` 回调
 *
 * `<AutopilotRightRail>` 在 fabric stage 调用本面板时默认不传这三个字段，
 * 由 `BlueprintProgressPanel` 组合时注入。
 */
export type PromptPackagePanelProps = Pick<
  AutopilotRightRailProps,
  "jobId" | "specTree" | "effectPreviews" | "locale"
> & {
  /** 原 local function 支持的 documents 参数；未传时从 `specTree.documents` 派生 */
  documents?: BlueprintSpecDocument[];
  /** 原 local function 支持的 initialPackages 参数 */
  initialPackages?: BlueprintPromptPackage[];
  /** 原 local function 支持的 onPackagesChange 回调 */
  onPackagesChange?: (packages: BlueprintPromptPackage[]) => void;
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

function summarizePromptContent(promptPackage: BlueprintPromptPackage): string {
  if (promptPackage.content) return promptPackage.content;
  return promptPackage.sections
    .map(section => section.content)
    .filter(Boolean)
    .join("\n\n");
}
// endregion

/**
 * `PromptPackagePanel` —— 对应 `AutopilotRailSubStage === "prompt_package"`。
 *
 * 函数体逐字符搬运自 `BlueprintProgressPanel.tsx::PromptPackageWorkbenchPanel`，
 * 唯一差异：内部辅助函数 `panelText / blueprintCopy / formatEffectPreviewDate`
 * 从「读 store.locale」改为「接收 props.locale」，以满足需求 2.9 与 8.2
 * （canonical panel 禁止 import `@/lib/store`）。
 *
 * 原函数签名里的 `documents`（必传）被替换为可选 `documents` 字段；面板内部派生
 * `const documents = props.documents ?? props.specTree?.documents ?? [];`
 * 保持原 local function 语义。
 */
export const PromptPackagePanel: FC<PromptPackagePanelProps> = props => {
  const {
    specTree,
    jobId,
    effectPreviews,
    locale,
    initialPackages,
    onPackagesChange,
  } = props;
  const documents: BlueprintSpecDocument[] =
    props.documents ??
    ((specTree as (BlueprintSpecTree & { documents?: BlueprintSpecDocument[] }) | null)
      ?.documents ??
      []);

  if (!specTree) {
    return null;
  }

  return (
    <PromptPackagePanelInner
      specTree={specTree}
      jobId={jobId}
      documents={documents}
      effectPreviews={effectPreviews}
      initialPackages={initialPackages}
      onPackagesChange={onPackagesChange}
      locale={locale}
    />
  );
};

function PromptPackagePanelInner({
  specTree,
  jobId,
  documents,
  effectPreviews,
  initialPackages,
  onPackagesChange,
  locale,
}: {
  specTree: BlueprintSpecTree;
  jobId?: string | null;
  documents: BlueprintSpecDocument[];
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  initialPackages?: BlueprintPromptPackage[];
  onPackagesChange?: (packages: BlueprintPromptPackage[]) => void;
  locale: AppLocale;
}) {
  const packageNodes = useMemo(
    () =>
      specTree.nodes.filter(
        node =>
          node.type === "prompt_package" ||
          node.type === "effect_preview" ||
          node.type === "spec_document"
      ),
    [specTree.nodes]
  );
  const [packages, setPackages] = useState<BlueprintPromptPackage[]>(
    initialPackages ?? []
  );
  const [selectedPlatform, setSelectedPlatform] = useState<
    "all" | BlueprintPromptTargetPlatform
  >("all");
  const [selectedPackageId, setSelectedPackageId] = useState(
    initialPackages?.[0]?.id ?? ""
  );
  const [selectedNodeId, setSelectedNodeId] = useState(
    specTree.nodes.find(node => node.type === "prompt_package")?.id ??
      packageNodes[0]?.id ??
      specTree.rootNodeId
  );
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    setPackages(initialPackages ?? []);
    setSelectedPackageId(current =>
      initialPackages?.some(promptPackage => promptPackage.id === current)
        ? current
        : (initialPackages?.[0]?.id ?? "")
    );
  }, [initialPackages]);

  useEffect(() => {
    setSelectedNodeId(current =>
      specTree.nodes.some(node => node.id === current)
        ? current
        : (specTree.nodes.find(node => node.type === "prompt_package")?.id ??
          packageNodes[0]?.id ??
          specTree.rootNodeId)
    );
  }, [packageNodes, specTree.nodes, specTree.rootNodeId]);

  const filteredPackages = useMemo(
    () =>
      selectedPlatform === "all"
        ? packages
        : packages.filter(
            promptPackage => promptPackage.targetPlatform === selectedPlatform
          ),
    [packages, selectedPlatform]
  );
  const activePackage = useMemo(
    () =>
      filteredPackages.find(
        promptPackage => promptPackage.id === selectedPackageId
      ) ??
      filteredPackages[0] ??
      null,
    [filteredPackages, selectedPackageId]
  );
  const selectedNode = useMemo(
    () =>
      specTree.nodes.find(node => node.id === selectedNodeId) ??
      specTree.nodes.find(node => node.type === "prompt_package") ??
      specTree.nodes[0],
    [selectedNodeId, specTree.nodes]
  );
  const acceptedDocuments = useMemo(
    () =>
      documents.filter(
        document => (document.status ?? "draft").toLowerCase() === "accepted"
      ),
    [documents]
  );
  const boundDocuments = useMemo(() => {
    if (!activePackage?.sourceDocumentIds.length) return acceptedDocuments;
    const ids = new Set(activePackage.sourceDocumentIds);
    return documents.filter(document => ids.has(document.id));
  }, [acceptedDocuments, activePackage, documents]);
  const boundPreviews = useMemo(() => {
    if (!activePackage?.sourcePreviewIds.length) return effectPreviews;
    const ids = new Set(activePackage.sourcePreviewIds);
    return effectPreviews.filter(preview => ids.has(preview.id));
  }, [activePackage, effectPreviews]);
  const canGenerate =
    Boolean(jobId) &&
    (acceptedDocuments.length > 0 || effectPreviews.length > 0);

  const publishPackages = useCallback(
    (nextPackages: BlueprintPromptPackage[]) => {
      setPackages(nextPackages);
      setSelectedPackageId(current =>
        nextPackages.some(promptPackage => promptPackage.id === current)
          ? current
          : (nextPackages[0]?.id ?? "")
      );
      onPackagesChange?.(nextPackages);
    },
    [onPackagesChange]
  );

  const handleRefresh = useCallback(async () => {
    if (!jobId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchBlueprintPromptPackages(jobId);
      if (result.ok) {
        publishPackages(result.data.promptPackages);
      } else if (result.error.status === 404) {
        publishPackages([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }, [jobId, publishPackages]);

  const handleGenerate = useCallback(async () => {
    if (!jobId) return;

    setGenerating(true);
    setError(null);

    try {
      const result = await generateBlueprintPromptPackages(jobId, {
        nodeId: selectedNode?.id,
        targetPlatforms:
          selectedPlatform === "all"
            ? PROMPT_PLATFORM_OPTIONS.filter(option => option.id !== "all").map(
                option => option.id as BlueprintPromptTargetPlatform
              )
            : [selectedPlatform],
        includeDrafts: false,
        includePreviewDrafts: false,
      });
      if (result.ok) {
        publishPackages(result.data.promptPackages);
      } else if (result.error.status === 404) {
        publishPackages([]);
      } else {
        setError(result.error);
      }
    } finally {
      setGenerating(false);
    }
  }, [
    effectPreviews,
    jobId,
    publishPackages,
    selectedNode?.id,
    selectedPlatform,
  ]);

  useEffect(() => {
    if (!jobId || packages.length > 0) return;
    void handleRefresh();
  }, [handleRefresh, jobId, packages.length]);

  return (
    <div
      className="grid gap-3"
      data-testid="prompt-package-workbench"
    >
      {/* Header chrome removed: SubStageCard 已提供标题 / apiPath / summary / 状态胶囊 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-none border-[#CCCCCC] bg-white font-black text-black hover:bg-[#F3F3F3]"
            disabled={!jobId || loading || generating}
            onClick={handleRefresh}
            data-testid="prompt-package-refresh-button"
          >
            <RefreshCw
              className={cn("size-3.5", loading && "animate-spin")}
              aria-hidden="true"
            />
            {panelText("刷新", "Refresh", locale)}
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-none bg-black font-black text-white hover:bg-[#333]"
            disabled={!canGenerate || loading || generating}
            onClick={handleGenerate}
            data-testid="prompt-package-generate-button"
          >
            {generating ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            {panelText("生成提示词包", "Generate prompt package", locale)}
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

      <div
        className="mt-4 flex flex-wrap gap-2"
        data-testid="prompt-package-platform-filter"
      >
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
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
              onClick={() => {
                setSelectedPlatform(option.id);
                setSelectedPackageId("");
              }}
              aria-pressed={selected}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.25fr)]">
        <div className="rounded-[18px] border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("提示词包列表", "Prompt package list", locale)}
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
            >
              {panelText(
                `${filteredPackages.length} 个包`,
                `${filteredPackages.length} packages`,
                locale
              )}
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[320px] pr-2">
            <div className="grid gap-2" data-testid="prompt-package-list">
              {filteredPackages.length ? (
                filteredPackages.map(promptPackage => {
                  const selected = activePackage?.id === promptPackage.id;
                  return (
                    <button
                      key={promptPackage.id}
                      type="button"
                      className={cn(
                        "w-full rounded-[14px] border px-3 py-3 text-left transition",
                        selected
                          ? "border-slate-950 bg-slate-100"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                      )}
                      onClick={() => setSelectedPackageId(promptPackage.id)}
                      aria-pressed={selected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-black text-slate-900">
                          {blueprintCopy(promptPackage.title, locale)}
                        </span>
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                          {promptPlatformLabel(promptPackage.targetPlatform)}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(promptPackage.summary, locale)}
                      </div>
                      <div className="mt-2 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        {formatEffectPreviewDate(
                          promptPackage.updatedAt ?? promptPackage.createdAt,
                          locale
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  {panelText(
                    "暂无提示词包。效果预演就绪后即可生成提示词包。",
                    "No prompt package yet. Generate one after effect previews are ready.",
                    locale
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("来源文档 / 预演", "Source docs / previews", locale)}
            </div>
            <div className="mt-2 grid gap-2">
              <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                  {panelText("文档", "Docs", locale)}
                </div>
                <div className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                  {boundDocuments.length
                    ? boundDocuments
                        .slice(0, 3)
                        .map(document => blueprintCopy(document.title, locale))
                        .join(" / ")
                    : panelText(
                        "已接受文档会绑定到这里。",
                        "Accepted documents will bind here.",
                        locale
                      )}
                </div>
              </div>
              <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                  {panelText("预演", "Previews", locale)}
                </div>
                <div className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                  {boundPreviews.length
                    ? boundPreviews
                        .slice(0, 3)
                        .map(preview => blueprintCopy(preview.summary, locale))
                        .join(" / ")
                    : panelText(
                        "效果预演会绑定到这里。",
                        "Effect previews will bind here.",
                        locale
                      )}
                </div>
              </div>
              <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                  {panelText("目标节点", "Target node", locale)}
                </div>
                <div className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                  {selectedNode?.title
                    ? blueprintCopy(selectedNode.title, locale)
                    : panelText(
                        "实现提示词包",
                        "Implementation prompt package",
                        locale
                      )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <Clipboard className="size-3.5" aria-hidden="true" />
                  {panelText("提示词内容", "Prompt content", locale)}
                </div>
                <h4 className="mt-2 truncate text-base font-black text-slate-950">
                  {activePackage?.title
                    ? blueprintCopy(activePackage.title, locale)
                    : panelText(
                        "提示词包已就绪",
                        "Prompt package ready",
                        locale
                      )}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
              >
                {activePackage
                  ? promptPlatformLabel(activePackage.targetPlatform)
                  : panelText("未选择平台", "No platform selected", locale)}
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {activePackage?.summary
                ? blueprintCopy(activePackage.summary, locale)
                : panelText(
                    "工作台已连接，正在等待后端提示词包内容。",
                    "Workbench is connected and waiting for backend prompt package content.",
                    locale
                  )}
            </p>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("分段预览", "Section preview", locale)}
            </div>
            {activePackage?.sections.length ? (
              <div
                className="mt-3 grid gap-2"
                data-testid="prompt-package-sections-preview"
              >
                {activePackage.sections.map(section => (
                  <div
                    key={section.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="text-sm font-black text-slate-900">
                      {blueprintCopy(section.title, locale)}
                    </div>
                    <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs font-semibold leading-5 text-slate-500">
                      {blueprintCopy(section.content || section.summary, locale)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                {panelText(
                  "生成后会在这里显示提示词分段。",
                  "Prompt sections will appear here after generation.",
                  locale
                )}
              </div>
            )}
          </div>

          <pre
            className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[16px] border border-slate-200 bg-slate-950 p-4 text-xs font-semibold leading-6 text-slate-100"
            data-testid="prompt-package-content-preview"
          >
            {activePackage
              ? blueprintCopy(summarizePromptContent(activePackage), locale)
              : panelText(
                  "生成提示词包后可预览可直接复制的实现提示词。",
                  "Generate a prompt package to preview copy-ready implementation prompts.",
                  locale
                )}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default PromptPackagePanel;
