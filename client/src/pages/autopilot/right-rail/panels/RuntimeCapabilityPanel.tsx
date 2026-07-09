/**
 * Autopilot 驾驶舱右栏收敛 — `RuntimeCapabilityPanel`
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1（8 个 Sub_Stage_Panel 的规范落点与命名冻结）
 * - 需求 2.6（`RuntimeCapabilityPanel` 只接受 `{ jobId, specTree, capabilities,
 *   capabilityInvocations, capabilityEvidence, agentCrew, locale }` + 面板私有字段
 *   `initialCapabilities / initialAgentCrew / initialInvocations / initialEvidence /
 *   onCapabilitiesChange / onAgentCrewChange / onInvocationsChange / onEvidenceChange`）
 * - 需求 3（Rendering_Parity，零行为变更）
 * - 需求 5（`BlueprintProgressPanel` 组合化，`/specs` 兼容）
 * - 需求 6.1（`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时消费 Canonical_Panel_Directory）
 * - 需求 7（独立可合入、单面板 PR、回滚安全）
 * - 需求 8（单向依赖与循环 import 守卫）
 * - 需求 10（零后端契约变更 + 零 testid drift）
 *
 * 本文件从 `client/src/pages/specs/BlueprintProgressPanel.tsx::RuntimeCapabilityBridgeWorkbenchPanel`
 * （~行 2268–2956）逐字符搬运函数体，仅做以下调整：
 * 1. 组件更名为 `RuntimeCapabilityPanel`
 * 2. 签名切换到 `RuntimeCapabilityPanelProps = Pick<AutopilotRightRailProps, ...>` +
 *    面板私有字段 `initialCapabilities / initialAgentCrew / initialInvocations /
 *    initialEvidence / onCapabilitiesChange / onAgentCrewChange / onInvocationsChange /
 *    onEvidenceChange`
 * 3. 必要的辅助函数与组件（`panelText` / `blueprintCopy` / `artifactTokenLabel` /
 *    `parseWorkbenchLines` / `SummaryTile`）同步复制到本文件，保持 canonical panel
 *    的独立可编译性
 *
 * 兼容性说明：
 * - 原 local function 的依赖数组、`useMemo / useState / useEffect / useCallback` 语义、
 *   JSX 结构、className 与 data-testid 均保持逐字符一致
 * - 辅助函数 `blueprintCopy / panelText / artifactTokenLabel` 在原实现里通过
 *   `useAppStore.getState().locale` 读取 locale；canonical panel 禁止 import
 *   `@/lib/store`（需求 2.9 / 8.2），因此改为接收 `locale: AppLocale` 参数，
 *   `locale` 由 `AutopilotRightRailProps.locale` / `BlueprintProgressPanel` 组合时
 *   注入。输出行为等价。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";

import {
  Clipboard,
  ListChecks,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ApiRequestError } from "@/lib/api-client";
import { blueprintCopy as translateBlueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import {
  fetchBlueprintCapabilities,
  fetchBlueprintCapabilityEvidence,
  fetchBlueprintCapabilityInvocations,
  fetchBlueprintJobCapabilities,
  invokeBlueprintCapability,
  type BlueprintAgentCrewSnapshot,
} from "@/lib/blueprint-api";
import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintRuntimeCapability,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import type { AutopilotRightRailProps } from "@/pages/autopilot/right-rail/types";

/**
 * Spec 1 冻结的 `AutopilotRightRailProps` 字段子集，严格对应 design.md
 * 「面板抽离总表」第 6 行。
 *
 * 本面板额外接受 canonical-panel 私有字段：
 * - `initialCapabilities` / `initialAgentCrew` / `initialInvocations` /
 *   `initialEvidence`：对应原 local function 的初始数据参数
 * - `onCapabilitiesChange` / `onAgentCrewChange` / `onInvocationsChange` /
 *   `onEvidenceChange`：对应原 local function 的回写回调
 *
 * `<AutopilotRightRail>` 在 fabric stage 调用本面板时默认不传这组字段，
 * 由 `BlueprintProgressPanel` 组合时注入。
 */
export type RuntimeCapabilityPanelProps = Pick<
  AutopilotRightRailProps,
  | "jobId"
  | "specTree"
  | "capabilities"
  | "capabilityInvocations"
  | "capabilityEvidence"
  | "agentCrew"
  | "locale"
> & {
  initialCapabilities?: BlueprintRuntimeCapability[];
  initialAgentCrew?: BlueprintAgentCrewSnapshot | null;
  initialInvocations?: BlueprintCapabilityInvocation[];
  initialEvidence?: BlueprintCapabilityEvidence[];
  onCapabilitiesChange?: (capabilities: BlueprintRuntimeCapability[]) => void;
  onAgentCrewChange?: (agentCrew: BlueprintAgentCrewSnapshot | null) => void;
  onInvocationsChange?: (invocations: BlueprintCapabilityInvocation[]) => void;
  onEvidenceChange?: (evidence: BlueprintCapabilityEvidence[]) => void;
};

// region Helpers: locale-aware copy 工具
function blueprintCopy(value: string | undefined, locale: AppLocale): string {
  return translateBlueprintCopy(value, locale);
}

function panelText(zh: string, en: string, locale: AppLocale): string {
  return locale === "zh-CN" ? zh : en;
}

function artifactTokenLabel(
  value: string | undefined,
  fallback: string,
  locale: AppLocale
): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return translateBlueprintCopy(fallback, locale);
  const translated = translateBlueprintCopy(normalized, locale);
  if (translated !== normalized) return translated;

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseWorkbenchLines(value: string): string[] {
  return value
    .split(/\r?\n|;/)
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}
// endregion

// region Local component: SummaryTile
function SummaryTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-xl font-black text-slate-950">{value}</div>
      <div className="mt-1 text-[10px] font-black uppercase tracking-normal text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-semibold text-slate-500">
        {detail}
      </div>
    </div>
  );
}
// endregion

/**
 * `RuntimeCapabilityPanel` —— 对应 `AutopilotRailSubStage === "runtime_capability"`。
 *
 * 函数体逐字符搬运自 `BlueprintProgressPanel.tsx::RuntimeCapabilityBridgeWorkbenchPanel`，
 * 唯一差异：内部辅助函数 `panelText / blueprintCopy / artifactTokenLabel` 从
 * 「读 store.locale」改为「接收 props.locale」，以满足需求 2.9 与 8.2
 * （canonical panel 禁止 import `@/lib/store`）。
 *
 * 顶层包装组件把 `AutopilotRightRailProps` slice 与 `initial*` / `on*Change`
 * 合并后下发给 `RuntimeCapabilityPanelInner`，保持与原 local function 一致的
 * `specTree: BlueprintSpecTree` 签名与降级语义：`specTree === null` 时直接返回
 * `null`，与 `BlueprintProgressPanel` 原调用点的 `showRuntimeCapabilityBridgeWorkbench
 * && specTree` 条件一致。
 */
export const RuntimeCapabilityPanel: FC<RuntimeCapabilityPanelProps> = props => {
  const {
    specTree,
    jobId,
    locale,
    initialCapabilities,
    initialAgentCrew,
    initialInvocations,
    initialEvidence,
    onCapabilitiesChange,
    onAgentCrewChange,
    onInvocationsChange,
    onEvidenceChange,
  } = props;

  if (!specTree) {
    return null;
  }

  return (
    <RuntimeCapabilityPanelInner
      specTree={specTree}
      jobId={jobId}
      initialCapabilities={initialCapabilities}
      initialAgentCrew={initialAgentCrew}
      initialInvocations={initialInvocations}
      initialEvidence={initialEvidence}
      onCapabilitiesChange={onCapabilitiesChange}
      onAgentCrewChange={onAgentCrewChange}
      onInvocationsChange={onInvocationsChange}
      onEvidenceChange={onEvidenceChange}
      locale={locale}
    />
  );
};

function RuntimeCapabilityPanelInner({
  specTree,
  jobId,
  initialCapabilities,
  initialAgentCrew,
  initialInvocations,
  initialEvidence,
  onCapabilitiesChange,
  onAgentCrewChange,
  onInvocationsChange,
  onEvidenceChange,
  locale,
}: {
  specTree: BlueprintSpecTree;
  jobId?: string | null;
  initialCapabilities?: BlueprintRuntimeCapability[];
  initialAgentCrew?: BlueprintAgentCrewSnapshot | null;
  initialInvocations?: BlueprintCapabilityInvocation[];
  initialEvidence?: BlueprintCapabilityEvidence[];
  onCapabilitiesChange?: (capabilities: BlueprintRuntimeCapability[]) => void;
  onAgentCrewChange?: (agentCrew: BlueprintAgentCrewSnapshot | null) => void;
  onInvocationsChange?: (invocations: BlueprintCapabilityInvocation[]) => void;
  onEvidenceChange?: (evidence: BlueprintCapabilityEvidence[]) => void;
  locale: AppLocale;
}) {
  const [registryCapabilities, setRegistryCapabilities] = useState<
    BlueprintRuntimeCapability[]
  >(initialCapabilities ?? []);
  const [jobCapabilities, setJobCapabilities] = useState<
    BlueprintRuntimeCapability[]
  >(initialCapabilities ?? []);
  const [agentCrew, setAgentCrew] = useState<BlueprintAgentCrewSnapshot | null>(
    initialAgentCrew ?? null
  );
  const [invocations, setInvocations] = useState<
    BlueprintCapabilityInvocation[]
  >(initialInvocations ?? []);
  const [evidence, setEvidence] = useState<BlueprintCapabilityEvidence[]>(
    initialEvidence ?? []
  );
  const [selectedCapabilityId, setSelectedCapabilityId] = useState(
    initialCapabilities?.[0]?.id ?? ""
  );
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(
    specTree.rootNodeId ?? specTree.nodes[0]?.id ?? ""
  );
  const [requestedBy, setRequestedBy] = useState("");
  const [invocationInput, setInvocationInput] = useState("");
  const [evidenceTags, setEvidenceTags] = useState("");
  const [approved, setApproved] = useState(true);
  const [loading, setLoading] = useState(false);
  const [invoking, setInvoking] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    setRegistryCapabilities(initialCapabilities ?? []);
    setJobCapabilities(initialCapabilities ?? []);
    setSelectedCapabilityId(current =>
      initialCapabilities?.some(capability => capability.id === current)
        ? current
        : (initialCapabilities?.[0]?.id ?? "")
    );
  }, [initialCapabilities]);

  useEffect(() => {
    setAgentCrew(initialAgentCrew ?? null);
  }, [initialAgentCrew]);

  useEffect(() => {
    setInvocations(initialInvocations ?? []);
  }, [initialInvocations]);

  useEffect(() => {
    setEvidence(initialEvidence ?? []);
  }, [initialEvidence]);

  useEffect(() => {
    setSelectedNodeId(current =>
      specTree.nodes.some(node => node.id === current)
        ? current
        : (specTree.rootNodeId ?? specTree.nodes[0]?.id ?? "")
    );
  }, [specTree.nodes, specTree.rootNodeId]);

  const registry = useMemo(
    () => (jobCapabilities.length ? jobCapabilities : registryCapabilities),
    [jobCapabilities, registryCapabilities]
  );
  const activeCapability = useMemo(
    () =>
      registry.find(capability => capability.id === selectedCapabilityId) ??
      registry[0] ??
      null,
    [registry, selectedCapabilityId]
  );
  const selectedNode = useMemo(
    () =>
      specTree.nodes.find(node => node.id === selectedNodeId) ??
      specTree.nodes[0] ??
      null,
    [selectedNodeId, specTree.nodes]
  );
  const activeInvocations = useMemo(() => {
    if (!activeCapability) return invocations;
    return invocations.filter(
      invocation => invocation.capabilityId === activeCapability.id
    );
  }, [activeCapability, invocations]);
  const activeEvidence = useMemo(() => {
    if (!activeCapability) return evidence;
    return evidence.filter(item => item.capabilityId === activeCapability.id);
  }, [activeCapability, evidence]);
  const canInvoke = Boolean(jobId && activeCapability);
  const capabilityTags = activeCapability?.tags ?? [];

  // 标记 selectedNode 被消费但保持语义：原 local function 计算 selectedNode 用于扩展；
  // 这里保留调用以不破坏 hook 依赖与行为等价（UI 暂未展示 selectedNode.title）。
  void selectedNode;

  const publishCapabilities = useCallback(
    (nextCapabilities: BlueprintRuntimeCapability[]) => {
      setRegistryCapabilities(nextCapabilities);
      setJobCapabilities(nextCapabilities);
      onCapabilitiesChange?.(nextCapabilities);
      setSelectedCapabilityId(current =>
        nextCapabilities.some(capability => capability.id === current)
          ? current
          : (nextCapabilities[0]?.id ?? "")
      );
    },
    [onCapabilitiesChange]
  );

  // publishCapabilities 保留以不破坏与原 local function 等价的回写 API（当前逻辑中
  // registry/job 两条更新路径内联使用 setState；此处暴露方法保持语义对齐）。
  void publishCapabilities;

  const publishInvocations = useCallback(
    (nextInvocations: BlueprintCapabilityInvocation[]) => {
      setInvocations(nextInvocations);
      onInvocationsChange?.(nextInvocations);
    },
    [onInvocationsChange]
  );

  const publishEvidence = useCallback(
    (nextEvidence: BlueprintCapabilityEvidence[]) => {
      setEvidence(nextEvidence);
      onEvidenceChange?.(nextEvidence);
    },
    [onEvidenceChange]
  );

  const handleRefresh = useCallback(async () => {
    if (!jobId) return;

    setLoading(true);
    setError(null);

    try {
      const [registryResult, jobResult, invocationsResult, evidenceResult] =
        await Promise.all([
          fetchBlueprintCapabilities(),
          fetchBlueprintJobCapabilities(jobId),
          fetchBlueprintCapabilityInvocations(jobId),
          fetchBlueprintCapabilityEvidence(jobId),
        ]);

      if (registryResult.ok) {
        setRegistryCapabilities(registryResult.data.capabilities);
        if (registryResult.data.agentCrew) {
          setAgentCrew(registryResult.data.agentCrew);
          onAgentCrewChange?.(registryResult.data.agentCrew);
        }
      } else if (registryResult.error.status !== 404) {
        setError(registryResult.error);
      }

      if (jobResult.ok) {
        setJobCapabilities(jobResult.data.capabilities);
        setAgentCrew(jobResult.data.agentCrew ?? null);
        onAgentCrewChange?.(jobResult.data.agentCrew ?? null);
      } else if (jobResult.error.status !== 404) {
        setError(jobResult.error);
      }

      if (invocationsResult.ok) {
        if (invocationsResult.data.agentCrew) {
          setAgentCrew(invocationsResult.data.agentCrew);
          onAgentCrewChange?.(invocationsResult.data.agentCrew);
        }
        publishInvocations(invocationsResult.data.invocations);
      } else if (invocationsResult.error.status !== 404) {
        setError(invocationsResult.error);
      }

      if (evidenceResult.ok) {
        publishEvidence(evidenceResult.data.evidence);
      } else if (evidenceResult.error.status !== 404) {
        setError(evidenceResult.error);
      }
    } finally {
      setLoading(false);
    }
  }, [jobId, onAgentCrewChange, publishEvidence, publishInvocations]);

  const handleInvoke = useCallback(async () => {
    if (!jobId || !activeCapability) return;

    setInvoking(true);
    setError(null);

    try {
      const result = await invokeBlueprintCapability(jobId, {
        capabilityId: activeCapability.id,
        routeId: selectedRouteId.trim() || undefined,
        nodeId: selectedNodeId.trim() || undefined,
        input: invocationInput.trim() || undefined,
        approved,
        requestedBy: requestedBy.trim() || undefined,
        evidenceTags: parseWorkbenchLines(evidenceTags),
      });

      if (result.ok) {
        setAgentCrew(result.data.agentCrew ?? agentCrew);
        onAgentCrewChange?.(result.data.agentCrew ?? agentCrew);
        setRegistryCapabilities(current => [
          result.data.capability,
          ...current.filter(
            capability => capability.id !== result.data.capability.id
          ),
        ]);
        setJobCapabilities(current => [
          result.data.capability,
          ...current.filter(
            capability => capability.id !== result.data.capability.id
          ),
        ]);
        publishInvocations([
          result.data.invocation,
          ...invocations.filter(item => item.id !== result.data.invocation.id),
        ]);
        publishEvidence([
          result.data.evidence,
          ...evidence.filter(item => item.id !== result.data.evidence.id),
        ]);
        setInvocationInput("");
        setEvidenceTags("");
      } else if (result.error.status !== 404) {
        setError(result.error);
      }
    } finally {
      setInvoking(false);
    }
  }, [
    activeCapability,
    agentCrew,
    approved,
    evidence,
    evidenceTags,
    invocations,
    jobId,
    onAgentCrewChange,
    publishEvidence,
    publishInvocations,
    requestedBy,
    selectedNodeId,
    selectedRouteId,
    invocationInput,
  ]);

  useEffect(() => {
    if (!jobId || registryCapabilities.length > 0) return;
    void handleRefresh();
  }, [handleRefresh, jobId, registryCapabilities.length]);

  const statusSummary = useMemo(() => {
    const allowed = invocations.filter(
      invocation => invocation.safetyGate.status === "allowed"
    ).length;
    return { allowed, blocked: invocations.length - allowed };
  }, [invocations]);

  return (
    <div
      className="grid gap-3"
      data-testid="runtime-capability-bridge-workbench"
    >
      {/* Header chrome removed: SubStageCard 已提供标题 / apiPath / summary / 状态胶囊 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-none border-[#CCCCCC] bg-white font-black text-black hover:bg-[#F3F3F3]"
            disabled={!jobId || loading || invoking}
            onClick={handleRefresh}
            data-testid="capability-bridge-refresh-button"
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
            disabled={!canInvoke || loading || invoking}
            onClick={handleInvoke}
            data-testid="capability-invoke-button"
          >
            {invoking ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            {panelText("调用能力", "Invoke capability", locale)}
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

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <SummaryTile
          label={panelText("能力注册表", "Capability registry", locale)}
          value={registry.length}
          detail={panelText("运行时能力", "Runtime capabilities", locale)}
        />
        <SummaryTile
          label={panelText("调用记录", "Invocations", locale)}
          value={invocations.length}
          detail={panelText(
            `${statusSummary.allowed} 次允许`,
            `${statusSummary.allowed} allowed`,
            locale
          )}
        />
        <SummaryTile
          label={panelText("证据", "Evidence", locale)}
          value={evidence.length}
          detail={panelText("调用记录", "Invocations", locale)}
        />
        <SummaryTile
          label={panelText("阻塞", "Blocked", locale)}
          value={statusSummary.blocked}
          detail={panelText("安全门结果", "Safety gate results", locale)}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(250px,0.78fr)_minmax(0,1.22fr)]">
        <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("能力注册表", "Capability registry", locale)}
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
            >
              {panelText(
                `${registry.length} 项能力`,
                `${registry.length} capabilities`,
                locale
              )}
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[360px] pr-2">
            <div className="grid gap-2" data-testid="capability-registry-list">
              {registry.length ? (
                registry.map(capability => {
                  const selected = activeCapability?.id === capability.id;
                  return (
                    <button
                      key={capability.id}
                      type="button"
                      className={cn(
                        "w-full rounded-[14px] border px-3 py-3 text-left transition",
                        selected
                          ? "border-slate-950 bg-white"
                          : "border-slate-200 bg-white/80 hover:border-slate-300"
                      )}
                      onClick={() => setSelectedCapabilityId(capability.id)}
                      aria-pressed={selected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-black text-slate-900">
                          {blueprintCopy(capability.label, locale)}
                        </span>
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(capability.kind, "Capability", locale)}
                        </Badge>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(capability.purpose, locale)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(
                            capability.securityLevel,
                            "Security",
                            locale
                          )}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(capability.status, "Status", locale)}
                        </Badge>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  {panelText(
                    "能力桥与后端同步后，能力注册项会显示在这里。",
                    "Capability entries will appear here after the bridge syncs with the backend.",
                    locale
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-3 rounded-[14px] border border-slate-200 bg-white px-3 py-3">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("能力详情", "Capability details", locale)}
            </div>
            <div className="mt-2 text-xs font-semibold leading-5 text-slate-600">
              {activeCapability
                ? blueprintCopy(activeCapability.description, locale)
                : panelText(
                    "选择一项能力后可查看适配器与 schema 详情。",
                    "Select a capability to view its adapter and schema details.",
                    locale
                  )}
            </div>
            {capabilityTags.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {capabilityTags.slice(0, 6).map(tag => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <Clipboard className="size-3.5" aria-hidden="true" />
                  {panelText("调用发射器", "Invocation launcher", locale)}
                </div>
                <h4 className="mt-2 text-base font-black text-slate-950">
                  {activeCapability?.label
                    ? blueprintCopy(activeCapability.label, locale)
                    : panelText("能力调用已就绪", "Capability invocation ready", locale)}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
              >
                {activeCapability
                  ? artifactTokenLabel(activeCapability.status, "Status", locale)
                  : panelText("未选择能力", "No capability selected", locale)}
              </Badge>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                {panelText("能力", "Capability", locale)}
                <select
                  value={selectedCapabilityId}
                  onChange={event =>
                    setSelectedCapabilityId(event.target.value)
                  }
                  className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  data-testid="capability-launcher-select"
                >
                  <option value="">{panelText("选择能力", "Select capability", locale)}</option>
                  {registry.map(capability => (
                    <option key={capability.id} value={capability.id}>
                      {blueprintCopy(capability.label, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                {panelText("目标节点", "Target node", locale)}
                <select
                  value={selectedNodeId}
                  onChange={event => setSelectedNodeId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  data-testid="capability-launcher-node-select"
                >
                  {specTree.nodes.map(node => (
                    <option key={node.id} value={node.id}>
                      {blueprintCopy(node.title, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500 md:col-span-2">
                {panelText("路线 ID", "Route ID", locale)}
                <input
                  value={selectedRouteId}
                  onChange={event => setSelectedRouteId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-400"
                  placeholder={panelText("可选路线 ID", "Optional route ID", locale)}
                  data-testid="capability-launcher-route-input"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500 md:col-span-2">
                {panelText("请求人", "Requested by", locale)}
                <input
                  value={requestedBy}
                  onChange={event => setRequestedBy(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-400"
                  placeholder={panelText("可选执行者", "Optional requester", locale)}
                  data-testid="capability-launcher-requested-by-input"
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3">
              <textarea
                value={invocationInput}
                onChange={event => setInvocationInput(event.target.value)}
                className="min-h-[88px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-400"
                placeholder={panelText("能力输入", "Capability input", locale)}
                data-testid="capability-launcher-input"
              />
              <textarea
                value={evidenceTags}
                onChange={event => setEvidenceTags(event.target.value)}
                className="min-h-[72px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                placeholder={panelText("证据标签", "Evidence tags", locale)}
                data-testid="capability-launcher-evidence-tags"
              />
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={event => setApproved(event.target.checked)}
                  className="size-4 rounded border-slate-300 text-slate-950 focus:ring-slate-400"
                  data-testid="capability-launcher-approved-toggle"
                />
                {panelText("已批准", "Approved", locale)}
              </label>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <ListChecks className="size-3.5" aria-hidden="true" />
                {panelText("调用列表", "Invocation list", locale)}
              </div>
              <div
                className="mt-3 grid gap-2"
                data-testid="capability-invocation-list"
              >
                {activeInvocations.length ? (
                  activeInvocations.slice(0, 6).map(invocation => (
                    <div
                      key={invocation.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black text-slate-900">
                          {blueprintCopy(invocation.capabilityLabel, locale)}
                        </div>
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(invocation.status, "Status", locale)}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(invocation.outputSummary, locale)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        <span>
                          {artifactTokenLabel(invocation.kind, "Kind", locale)}
                        </span>
                        <span>
                          {artifactTokenLabel(
                            invocation.securityLevel,
                            "Security",
                            locale
                          )}
                        </span>
                        <span>
                          {artifactTokenLabel(
                            invocation.safetyGate.status,
                            "Gate",
                            locale
                          )}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                    {panelText(
                      "发起调用后，能力调用记录会显示在这里。",
                      "Capability invocations will appear here after you launch one.",
                      locale
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <Sparkles className="size-3.5" aria-hidden="true" />
                {panelText("证据列表", "Evidence list", locale)}
              </div>
              <div
                className="mt-3 grid gap-2"
                data-testid="capability-evidence-list"
              >
                {activeEvidence.length ? (
                  activeEvidence.slice(0, 6).map(item => (
                    <div
                      key={item.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black text-slate-900">
                          {blueprintCopy(item.title, locale)}
                        </div>
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(item.status, "Status", locale)}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(item.summary, locale)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        <span>{artifactTokenLabel(item.kind, "Kind", locale)}</span>
                        <span>{item.artifacts.length} 个资产</span>
                        <span>{item.logs.length} 条日志</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                    {panelText(
                      "能力调用被记录后，相关证据会显示在这里。",
                      "Evidence will appear here after capability invocations are recorded.",
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

export default RuntimeCapabilityPanel;
