/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 Step 3。
 *
 * 阶段激活日志：从 useBlueprintRealtimeStore.agentProgress 读取最近的 agent
 * 进度事件，渲染一段时间线。此组件是 store.agentProgress 在前端的第一位消费者。
 *
 * 增强（Task 4.2）：在激活日志下方混入 DiscussionTimeline 条目，
 * 按时间戳排序合并显示。
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
import { useAppStore } from "@/lib/store";
import type { AppLocale } from "@/lib/locale";

import { DiscussionTimeline } from "./crew-activation/DiscussionTimeline";
import { useRoleCrewState } from "./crew-activation/useRoleCrewState";

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
      return "text-blue-300";
    case "acting":
      return "text-amber-300";
    case "observing":
      return "text-emerald-300";
    case "completed":
      return "text-emerald-400";
    case "failed":
      return "text-rose-400";
  }
}

/**
 * Fleet 阶段激活日志面板。
 *
 * 消费 `useBlueprintRealtimeStore.agentProgress`（FIFO，最新在末尾），
 * 截取最近 12 条按时间正序渲染，使顶部为最早、底部为最新，
 * 滚动到底部即可看到最新事件。
 *
 * 增强（Task 4.2）：在激活日志下方渲染 DiscussionTimeline，
 * 展示角色讨论与决策条目。
 */
export const FleetActivationLog: FC = () => {
  const agentProgress = useBlueprintRealtimeStore((s) => s.agentProgress);
  const locale = useAppStore((s) => s.locale) as AppLocale;
  const { discussions } = useRoleCrewState();

  // 防御性兜底：与 RoleStatusStrip / CapabilityRail 保持一致。store 初始
  // state 中 `agentProgress` 即为 `[]`，正常路径下不会是 undefined / null；
  // 但既有测试 mock `useBlueprintRealtimeStore` 时可能只返回部分字段，
  // 此时 selector 取到 undefined。把空 / 缺省 / null / undefined / 非数组
  // 一律视为折叠态，避免 `.slice()` 抛错。
  const hasProgress = Array.isArray(agentProgress) && agentProgress.length > 0;
  const hasDiscussions = discussions && discussions.length > 0;

  if (!hasProgress && !hasDiscussions) {
    return null;
  }

  // store 端是 FIFO（最新在末尾），所以取末尾 N 条即"最近 N 条"；
  // 取出后已经天然按 timestamp 升序，正序渲染即可让顶部=最早、底部=最新。
  const visible = hasProgress
    ? agentProgress.slice(-FLEET_ACTIVATION_LOG_VISIBLE_LIMIT)
    : [];

  return (
    <div data-testid="fleet-activation-log">
      {/* 原有激活日志条目 */}
      {visible.length > 0 && (
        <div
          className="mt-1 max-h-[140px] overflow-y-auto rounded border border-white/[0.08] bg-white/[0.03] p-2 text-[10px] font-mono"
        >
          {visible.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 py-0.5">
              <span className="text-white/35">[{formatTimestamp(entry.timestamp)}]</span>
              <span className="font-bold text-white/80">{entry.roleId}</span>
              <span className="text-white/55">
                <span className={resolveTypeColorClass(entry.type)}>{entry.type}</span>
                {entry.message ? ` · ${entry.message}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 讨论时间线条目 */}
      {hasDiscussions && (
        <div className="mt-2">
          <DiscussionTimeline discussions={discussions} locale={locale} />
        </div>
      )}
    </div>
  );
};

export default FleetActivationLog;
