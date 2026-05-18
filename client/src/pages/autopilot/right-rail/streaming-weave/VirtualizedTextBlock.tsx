/**
 * 虚拟化长文本块组件 — VirtualizedTextBlock
 *
 * 当流式文本超过 1000 字符时，对旧文本块应用 CSS `content-visibility: auto`，
 * 使浏览器跳过不可见区域的渲染计算，从而降低高频流式更新时的布局开销。
 *
 * 核心策略：
 * - 文本长度 ≤ 1000 字符：正常渲染，不做任何优化
 * - 文本长度 > 1000 字符：为容器添加 `content-visibility: auto` 与
 *   `contain-intrinsic-size: auto 20px`，让浏览器仅渲染可见区域
 *
 * 使用方式：
 * ```tsx
 * <VirtualizedTextBlock text={longStreamingText} />
 * ```
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-lifecycle-weave/`
 * - 需求 4.2：流式文本超过 1000 字符时虚拟化旧内容仅渲染可见区域
 */

import React from "react";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 触发虚拟化的文本长度阈值 */
const VIRTUALIZATION_THRESHOLD = 1000;

// ---------------------------------------------------------------------------
// Props 接口
// ---------------------------------------------------------------------------

/**
 * VirtualizedTextBlock 组件属性。
 */
export interface VirtualizedTextBlockProps {
  /** 要展示的文本内容 */
  text: string;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 子元素（优先于 text 渲染） */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// 虚拟化样式
// ---------------------------------------------------------------------------

/**
 * 当文本超过阈值时应用的内联样式。
 *
 * `content-visibility: auto` 让浏览器跳过屏幕外元素的渲染。
 * `contain-intrinsic-size: auto 20px` 为跳过渲染的元素提供占位高度估算。
 */
const virtualizedStyle: React.CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 20px",
};

// ---------------------------------------------------------------------------
// 组件实现
// ---------------------------------------------------------------------------

/**
 * 虚拟化长文本块。
 *
 * 对超过 1000 字符的流式文本应用 CSS content-visibility 优化，
 * 减少浏览器对不可见区域的布局与绘制开销。
 *
 * @param props - VirtualizedTextBlockProps
 */
export const VirtualizedTextBlock = React.memo(function VirtualizedTextBlock({
  text,
  className,
  children,
}: VirtualizedTextBlockProps) {
  const shouldVirtualize = text.length > VIRTUALIZATION_THRESHOLD;

  return (
    <div
      className={className}
      style={shouldVirtualize ? virtualizedStyle : undefined}
    >
      {children ?? text}
    </div>
  );
});
