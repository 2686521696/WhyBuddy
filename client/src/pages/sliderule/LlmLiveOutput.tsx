/**
 * LlmLiveOutput — Claude 式 LLM 实时输出（2026-07-10 按用户裁决重做）。
 *
 * Claude 的关键做法（本组件对齐）：
 * 1. 尾窗而非无限生长——流式正文装在固定高度的窗口里（终端式），新内容
 *    在窗口内滚动，不再把整个对话列越顶越长；
 * 2. 窗口内贴底跟随 + 用户接管——用户在底部才跟随最新输出；往上滚动即
 *    停止跟随可自由回看已输出内容，右下角出现「↓ 最新」胶囊一键回底；
 * 3. 代码进代码块——五系统 JSON 流走代码块外观（圆角边框 + 浅底 + mono
 *    + 轻量语法高亮），不是灰色纯文本墙。
 *
 * 头部一行小字（脉冲点 + 来源标题 + 字符数 + 折叠箭头）点击折叠/展开。
 */

import React from "react";
import { ArrowDown, ChevronDown } from "lucide-react";
import { repairPartialJson } from "./system-screens/five-system-model";

/** 轻量 JSON 高亮：按 token 切成着色 span（不引编辑器，流式高频更新便宜）。 */
const JSON_TOKEN_RE =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function highlightJson(pretty: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of pretty.matchAll(JSON_TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(pretty.slice(last, idx));
    if (m[1] !== undefined) {
      // 字符串：带冒号的是键（深蓝），否则是值（墨绿）
      out.push(
        <span key={key++} style={{ color: m[2] ? "#0958d9" : "#2f6f4f" }}>
          {m[1]}
        </span>
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3] !== undefined) {
      out.push(
        <span key={key++} style={{ color: "#b45309" }}>
          {m[3]}
        </span>
      );
    } else {
      out.push(
        <span key={key++} style={{ color: "#b45309" }}>
          {m[0]}
        </span>
      );
    }
    last = idx + m[0].length;
  }
  if (last < pretty.length) out.push(pretty.slice(last));
  return out;
}

export function LlmLiveOutput({
  title,
  text,
  formatJson = false,
  className = "",
}: {
  /** 来源标题（"正在分析风险" / "五系统模型起草中"…） */
  title: string;
  text: string;
  /** true = 流式 JSON（五系统起草）：容错解析美化 + 代码块外观 + 高亮 */
  formatJson?: boolean;
  className?: string;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  // 贴底跟随：用户在底部才跟随；往上滚即接管（followRef 存意图，state 控胶囊）
  const followRef = React.useRef(true);
  const [following, setFollowing] = React.useState(true);

  // 流式 JSON 美化：每 +200 字符重解一次（容错解析未收尾 JSON）。
  // 只有"美化/高亮结果"走节流 memo；原文本身必须每帧跟随 text——
  // 否则非 JSON 流会冻结在第一帧（曾踩过：正文停住、字符数还在涨）。
  const formatKey = formatJson ? Math.floor(text.length / 200) : -1;
  const prettyNodes = React.useMemo(() => {
    if (!formatJson || !text) return null;
    const parsed = repairPartialJson(text);
    if (parsed === null) return null;
    return highlightJson(JSON.stringify(parsed, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按长度桶节流重解
  }, [formatJson, formatKey]);
  const body: React.ReactNode =
    formatJson && prettyNodes !== null ? prettyNodes : text;

  // 新内容到达：仅当用户在底部时窗口内贴底（Claude/终端行为）
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [text, prettyNodes, collapsed]);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    followRef.current = atBottom;
    setFollowing(atBottom);
  }, []);

  const jumpToLatest = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = true;
    setFollowing(true);
    el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div data-testid="sliderule-llm-draft" className={`min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        data-testid="sliderule-llm-draft-toggle"
        className="flex items-center gap-2 text-left text-[11px] font-medium text-stone-400 transition-colors hover:text-stone-600"
      >
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#1677ff]" />
        <span className="min-w-0 truncate">
          {title} · {text.length} 字符
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {!collapsed && (
        <div
          className={`relative mt-1.5 ${
            formatJson
              ? "overflow-hidden rounded-lg border border-[#e5e7eb] bg-[#fafbfc]"
              : ""
          }`}
        >
          <div
            ref={scrollRef}
            onScroll={onScroll}
            data-testid="sliderule-llm-draft-window"
            className="max-h-[260px] overflow-y-auto"
          >
            <pre
              data-testid="sliderule-llm-draft-body"
              className={`whitespace-pre-wrap break-all leading-6 ${
                formatJson
                  ? "px-3 py-2 font-mono text-[11.5px] text-[#1f2329]"
                  : "pl-3.5 font-sans text-[12.5px] text-stone-500"
              }`}
            >
              {body}
              <span className="animate-pulse text-[#1677ff]">▊</span>
            </pre>
          </div>
          {/* 顶部渐隐：提示窗口上方还有已输出内容（可向上滚动回看） */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b ${
              formatJson ? "from-[#fafbfc]" : "from-[#f7f8fa]"
            } to-transparent`}
          />
          {/* 用户滚上去回看时：一键回到最新 */}
          {!following && (
            <button
              type="button"
              onClick={jumpToLatest}
              data-testid="sliderule-llm-draft-latest"
              className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-medium text-stone-600 shadow-sm transition hover:bg-[#eef0f4]"
            >
              <ArrowDown className="h-3 w-3" />
              最新
            </button>
          )}
        </div>
      )}
    </div>
  );
}
