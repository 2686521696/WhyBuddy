/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — Agent 推理子时间线
 *
 * 从 AutopilotRightRail.tsx 抽出来的可复用组件，消费 store.agentReasoning.entries。
 * 现在挂载位置不再仅限 fabric 阶段右栏 active 节点：StoreObservabilityHud 也会
 * 在所有阶段（input / clarification / routeset / selection / fabric）顶部挂一份，
 * 让用户从澄清开始就能看到 thinking/acting/observing 流。
 *
 * 设计原则与其它 store-observability 组件一致：
 * - 只读：不写 store，不订阅 socket
 * - 折叠态：可见 phase 计数为 0 时返回 null，避免空容器抢占布局
 * - 可在多个位置挂载：右栏 fabric 分支 + 跨阶段 HUD overlay 都是合法位置
 */

import { useEffect, useRef, type FC } from "react";

import type { AppLocale } from "@/lib/locale";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";

/**
 * 双轨子时间线：Think 在左轨，Act + Observe 在右轨，error / completed 横跨双轨。
 *
 * 注意：该组件 *不* 注入任何模拟事件。事件由
 * `server/routes/blueprint/stage-progress-emitter.ts`（route handler 直发）与
 * `server/routes/blueprint/agent-reasoning-bridge.ts`（Docker 容器 HMAC 回调）
 * 两条链路共同填充 `agentReasoning.entries`；空态由 store 决定。
 */
export const AgentReasoningSubTimeline: FC<{
  locale?: AppLocale;
  /**
   * 当前活跃阶段标识。提供时仅显示 `entry.stageId === stageFilter` 的条目（或
   * 当 `stageFilter` 是数组时，`entry.stageId ∈ stageFilter`），让多阶段共享
   * 同一份 entries 时，每张 active 卡片只看到属于自身阶段的事件。不提供时
   * 显示全部条目（fabric 阶段的右栏 active 节点等场景沿用旧行为）。
   *
   * 数组形态用于 UI 上将多个后端 stage 合并为同一张卡片：例如前端把
   * "路线生成 + 路线选择 + spec_tree 派生" 合并为单一"路线"卡片，但后端
   * 仍保留 `route_generation` / `spec_tree` 等独立 stage 名，用于 capability /
   * agentCrew / events 投影；此时数组让前端 UI 合并视图与后端 stage 模型解耦。
   *
   * `autopilot-streaming-experience` integration-gap-2026-05-16。
   */
  stageFilter?: string | readonly string[];
}> = ({ locale = "zh-CN", stageFilter }) => {
  const entries = useBlueprintRealtimeStore((s) => s.agentReasoning.entries);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isZh = locale === "zh-CN";

  // 自动滚到最新
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [entries.length]);

  // 防御性兜底：与其它 store-observability 组件保持一致，
  // mock store 仅注入部分字段时也不抛错。
  const safeEntries = Array.isArray(entries) ? entries : [];

  // 把 stageFilter 归一化为 Set，统一处理 string | string[] 两种形态。
  const stageFilterSet =
    stageFilter === undefined
      ? undefined
      : new Set(
          typeof stageFilter === "string" ? [stageFilter] : stageFilter,
        );

  const visibleEntries = safeEntries.filter((e) => {
    // 过滤掉迭代标记
    if (
      e.phase === "iteration_started" ||
      e.phase === "iteration_completed"
    ) {
      return false;
    }
    // 阶段过滤：当 stageFilterSet 提供时，只保留 stageId ∈ Set 的条目；
    // entry.stageId 缺失视为「全局事件」继续显示，避免历史 entries 被误剔。
    if (stageFilterSet && e.stageId && !stageFilterSet.has(e.stageId)) {
      return false;
    }
    return true;
  });

  if (visibleEntries.length === 0) return null;

  return (
    <div
      data-testid="agent-reasoning-sub-timeline"
      className="mt-3 max-h-[360px] overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3"
    >
      {/* 左右双轨布局：Think 左 / Act+Observe 右 */}
      <div className="grid grid-cols-[1fr_2px_1fr] gap-2 relative">
        {/* 中轴线 */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-200 -translate-x-1/2" />

        {visibleEntries.map((entry) => {
          const isLeft = entry.phase === "thinking";
          const isCenter =
            entry.phase === "error" || entry.phase === "completed";

          if (isCenter) {
            const bannerClass =
              entry.phase === "error"
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-emerald-300 bg-emerald-50 text-emerald-700";
            return (
              <div
                key={entry.id}
                className={`col-span-3 rounded border px-3 py-2 text-xs text-center font-semibold ${bannerClass}`}
              >
                {entry.phase === "completed" ? "✓ " : "⚠ "}
                {entry.reason ?? entry.error ?? (isZh ? "推理完成" : "Complete")}
              </div>
            );
          }

          const icon =
            isLeft ? "💭" : entry.phase === "acting" ? "⚡" : "👁";
          const bgClass = isLeft
            ? "bg-blue-50 border-blue-200"
            : entry.phase === "acting"
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50 border-emerald-200";
          const gridCol = isLeft ? "1" : "3";

          return (
            <div
              key={entry.id}
              className={`rounded border px-2 py-1.5 text-[11px] ${bgClass}`}
              style={{ gridColumn: gridCol }}
            >
              <div className="flex items-center gap-1">
                <span>{icon}</span>
                <span className="font-bold text-slate-600 uppercase text-[9px]">
                  {entry.phase}
                </span>
                <span className="ml-auto text-[8px] text-slate-400 font-mono">
                  {entry.iterationLabel}
                </span>
              </div>
              {entry.thought && (
                <p className="mt-0.5 text-slate-700 leading-snug">
                  {entry.thought}
                </p>
              )}
              {entry.actionToolId && (
                <p className="mt-0.5 font-mono text-[9px] text-slate-500">
                  → {entry.actionToolId}
                </p>
              )}
              {entry.observationSummary && (
                <p className="mt-0.5 text-slate-600">
                  {entry.observationSuccess ? "✓" : "✗"}{" "}
                  {entry.observationSummary}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
};

export default AgentReasoningSubTimeline;
