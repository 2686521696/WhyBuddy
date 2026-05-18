/**
 * `autopilot-streaming-doc-renderer` — Wave 1 / Task 2.3
 *
 * 流式文档光标指示器。
 *
 * 该组件用于在 Markdown 文档流式渲染过程中，于最后一个字符之后展示一枚
 * 闪烁光标，让用户感知"文档正在被书写"。动画效果复用 `index.css` 中已经
 * 存在的 `mirofish-blink` keyframes（1s step-end infinite），不引入新的
 * 全局样式。
 *
 * 关键边界：
 * - 右栏底色为白色，需要使用浅色主题（`bg-slate-700`），不允许出现
 *   `bg-white/70` 等深色毛玻璃语义；详见 design.md 样式方案的浅色翻译。
 * - 当 `visible=false` 时，组件返回 `null`，避免 DOM 中残留无用 span 与
 *   不必要的动画开销。
 * - 使用 `aria-hidden` 标记，避免屏幕阅读器把光标读成内容字符。
 */

import type { FC } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * `StreamCursor` 的对外 props。
 *
 * - `visible`：是否展示闪烁光标。当对应文档处于流式生成中（`isStreaming`
 *   为 true）时由父组件传入 true；流式结束后传入 false 让组件返回 null。
 */
export interface StreamCursorProps {
  visible: boolean;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 流式文档闪烁光标。
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-doc-renderer/`
 * - 需求 2.3：流式生成中展示闪烁光标
 * - 需求 2.4：生成完成后光标消失
 */
export const StreamCursor: FC<StreamCursorProps> = ({ visible }) => {
  if (!visible) return null;
  return (
    <span
      className="animate-mirofish-blink ml-0.5 inline-block h-[14px] w-[2px] bg-slate-700 align-middle"
      aria-hidden
      data-testid="streaming-doc-cursor"
    />
  );
};

export default StreamCursor;
