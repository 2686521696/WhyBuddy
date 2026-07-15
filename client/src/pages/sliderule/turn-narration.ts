import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { TurnStep } from "./types";

/**
 * E13 直播时间线持久化（用户裁决 2026-07-15，方案 1）。
 *
 * 左栏推演直播（阶段步骤条 + 逐步叙述）此前只活在浏览器内存：刷新后
 * derive-persisted-turn 只能重建 steps 为空的骨架轮次，「7 阶段 25 步」
 * 缩成「1 阶段 0 步」。本模块把轮次落定时的 steps 随既有 PUT 通道写进
 * 会话状态（turnNarrations，纯展示投影、无信任语义；Python 侧封顶
 * 3 轮 × 300 步 × 1200 字符），刷新后完整回放。
 */

export type TurnNarrationEntry = {
  turnId: string;
  user?: string;
  steps: TurnStep[];
  /** 本轮真实用时（E16 收口句回放用） */
  durationMs?: number;
};

const MAX_TURNS = 3;
const MAX_STEPS = 300;
const MAX_TEXT = 1200;

function slimStep(step: TurnStep): TurnStep {
  const slim: Record<string, unknown> = { ...step };
  for (const key of ["text", "message", "label", "title"] as const) {
    const v = slim[key];
    if (typeof v === "string" && v.length > MAX_TEXT) {
      slim[key] = v.slice(0, MAX_TEXT) + "…";
    }
  }
  return slim as TurnStep;
}

/** 轮次落定时打戳：把本轮 steps 合并进 state.turnNarrations（同轮覆盖，
 *  只留最近 MAX_TURNS 轮）。原地不动传入对象——返回带戳的浅拷贝。 */
export function stampTurnNarration(
  state: V5SessionState,
  entry: TurnNarrationEntry
): V5SessionState {
  if (!entry.turnId || entry.steps.length === 0) return state;
  const prior = (state.turnNarrations || []).filter(
    n => n && n.turnId !== entry.turnId
  );
  const stamped = [
    ...prior,
    {
      turnId: entry.turnId,
      user: (entry.user || "").slice(0, 600),
      steps: entry.steps.slice(0, MAX_STEPS).map(slimStep),
      ...(entry.durationMs ? { durationMs: Math.round(entry.durationMs) } : {}),
    },
  ].slice(-MAX_TURNS);
  return { ...state, turnNarrations: stamped };
}

const KNOWN_KINDS = new Set([
  "narration",
  "chip",
  "step_narration",
  "capability_fail",
  "llm_output",
]);

/** 刷新回放：从持久化状态取指定轮（缺省最新一轮）的叙述步骤。
 *  持久化数据来自网络往返，形状按未知输入校验——只放行已知 kind 的
 *  dict，其余丢弃（宁缺勿崩）。 */
export function narrationStepsFor(
  state: V5SessionState | null | undefined,
  turnId?: string | null
): { turnId: string; user: string; steps: TurnStep[]; durationMs?: number } | null {
  const all = (state?.turnNarrations || []).filter(
    (n): n is { turnId: string; user?: string; steps: unknown[] } =>
      !!n && typeof n.turnId === "string" && Array.isArray(n.steps)
  );
  if (all.length === 0) return null;
  const entry = turnId ? all.find(n => n.turnId === turnId) : all[all.length - 1];
  if (!entry) return null;
  const steps = entry.steps.filter(
    (s): s is TurnStep =>
      !!s &&
      typeof s === "object" &&
      typeof (s as { id?: unknown }).id === "string" &&
      KNOWN_KINDS.has(String((s as { kind?: unknown }).kind))
  );
  if (steps.length === 0) return null;
  const durationMs = Number((entry as { durationMs?: unknown }).durationMs);
  return {
    turnId: entry.turnId,
    user: String(entry.user || ""),
    steps,
    ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
  };
}
