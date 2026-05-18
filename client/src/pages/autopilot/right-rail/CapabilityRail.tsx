/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 Step 2。
 *
 * 横向能力调用条：从 useBlueprintRealtimeStore.capabilityStatuses 读取所有已知
 * 能力的调用状态，按 4 类状态着色。此组件是 store.capabilityStatuses 在前端的
 * 第一位消费者。
 *
 * 设计原则：
 * - 只读：不写 store，不订阅 socket
 * - 折叠态：capabilityStatuses 为空时返回 null
 * - 可在多个位置挂载：右栏 fabric 分支与 AutopilotVisualStage 顶部 HUD 都是合法挂载点
 *
 * 数据来源：
 * - `useBlueprintRealtimeStore.capabilityStatuses: Record<string, CapabilityStatus>`
 * - 由 `capability.invoked` / `capability.completed` / `capability.failed`
 *   socket 事件填充，键为 capabilityId（如 `"role-system-architecture"`、
 *   `"docker-analysis-sandbox"` 等）。
 *
 * autopilot-capability-bridge-runtime-panel — 集成 CapabilityBridgePanel：
 * - 在现有能力状态徽章下方渲染 Bridge 运行时面板
 * - 面板内部调用 useCapabilityBridgeState()，无调用数据时返回 null
 */

import type { FC } from "react";

import {
  useBlueprintRealtimeStore,
  type CapabilityStatus,
} from "@/lib/blueprint-realtime-store";
import type { AppLocale } from "@/lib/locale";
import { useAppStore } from "@/lib/store";

import { CapabilityBridgePanel } from "./capability-panel/CapabilityBridgePanel";

// ---------------------------------------------------------------------------
// 状态 → 样式映射
// ---------------------------------------------------------------------------

/**
 * 按 `CapabilityStatus` 派生 Tailwind 类。颜色与 `BlueprintLogStream` 中的
 * level 配色保持同色族，但状态语义不同：
 * - `idle`      → slate（未触发）
 * - `invoking`  → amber（进行中，带 pulse）
 * - `completed` → emerald（成功）
 * - `failed`    → rose（失败）
 */
function statusToClass(status: CapabilityStatus): string {
  switch (status) {
    case "idle":
      return "bg-slate-100 text-slate-500";
    case "invoking":
      return "bg-amber-100 text-amber-700 animate-pulse";
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "failed":
      return "bg-rose-100 text-rose-700";
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 横向能力调用条组件。
 *
 * 行为契约：
 * 1. 通过 selector 仅订阅 `capabilityStatuses` 切片，避免无关 re-render。
 * 2. 当 `Object.keys(capabilityStatuses).length === 0` 返回 `null`，对外不
 *    占据布局空间。
 * 3. 否则渲染 `<div data-testid="capability-rail" className="flex flex-wrap
 *    gap-1.5">`，每条 `[capabilityId, status]` 渲染为一颗 pill 形 badge。
 * 4. badge 内嵌 `bg-current` 状态点（`opacity-70`），文字使用全 capabilityId
 *    并通过 `truncate max-w-[160px]` 防止长 id 撑破布局。
 * 5. 排序按 capabilityId 字母序稳定（`localeCompare`），保证 DOM 顺序与
 *    渲染前后一致，便于回归断言。
 * 6. 在状态徽章下方渲染 CapabilityBridgePanel，面板内部无调用数据时返回 null。
 */
export const CapabilityRail: FC = () => {
  const capabilityStatuses = useBlueprintRealtimeStore(
    (s) => s.capabilityStatuses
  );
  const locale = useAppStore((s) => s.locale) as AppLocale;

  // 防御性兜底：与 RoleStatusStrip 保持一致。store 初始 state 中
  // `capabilityStatuses` 即为 `{}`，正常路径下不会是 undefined / null；
  // 但既有 `AutopilotRightRail.subtimeline-mount.test.tsx` 等测试 mock
  // `useBlueprintRealtimeStore` 时只返回部分字段（如仅 `agentReasoning`），
  // 此时 selector 取到 undefined。把空 / 缺省 / null / undefined 一律
  // 视为折叠态，避免 `Object.entries(undefined)` 抛错。
  const entries =
    capabilityStatuses && typeof capabilityStatuses === "object"
      ? Object.entries(capabilityStatuses)
      : [];
  if (entries.length === 0) {
    return null;
  }

  // 按 capabilityId 字母序排序，确保 DOM 顺序稳定（不依赖 store 内 Object 插入序）。
  const sorted = [...entries].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div data-testid="capability-rail" className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {sorted.map(([capabilityId, status]) => (
          <span
            key={capabilityId}
            data-capability-id={capabilityId}
            data-capability-status={status}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${statusToClass(
              status
            )}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-current opacity-70"
              aria-hidden="true"
            />
            <span className="truncate max-w-[160px]">{capabilityId}</span>
          </span>
        ))}
      </div>
      {/* autopilot-capability-bridge-runtime-panel：Bridge 运行时面板 */}
      <CapabilityBridgePanel locale={locale} />
    </div>
  );
};

export default CapabilityRail;
