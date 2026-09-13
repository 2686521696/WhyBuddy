import React from "react";
import { Check, Circle, LoaderCircle, X } from "lucide-react";
import type { UiTurn, TurnStep } from "./types";

export type ProjectTaskStatus = "pending" | "running" | "done" | "failed";

export type ProjectTaskItem = {
  id: string;
  label: string;
  status: ProjectTaskStatus;
};

const TASKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "project_create", label: "Create project" },
  { id: "project_patch", label: "Write source" },
  { id: "project_exec", label: "Run command" },
  { id: "project_start", label: "Start preview" },
  { id: "project_verify", label: "Browser checks" },
  { id: "project_delivery", label: "Confirm delivery" },
];

function projectSteps(turns: UiTurn[]): TurnStep[] {
  return turns.flatMap(turn => turn.steps || []);
}

/**
 * Derive the checklist from the persisted/live project tool steps. A task is
 * never marked complete merely because the turn exists: only a tool step with
 * `progressType=completed` can make it done. This keeps the Manus-style list
 * honest when an operation is queued, blocked, or the page is reloaded.
 */
export function deriveProjectTaskChecklist(
  turns: UiTurn[],
  isRunning = false
): ProjectTaskItem[] {
  const observed = new Map<string, ProjectTaskStatus>();
  for (const step of projectSteps(turns)) {
    if (step.kind !== "chip") continue;
    const id = String(step.capabilityId || "");
    if (!id.startsWith("project_")) continue;
    const status: ProjectTaskStatus =
      step.progressType === "failed"
        ? "failed"
        : step.progressType === "completed"
          ? "done"
          : step.progressType === "acting" || step.progressType === "observing"
            ? "running"
            : observed.get(id) || "running";
    observed.set(id, status);
  }
  const hasProjectEvent = observed.size > 0;
  if (!hasProjectEvent) return [];
  const lastObserved = [...observed.keys()].at(-1);
  return TASKS.map(task => {
    if (task.id === "project_delivery") {
      const hasFailure = [...observed.values()].includes("failed");
      const allRequiredDone = TASKS.slice(0, -1).every(t => observed.get(t.id) === "done");
      return {
        ...task,
        status: hasFailure ? "failed" : allRequiredDone ? "done" : "pending",
      };
    }
    const status = observed.get(task.id);
    if (status) return { ...task, status };
    // Pending means the operation has not been observed. It must not be
    // inferred from the current turn count or a fabricated percentage.
    return { ...task, status: isRunning && task.id === lastObserved ? "running" : "pending" };
  });
}

function StatusIcon({ status }: { status: ProjectTaskStatus }) {
  if (status === "done") return <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  if (status === "failed") return <X className="h-3.5 w-3.5 text-rose-600" aria-hidden />;
  if (status === "running") return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-blue-600" aria-hidden />;
  return <Circle className="h-3.5 w-3.5 text-stone-300" aria-hidden />;
}

export function ProjectTaskChecklist({ turns, isRunning = false }: { turns: UiTurn[]; isRunning?: boolean }) {
  const items = React.useMemo(() => deriveProjectTaskChecklist(turns, isRunning), [turns, isRunning]);
  if (items.length === 0) return null;
  const completed = items.filter(item => item.status === "done").length;
  const current = items.find(item => item.status === "running") || items.find(item => item.status === "failed");
  return (
    <section
      className="mb-3 rounded-lg border border-stone-200 bg-white/80 px-3 py-2.5 shadow-sm"
      data-testid="project-task-checklist"
      aria-label="Project task progress"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px] text-stone-500">
        <span className="font-medium text-stone-700">Project task</span>
        <span data-testid="project-task-count" className="tabular-nums">{completed} / {items.length - 1}</span>
      </div>
      <ol className="space-y-1">
        {items.slice(0, -1).map(item => (
          <li key={item.id} className="flex items-center gap-2 text-[12px]" data-status={item.status} data-task-id={item.id}>
            <StatusIcon status={item.status} />
            <span className={item.status === "pending" ? "text-stone-400" : item.status === "failed" ? "text-rose-700" : "text-stone-700"}>{item.label}</span>
            {current?.id === item.id ? <span className="ml-auto text-[11px] text-blue-600">In progress</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
