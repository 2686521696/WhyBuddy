/**
 * LlmLiveOutput — Claude 式 LLM 实时输出（无框纯文字流）。
 *
 * 不是卡片：头部一行小字（脉冲点 + 来源标题 + 字符数 + 折叠箭头），正文
 * 是持续追加的浅灰正文流，占满可视余高、超出内部滚动并自动跟到底部（用户
 * 往回翻时停住不打扰）；点头部折叠/展开。五系统起草的 JSON 流经容错解析
 * 后缩进美化展示（formatJson）。
 */

import React from "react";
import { ChevronDown } from "lucide-react";
import { repairPartialJson } from "./system-screens/five-system-model";

export function LlmLiveOutput({
  title,
  text,
  formatJson = false,
  className = "",
}: {
  /** 来源标题（"正在分析风险" / "五系统模型起草中"…） */
  title: string;
  text: string;
  /** true = 流式 JSON（五系统起草）：容错解析后缩进美化，拼不出时回落原文 */
  formatJson?: boolean;
  className?: string;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const bodyRef = React.useRef<HTMLPreElement | null>(null);

  // 流式 JSON 美化：每 +200 字符重解一次（容错解析未收尾 JSON），
  // 拼不出对象时如实显示原始流。字符数统计始终按原文。
  const formatKey = formatJson ? Math.floor(text.length / 200) : -1;
  const displayText = React.useMemo(() => {
    if (!formatJson || !text) return text;
    const parsed = repairPartialJson(text);
    return parsed !== null ? JSON.stringify(parsed, null, 2) : text;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按长度桶节流重解
  }, [formatJson, formatKey]);

  // Claude 式跟随：新增量到达时自动滚到底（用户往回翻时不打扰）
  const stickToBottomRef = React.useRef(true);
  React.useEffect(() => {
    const el = bodyRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [displayText, collapsed]);

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
          // max-height 以视口余高为准（约 = 100vh - 顶部话题区/步骤区 - 底部指令条），
          // 让实时流占满左栏可视空间而不是压成小窗（用户反馈：高度没占满）。
          // 用内联样式而非 Tailwind 任意值：calc 内空格在 arbitrary value 里易写坏。
          style={{ maxHeight: "max(12rem, calc(100vh - 430px))" }}
          className={`mt-1.5 min-h-0 overflow-y-auto whitespace-pre-wrap break-all pl-3.5 text-[12.5px] leading-6 text-stone-500 ${
            formatJson ? "font-mono text-[11.5px]" : "font-sans"
          }`}
        >
          {displayText}
          <span className="animate-pulse text-[#D97757]">▊</span>
        </pre>
      )}
    </div>
  );
}
