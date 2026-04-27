import { Monitor, Server } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
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
}

export function SidebarStatusBlock({ collapsed }: SidebarStatusBlockProps) {
  const { locale, copy } = useI18n();

  // Derive driveState from tasks-store
  const driveState = useTasksStore((state) => {
    const id = state.selectedTaskId;
    if (!id) return "idle";
    const detail = state.detailsById[id];
    return (
      detail?.autopilotSummary?.execution?.driveState ??
      detail?.status ??
      "idle"
    );
  });

  // Read runtime mode from app store
  const runtimeMode = useAppStore((state) => state.runtimeMode);

  const statusMapping = getStatusMapping(driveState);
  const statusLabel = locale.startsWith("en")
    ? statusMapping.labelEn
    : statusMapping.labelZh;

  const sidebarCopy = copy.sidebar;
  const modeLabel =
    runtimeMode === "advanced"
      ? sidebarCopy.missionControlAdvanced
      : sidebarCopy.missionControlFrontend;

  // ── Collapsed mode ──────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="mx-auto mb-2 flex flex-col items-center gap-2">
        {/* Autopilot Control — dot only */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "block h-2.5 w-2.5 shrink-0 rounded-full cursor-default",
                statusMapping.dotClass,
              )}
              aria-label={`Autopilot Control: ${statusLabel}`}
            />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <span className="font-semibold">Autopilot Control</span>
            <br />
            <span className="text-xs opacity-80">{statusLabel}</span>
          </TooltipContent>
        </Tooltip>

        {/* Mission Control — icon only */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default" aria-label={`Mission Control: ${modeLabel}`}>
              {runtimeMode === "advanced" ? (
                <Server
                  size={14}
                  className="shrink-0"
                  style={{ color: "var(--sidebar-foreground)" }}
                />
              ) : (
                <Monitor
                  size={14}
                  className="shrink-0"
                  style={{ color: "var(--sidebar-foreground)" }}
                />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <span className="font-semibold">Mission Control</span>
            <br />
            <span className="text-xs opacity-80">{modeLabel}</span>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // ── Expanded mode ───────────────────────────────────────────────────────
  return (
    <div className="mx-3 mb-2 space-y-1.5">
      {/* Autopilot Control */}
      <div
        className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]"
        style={{
          borderColor: "var(--sidebar-border)",
          backgroundColor: "var(--sidebar-accent)",
        }}
      >
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", statusMapping.dotClass)}
        />
        <div className="min-w-0">
          <div
            className="font-semibold"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            Autopilot Control
          </div>
          <div
            className="truncate opacity-60"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Mission Control */}
      <div
        className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]"
        style={{
          borderColor: "var(--sidebar-border)",
          backgroundColor: "var(--sidebar-accent)",
        }}
      >
        {runtimeMode === "advanced" ? (
          <Server
            size={14}
            className="shrink-0 opacity-60"
            style={{ color: "var(--sidebar-foreground)" }}
          />
        ) : (
          <Monitor
            size={14}
            className="shrink-0 opacity-60"
            style={{ color: "var(--sidebar-foreground)" }}
          />
        )}
        <div className="min-w-0">
          <div
            className="font-semibold"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            Mission Control
          </div>
          <div
            className="truncate opacity-60"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            {modeLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
