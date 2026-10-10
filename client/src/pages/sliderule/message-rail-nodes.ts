/**
 * 对话导轨的数据：一条消息一个刻度。照 grok-app（RongleCat/grok-app，src/lib/sessionMessageNodes.ts）。
 *
 * 2026-10-10 用户要的：长对话（一轮推演动辄十几步）来回翻太累，抄 grok-app 左侧那条「进度刻度」——一条短横线
 * 一条消息，悬停看是谁说的、说了什么、第几条，点一下跳过去。
 *
 * ⚠ 刻度跟屏幕上的消息**同源**：都从 buildImItems(uiTurns) 来（SlideRule.tsx 的消息列表也吃它）。各算一份的话，
 *   续跑轮被折叠、撞 id 被丢弃这些规则只要一边改了，刻度就跟消息对不上——点第 7 条跳到第 8 条（CLAUDE.md 四）。
 *   用户那条没有可见正文（系统提示 / 空恢复轮）时 ImUserMessage 不渲染，这里同样不出刻度。
 */
import type { UiTurn } from "./types";
import { visibleUserMessage } from "./user-message-display";

export type RailRole = "user" | "assistant";

export type RailNode = {
  /** = 消息的 id（ImItem.id），也是 DOM 上 data-message-id 的值。 */
  id: string;
  role: RailRole;
  /** 第几个刻度（从 0 起）。 */
  nodeIndex: number;
  preview: string;
  status: "pending" | "done" | "error";
};

/** grok-app 的 PREVIEW_MAX。 */
export const RAIL_PREVIEW_MAX = 72;

export function truncateRailPreview(text: string | null | undefined, max = RAIL_PREVIEW_MAX): string {
  const raw = String(text ?? "")
    // 预览是一行字：去掉 markdown 记号，别把「**加粗**」「# 标题」原样露出来。
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>|]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "…";
  return raw.length <= max ? raw : `${raw.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * 面团这一轮说的话：最终正文优先，没有就用动手前的开口（model_speech）。
 * ⚠ 不拿 narration：那是平台旁白（「正在解析意图…」），对话栏里已经去掉「正在」改成活动行，
 *   刻度预览再原样露一遍就是同一句话两种写法（unified-surface 那条「动词去掉正在」的判据第一版就红在这）。
 */
function assistantPreview(turn: UiTurn): string {
  if (turn.assistant && turn.assistant.trim()) return turn.assistant;
  for (let i = turn.steps.length - 1; i >= 0; i--) {
    const step = turn.steps[i];
    if (step.kind === "model_speech" && step.text.trim()) return step.text;
  }
  return turn.status === "streaming" ? "正在处理…" : "";
}

export type RailSourceItem = { id: string; role: RailRole; turn: UiTurn };

/** items 必须是 buildImItems(uiTurns) 的结果——跟消息列表同一份（模块头）。 */
export function buildRailNodes(items: readonly RailSourceItem[]): RailNode[] {
  const out: RailNode[] = [];
  for (const item of items) {
    if (item.role === "user") {
      const visible = visibleUserMessage(item.turn.user);
      if (!visible.prompt && visible.files.length === 0) continue;   // ImUserMessage 不渲染的，这里也不出刻度
      out.push({
        id: item.id,
        role: "user",
        nodeIndex: out.length,
        preview: truncateRailPreview(visible.prompt || visible.files.join("、")),
        status: "done",
      });
      continue;
    }
    const failed = item.turn.assistantSource === "fallback" && item.turn.assistant.startsWith("推演中断");
    out.push({
      id: item.id,
      role: "assistant",
      nodeIndex: out.length,
      preview: truncateRailPreview(assistantPreview(item.turn)),
      status: item.turn.status === "streaming" ? "pending" : failed ? "error" : "done",
    });
  }
  return out;
}

export type RailRect = { id: string; top: number; bottom: number };

/**
 * 正在读哪一条：视口上沿往下 28% 那条线（grok-app 的 focusY），线以上最后一条开了头的消息。
 * 一条都没过线（滚到最顶）就取离线最近的那条。
 */
export function pickActiveNodeId(rects: readonly RailRect[], focusY: number): string | null {
  if (rects.length === 0) return null;
  let reading: RailRect | null = null;
  for (const rect of rects) if (rect.top <= focusY + 1) reading = rect;
  if (reading) return reading.id;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const rect of rects) {
    const dist = Math.abs((rect.top + rect.bottom) / 2 - focusY);
    if (dist < bestDist) {
      bestDist = dist;
      best = rect.id;
    }
  }
  return best;
}

/** 上一条 / 下一条。当前不在列表里：往下从第一条开始，往上从最后一条开始。到头返回 null。 */
export function adjacentRailNode(
  nodes: readonly RailNode[],
  currentId: string | null | undefined,
  delta: -1 | 1
): RailNode | null {
  if (nodes.length === 0) return null;
  const at = currentId ? nodes.findIndex(node => node.id === currentId) : -1;
  if (at < 0) return delta > 0 ? nodes[0] ?? null : nodes[nodes.length - 1] ?? null;
  return nodes[at + delta] ?? null;
}
