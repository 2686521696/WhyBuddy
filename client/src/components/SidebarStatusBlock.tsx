import { Monitor, Server } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  resolveProjectTaskScope,
  resolveScopedSelectedTaskId,
} from "@/lib/project-task-scope";
import { selectCurrentProject, useProjectStore } from "@/lib/project-store";
import { useAppStore } from "@/lib/store";
import { useTasksStore } from "@/lib/tasks-store";

import { getStatusMapping, getStatusLabel } from "./sidebar-status-utils";
export { getStatusMapping, getStatusLabel } from "./sidebar-status-utils";
export type { StatusMapping } from "./sidebar-status-utils";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SidebarStatusBlockProps {
  collapsed: boolean;
  tone?: "light" | "glass";
}

const STATUS_CARD_STYLE = {
  borderColor: "rgba(186,230,253,0.68)",
  background: "rgba(255,255,255,0.66)",
};

const STATUS_TITLE_STYLE = { color: "#1e293b" };
const STATUS_META_STYLE = { color: "#475569" };
const STATUS_ICON_STYLE = { color: "#0284c7" };

const GLASS_STATUS_CARD_STYLE = {
  borderColor: "rgba(255,255,255,0.58)",
  background: "rgba(255,255,255,0.48)",
};

export function SidebarStatusBlock({
  collapsed,
  tone = "light",
}: SidebarStatusBlockProps) {
  const { locale, copy } = useI18n();
  const glass = tone === "glass";
  const currentProject = useProjectStore(selectCurrentProject);
  const projectMissions = useProjectStore(state => state.missions);

  const driveState = useTasksStore(state => {
    const scope = resolveProjectTaskScope({
      projectId: currentProject?.id ?? null,
      projectMissions,
      tasks: state.tasks,
    });
    const id = resolveScopedSelectedTaskId({
      selectedTaskId: state.selectedTaskId,
      scope,
      hasDetail: taskId => Boolean(state.detailsById[taskId]),
    });
    if (!id) return "idle";
    const detail = state.detailsById[id];
    return (
      detail?.autopilotSummary?.driveState?.state ?? detail?.status ?? "idle"
    );
  });

  const runtimeMode = useAppStore(state => state.runtimeMode);

  const statusMapping = getStatusMapping(driveState);
  const statusLabel = locale.startsWith("en")
    ? statusMapping.labelEn
    : statusMapping.labelZh;
  const autopilotControlTitle = locale.startsWith("en")
    ? "Autopilot Control"
    : "自动驾驶控制";
  const missionControlTitle = locale.startsWith("en")
    ? "Mission Control"
    : "任务控制";

  const sidebarCopy = copy.sidebar;
  const modeLabel =
    runtimeMode === "advanced"
      ? sidebarCopy.missionControlAdvanced
      : sidebarCopy.missionControlFrontend;

  if (collapsed) {
    return (
      <div
        className={cn(
          "mx-auto mb-3 flex flex-col items-center gap-2",
          glass && "rounded-[14px] bg-white/30 px-2 py-2"
        )}
        data-sidebar-status-tone={tone}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "block h-2.5 w-2.5 shrink-0 cursor-default rounded-full",
                statusMapping.dotClass
              )}
              aria-label={`${autopilotControlTitle}: ${statusLabel}`}
            />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <span className="font-semibold">{autopilotControlTitle}</span>
            <br />
            <span className="text-xs opacity-80">{statusLabel}</span>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="cursor-default"
              aria-label={`${missionControlTitle}: ${modeLabel}`}
            >
              {runtimeMode === "advanced" ? (
                <Server
                  size={14}
                  className="shrink-0"
                  style={STATUS_ICON_STYLE}
                />
              ) : (
                <Monitor
                  size={14}
                  className="shrink-0"
                  style={STATUS_ICON_STYLE}
                />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <span className="font-semibold">{missionControlTitle}</span>
            <br />
            <span className="text-xs opacity-80">{modeLabel}</span>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 space-y-2" data-sidebar-status-tone={tone}>
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-[16px] border px-3 py-2.5 text-[11px] shadow-[0_10px_24px_rgba(14,165,233,0.08),inset_0_1px_0_rgba(255,255,255,0.72)]",
          glass && "shadow-[0_10px_24px_rgba(14,165,233,0.07),inset_0_1px_0_rgba(255,255,255,0.58)]"
        )}
        data-sidebar-status-card={tone}
        style={glass ? GLASS_STATUS_CARD_STYLE : STATUS_CARD_STYLE}
      >
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_14px_currentColor]",
            statusMapping.dotClass
          )}
        />
        <div className="min-w-0">
          <div className="font-semibold" style={STATUS_TITLE_STYLE}>
            {autopilotControlTitle}
          </div>
          <div className="truncate opacity-80" style={STATUS_META_STYLE}>
            {statusLabel}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex items-center gap-2.5 rounded-[16px] border px-3 py-2.5 text-[11px] shadow-[0_10px_24px_rgba(14,165,233,0.08),inset_0_1px_0_rgba(255,255,255,0.72)]",
          glass && "shadow-[0_10px_24px_rgba(14,165,233,0.07),inset_0_1px_0_rgba(255,255,255,0.58)]"
        )}
        data-sidebar-status-card={tone}
        style={glass ? GLASS_STATUS_CARD_STYLE : STATUS_CARD_STYLE}
      >
        {runtimeMode === "advanced" ? (
          <Server
            size={14}
            className="shrink-0 opacity-70"
            style={STATUS_ICON_STYLE}
          />
        ) : (
          <Monitor
            size={14}
            className="shrink-0 opacity-70"
            style={STATUS_ICON_STYLE}
          />
        )}
        <div className="min-w-0">
          <div className="font-semibold" style={STATUS_TITLE_STYLE}>
            {missionControlTitle}
          </div>
          <div className="truncate opacity-80" style={STATUS_META_STYLE}>
            {modeLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
