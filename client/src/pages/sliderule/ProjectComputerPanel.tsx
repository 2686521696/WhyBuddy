/**
 * ProjectComputerPanel — 「它的电脑」：看着它干活，也能倒回去看。
 *
 * ## 为什么要这个（2026-09-13，用户对照 Manus 截图第 4 件）
 *
 * Manus 右侧那块面板是感知差距最大的一件：正在调什么工具、参数是什么、
 * 返回了什么，底下还有一条可拖的时间轴能回放。我们这边同一时刻只有左栏
 * 一行「正在执行工程命令」，看不出它在对什么动手。
 *
 * ## 它跟左栏那份动作流不是一回事
 *
 * 左栏 `ProjectTaskChecklist` 回答「这一轮干了哪些事」——一眼扫完的清单。
 * 这里回答「**此刻**这一步具体在干什么」——一次只摊开一条，带细节。
 * 两者共用 `deriveProjectActivity` 的同一份真实数据，不各算一套。
 *
 * ## 诚实边界
 *
 *   · 细节来自服务端**脱敏白名单**摘要（`project_tool_summary`）。
 *     approvalRef 和文件内容永远不会到这儿——不是这里过滤，是那边就没发。
 *   · 没有摘要就显示不了细节，**不从别处拼一个**。界面少一句，好过编一句。
 *   · 「实时」只在真的还有动作在跑时才亮；停了就是停了，不留一个骗人的转圈。
 */

import React from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import {
  deriveProjectActivity,
  projectActivityProgress,
  projectComputerView,
  type ProjectActionRow,
} from "./project-activity";
import type { UiTurn } from "./types";

function StatusMark({ status }: { status: ProjectActionRow["status"] }) {
  if (status === "done")
    return <Check className="h-4 w-4 text-emerald-600" aria-hidden />;
  if (status === "failed")
    return <X className="h-4 w-4 text-rose-600" aria-hidden />;
  return (
    <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
  );
}

export function ProjectComputerPanel({
  turns,
  className = "",
}: {
  turns: UiTurn[];
  className?: string;
}) {
  const rows = React.useMemo(() => deriveProjectActivity(turns), [turns]);
  // 游标：null = 跟着最新那条走（实时）。用户点了前后才钉住某一条。
  // 「摊开哪条 / 实时亮不亮」的决策在 projectComputerView 里，纯函数可测。
  const [pinned, setPinned] = React.useState<number | null>(null);
  const { index, current, live, following } = projectComputerView(rows, pinned);

  if (rows.length === 0) return null;
  const { done, total, failed } = projectActivityProgress(rows);

  return (
    <section
      className={`flex min-h-0 flex-col rounded-lg border border-stone-200 bg-white ${className}`}
      data-testid="project-computer-panel"
      data-live={live ? "true" : "false"}
      data-following={following ? "true" : "false"}
      aria-label="工程执行面板"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-stone-100 px-3 py-2">
        <span className="text-[13px] font-medium text-stone-700">它的电脑</span>
        <span
          className="text-[11px] text-stone-400"
          data-testid="project-computer-subtitle"
        >
          {current
            ? current.status === "running"
              ? `正在${current.label}`
              : `${current.label}${current.status === "failed" ? " · 失败" : ""}`
            : ""}
        </span>
        <span className="ml-auto tabular-nums text-[11px] text-stone-400">
          {done} / {total}
          {failed > 0 ? <span className="ml-1 text-rose-600">· {failed} 失败</span> : null}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {current ? (
          <div className="space-y-2" data-testid="project-computer-current">
            <div className="flex items-center gap-2">
              <StatusMark status={current.status} />
              <span className="text-[13px] text-stone-800">{current.label}</span>
              <code className="rounded bg-stone-50 px-1.5 py-0.5 text-[11px] text-stone-500">
                {current.tool}
              </code>
            </div>
            {current.detail ? (
              <pre
                className="whitespace-pre-wrap break-all rounded bg-stone-50 px-2.5 py-2 text-[12px] leading-5 text-stone-600"
                data-testid="project-computer-detail"
              >
                {current.detail}
              </pre>
            ) : (
              // ⚠ 没摘要就明说没有，不拿工具名凑一段假细节。
              <p className="text-[12px] text-stone-400">这一步没有可展示的细节。</p>
            )}
          </div>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-stone-100 px-3 py-2">
        <button
          type="button"
          aria-label="上一步"
          data-testid="project-computer-prev"
          disabled={index <= 0}
          onClick={() => setPinned(Math.max(index - 1, 0))}
          className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="下一步"
          data-testid="project-computer-next"
          disabled={index >= rows.length - 1}
          onClick={() =>
            setPinned(index + 1 >= rows.length - 1 ? null : index + 1)
          }
          className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full rounded-full bg-blue-500 transition-[width]"
            style={{ width: `${((index + 1) / rows.length) * 100}%` }}
          />
        </div>
        <span
          className="shrink-0 text-[11px]"
          data-testid="project-computer-live"
        >
          {/* 「实时」只在真有动作在跑、而且用户没有倒回去看时才亮。 */}
          {live && following ? (
            <span className="text-blue-600">● 实时</span>
          ) : (
            <span className="text-stone-400 tabular-nums">
              {index + 1} / {rows.length}
            </span>
          )}
        </span>
      </footer>
    </section>
  );
}
