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
  icon: LucideIcon;
}

const ROUTE_PLAN_STEPS: RoutePlanStep[] = [
  { id: "destination", labelZh: "目的地", labelEn: "Destination", icon: MapPin },
  { id: "planning", labelZh: "路线规划", labelEn: "Route Plan", icon: Route },
  { id: "execution", labelZh: "执行步骤", labelEn: "Execution", icon: Play },
  { id: "validation", labelZh: "校验/证据", labelEn: "Validation", icon: ShieldCheck },
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
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--muted-foreground, #64748b)" }}
      >
        {t(locale, "自主规划路径", "Autonomous Route Planning")}
      </h3>
      <div className="flex items-center gap-1">
        {ROUTE_PLAN_STEPS.map((step, index) => {
          const status = getStepStatus(step.id, hasDraftDestination, routePlan);
          const Icon = step.icon;
          const isLast = index === ROUTE_PLAN_STEPS.length - 1;

          return (
            <div key={step.id} className="flex items-center gap-1">
              <div
                className="flex flex-col items-center gap-1"
                data-testid={`route-step-${step.id}`}
                data-status={status}
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full border transition-colors"
                  style={{
                    backgroundColor:
                      status === "completed"
                        ? "var(--primary, #0f172a)"
                        : status === "active"
                          ? "var(--primary, #0f172a)"
                          : "var(--muted, #f1f5f9)",
                    borderColor:
                      status === "completed" || status === "active"
                        ? "var(--primary, #0f172a)"
                        : "var(--border, #e2e8f0)",
                    color:
                      status === "completed" || status === "active"
                        ? "var(--primary-foreground, #ffffff)"
                        : "var(--muted-foreground, #64748b)",
                  }}
                >
                  <Icon size={14} />
                </div>
                <span
                  className="text-[10px] whitespace-nowrap"
                  style={{
                    color:
                      status === "completed" || status === "active"
                        ? "var(--card-foreground, #0f172a)"
                        : "var(--muted-foreground, #64748b)",
                  }}
                >
                  {t(locale, step.labelZh, step.labelEn)}
                </span>
              </div>
              {!isLast && (
                <div
                  className="mx-1 h-px w-6 flex-shrink-0"
                  style={{
                    backgroundColor: "var(--border, #e2e8f0)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
