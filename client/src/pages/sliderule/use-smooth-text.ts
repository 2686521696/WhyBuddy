/**
 * useSmoothText — 流式输出节奏平滑（E16 手感层第 1 刀，用户批准 2026-07-15）。
 *
 * 网关是突发式的：reasoning 憋很久、然后哗一下吐一大块。直接渲染原始
 * delta 的观感就是"卡顿 + 爆发"。本 hook 在展示层加平滑缓冲：目标文本
 * 随便怎么跳，展示文本按自适应速率匀速追——积压多就快放、快见底就慢放，
 * 观感永远是稳定的打字流（Claude 的手感来源之一）。
 *
 * 诚实边界：只调整"已到达内容"的展示节奏，不预测、不伪造；追平积压有
 * 上限时长（大段积压最多 ~1.5s 追完），完成态立即放完不拖泥带水。
 */

import React from "react";

/** 每帧放出的字符数：积压的 1/8（下限 2，无上限——几何衰减保证任意
 *  积压 ~1.5s 内追平；巨量积压快放正是设计意图，网关一次吐 8k 时
 *  拖 10 秒慢慢打字反而是伪造节奏）。60fps 下尾部最慢 120 字/s。 */
export function drainStep(backlog: number): number {
  if (backlog <= 0) return 0;
  return Math.max(2, Math.ceil(backlog / 8));
}

/** 目标是否是展示的"前缀延续"：不是（换轮/重置/回退）就该瞬时对齐。 */
export function isPrefixContinuation(shown: string, target: string): boolean {
  return target.length >= shown.length && target.startsWith(shown);
}

/** 单帧推进（纯函数，泵的全部语义在此）：
 *  非前缀延续 → 瞬时对齐；有积压 → 按 drainStep 放出一段。 */
export function advanceShown(shown: string, target: string): string {
  if (!isPrefixContinuation(shown, target)) return target;
  const backlog = target.length - shown.length;
  if (backlog <= 0) return shown;
  return target.slice(0, shown.length + drainStep(backlog));
}

export function useSmoothText(
  target: string,
  options?: {
    /** false = 直通（归档态/回放态不需要动画） */
    enabled?: boolean;
  }
): string {
  const enabled = options?.enabled !== false;
  const [shown, setShown] = React.useState(target);
  const shownRef = React.useRef(target);
  const targetRef = React.useRef(target);
  const rafRef = React.useRef<number | null>(null);

  const reducedMotion = React.useMemo(() => {
    try {
      return (
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
      );
    } catch {
      return false;
    }
  }, []);

  React.useEffect(() => {
    targetRef.current = target;
    // 直通条件：关闭 / 降动效 / 非前缀延续（换话题、重置、内容回退）
    if (!enabled || reducedMotion || !isPrefixContinuation(shownRef.current, target)) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    if (shownRef.current === target) return;
    if (rafRef.current != null) return; // 已有泵在跑，让它继续追新目标

    const pump = () => {
      const next = advanceShown(shownRef.current, targetRef.current);
      shownRef.current = next;
      setShown(next);
      rafRef.current =
        next.length < targetRef.current.length
          ? requestAnimationFrame(pump)
          : null;
    };
    rafRef.current = requestAnimationFrame(pump);
  }, [target, enabled, reducedMotion]);

  React.useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  return enabled ? shown : target;
}
