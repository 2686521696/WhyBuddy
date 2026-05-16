/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 Step 3。
 *
 * 阶段激活日志：从 useBlueprintRealtimeStore.agentProgress 读取最近的 agent
 * 进度事件，渲染一段时间线。此组件是 store.agentProgress 在前端的第一位消费者。
 *
 * 设计原则：
 * - 只读：不写 store，不订阅 socket
 * - 折叠态：agentProgress 为空时返回 null
 * - 显示最近 12 条；每条格式 `[HH:MM:SS] roleId · type · message?`
 * - 可在多个位置挂载：右栏 fabric 分支与 AutopilotVisualStage 顶部 HUD 都是合法挂载点
 */

import type { FC } from "react";

import {
  useBlueprintRealtimeStore,
  type AgentProgressEntry,
} from "@/lib/blueprint-realtime-store";

/**
 * 一次性最多渲染的进度条目数。store 端 FIFO cap 为 50，本面板再
 * 截取最近 12 条以保持视觉密度可控。
 */
const FLEET_ACTIVATION_LOG_VISIBLE_LIMIT = 12;

/**
 * 把 `entry.timestamp`（epoch ms）格式化为 `HH:MM:SS`。
 *
 * 直接走 `Date.toTimeString().slice(0, 8)`：与浏览器本地时区保持一致，
 * 不引入额外格式化依赖；与 store 内部时间戳产生路径一致（也是 `Date.now()` 出来的本地 epoch）。
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toTimeString().slice(0, 8);
}

/**
 * 不同 progress type 对应的字体颜色 class。
 *
 * 仅对 type 文案上色；message / 时间戳 / roleId 保持中性色，避免
 * 一行里出现过多色块导致信息层级模糊。
 */
function resolveTypeColorClass(type: AgentProgressEntry["type"]): string {
  switch (type) {
    case "thinking":
      return "text-blue-600";
    case "acting":
      return "text-amber-600";
    case "observing":
      return "text-emerald-600";
    case "completed":
      return "text-emerald-700";
    case "failed":
      return "text-rose-600";
  }
}

/**
 * Fleet 阶段激活日志面板。
 *
 * 消费 `useBlueprintRealtimeStore.agentProgress`（FIFO，最新在末尾），
 * 截取最近 12 条按时间正序渲染，使顶部为最早、底部为最新，
 * 滚动到底部即可看到最新事件。
 */
export const FleetActivationLog: FC = () => {
  const agentProgress = useBlueprintRealtimeStore((s) => s.agentProgress);

  // 防御性兜底：与 RoleStatusStrip / CapabilityRail 保持一致。store 初始
  // state 中 `agentProgress` 即为 `[]`，正常路径下不会是 undefined / null；
  // 但既有测试 mock `useBlueprintRealtimeStore` 时可能只返回部分字段，
  // 此时 selector 取到 undefined。把空 / 缺省 / null / undefined / 非数组
  // 一律视为折叠态，避免 `.slice()` 抛错。
  if (!Array.isArray(agentProgress) || agentProgress.length === 0) {
    return null;
  }

  // store 端是 FIFO（最新在末尾），所以取末尾 N 条即"最近 N 条"；
  // 取出后已经天然按 timestamp 升序，正序渲染即可让顶部=最早、底部=最新。
  const visible = agentProgress.slice(-FLEET_ACTIVATION_LOG_VISIBLE_LIMIT);

  return (
    <div
      data-testid="fleet-activation-log"
      className="mt-3 max-h-[180px] overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2 text-[10px] font-mono"
    >
      {visible.map((entry) => (
        <div key={entry.id} className="flex items-center gap-2 py-0.5">
          <span className="text-slate-400">[{formatTimestamp(entry.timestamp)}]</span>
          <span className="font-bold text-slate-700">{entry.roleId}</span>
          <span className="text-slate-500">
            <span className={resolveTypeColorClass(entry.type)}>{entry.type}</span>
            {entry.message ? ` · ${entry.message}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
};

export default FleetActivationLog;
