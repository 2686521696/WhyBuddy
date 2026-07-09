/**
 * Autopilot 驾驶舱右栏收敛 — `AgentCrewFabricPanel`
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1（8 个 Sub_Stage_Panel 的规范落点与命名冻结）
 * - 需求 2.1（`AgentCrewFabricPanel` 只接受 `{ jobId, job, agentCrew, capabilities,
 *   capabilityInvocations, capabilityEvidence, locale }`）
 * - 需求 3（Rendering_Parity，零行为变更）
 * - 需求 5（`BlueprintProgressPanel` 组合化，`/specs` 兼容）
 * - 需求 6.1（`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时消费 Canonical_Panel_Directory）
 * - 需求 7（独立可合入、单面板 PR、回滚安全）
 * - 需求 8（单向依赖与循环 import 守卫）
 * - 需求 10（零后端契约变更 + 零 testid drift）
 *
 * 本文件从 `client/src/pages/specs/BlueprintProgressPanel.tsx::BlueprintAgentCrewSurface`
 * （~行 1794–2083）逐字符搬运函数体，仅做以下调整：
 * 1. 组件更名为 `AgentCrewFabricPanel`
 * 2. 签名切换到 `AgentCrewFabricPanelProps = Pick<AutopilotRightRailProps, ...>` +
 *    私有字段 `roleEventProjection?`；在函数体第一行通过 destructure 重命名
 *    `capabilityInvocations -> invocations` 与 `capabilityEvidence -> evidence`，
 *    让内部对 `invocations` / `evidence` 的引用保持与原 local function 一致
 * 3. 必要的辅助函数与类型 (`agentRoleStateLabel` / `agentRoleStateClass` /
 *    `agentRoleStateDetail` / `latestAgentRoleItem` / `artifactTokenLabel` /
 *    `panelText` / `blueprintCopy` / `SummaryTile` / `BlueprintRoleEventProjection`)
 *    同步复制到本文件，保持 canonical panel 的独立可编译性
 *
 * 兼容性说明：
 * - 原 local function 的依赖数组、`useMemo` 语义、JSX 结构、className 与 data-testid
 *   均保持逐字符一致
 * - 辅助函数 `panelText` / `blueprintCopy` / `artifactTokenLabel` /
 *   `agentRoleStateLabel` / `agentRoleStateDetail` 在原实现里通过
 *   `useAppStore.getState().locale` 读取 locale；canonical panel 禁止 import
 *   `@/lib/store`（需求 2.9 / 8.2），因此改为接收 `locale: AppLocale` 参数，
 *   `locale` 由 `AutopilotRightRailProps.locale` / `BlueprintProgressPanel` 组合时
 *   注入。输出行为等价。
 */

import { useMemo } from "react";
import type { FC } from "react";

import { Badge } from "@/components/ui/badge";
import { blueprintCopy as translateBlueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type { BlueprintAgentCrewSnapshot } from "@/lib/blueprint-api";
import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintRolePresenceState,
  BlueprintRoleTimelineEntry,
  BlueprintRuntimeCapability,
} from "@shared/blueprint/contracts";

import type { AutopilotRightRailProps } from "@/pages/autopilot/right-rail/types";

/**
 * Spec 1 冻结的 `AutopilotRightRailProps` 字段子集，严格对应 design.md
 * 「面板抽离总表」第 1 行。
 *
 * 本面板额外接受一个 canonical-panel 私有字段 `roleEventProjection`，
 * 对应原 local function `BlueprintAgentCrewSurface` 的第 5 个参数；`<AutopilotRightRail>`
 * 在 fabric stage 调用本面板时默认不传该字段，由 `BlueprintProgressPanel` 组合时注入。
 */
export type AgentCrewFabricPanelProps = Pick<
  AutopilotRightRailProps,
  | "jobId"
  | "job"
  | "agentCrew"
  | "capabilities"
  | "capabilityInvocations"
  | "capabilityEvidence"
  | "locale"
> & {
  /** 原 local function 支持的 roleEventProjection 参数，保留为面板私有字段 */
  roleEventProjection?: BlueprintRoleEventProjection;
};

/**
 * `BlueprintAgentCrewSurface` 消费的 role event projection 结构。
 *
 * 原定义位于 `client/src/pages/specs/BlueprintProgressPanel.tsx` 第 101–128 行；
 * 本面板作为 canonical panel 不反向 import 任何 `specs/` 下的符号，因此在此重新声明。
 * 导出以便 `BlueprintProgressPanel` 组合时的 `roleEventProjection` 属性类型可追溯。
 */
export type BlueprintRoleEventConsumerId =
  | "scene"
  | "hud"
  | "logs"
  | "browser"
  | "spec";
export interface BlueprintRoleEventProjectionItem {
  id: BlueprintRoleEventConsumerId;
  label: string;
  value: string;
  detail: string;
  status: string;
  roleState?: BlueprintRolePresenceState;
  eventType?: string;
  sourceEventId?: string;
}
export interface BlueprintRoleEventProjection {
  items: BlueprintRoleEventProjectionItem[];
  eventCount: number;
  roleCount: number;
  latestEvent?: BlueprintRoleTimelineEntry;
}

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

function agentRoleStateLabel(state: string, locale: AppLocale): string {
  if (state === "active") return panelText("活跃", "Active", locale);
  if (state === "watching") return panelText("观察中", "Watching", locale);
  if (state === "reviewing") return panelText("评审中", "Reviewing", locale);
  if (state === "sleeping") return panelText("休眠", "Sleeping", locale);
  return artifactTokenLabel(state, "Status", locale);
}

function agentRoleStateClass(state: string): string {
  if (
    state === "active" ||
    state === "watching" ||
    state === "reviewing"
  ) {
    return "border-[#CCCCCC] bg-white text-black";
  }
  return "border-[#CCCCCC] bg-white text-[#666]";
}

function agentRoleStateDetail(state: string, locale: AppLocale): string {
  if (state === "active") return panelText("驱动当前工作", "driving current work", locale);
  if (state === "watching") {
    return panelText("观察交接信号", "watching handoff signals", locale);
  }
  if (state === "reviewing") return panelText("评审证据", "reviewing evidence", locale);
  if (state === "sleeping") return panelText("待命", "standing by", locale);
  return panelText("角色在线状态", "role presence", locale);
}

function latestAgentRoleItem(
  values: string[],
  explicit: string | undefined,
  fallback: string
): string {
  return explicit || values[0] || fallback;
}

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
    <div className="rounded-none border border-[#EAEAEA] bg-white px-3 py-3">
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

/**
 * `AgentCrewFabricPanel` —— 对应 `AutopilotRailSubStage === "agent_crew_fabric"`。
 *
 * 函数体逐字符搬运自 `BlueprintProgressPanel.tsx::BlueprintAgentCrewSurface`，
 * 唯一差异：内部辅助函数 `panelText / blueprintCopy / artifactTokenLabel /
 * agentRoleStateLabel / agentRoleStateDetail` 从「读 store.locale」改为「接收 props.locale」，
 * 以满足需求 2.9 与 8.2（canonical panel 禁止 import `@/lib/store`）。
 */
export const AgentCrewFabricPanel: FC<AgentCrewFabricPanelProps> = ({
  agentCrew,
  capabilities,
  capabilityInvocations: invocations,
  capabilityEvidence: evidence,
  locale,
  roleEventProjection,
}) => {
  const roleTimelines = agentCrew?.roleTimelines ?? agentCrew?.presence ?? [];
  const capabilityById = useMemo(
    () => new Map(capabilities.map(capability => [capability.id, capability])),
    [capabilities]
  );
  const invocationById = useMemo(
    () => new Map(invocations.map(invocation => [invocation.id, invocation])),
    [invocations]
  );
  const evidenceById = useMemo(
    () => new Map(evidence.map(item => [item.id, item])),
    [evidence]
  );
  const stateCounts = useMemo(
    () =>
      roleTimelines.reduce(
        (counts, role) => {
          counts[role.state] += 1;
          return counts;
        },
        { active: 0, watching: 0, reviewing: 0, sleeping: 0 }
      ),
    [roleTimelines]
  );
  // streamEventCount removed with header chrome; downstream JSX still consumes roleEventProjection.

  if (!agentCrew && roleTimelines.length === 0) return null;

  return (
    <div
      className="grid gap-3"
      data-testid="blueprint-agent-crew-surface"
    >
      {/* Header chrome removed: SubStageCard 已提供标题 / apiPath / summary / 状态胶囊 */}

      {roleEventProjection ? (
        <div
          className="grid gap-2 md:grid-cols-5"
          data-testid="agent-crew-event-stream-consumers"
        >
          {roleEventProjection.items.map(item => (
            <div
              key={item.id}
              className="rounded-none border border-[#EAEAEA] bg-white px-3 py-2"
              data-testid="agent-crew-event-stream-consumer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[10px] font-black uppercase tracking-normal text-slate-400">
                  {item.label}
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 rounded-none text-[10px] font-black",
                    agentRoleStateClass(item.roleState ?? item.status)
                  )}
                >
                  {agentRoleStateLabel(item.roleState ?? item.status, locale)}
                </Badge>
              </div>
              <div className="mt-1 truncate text-xs font-bold text-slate-700">
                {blueprintCopy(item.value, locale)}
              </div>
              <div className="mt-1 truncate text-[10px] font-bold uppercase tracking-normal text-slate-400">
                {item.sourceEventId
                  ? blueprintCopy(
                      `${item.sourceEventId} / ${item.eventType ?? "role.event"}`,
                      locale
                    )
                  : panelText("等待角色事件", "Waiting for role event", locale)}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-4">
        {(["active", "watching", "reviewing", "sleeping"] as const).map(
          state => (
            <SummaryTile
              key={state}
              label={agentRoleStateLabel(state, locale)}
              value={stateCounts[state]}
              detail={agentRoleStateDetail(state, locale)}
            />
          )
        )}
      </div>

      <div className="mt-4 grid gap-3">
        {roleTimelines.length ? (
          roleTimelines.map(role => {
            const latestCapability =
              role.latestCapability ||
              role.capabilityIds
                .map(
                  capabilityId =>
                    capabilityById.get(capabilityId)?.label ?? capabilityId
                )
                .find(Boolean) ||
              role.capabilityLabels[0] ||
              panelText("未绑定能力", "No capability bound", locale);
            const latestArtifact = latestAgentRoleItem(
              role.artifactIds,
              role.latestArtifact,
              panelText("暂无资产", "No artifact yet", locale)
            );
            const latestEvidenceId = latestAgentRoleItem(
              role.evidenceIds,
              role.latestEvidence,
              panelText("暂无证据", "No evidence yet", locale)
            );
            const latestEvidence =
              evidenceById.get(latestEvidenceId)?.title ?? latestEvidenceId;
            const relatedInvocation = invocations.find(
              invocation =>
                invocation.roleId === role.roleId ||
                role.capabilityIds.includes(invocation.capabilityId)
            );
            const latestLog =
              relatedInvocation?.logs[0] ??
              (relatedInvocation
                ? invocationById.get(relatedInvocation.id)?.outputSummary
                : "");
            const latestEvent = role.entries?.at(-1);

            return (
              <div
                key={role.id}
                className="rounded-none border border-[#EAEAEA] bg-white px-4 py-3"
                data-testid="blueprint-agent-role-row"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-black text-slate-950">
                        {blueprintCopy(role.displayLabel || role.displayName, locale)}
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-none text-[10px] font-black",
                          agentRoleStateClass(role.state)
                        )}
                      >
                        {agentRoleStateLabel(role.state, locale)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-none border-[#CCCCCC] bg-white text-[10px] font-black text-black font-mono uppercase"
                      >
                          {artifactTokenLabel(role.group, "Role", locale)}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                      {blueprintCopy(role.currentAction, locale)}
                    </div>
                  </div>
                  <div className="text-right text-[10px] font-black uppercase tracking-normal text-slate-400">
                    {artifactTokenLabel(role.stage, "runtime_capability", locale)}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  <div className="rounded-none border border-[#EAEAEA] bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                      {panelText("能力", "Capability", locale)}
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(latestCapability, locale)}
                    </div>
                  </div>
                  <div className="rounded-none border border-[#EAEAEA] bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                      {panelText("资产", "Artifact", locale)}
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(latestArtifact, locale)}
                    </div>
                  </div>
                  <div className="rounded-none border border-[#EAEAEA] bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                      {panelText("证据", "Evidence", locale)}
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(latestEvidence, locale)}
                    </div>
                  </div>
                  <div className="rounded-none border border-[#EAEAEA] bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                      {panelText("日志 / 预演", "Log / Preview", locale)}
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(
                        latestLog ||
                          latestEvent?.summary ||
                          panelText("等待运行时日志", "Awaiting runtime log", locale),
                        locale
                      )}
                    </div>
                  </div>
                </div>

                {latestEvent ? (
                  <div
                    className="mt-2 rounded-none border border-[#EAEAEA] bg-white px-3 py-2"
                    data-testid="agent-crew-role-event-source"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                        {panelText("角色事件来源", "Role Event Source", locale)}
                      </div>
                      <Badge
                        variant="outline"
                        className="rounded-none border-[#CCCCCC] bg-white text-[10px] font-black text-black font-mono uppercase"
                      >
                        {blueprintCopy(latestEvent.type, locale)}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(
                        `${latestEvent.eventId} / ${agentRoleStateLabel(
                          latestEvent.presenceState,
                          locale
                        )}`,
                        locale
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="rounded-none border border-dashed border-[#CCCCCC] bg-white px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
            {panelText(
              "运行时能力桥返回 crew presence 后，Agent Crew 协作角色会显示在这里。",
              "Agent Crew companion roles will appear after the runtime capability bridge returns crew presence.",
              locale
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentCrewFabricPanel;
