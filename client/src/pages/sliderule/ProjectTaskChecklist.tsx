/**
 * ProjectTaskChecklist — 工程动作流（原「固定六行清单」）。
 *
 * ## 2026-09-13 改了什么，为什么
 *
 * 原来这里写死一份六行清单（创建工程 / 写入源码 / 运行命令 / 启动预览 /
 * 浏览器检查 / 确认交付），用 `Map<capabilityId, status>` 归并。固定模板下
 * 够用，但有两个硬伤：
 *
 *   · 模板之外的动作（restore / export / read …）**一行都不显示**，而
 *     §27 第 3 项下一步就是「固定模板之外的增量需求」
 *   · 同一工具跑多次会被折成一行，只留最后一次——连跑三次 patch、中间
 *     那次失败了，界面上一点痕迹都没有
 *
 * 现在行从真实动作长出来（见 `project-activity.ts` 头注）。分母是**真实
 * 发生的动作数**，不是写死的 6。
 *
 * ⚠ 原来那三条诚实性质一条没丢，判据钉着：没事件不造清单、只有
 *   `completed` 才算完成、失败要留在台面上。
 */

import React from "react";
import { Check, Circle, LoaderCircle, X } from "lucide-react";
import {
  deriveProjectActivity,
  projectActivityProgress,
  type ProjectActionRow,
  type ProjectActionStatus,
} from "./project-activity";
import type { UiTurn } from "./types";

export type { ProjectActionRow, ProjectActionStatus };

function StatusIcon({ status }: { status: ProjectActionStatus }) {
  if (status === "done")
    return <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  if (status === "failed")
    return <X className="h-3.5 w-3.5 text-rose-600" aria-hidden />;
  return (
    <LoaderCircle
      className="h-3.5 w-3.5 animate-spin text-blue-600"
      aria-hidden
    />
  );
}

export function ProjectTaskChecklist({ turns }: { turns: UiTurn[] }) {
  const rows = React.useMemo(() => deriveProjectActivity(turns), [turns]);
  if (rows.length === 0) return null;
  const { done, total, failed } = projectActivityProgress(rows);
  return (
    <section
      className="mb-3 rounded-lg border border-stone-200 bg-white/80 px-3 py-2.5 shadow-sm"
      data-testid="project-task-checklist"
      aria-label="工程动作"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px] text-stone-500">
        <span className="font-medium text-stone-700">工程动作</span>
        <span data-testid="project-task-count" className="tabular-nums">
          {done} / {total}
          {failed > 0 ? (
            <span className="ml-1 text-rose-600">· {failed} 失败</span>
          ) : null}
        </span>
      </div>
      <ol className="space-y-1">
        {rows.map(row => (
          <li
            key={row.id}
            className="flex items-start gap-2 text-[12px]"
            data-status={row.status}
            data-task-id={row.tool}
          >
            <span className="mt-[3px] shrink-0">
              <StatusIcon status={row.status} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={
                  row.status === "failed" ? "text-rose-700" : "text-stone-700"
                }
              >
                {row.label}
              </span>
              {row.detail ? (
                <span
                  className="ml-1.5 break-all text-stone-400"
                  data-testid="project-task-detail"
                >
                  {row.detail}
                </span>
              ) : null}
            </span>
            {row.status === "running" ? (
              <span className="ml-auto shrink-0 text-[11px] text-blue-600">
                进行中
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
