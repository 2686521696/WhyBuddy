/**
 * 流式时间线节点 — 三态容器组件
 *
 * 根据 status 渲染不同的视觉形态:
 * - completed: 折叠摘要(标题 + badge + 指标)
 * - active: 展开内容区(标题 + 进度/内容)
 * - future: 灰色占位(仅标题)
 */

import type { FC, ReactNode } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";

import "./timeline-animations.css";
import type { SubStageSummary } from "../sub-stage-summary";

export type TimelineNodeStatus = "completed" | "active" | "future";

export interface TimelineNodeProps {
  index: number;
  status: TimelineNodeStatus;
  summary: SubStageSummary;
  ready?: boolean;
  /** 活跃节点的内容区 */
  children?: ReactNode;
  /** 已完成节点点击"查看详情" */
  onViewDetail?: () => void;
}

function StatusIcon({
  ready,
  status,
}: {
  ready?: boolean;
  status: TimelineNodeStatus;
}) {
  switch (status) {
    case "completed":
      return (
        <CheckCircle2
          className="size-4 shrink-0 text-emerald-500"
          aria-hidden="true"
        />
      );
    case "active":
      if (ready) {
        return (
          <CheckCircle2
            className="size-4 shrink-0 text-blue-500"
            aria-hidden="true"
          />
        );
      }
      return (
        <Loader2
          className="size-4 shrink-0 animate-spin text-blue-500"
          aria-hidden="true"
        />
      );
    case "future":
      return (
        <Circle
          className="size-4 shrink-0 text-slate-300"
          aria-hidden="true"
        />
      );
  }
}

export const TimelineNode: FC<TimelineNodeProps> = ({
  index,
  status,
  summary,
  ready = false,
  children,
  onViewDetail,
}) => {
  const isLast = false; // 由父组件通过 CSS 控制连接线

  return (
    <div
      className="relative flex gap-3"
      data-testid="timeline-node"
      data-timeline-status={status}
      data-timeline-index={index}
    >
      {/* 左侧:图标 + 连接线 */}
      <div className="flex flex-col items-center">
        <StatusIcon ready={ready} status={status} />
        {/* 连接线 */}
        <div className="mt-1 w-px flex-1 bg-slate-200" />
      </div>

      {/* 右侧:内容 */}
      <div className="min-w-0 flex-1 pb-6">
        {/* 标题行 */}
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-bold ${
              status === "future"
                ? "text-slate-400"
                : status === "completed"
                  ? "text-slate-700"
                  : "text-slate-900"
            }`}
          >
            {summary.title}
          </span>
          {status === "completed" && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
              完成
            </span>
          )}
          {status === "active" && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
              {ready ? "已就绪" : "进行中"}
            </span>
          )}
        </div>

        {/* 已完成:children 优先,否则显示指标行 */}
        {status === "completed" && (
          <div className="mt-2">
            {children || (
              <div className="flex flex-wrap gap-4">
                {summary.metrics.map((metric, i) => (
                  <div key={i} className="flex items-baseline gap-1">
                    <span className="font-mono text-lg font-black text-slate-900">
                      {metric.value}
                    </span>
                    <span className="text-[10px] font-bold uppercase text-slate-400">
                      {metric.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {onViewDetail && (
              <button
                type="button"
                onClick={onViewDetail}
                className="mt-1 text-[11px] font-bold text-blue-500 hover:text-blue-700 hover:underline"
              >
                查看详情
              </button>
            )}
          </div>
        )}

        {/* 活跃:内容区 */}
        {status === "active" && (
          <div className="mt-3">{children}</div>
        )}

        {/* 未来:API path 提示 */}
        {status === "future" && (
          <div className="mt-1 font-mono text-[10px] text-slate-300">
            {summary.apiPath}
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineNode;
