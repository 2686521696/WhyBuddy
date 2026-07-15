/**
 * Response — 流式 markdown 正文（E16）。streamdown 薄壳：
 * 未闭合语法容错（流到一半的 **加粗 不闪烁）、按块记忆化（只重渲染
 * 最后一个未闭合块，选区不被打断）、Shiki 代码高亮、内置 mermaid。
 * 上游 ai-elements 现版 registry 已把它并进 message，本壳保持单一职责。
 */

import { memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

export type ResponseProps = {
  children: string;
  className?: string;
  /** 流式中：streamdown 据此做未闭合块的宽容解析 */
  parseIncompleteMarkdown?: boolean;
};

export const Response = memo(
  ({ children, className, parseIncompleteMarkdown = true }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      parseIncompleteMarkdown={parseIncompleteMarkdown}
    >
      {children}
    </Streamdown>
  ),
  (prev, next) =>
    prev.children === next.children && prev.className === next.className
);
Response.displayName = "Response";
