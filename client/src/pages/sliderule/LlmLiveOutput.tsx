/**
 * LlmLiveOutput — Claude 式 LLM 实时输出（无框纯文字流）。
 *
 * 不是卡片：头部一行小字（脉冲点 + 来源标题 + 字符数 + 折叠箭头），正文
 * 是持续追加的浅灰正文流，超过最大高度内部滚动并自动跟到底部（用户往回
 * 翻时停住不打扰）；点头部折叠/展开。
 */

import React from "react";
import { ChevronDown } from "lucide-react";

export function LlmLiveOutput({
  title,
  text,
  className = "",
}: {
  /** 来源标题（"正在分析风险" / "五系统模型起草中"…） */
  title: string;
  text: string;
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
    <div data-testid="sliderule-llm-draft" className={`min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        data-testid="sliderule-llm-draft-toggle"
        className="flex items-center gap-2 text-left text-[11px] font-medium text-stone-400 transition-colors hover:text-stone-600"
      >
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#D97757]" />
        <span className="min-w-0 truncate">
          {title} · {text.length} 字符
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
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
          className="mt-1.5 max-h-48 min-h-0 overflow-y-auto whitespace-pre-wrap break-all pl-3.5 font-sans text-[12.5px] leading-6 text-stone-500"
        >
          {text}
          <span className="animate-pulse text-[#D97757]">▊</span>
        </pre>
      )}
    </div>
  );
}
