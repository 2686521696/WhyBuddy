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
 *
 * ⚠ 2026-09-26 第二版。第一版只在 `liveAction` 为空时才走「在想下一步」，
 *   判据也喂的是 liveAction={null}。真机 sr-20260926103934-KXTT09V6JE 里它从来
 *   不为空：工具一结束，liveAction 被改写成过去式「已执行工程命令」，第一个分支
 *   就把它当「正在」返回了——修复在真机上一次都没走到（本仓 §一之二）。
 *   现在认 liveAction.settled；判据改成用那一轮的原样事件驱动真 hook。
 *
 * ⚠ 2026-09-27 第三版。真机 sr-20260927052041-2V6K4Z5SPY：模型先 todo_write 再
 *   写 2 分钟脚本。todo 的结果摘要作为一段 model_speech 挂在步骤末尾，第二版只认
 *   「最后一步是收尾的动作 chip」才算空闲，于是退回「正在推演...」。现在工程档里
 *   只要没有工具在跑、最后一步又没有可显示的字，就是在想下一步。
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
  liveActionSettled,
  latestStep,
  latestStepText,
  runtimeKind,
  todo,
  fallback,
}: {
  liveActionLabel?: string | null;
  /** liveAction 是一个已经结束的动作（过去式标签），不算「正在」。 */
  liveActionSettled?: boolean;
  latestStep?: TurnStep | null;
  latestStepText: string;
  runtimeKind?: "html-prototype" | "project";
  todo?: LiveTodo[] | null;
  fallback: string;
}): string {
  if (liveActionLabel && !liveActionSettled) return liveActionLabel;
  // 最后一步没有可显示的字，也是空闲：第 21 轮 todo_write 的摘要作为 model_speech
  // 挂在末尾，第二版只认「最后一步是收尾的动作 chip」，状态行退回「正在推演...」。
  //
  // ⚠ 2026-10-02 第四版。用户截图（采购审批应用，规划阶段答完问卷）：重新加载完技能之后干等 10 分 32 秒，
  //   状态行一直是「◌ 已加载技能」——像卡在加载技能上，其实是模型那一发在网关上没回来。
  //   规划阶段还没有工程（runtimeKind 不是 project），上面那条判断进不来，退回了最后一步的过去式。
  //   liveActionSettled 只由控制面工具回执标（useSlideRuleSession 的 onControlToolResult）——
  //   工具结束了、没有新工具在跑，下一步就是模型在想，有没有工程都一样。
  //   HTML 推演的阶段不带这个标，照旧（下面那条反向判据钉着）。
  if (liveActionSettled || (runtimeKind === "project" && (isSettledAction(latestStep) || !latestStepText))) {
    const doing = (todo || [])
      .find(t => t.status === "in_progress")
      ?.content?.trim();
    return doing ? `${THINKING_NEXT}：${doing}` : THINKING_NEXT;
  }
  return latestStepText || fallback;
}
