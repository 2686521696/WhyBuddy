/**
 * LlmLiveOutput — Claude 式 LLM 实时输出块。
 *
 * 浅色（不再是黑框）：头部一行 = 脉冲点 + 来源标题 + 字符数 + 折叠箭头；
 * 正文实时追加，超过最大高度内部滚动并自动跟到底部；点头部折叠/展开。
 * 左栏对话流与右侧舞台共用（右侧传 fill 占满剩余高度）。
 */

import React from "react";
import { ChevronDown } from "lucide-react";

export function LlmLiveOutput({
  title,
  text,
  fill = false,
  className = "",
}: {
  /** 来源标题（"正在分析风险" / "五系统模型起草中"…） */
  title: string;
  text: string;
  /** true = 占满父容器剩余高度（右侧舞台）；false = 紧凑块（左栏，内部滚动） */
  fill?: boolean;
  className?: string;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const bodyRef = React.useRef<HTMLPreElement | null>(null);

  // Claude 式跟随：新增量到达时自动滚到底（用户往回翻时不打扰）
  const stickToBottomRef = React.useRef(true);
  React.useEffect(() => {
    const el = bodyRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [text, collapsed]);

  return (
    <div
      data-testid="sliderule-llm-draft"
      className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-[#E7E2D9] bg-white/70 ${
        fill && !collapsed ? "flex-1" : ""
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        data-testid="sliderule-llm-draft-toggle"
        className="flex w-full shrink-0 items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-stone-500 transition-colors hover:text-stone-700"
      >
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#D97757]" />
        <span className="min-w-0 truncate">
          LLM 实时输出 · {title} · {text.length} 字符
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {!collapsed && (
        <pre
          ref={bodyRef}
          onScroll={(ev) => {
            const el = ev.currentTarget;
            // 离底 40px 以内算"贴底"，继续自动跟随；往回翻则停住
            stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          data-testid="sliderule-llm-draft-body"
          className={`min-h-0 overflow-y-auto whitespace-pre-wrap break-all border-t border-[#F0EDE5] px-3 py-2 font-mono text-[11px] leading-5 text-stone-600 ${
            fill ? "flex-1" : "max-h-44"
          }`}
        >
          {text}
          <span className="animate-pulse text-[#D97757]">▊</span>
        </pre>
      )}
    </div>
  );
}
