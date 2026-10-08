/**
 * 输入条上方的待办。聊天里只留散文。
 *
 * 2026-09-15 对照 Manus 两张截图：默认是输入条上方一条窄卡——
 * 蓝点 + 当前这条 + `1/4` + 箭头。点开才摊清单。第一版抄 Cursor
 * To-dos 默认摊开、脸上写 completed/total，用户圈了 Manus 说
 * 「抄这种效果，默认折叠」。
 *
 * ⚠ 同日 Ticketstream 真机（10 条长文案）展开后当前条和清单叠在一起。
 * 第一版 ol 只写了 max-h、没写 overflow-y-auto，长句从盒子里溢到
 * 底栏上。清单必须自己滚，底栏白底钉住，条目 break-words。
 *
 * 分数用 `planTodoProgress`（做到第几条），不是完成数。没有模型
 * 写下的条目就不画，不许编一条。
 */
import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import {
  planTodoCompleted,
  planTodoProgress,
  skillStageLabel,
  skillStageStatusLabel,
  stagesForTodo,
  visiblePlanTodo,
  visibleSkillStages,
  type PlanTodoAction,
  type PlanTodoItem,
  type PlanTodoStatus,
  type SkillStage,
} from "./plan-todo-dock";
import { dispatchInspectAction } from "./project-computer-view";
import { isMotionReduced } from "./user-prefs";

function statusLabel(status: PlanTodoStatus): string {
  if (status === "in_progress") return "进行中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "待做";
}

function currentTodoItem(items: readonly PlanTodoItem[]): PlanTodoItem | null {
  return (
    items.find(item => item.status === "in_progress") ??
    items.find(item => item.status === "pending") ??
    items[items.length - 1] ??
    null
  );
}

function TodoStatusMark({
  status,
  spin = false,
}: {
  status: PlanTodoStatus;
  spin?: boolean;
}) {
  if (status === "completed") {
    return (
      <span
        data-todo-mark="completed"
        className="flex size-[14px] shrink-0 items-center justify-center"
        aria-hidden
      >
        <Check className="size-3.5 text-[#b0b0b0]" strokeWidth={2.4} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span
        data-todo-mark="in_progress"
        className="flex size-[14px] shrink-0 items-center justify-center text-[#2f6bff]"
        aria-hidden
      >
        {spin ? (
          <Loader2 className="sr-todo-spin size-3.5" strokeWidth={2.2} />
        ) : (
          <span className="size-2.5 rounded-full bg-[#2f6bff]" />
        )}
      </span>
    );
  }
  return (
    <span
      data-todo-mark="pending"
      className="flex size-[14px] shrink-0 items-center justify-center"
      aria-hidden
    >
      <span className="size-[14px] rounded-full border border-[#d4d4d4]" />
    </span>
  );
}

/** 待办上那段技能步骤的小标签（2026-10-08，plan-todo-dock.SkillStage 头注）。 */
function SkillStageChip({ stage }: { stage: SkillStage }) {
  return (
    <span
      data-testid="plan-todo-skill-stage"
      className="mr-1.5 inline-block max-w-full truncate rounded bg-[#f3f4f6] px-1.5 align-[1px] text-[11px] leading-[18px] text-[#6b7280]"
    >
      {skillStageLabel(stage)}
    </span>
  );
}

export function PlanTodoDock({
  items,
  action,
  stages: rawStages,
}: {
  items?: Array<{ id?: string; status?: string; content?: string }> | null;
  /** 控制面当前挑的工程动作。只展示，不改 status。 */
  action?: PlanTodoAction | null;
  /** 批准计划里承诺的技能步骤各落在哪条待办（宿主算，不在这里猜）。 */
  stages?: unknown;
}) {
  const todo = visiblePlanTodo(items);
  const stages = visibleSkillStages(rawStages);
  const shown = todo.filter(item => item.status !== "cancelled");
  const progress = planTodoProgress(todo);
  const { percent } = planTodoCompleted(todo);
  const current = currentTodoItem(shown);
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const listRef = useRef<HTMLOListElement | null>(null);
  const currentRef = useRef<HTMLLIElement | null>(null);
  const currentId = current?.id ?? "";

  useLayoutEffect(() => {
    if (!open) return;
    const row = currentRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;
    if (rowTop < viewTop || rowBottom > viewBottom) {
      list.scrollTop = Math.max(0, rowTop - 8);
    }
  }, [open, currentId]);

  if (!shown.length) return null;

  return (
    <section
      data-testid="plan-todo-dock"
      data-plan-todo-surface="manus"
      aria-label="待办"
      className="mb-2 flex flex-col overflow-hidden rounded-2xl border border-[#ebebeb] bg-white shadow-[0_4px_24px_rgba(15,23,42,0.06)]"
    >
      {open ? (
        <>
          <div className="flex h-10 shrink-0 items-center gap-2 px-3.5">
            <h3 className="min-w-0 flex-1 text-[13px] font-medium text-[#333]">
              待办
            </h3>
            <span className="shrink-0 text-[12px] tabular-nums text-[#9a9a9a]">
              {progress.current}/{progress.total}
            </span>
          </div>
          <ol
            ref={listRef}
            id={listId}
            data-todo-list=""
            aria-live="polite"
            className="min-h-0 max-h-52 overflow-y-auto overscroll-contain px-3.5 pb-1.5"
          >
            {shown.map(item => {
              const active = item.status === "in_progress";
              const hint =
                active && action?.detail
                  ? action.detail
                  : active && action
                    ? action.tool
                    : null;
              return (
                <li
                  key={item.id}
                  ref={active ? currentRef : undefined}
                  data-todo-status={item.status}
                  className={`flex items-start gap-2.5 py-[7px] text-[13px] leading-5 ${
                    item.status === "completed"
                      ? "text-[#9a9a9a]"
                      : "text-[#333]"
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    <TodoStatusMark status={item.status} />
                  </span>
                  <span className="sr-only">{statusLabel(item.status)}：</span>
                  <span className="min-w-0 flex-1 break-words">
                    {action && active ? (
                      <button
                        type="button"
                        data-testid="plan-todo-action"
                        className="block w-full text-left"
                        onClick={() =>
                          dispatchInspectAction({
                            id: action.id,
                            tool: action.tool,
                          })
                        }
                      >
                        {item.content}
                        {hint ? (
                          <span className="mt-0.5 block break-all text-[12px] text-[#9a9a9a]">
                            {hint}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      item.content
                    )}
                    {stagesForTodo(stages, item.id).length ? (
                      <span className="mt-0.5 block">
                        {stagesForTodo(stages, item.id).map(stage => (
                          <SkillStageChip key={`${stage.skill}:${stage.stage}`} stage={stage} />
                        ))}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          {stages.length ? (
            <div
              data-testid="plan-todo-skill-stages"
              className="border-t border-[#f0f0f0] px-3.5 py-2"
            >
              <h4 className="mb-1 text-[12px] font-medium text-[#666]">技能步骤</h4>
              <ul className="space-y-0.5">
                {stages.map(stage => (
                  <li
                    key={`${stage.skill}:${stage.stage}`}
                    data-skill-stage-status={stage.status}
                    className="flex items-baseline gap-2 text-[12px] leading-5"
                  >
                    <span className="min-w-0 flex-1 break-words text-[#555]">{skillStageLabel(stage)}</span>
                    <span
                      className={`shrink-0 ${
                        stage.status === "missing"
                          ? "text-amber-600"
                          : stage.status === "in_progress"
                            ? "text-[#2f6bff]"
                            : "text-[#9a9a9a]"
                      }`}
                    >
                      {skillStageStatusLabel(stage.status)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(value => !value)}
        className={`relative z-[1] flex h-10 w-full shrink-0 items-center gap-2 bg-white px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#2f6bff]/40 ${
          open ? "border-t border-[#f0f0f0]" : ""
        }`}
      >
        {current ? <TodoStatusMark status={current.status} spin /> : null}
        <span
          data-testid="plan-todo-current"
          className="min-w-0 flex-1 truncate text-[13px] text-[#333]"
        >
          {current && progress.currentContent
            ? stagesForTodo(stages, current.id).slice(0, 1).map(stage => (
                <SkillStageChip key={`${stage.skill}:${stage.stage}`} stage={stage} />
              ))
            : null}
          {progress.currentContent ?? "待办"}
        </span>
        <span
          data-testid="plan-todo-progress"
          data-todo-percent={percent}
          className="shrink-0 text-[12px] tabular-nums text-[#9a9a9a]"
        >
          {progress.current}/{progress.total}
        </span>
        <ChevronRight
          className={`size-3.5 shrink-0 text-[#c0c0c0] transition-transform duration-150 ${
            open ? "-rotate-90" : ""
          }`}
          aria-hidden
        />
      </button>
    </section>
  );
}
