/**
 * Autopilot 右栏底部叙事 Swiper — useAutoRotation hook
 *
 * 把 Narrative_Swiper 的 Auto_Rotation 行为抽象成纯 React hook，由
 * `<NarrativeSwiper>` 组合 hover / focus / 手动浏览状态后传入 `paused` 与
 * `reducedMotion`，本 hook 只关心 timer 调度与 `activeIndex` 维护。
 *
 * 对应 spec：
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/requirements.md`
 *   - Requirement 2.3：按 Dwell_Time 默认 5 秒（3-8 秒区间）向前推进
 *   - Requirement 8.5：Reduced_Motion 模式下关闭 Auto_Rotation
 *   - Requirement 9.1：1 秒内最多 1 次 Auto_Rotation 步进
 *   - Requirement 9.5：卸载时清理所有定时器，不在 React 严格模式下产生悬挂副作用
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/design.md`
 *   §"useAutoRotation(...)"
 *
 * 实现要点：
 * 1. 用 `setTimeout` 单次链式调度（每次步进结束都重新调度下一次），effect
 *    cleanup 中 `clearTimeout`，避免悬挂 timer。
 * 2. `paused = true` 时不调度新 timer；恢复后会触发 effect 重新调度。
 * 3. `reducedMotion = true` 时锁定 `activeIndex = 0`，不调度 timer，
 *    `setActiveIndex(...)` 调用不会改变 `activeIndex`（Req 8.5）。
 * 4. `Math.max(dwellMs, 1000)` 保证 ≤ 1 步 / 秒（Req 9.1）。
 * 5. `dwellPerCard?: (card) => number` 可按 source / severity 调整 dwell；
 *    若提供 `cards` 数组，调用时传入 `cards[activeIndex]`。
 * 6. `total <= 1` 时不调度 timer（无可轮播的下一张）。
 * 7. `setActiveIndex(next)` 对 `total > 0` 做 modulo 环绕，越界值映射回
 *    `[0, total)`；`total === 0` 时为 no-op。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { NarrativeCard } from './narrative-card-types';

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * Auto_Rotation 的最小 dwell 时间（ms）。
 *
 * Requirement 9.1 要求 1 秒内最多 1 次步进，因此即便上层传入的 dwellMs 小于
 * 1000ms，也会被拉回到 1000ms 这一下限。
 */
const MIN_DWELL_MS = 1000;

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * `useAutoRotation(...)` 的入参选项（design.md §useAutoRotation）。
 *
 * 字段语义：
 * - `total`：当前可见 Narrative_Card 数量，对应 `useNarrativeCardStream` 返回
 *   的 `cards.length`。`total <= 1` 时 hook 不调度任何 timer。
 * - `defaultDwellMs`：默认 dwell 时间（ms）。建议 3000-8000，落在 Req 2.3
 *   的「3-8 秒」区间。最小值会被 `MIN_DWELL_MS = 1000` 兜底。
 * - `dwellPerCard`：可选回调，用于按当前活跃卡片（`cards[activeIndex]`）的
 *   `source` / `severity` 等属性调整 dwell 时间。返回值同样会被
 *   `MIN_DWELL_MS` 兜底。
 * - `cards`：当前可见卡片数组，仅在 `dwellPerCard` 提供时使用，本 hook 不
 *   读取其它字段，避免成为 `cards` 引用变化的次级订阅源。
 * - `paused`：上层组合的暂停标记（hover / focus / 手动浏览态等任一为真即
 *   传入 true）。为 true 时不调度新 timer，已存在 timer 在下一次 effect
 *   cleanup 中被清除。
 * - `reducedMotion`：来自 `prefers-reduced-motion: reduce` 的订阅结果。命中
 *   时 `activeIndex` 锁定为 0，且 `setActiveIndex(...)` 视为 no-op
 *   （Req 8.5）。
 */
export interface UseAutoRotationOptions {
  /** 当前可见 Narrative_Card 数量，对应 `cards.length`。 */
  total: number;
  /** 默认 dwell 时间（ms）；最小值兜底为 `MIN_DWELL_MS`。 */
  defaultDwellMs: number;
  /** 可选：按当前活跃卡片返回 dwell 时间（ms）。 */
  dwellPerCard?: (card: NarrativeCard) => number;
  /** 当前可见卡片数组；仅用于 `dwellPerCard` 调用，hook 不读取其它字段。 */
  cards?: NarrativeCard[];
  /** 暂停标记：true 时不调度新 timer。 */
  paused: boolean;
  /** Reduced_Motion 模式：true 时锁定 `activeIndex = 0` 且不调度 timer。 */
  reducedMotion: boolean;
}

/**
 * `useAutoRotation(...)` 的返回结构（design.md §useAutoRotation）。
 *
 * - `activeIndex`：当前 Auto_Rotation 指针，落在 `[0, total)`；`total === 0`
 *   或 `reducedMotion === true` 时恒为 0。
 * - `setActiveIndex(next)`：手动跳转入口（左右按钮 / 键盘 / 拖拽手势）。对
 *   `total > 0` 做 modulo 环绕；`total === 0` 或 `reducedMotion === true`
 *   时为 no-op。
 */
export interface UseAutoRotationResult {
  /** 当前 Auto_Rotation 指针，`[0, total)`。 */
  activeIndex: number;
  /** 手动跳转入口；越界值通过 modulo 环绕回 `[0, total)`。 */
  setActiveIndex: (next: number) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * 把任意整数环绕到 `[0, total)`。
 *
 * `total <= 0` 时返回 0；负数索引通过两次取模映射回正区间，保证 `((next %
 * total) + total) % total` 永远落在 `[0, total)`。
 */
function wrapIndex(next: number, total: number): number {
  if (total <= 0) return 0;
  const normalized = Math.trunc(next);
  return ((normalized % total) + total) % total;
}

/**
 * 把任意 dwell 候选值兜底到 `[MIN_DWELL_MS, +∞)`。
 *
 * 用于：
 * - `defaultDwellMs` 由上层注入，可能小于 1000ms；
 * - `dwellPerCard(card)` 返回值可能为 `NaN` / 负数 / 0。
 *
 * 任意非有限数值（`NaN` / `Infinity`）都退回 `MIN_DWELL_MS`，保证 timer 不
 * 会立即重入或挂起。
 */
function clampDwellMs(candidate: number): number {
  if (!Number.isFinite(candidate)) return MIN_DWELL_MS;
  return Math.max(candidate, MIN_DWELL_MS);
}

// ─── Hook ──────────────────────────────────────────────────────────────────

/**
 * Narrative_Swiper Auto_Rotation 调度 hook。
 *
 * @see UseAutoRotationOptions
 * @see UseAutoRotationResult
 */
export function useAutoRotation(
  options: UseAutoRotationOptions,
): UseAutoRotationResult {
  const { total, defaultDwellMs, dwellPerCard, cards, paused, reducedMotion } =
    options;

  const [activeIndex, setActiveIndexState] = useState(0);

  // Reduced_Motion 命中时强制把指针拉回 0，确保从“非 reducedMotion → reducedMotion”
  // 切换的边界上 `activeIndex` 不残留旧值（Req 8.5）。
  useEffect(() => {
    if (reducedMotion && activeIndex !== 0) {
      setActiveIndexState(0);
    }
  }, [reducedMotion, activeIndex]);

  // 越界自愈：当 `total` 缩小（例如 FIFO 出队头）导致 `activeIndex >= total`
  // 时，自动回卷到 `[0, total)`，避免后续 `cards[activeIndex]` 访问越界。
  useEffect(() => {
    if (total > 0 && activeIndex >= total) {
      setActiveIndexState(wrapIndex(activeIndex, total));
    } else if (total <= 0 && activeIndex !== 0) {
      setActiveIndexState(0);
    }
  }, [total, activeIndex]);

  // 把 dwellPerCard / cards 装入 ref，避免每次卡片数组引用变化都触发 timer
  // 重建（Req 9.3：卡片切换路径不应放大重渲染）。
  const dwellPerCardRef = useRef<typeof dwellPerCard>(dwellPerCard);
  dwellPerCardRef.current = dwellPerCard;
  const cardsRef = useRef<typeof cards>(cards);
  cardsRef.current = cards;

  // ─── 单次链式 setTimeout 调度 ─────────────────────────────────────────────
  //
  // 每次 effect 重跑时计算下一次 dwell（基于当前 `activeIndex`），调度一次
  // setTimeout；timer 触发后通过 setState 推进 `activeIndex`，从而触发下一
  // 次 effect 重跑、调度下一次 timer。effect cleanup 始终 `clearTimeout`，
  // 保证：
  // 1. paused / reducedMotion / total 变化时旧 timer 立即清除；
  // 2. 组件卸载时不留悬挂 timer（Req 9.5）；
  // 3. 严格模式 double-mount 不会出现两个并行 timer。
  useEffect(() => {
    // 任一暂停条件成立都不调度新 timer。
    if (reducedMotion) return;
    if (paused) return;
    if (total <= 1) return;

    // 计算本次 dwell：优先按当前活跃卡片调整，否则使用默认值。
    let dwellCandidate = defaultDwellMs;
    const perCard = dwellPerCardRef.current;
    const currentCard = cardsRef.current?.[activeIndex];
    if (perCard && currentCard) {
      try {
        dwellCandidate = perCard(currentCard);
      } catch {
        // 单条 dwellPerCard 抛错时退回 defaultDwellMs，避免一张卡片把整个
        // Auto_Rotation 卡死。
        dwellCandidate = defaultDwellMs;
      }
    }
    const dwellMs = clampDwellMs(dwellCandidate);

    const timerId = setTimeout(() => {
      // 用 functional update：避免把 `total` 写进闭包；同时在并发 setState
      // 重入时仍能拿到最新值。total 在 effect 触发时已经 > 1，但仍走一次
      // wrap 防御。
      setActiveIndexState((prev) => wrapIndex(prev + 1, total));
    }, dwellMs);

    return () => {
      clearTimeout(timerId);
    };
  }, [activeIndex, defaultDwellMs, paused, reducedMotion, total]);

  // ─── 手动跳转入口 ─────────────────────────────────────────────────────────
  //
  // Reduced_Motion 模式下视为 no-op（指针锁定 0）；其它情况按 modulo 环绕。
  // 用 functional update 读取最新 `activeIndex`，在 React 严格模式 double
  // invoke 下不会出现“拿到旧 prev”的偏移问题。
  const setActiveIndex = useCallback(
    (next: number) => {
      if (reducedMotion) return;
      if (total <= 0) return;
      setActiveIndexState(() => wrapIndex(next, total));
    },
    [reducedMotion, total],
  );

  return {
    activeIndex,
    setActiveIndex,
  };
}
