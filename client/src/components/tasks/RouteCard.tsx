import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { TaskAutopilotSummary, MissionTaskDetail } from "@/lib/tasks-store";

/* ─── i18n helper ─── */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ─── Types ─── */

export type RouteStepStatus = "completed" | "active" | "pending";

export interface RouteStepItem {
  index: number;
  label: string;
  status: RouteStepStatus;
}

export interface RouteCardProps {
  title: string;                       // i18n: "路线" / "Route"
  steps: RouteStepItem[];
  currentStepIndex: number;
  locale: string;
}

/* ─── Data mapping helper ─── */

/**
 * Build RouteCard data from autopilotSummary and selectedDetail.
 *
 * Priority:
 * 1. `route.stages` from autopilotSummary (if array and non-empty)
 * 2. Fallback: `selectedDetail.stages` (mission ten-stage), filter out empty stages
 */
export function buildRouteCardData(
  autopilotSummary: TaskAutopilotSummary | null | undefined,
  selectedDetail: Pick<MissionTaskDetail, "stages"> | null | undefined,
  locale: string,
): Pick<RouteCardProps, "title" | "steps" | "currentStepIndex"> {
  const title = t(locale, "路线", "Route");

  // Try autopilotSummary route.stages first
  const routeStages = autopilotSummary?.route?.stages;
  if (Array.isArray(routeStages) && routeStages.length > 0) {
    let currentStepIndex = -1;
    const steps: RouteStepItem[] = routeStages.map((stage, idx) => {
      let status: RouteStepStatus;
      if (stage.status === "done") {
        status = "completed";
      } else if (stage.status === "running" || stage.isCurrent) {
        status = "active";
        if (currentStepIndex === -1) currentStepIndex = idx;
      } else {
        status = "pending";
      }
      return { index: idx, label: stage.label || stage.key, status };
    });
    return { title, steps, currentStepIndex: Math.max(currentStepIndex, 0) };
  }

  // Fallback: use selectedDetail.stages
  const detailStages = selectedDetail?.stages;
  if (Array.isArray(detailStages) && detailStages.length > 0) {
    // Filter out stages with empty labels
    const filtered = detailStages.filter((s) => s.label && s.label.trim() !== "");
    if (filtered.length > 0) {
      let currentStepIndex = -1;
      const steps: RouteStepItem[] = filtered.map((stage, idx) => {
        let status: RouteStepStatus;
        if (stage.status === "done") {
          status = "completed";
        } else if (stage.status === "running") {
          status = "active";
          if (currentStepIndex === -1) currentStepIndex = idx;
        } else {
          status = "pending";
        }
        return { index: idx, label: stage.label, status };
      });
      return { title, steps, currentStepIndex: Math.max(currentStepIndex, 0) };
    }
  }

  return { title, steps: [], currentStepIndex: 0 };
}

/* ─── Component ─── */

export function RouteCard({
  title,
  steps,
  locale,
}: RouteCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground border rounded-lg p-4",
        "flex flex-col gap-3",
      )}
    >
      {/* Card title */}
      <h4 className="text-sm font-semibold">{title}</h4>

      {/* Steps or empty state */}
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          {t(locale, "暂无路线数据", "No route available")}
        </p>
      ) : (
        <div
          className={cn(
            "flex items-start gap-0 py-2",
            steps.length > 6 && "overflow-x-auto",
          )}
        >
          {steps.map((step, idx) => (
            <div key={step.index} className="flex items-start">
              {/* Step node + label */}
              <div className="flex flex-col items-center" style={{ minWidth: 64 }}>
                <StepNode step={step} />
                <span
                  className={cn(
                    "text-xs mt-1.5 text-center leading-tight max-w-[72px] truncate",
                    step.status === "pending"
                      ? "text-muted-foreground"
                      : "text-card-foreground",
                  )}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line (not after last step) */}
              {idx < steps.length - 1 && (
                <div className="flex items-center" style={{ marginTop: 12 }}>
                  <ConnectorLine
                    fromStatus={step.status}
                    toStatus={steps[idx + 1].status}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Step Node ─── */

function StepNode({ step }: { step: RouteStepItem }): React.ReactElement {
  if (step.status === "completed") {
    return (
      <div
        className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white"
        aria-label={`Step ${step.index + 1} completed`}
      >
        <Check size={14} strokeWidth={3} />
      </div>
    );
  }

  if (step.status === "active") {
    return (
      <div
        className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-primary text-primary animate-pulse"
        aria-label={`Step ${step.index + 1} active`}
      >
        <span className="text-xs font-semibold leading-none">
          {step.index + 1}
        </span>
      </div>
    );
  }

  // pending
  return (
    <div
      className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-muted-foreground/40 text-muted-foreground"
      aria-label={`Step ${step.index + 1} pending`}
    >
      <span className="text-xs font-semibold leading-none">
        {step.index + 1}
      </span>
    </div>
  );
}

/* ─── Connector Line ─── */

function ConnectorLine({
  fromStatus,
  toStatus,
}: {
  fromStatus: RouteStepStatus;
  toStatus: RouteStepStatus;
}): React.ReactElement {
  // If the left step is completed and the right step is completed or active,
  // the line is solid green. Otherwise it's dashed gray.
  const isGreen =
    fromStatus === "completed" &&
    (toStatus === "completed" || toStatus === "active");

  return (
    <div
      className={cn(
        "w-6 h-0.5",
        isGreen
          ? "bg-emerald-500"
          : "border-t-2 border-dashed border-muted-foreground/40 bg-transparent",
      )}
    />
  );
}
