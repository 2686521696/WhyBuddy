/**
 * RollingText — 动态状态文字的上下翻滚过渡（anime.js v4，2026-07-10 用户裁决）。
 *
 * 文案变化时不再生硬跳变：旧文案向上滚出淡出、新文案从下方滚入——
 * 用于 IM 的思考指示行、「最新定义」语义副标题、右舞台步骤锚点等
 * "同一位置内容持续更替"的文字槽。文案不变时零开销（不挂动画）。
 */

import React from "react";
import { animate } from "animejs";
import { isMotionReduced } from "./user-prefs";

export function RollingText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [display, setDisplay] = React.useState(text);
  const [leaving, setLeaving] = React.useState<string | null>(null);
  const inRef = React.useRef<HTMLSpanElement | null>(null);
  const outRef = React.useRef<HTMLSpanElement | null>(null);

  React.useEffect(() => {
    if (text === display) return;
    // 减少动效偏好/系统设置：直接换字，不挂翻滚动画
    setLeaving(isMotionReduced() ? null : display);
    setDisplay(text);
  }, [text, display]);

  React.useLayoutEffect(() => {
    if (leaving === null) return;
    if (outRef.current) {
      animate(outRef.current, {
        translateY: [0, -12],
        opacity: [1, 0],
        duration: 200,
        ease: "outQuad",
      });
    }
    if (inRef.current) {
      animate(inRef.current, {
        translateY: [12, 0],
        opacity: [0, 1],
        duration: 240,
        ease: "outQuad",
        onComplete: () => setLeaving(null),
      });
    }
  }, [leaving, display]);

  return (
    <span
      className={`relative inline-flex min-w-0 overflow-hidden ${className}`}
      data-testid="sliderule-rolling-text"
    >
      <span ref={inRef} className="min-w-0 truncate">
        {display}
      </span>
      {leaving !== null && (
        <span
          ref={outRef}
          aria-hidden
          className="absolute inset-0 min-w-0 truncate"
        >
          {leaving}
        </span>
      )}
    </span>
  );
}
