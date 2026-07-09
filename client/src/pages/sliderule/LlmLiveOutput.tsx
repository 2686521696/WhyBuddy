/**
 * LlmLiveOutput — Claude 式 LLM 实时输出（无框纯文字流）。
 *
 * 不是卡片：头部一行小字（脉冲点 + 来源标题 + 字符数 + 折叠箭头），正文
 * 是持续追加的浅灰正文流；点头部折叠/展开。五系统起草的 JSON 流经容错
 * 解析后缩进美化展示（formatJson）。
 *
 * 本体不滚动：随内容自然生长，滚动与"贴底跟随"由外层聊天列统一负责
 * （单滚动条——用户反馈内外双滚动条易迷失）。
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

  // 流式 JSON 美化：每 +200 字符重解一次（容错解析未收尾 JSON）。
  // 只有"美化结果"走节流 memo；displayText 本身必须每帧跟随 text——
  // 否则非 JSON 流会冻结在第一帧（曾踩过：正文停住、字符数还在涨）。
  const formatKey = formatJson ? Math.floor(text.length / 200) : -1;
  const pretty = React.useMemo(() => {
    if (!formatJson || !text) return null;
    const parsed = repairPartialJson(text);
    return parsed !== null ? JSON.stringify(parsed, null, 2) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按长度桶节流重解
  }, [formatJson, formatKey]);
  const displayText = formatJson && pretty !== null ? pretty : text;

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
          data-testid="sliderule-llm-draft-body"
          className={`mt-1.5 whitespace-pre-wrap break-all pl-3.5 text-[12.5px] leading-6 text-stone-500 ${
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
