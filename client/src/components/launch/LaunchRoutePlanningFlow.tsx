import { MapPin, Route, Play, ShieldCheck, type LucideIcon } from "lucide-react";

import { useI18n } from "@/i18n";
import type { LaunchRoutePlan } from "@/lib/launch-router";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

interface RoutePlanStep {
  id: string;
  labelZh: string;
  labelEn: string;
  descZh: string;
  descEn: string;
  icon: LucideIcon;
  color: string;
}

const ROUTE_PLAN_STEPS: RoutePlanStep[] = [
  { id: "destination", labelZh: "目的地", labelEn: "Destination", descZh: "理解目标与约束", descEn: "Parse goals & constraints", icon: MapPin, color: "#ef4444" },
  { id: "planning", labelZh: "路线搜索", labelEn: "Route Search", descZh: "分解任务与策略", descEn: "Decompose tasks & strategy", icon: Route, color: "#3b82f6" },
  { id: "execution", labelZh: "执行步骤", labelEn: "Execution", descZh: "智能分配与执行", descEn: "Smart dispatch & execute", icon: Play, color: "#22c55e" },
  { id: "validation", labelZh: "校验 / 证据", labelEn: "Validation", descZh: "证据链与验证记录", descEn: "Evidence chain & verification", icon: ShieldCheck, color: "#8b5cf6" },
];

export interface LaunchRoutePlanningFlowProps {
  hasDraftDestination: boolean;
  routePlan: LaunchRoutePlan;
}

function getStepStatus(
  stepId: string,
  hasDraftDestination: boolean,
  routePlan: LaunchRoutePlan
): "pending" | "active" | "completed" {
  if (stepId === "destination") {
    return hasDraftDestination ? "completed" : "pending";
  }
  if (stepId === "planning") {
    return hasDraftDestination && routePlan.candidates.length > 0
      ? "active"
      : "pending";
  }
  return "pending";
}

export function LaunchRoutePlanningFlow({
  hasDraftDestination,
  routePlan,
}: LaunchRoutePlanningFlowProps) {
  const { locale } = useI18n();

  return (
    <div data-testid="launch-route-planning-flow">
      <h3
        className="mb-1 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--muted-foreground, #64748b)" }}
      >
        ⚙ {t(locale, "自主规划路线", "Autonomous Route Planning")}
      </h3>
      <p
        className="mb-3 text-[11px]"
        style={{ color: "var(--muted-foreground, #64748b)" }}
      >
        {t(locale, "系统将按照以下路径，自主完成从理解到验证的全流程。", "The system follows this path to autonomously complete the full cycle.")}
      </p>
      <div className="flex items-start justify-between gap-2">
        {ROUTE_PLAN_STEPS.map((step, index) => {
          const status = getStepStatus(step.id, hasDraftDestination, routePlan);
          const Icon = step.icon;
          const isLast = index === ROUTE_PLAN_STEPS.length - 1;

          return (
            <div key={step.id} className="flex flex-1 items-start gap-2">
              <div
                className="flex flex-col items-center gap-1.5 min-w-0 flex-1"
                data-testid={`route-step-${step.id}`}
                data-status={status}
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                  style={{
                    backgroundColor:
                      status === "completed" || status === "active"
                        ? step.color
                        : `${step.color}18`,
                    color:
                      status === "completed" || status === "active"
                        ? "#ffffff"
                        : step.color,
                  }}
                >
                  <Icon size={16} />
                </div>
                <span
                  className="text-[11px] font-medium text-center"
                  style={{
                    color: "var(--card-foreground, #0f172a)",
                  }}
                >
                  {t(locale, step.labelZh, step.labelEn)}
                </span>
                <span
                  className="text-[10px] text-center leading-tight"
                  style={{
                    color: "var(--muted-foreground, #64748b)",
                  }}
                >
                  {t(locale, step.descZh, step.descEn)}
                </span>
              </div>
              {!isLast && (
                <div className="mt-4 flex items-center">
                  <div
                    className="h-px w-6 flex-shrink-0"
                    style={{
                      backgroundImage: "repeating-linear-gradient(90deg, var(--border) 0, var(--border) 4px, transparent 4px, transparent 8px)",
                    }}
                  />
                  <span style={{ color: "var(--muted-foreground, #94a3b8)", fontSize: 10 }}>→</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
