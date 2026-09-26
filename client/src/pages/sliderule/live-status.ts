/**
 * 回合进行中那一行状态文案：「现在在干什么」。
 *
 * ## 为什么单拎出来（2026-09-26）
 *
 * 隔离真机 sr-20260926043506-7B49NNSE1M（PPT 话题）：批准后模型用 4 分 20 秒
 * 一口气写生成脚本（控制面那一发不是流式，写完之前宿主一个事件都收不到）。
 * 这段时间状态行一直是
 *
 *     ◌ 已创建工程                           已等待 2 分 16 秒
 *
 * 转圈 + 一个**已经做完的**动作名。用户读到的是「卡在创建工程上了」，
 * 而工程两分钟前就建好了——真正在发生的是模型在写下一步。原来的写法是
 *
 *     liveAction?.label || latestStepText || "正在推演..."
 *
 * 没有工具在跑时回落到最后一步的标签，而工程档最后一步是一枚**已完成的
 * 动作 chip**。那枚 chip 在列表里打勾是对的，拿来当「正在」就是错的。
 *
 * ## 现在只说宿主确知的事
 *
 *   · 有工具在跑 → 它的标签（liveAction）；
 *   · 工程档、没有工具在跑、最后一步是做完/失败了的动作 → 模型在想下一步。
 *     模型自己标了 in_progress 的待办就一起说出来——那是它自己写的「正在做什么」；
 *   · 其余（开口、叙述、HTML 推演的阶段）照旧用最后一步的文字。
 *
 * ⚠ 不猜模型在写哪个文件：那一发没流式，猜出来就是编的。
 */
import type { TurnStep } from "./types";

export const THINKING_NEXT = "正在想下一步";

export type LiveTodo = { status?: string; content?: string };

/** 这一步是不是一枚已经收尾的动作 chip（打了勾或打了叉）。 */
export function isSettledAction(step: TurnStep | null | undefined): boolean {
  return Boolean(
    step &&
      step.kind === "chip" &&
      (step.progressType === "completed" || step.progressType === "failed")
  );
}

export function liveStatusText({
  liveActionLabel,
  latestStep,
  latestStepText,
  runtimeKind,
  todo,
  fallback,
}: {
  liveActionLabel?: string | null;
  latestStep?: TurnStep | null;
  latestStepText: string;
  runtimeKind?: "html-prototype" | "project";
  todo?: LiveTodo[] | null;
  fallback: string;
}): string {
  if (liveActionLabel) return liveActionLabel;
  if (runtimeKind === "project" && isSettledAction(latestStep)) {
    const doing = (todo || [])
      .find(t => t.status === "in_progress")
      ?.content?.trim();
    return doing ? `${THINKING_NEXT}：${doing}` : THINKING_NEXT;
  }
  return latestStepText || fallback;
}
