/**
 * 输入条上方的待办。聊天里只留散文。
 *
 * 2026-09-15 用户对照：「目前有点简单」→ 先抄 beUI / assistant-ui。
 * 同日又圈了收起态那颗 1/8 饼图：「做的还是不太好，直接抄 cursor 的」。
 *
 * Cursor Agent 那张 To-dos（TodoWrite 画在对话里的）：
 *   · 跟输入条同一张 12px 卡（border-[#e5e7eb]、浅影），不是 beUI 大圆角重阴影
 *   · 默认摊开全部条目，不把「当前条 + 饼图」当脸
 *   · 状态是圆点：空圈 / 转圈 / 勾。没有进度条，没有 ListTodo 圆标
 *   · 分数是 completed/total，不是 Manus 那格「做到第几条」
 *
 * 条目仍只来自 `visiblePlanTodo(controlTodo)`：没有就不画，不许编一条。
 */
import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import {
  planTodoCompleted,
  visiblePlanTodo,
  type PlanTodoStatus,
} from "./plan-todo-dock";
import { isMotionReduced } from "./user-prefs";

function statusLabel(status: PlanTodoStatus): string {
  if (status === "in_progress") return "进行中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "待做";
}

function TodoStatusMark({ status }: { status: PlanTodoStatus }) {
  if (status === "completed") {
    return (
      <span
        data-todo-mark="completed"
        className="flex size-4 shrink-0 items-center justify-center"
        aria-hidden
      >
        <Check className="size-3.5 text-[#8b8b8b]" strokeWidth={2.4} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span
        data-todo-mark="in_progress"
        className="flex size-4 shrink-0 items-center justify-center text-[#333]"
        aria-hidden
      >
        <Loader2 className="sr-todo-spin size-3.5" strokeWidth={2.2} />
      </span>
    );
  }
  return (
    <span
      data-todo-mark="pending"
      className="flex size-4 shrink-0 items-center justify-center"
      aria-hidden
    >
      <span className="size-3.5 rounded-full border border-[#d0d0d0]" />
    </span>
  );
}

export function PlanTodoDock({
  items,
}: {
  items?: Array<{ id?: string; status?: string; content?: string }> | null;
}) {
  const todo = visiblePlanTodo(items);
  const shown = todo.filter(item => item.status !== "cancelled");
  const { done, total, percent } = planTodoCompleted(todo);
  const [open, setOpen] = useState(true);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const currentRef = useRef<HTMLLIElement | null>(null);
  const currentId = shown.find(item => item.status === "in_progress")?.id ?? "";

  useLayoutEffect(() => {
    if (!open) return;
    currentRef.current?.scrollIntoView({
      block: "nearest",
      behavior: isMotionReduced() ? "auto" : "smooth",
    });
  }, [open, currentId]);

  if (!shown.length) return null;

  return (
    <section
      data-testid="plan-todo-dock"
      data-plan-todo-surface="cursor"
      aria-label="待办"
      className="mb-2 overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-[0_2px_8px_rgba(31,35,40,0.06)]"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(value => !value)}
        className="flex h-9 w-full items-center gap-1.5 px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#2f6bff]/40"
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-[#8b8b8b] transition-transform duration-150 ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden
        />
        <h3 className="min-w-0 flex-1 text-[13px] font-medium text-[#333]">待办</h3>
        <span
          data-testid="plan-todo-progress"
          data-todo-percent={percent}
          className="shrink-0 text-[12px] tabular-nums text-[#8b8b8b]"
        >
          {done}/{total}
        </span>
      </button>
      {open ? (
        <ol id={listId} aria-live="polite" className="max-h-64 px-1.5 pb-2">
          {shown.map(item => {
            const active = item.status === "in_progress";
            return (
              <li
                key={item.id}
                ref={active ? currentRef : undefined}
                data-todo-status={item.status}
                className={`flex items-start gap-2 rounded-md px-1.5 py-1 text-[13px] leading-5 ${
                  item.status === "completed"
                    ? "text-[#8b8b8b]"
                    : "text-[#333]"
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  <TodoStatusMark status={item.status} />
                </span>
                <span className="sr-only">{statusLabel(item.status)}：</span>
                <span className="min-w-0 flex-1">{item.content}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
