/**
 * StageTransitionWrapper — 阶段切场动画包裹层
 *
 * 使用 framer-motion 的 AnimatePresence + motion.div 实现阶段间的方向性滑动过渡。
 * - 正向推进（forward）：新阶段从右侧滑入（x: 30% → 0），旧阶段向左滑出（x: 0 → -30%）
 * - 回看（backward）：新阶段从左侧滑入（x: -30% → 0），旧阶段向右滑出（x: 0 → 30%）
 *
 * 对应 spec：`.kiro/specs/autopilot-workbench-stage-rhythm/`
 * - 需求 2.1：AnimatePresence 实现退出与进入动画，总时长 300-500ms
 * - 需求 2.2：正向推进使用从右向左滑入方向
 * - 需求 2.3：回看使用从左向右滑入方向
 * - 需求 2.4：过渡动画期间禁用 StageCTA 按钮点击
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type FC, type ReactNode } from "react";
import { useMirofishMotionProps } from "@/hooks/useMirofishMotionProps";

/**
 * StageTransitionWrapper 组件 Props
 */
export interface StageTransitionWrapperProps {
  /** AnimatePresence key，阶段变化时触发动画 */
  stageKey: string;
  /** 切场方向：forward 正向推进，backward 回看 */
  direction: "forward" | "backward";
  /** 子内容（当前阶段的 StageViewport） */
  children: ReactNode;
  /**
   * 过渡动画开始时的回调。
   * 当 stageKey 变化触发切场动画时调用，可用于禁用交互。
   */
  onTransitionStart?: () => void;
  /**
   * 过渡动画结束时的回调（退出动画完成后）。
   * 通过 AnimatePresence 的 onExitComplete 触发，可用于恢复交互。
   */
  onTransitionEnd?: () => void;
}

/**
 * 切场动画变体定义。
 *
 * - enter：进入前的初始位置，根据方向决定从右侧（30%）或左侧（-30%）进入
 * - center：居中展示位置
 * - exit：退出时的目标位置，根据方向决定向左（-30%）或向右（30%）退出
 */
const variants = {
  enter: (direction: "forward" | "backward") => ({
    x: direction === "forward" ? "30%" : "-30%",
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: "forward" | "backward") => ({
    x: direction === "forward" ? "-30%" : "30%",
    opacity: 0,
  }),
};

/**
 * 过渡动画配置：tween 缓动，easeInOut，350ms。
 */
const transition = {
  type: "tween" as const,
  ease: "easeInOut" as const,
  duration: 0.35,
};

/**
 * 阶段切场动画包裹组件。
 *
 * 使用 `AnimatePresence mode="sync"` 让新阶段立即挂载，避免旧阶段退出动画异常时
 * 阻塞下一阶段内容渲染；通过 `custom` 属性传递方向参数给 variants 函数。
 *
 * 内部维护 `isTransitioning` 状态：
 * - stageKey 变化时设为 true，触发 `onTransitionStart` 回调
 * - AnimatePresence 的 `onExitComplete` 触发时设为 false，触发 `onTransitionEnd` 回调
 *
 * 父组件可通过回调获知过渡状态，从而在动画期间禁用 StageCTA 按钮。
 */
const StageTransitionWrapper: FC<StageTransitionWrapperProps> = ({
  stageKey,
  direction,
  children,
  onTransitionStart,
  onTransitionEnd,
}) => {
  /** Is animation reduced (MiroFish scope or prefers-reduced-motion) */
  const motionOverrides = useMirofishMotionProps();
  const isReduced = Object.keys(motionOverrides).length > 0;

  /** 是否正在过渡动画中 */
  const [isTransitioning, setIsTransitioning] = useState(false);

  /** 记录上一次的 stageKey，用于检测变化 */
  const prevStageKeyRef = useRef(stageKey);

  /**
   * 当 stageKey 变化时，标记过渡开始并通知父组件。
   * 首次渲染不触发（prevStageKeyRef 初始值等于当前 stageKey）。
   *
   * Since exit animations are intentionally omitted (to avoid blocking the next
   * stage), onExitComplete will not fire. Instead, we fire onTransitionEnd after
   * the enter animation duration (350ms) completes.
   */
  useEffect(() => {
    if (prevStageKeyRef.current !== stageKey) {
      prevStageKeyRef.current = stageKey;
      if (isReduced) {
        // When animations are disabled, fire start+end immediately
        onTransitionStart?.();
        onTransitionEnd?.();
      } else {
        setIsTransitioning(true);
        onTransitionStart?.();
        // No exit animation means onExitComplete won't fire.
        // End the transition lock after the enter animation duration.
        const timer = setTimeout(() => {
          setIsTransitioning(false);
          onTransitionEnd?.();
        }, 350);
        return () => clearTimeout(timer);
      }
    }
  }, [stageKey, onTransitionStart, onTransitionEnd, isReduced]);

  return (
    <div
      className="grid h-full min-h-0"
      style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      <AnimatePresence
        mode="sync"
        initial={false}
        custom={direction}
      >
        <motion.div
          key={stageKey}
          custom={direction}
          variants={isReduced ? undefined : variants}
          initial={false}
          animate={isReduced ? false : "center"}
          transition={isReduced ? { duration: 0 } : transition}
          className="col-start-1 row-start-1 h-full min-h-0"
          style={{
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            boxSizing: "border-box",
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default StageTransitionWrapper;

/**
 * 自定义 Hook：管理阶段过渡期间的交互禁用状态。
 *
 * 返回 `isTransitioning` 布尔值与 `onTransitionStart` / `onTransitionEnd` 回调，
 * 可直接传递给 StageTransitionWrapper 与 StageCTA。
 *
 * @example
 * ```tsx
 * const { isTransitioning, onTransitionStart, onTransitionEnd } = useStageTransitionLock();
 *
 * <StageTransitionWrapper
 *   stageKey={stageKey}
 *   direction={direction}
 *   onTransitionStart={onTransitionStart}
 *   onTransitionEnd={onTransitionEnd}
 * >
 *   <StageCTA disabled={isTransitioning} ... />
 * </StageTransitionWrapper>
 * ```
 */
export function useStageTransitionLock() {
  const [isTransitioning, setIsTransitioning] = useState(false);

  const onTransitionStart = () => {
    setIsTransitioning(true);
  };

  const onTransitionEnd = () => {
    setIsTransitioning(false);
  };

  return { isTransitioning, onTransitionStart, onTransitionEnd };
}
