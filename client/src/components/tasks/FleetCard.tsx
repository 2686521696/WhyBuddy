import { cn } from "@/lib/utils";
import type {
  TaskAutopilotSummary,
  MissionTaskDetail,
} from "@/lib/tasks-store";
import type {
  MissionAutopilotFleetRoleType,
  MissionAutopilotFleetRoleStatus,
} from "@shared/mission/autopilot";
import {
  User,
  Bot,
  Search,
  FileText,
  Shield,
  Settings,
  Wrench,
  Terminal,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

/* ─── i18n helper ─── */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ─── Role type → icon mapping ─── */

const ROLE_TYPE_ICONS: Record<MissionAutopilotFleetRoleType, LucideIcon> = {
  planner: Settings,
  clarifier: HelpCircle,
  researcher: Search,
  generator: FileText,
  reviewer: Shield,
  auditor: Shield,
  operator: Wrench,
  executor: Terminal,
  custom: Bot,
};

/* ─── Status indicator color mapping ─── */

const STATUS_DOT_CLASSES: Record<MissionAutopilotFleetRoleStatus, string> = {
  running: "bg-emerald-500",
  idle: "bg-slate-300",
  waiting: "bg-amber-400",
  blocked: "bg-red-500",
  failed: "bg-red-500",
  done: "bg-slate-400",
};

/* ─── Types ─── */

export interface FleetMemberItem {
  id: string;
  role: string;
  roleType: MissionAutopilotFleetRoleType;
  status: MissionAutopilotFleetRoleStatus;
  label: string;
}

export interface FleetCardProps {
  title: string;
  members: FleetMemberItem[];
  locale: string;
}

/* ─── Data mapping helper ─── */

/**
 * Build FleetCard data from autopilotSummary and selectedDetail.
 *
 * Priority:
 * 1. `fleet.roles` (if array and non-empty)
 * 2. Fallback: `selectedDetail.departmentLabels` to build simplified role list
 */
export function buildFleetCardData(
  autopilotSummary: TaskAutopilotSummary | null | undefined,
  selectedDetail:
    | Pick<MissionTaskDetail, "departmentLabels">
    | null
    | undefined,
  locale: string
): Pick<FleetCardProps, "title" | "members"> {
  const title = t(locale, "编队执行", "Fleet Execution");

  // Try fleet.roles first
  const roles = autopilotSummary?.fleet?.roles;
  if (Array.isArray(roles) && roles.length > 0) {
    const members: FleetMemberItem[] = roles.map(role => ({
      id: role.id,
      role: role.title || role.roleType,
      roleType: role.roleType,
      status: role.status,
      label: role.title || role.roleType,
    }));
    return { title, members };
  }

  // Fallback: use departmentLabels
  if (selectedDetail) {
    const labels = selectedDetail.departmentLabels;
    if (Array.isArray(labels) && labels.length > 0) {
      const members: FleetMemberItem[] = labels.map((label, index) => ({
        id: `dept-${index}`,
        role: label,
        roleType: "custom" as const,
        status: "idle" as const,
        label,
      }));
      return { title, members };
    }
  }

  return { title, members: [] };
}

/* ─── Component ─── */

export function FleetCard({
  title,
  members,
  locale,
}: FleetCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground border rounded-lg p-4",
        "flex flex-col gap-3"
      )}
    >
      {/* Card title */}
      <h4 className="text-sm font-semibold">{title}</h4>

      {/* Members grid or empty state */}
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          {t(locale, "暂无编队数据", "No fleet available")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {members.map(member => {
            const IconComponent = ROLE_TYPE_ICONS[member.roleType] ?? User;
            const dotClass =
              STATUS_DOT_CLASSES[member.status] ?? "bg-slate-300";

            return (
              <div
                key={member.id}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-2 rounded-lg",
                  "bg-muted/50",
                  "w-[88px] min-h-[96px]"
                )}
              >
                {/* Circular avatar placeholder with role icon */}
                <div className="relative">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full",
                      "bg-muted flex items-center justify-center"
                    )}
                  >
                    <IconComponent
                      size={18}
                      className="text-muted-foreground"
                    />
                  </div>
                  {/* Status indicator dot */}
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5",
                      "w-3 h-3 rounded-full border-2 border-card",
                      dotClass
                    )}
                  />
                </div>

                {/* Role name */}
                <span className="text-xs text-center leading-tight truncate w-full">
                  {member.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
