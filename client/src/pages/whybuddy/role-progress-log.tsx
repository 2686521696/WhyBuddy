import React from "react";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";
import type { TurnStep } from "./types";

const ROLE_DISPLAY: Record<string, string> = {
  产品: "产品",
  架构: "架构师",
  安全: "安全官",
  工程: "工程师",
  挑刺: "挑刺者",
  接地: "接地者",
  综合: "综合器",
  agent: "推演者",
};

function progressColor(type?: string, ok?: boolean): string {
  if (type === "failed" || ok === false) return "text-rose-600";
  if (type === "degraded") return "text-amber-600";
  if (type === "acting") return "text-amber-700";
  if (type === "observing" || type === "completed") return "text-emerald-700";
  return "text-blue-600";
}

function progressLabel(type?: string): string {
  if (type === "acting") return "acting";
  if (type === "observing") return "observing";
  if (type === "completed") return "completed";
  if (type === "degraded") return "degraded";
  if (type === "failed") return "failed";
  return "thinking";
}

function isDegradedCapabilityMessage(message: string): boolean {
  return /未接地|规则推演|未引入外部证据|ground/i.test(message);
}

function stepMatchesCapability(
  step: TurnStep,
  capabilityId?: string
): boolean {
  if (!capabilityId) return true;
  return "capabilityId" in step && step.capabilityId === capabilityId;
}

function stepsForLoop(steps: TurnStep[], loopTurnId?: string): TurnStep[] {
  if (!loopTurnId) return steps;
  const prefix = `${loopTurnId}-`;
  return steps.filter(
    (s) =>
      s.id.startsWith(prefix) ||
      ("loopTurnId" in s && s.loopTurnId === loopTurnId)
  );
}

export function RoleProgressLog({
  steps,
  actions,
  loopTurnId,
  capabilityId,
}: {
  steps: TurnStep[];
  actions: ActionTrace[];
  loopTurnId?: string;
  /** When set, only show progress for this pool capability (avoids duplicating across C_* stations). */
  capabilityId?: string;
}) {
  const scopedSteps = stepsForLoop(steps, loopTurnId).filter((s) =>
    stepMatchesCapability(s, capabilityId)
  );
  const scopedActions = capabilityId
    ? []
    : loopTurnId
    ? actions.filter((a) => !a.turnId || a.turnId === loopTurnId)
    : actions;

  const lines: Array<{
    id: string;
    role: string;
    type: string;
    text: string;
    ok?: boolean;
  }> = [];

  for (const step of scopedSteps) {
    if (step.kind === "chip") {
      lines.push({
        id: step.id,
        role: ROLE_DISPLAY[step.roleId] || step.roleId,
        type: progressLabel(step.progressType),
        text: step.label,
      });
    } else if (step.kind === "step_narration") {
      lines.push({
        id: step.id,
        role: ROLE_DISPLAY[step.roleId || ""] || step.roleId || "推演者",
        type: step.realLlm ? "observing" : "thinking",
        text: step.text.slice(0, 120),
      });
    } else if (step.kind === "capability_fail") {
      const degraded = isDegradedCapabilityMessage(step.message);
      lines.push({
        id: step.id,
        role: ROLE_DISPLAY[step.roleId] || step.roleId,
        type: degraded ? "degraded" : "failed",
        text: step.message,
        ok: degraded ? undefined : false,
      });
    }
  }

  for (const trace of scopedActions) {
    lines.push({
      id: `trace-${trace.label}-${trace.turnId ?? "global"}`,
      role: "工具",
      type: trace.ok ? "completed" : "degraded",
      text: trace.label,
      ok: trace.ok,
    });
  }

  if (lines.length === 0) return null;

  return (
    <div
      className="mt-1.5 flex flex-col gap-1 rounded-md bg-transparent px-0.5 py-1 font-mono text-[10px] leading-relaxed"
      data-testid="role-progress-log"
    >
      {lines.slice(-8).map((line) => (
        <div key={line.id} className="flex gap-1.5">
          <span className="shrink-0 text-slate-400">{line.role}</span>
          <span className={`shrink-0 uppercase ${progressColor(line.type, line.ok)}`}>
            {line.type}
          </span>
          <span className="min-w-0 text-slate-600">{line.text}</span>
        </div>
      ))}
    </div>
  );
}

function hasProgressContent(steps: TurnStep[], actions: ActionTrace[]): boolean {
  return (
    steps.some(
      (s) =>
        s.kind === "chip" ||
        s.kind === "step_narration" ||
        s.kind === "capability_fail"
    ) || actions.length > 0
  );
}

/** 左上横向角色并行流（透明长条，FleetActivationLog 横版）。 */
export function RoleProgressBar({
  steps,
  actions,
}: {
  steps: TurnStep[];
  actions: ActionTrace[];
}) {
  const scopedSteps = steps;
  const scopedActions = actions;

  const lines: Array<{
    id: string;
    role: string;
    type: string;
    text: string;
    ok?: boolean;
  }> = [];

  for (const step of scopedSteps) {
    if (step.kind === "chip") {
      lines.push({
        id: step.id,
        role: ROLE_DISPLAY[step.roleId] || step.roleId,
        type: progressLabel(step.progressType),
        text: step.label,
      });
    } else if (step.kind === "step_narration") {
      lines.push({
        id: step.id,
        role: ROLE_DISPLAY[step.roleId || ""] || step.roleId || "推演者",
        type: step.realLlm ? "observing" : "thinking",
        text: step.text.slice(0, 80),
      });
    } else if (step.kind === "capability_fail") {
      const degraded = isDegradedCapabilityMessage(step.message);
      lines.push({
        id: step.id,
        role: ROLE_DISPLAY[step.roleId] || step.roleId,
        type: degraded ? "degraded" : "failed",
        text: step.message,
        ok: degraded ? undefined : false,
      });
    }
  }

  for (const trace of scopedActions) {
    lines.push({
      id: `trace-${trace.label}-${trace.turnId ?? "global"}`,
      role: "工具",
      type: trace.ok ? "completed" : "degraded",
      text: trace.label,
      ok: trace.ok,
    });
  }

  if (lines.length === 0) return null;

  return (
    <div
      className="flex gap-4 overflow-x-auto whitespace-nowrap px-0.5 font-mono text-[10px] leading-relaxed text-slate-600 [scrollbar-width:thin]"
      data-testid="role-progress-bar"
    >
      {lines.slice(-12).map((line) => (
        <span key={line.id} className="inline-flex shrink-0 items-center gap-1.5">
          <span className="text-slate-400">{line.role}</span>
          <span className={`uppercase ${progressColor(line.type, line.ok)}`}>{line.type}</span>
          <span className="max-w-[200px] truncate text-slate-600">{line.text}</span>
        </span>
      ))}
    </div>
  );
}

/** Turn-wide fleet activation stream (Autopilot FleetActivationLog parity). */
export function TurnFleetProgressLog({
  steps,
  actions,
  title = "角色并行流",
}: {
  steps: TurnStep[];
  actions: ActionTrace[];
  title?: string;
}) {
  if (!hasProgressContent(steps, actions)) return null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-2" data-testid="turn-fleet-progress">
      <p className="m-0 mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </p>
      <RoleProgressLog steps={steps} actions={actions} />
    </div>
  );
}