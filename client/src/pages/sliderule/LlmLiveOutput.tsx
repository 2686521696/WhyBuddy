/**
 * LlmLiveOutput — Claude 式 LLM 实时输出（2026-07-10 两轮用户裁决）。
 *
 * Claude 的真实分工（第二轮用户观察修正）：
 * - 自然语言的思考/叙事流 **自由流动**——不装窗、不折叠，像正文一样
 *   随对话生长（外层聊天列贴底跟随负责滚动）；
 * - 被折叠成一行摘要的是 **工具活动/代码**——五系统 JSON 起草属于这类：
 *   默认收成摘要行（脉冲点 + 标题 + 字符数），点开是代码块面板
 *   （圆角浅底 + mono + 轻量语法高亮 + 260px 尾窗）。
 *
 * 尾窗内贴底跟随 + 用户接管：在底部才跟随最新输出；上滚即停、可自由
 * 回看，右下角「↓ 最新」胶囊一键回底（JSON 面板专属；纯文字流不需要）。
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
  done = false,
  className = "",
}: {
  /** 来源标题（"正在分析风险" / "五系统模型起草中"…） */
  title: string;
  text: string;
  /** true = 流式 JSON（五系统起草）：容错解析美化 + 代码块外观 + 高亮 */
  formatJson?: boolean;
  /** true = 归档态（推演结束后的留档）：灰点无光标，默认折叠（Claude
   *  的"Thought for Xs"——留在对话里、要看点开） */
  done?: boolean;
  className?: string;
}) {
  // Claude 分工：代码/JSON 默认收成摘要行（点开看面板）；纯文字流默认展开；
  // 归档态一律默认折叠
  const [collapsed, setCollapsed] = React.useState(done || formatJson);
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
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            done ? "bg-stone-300" : "animate-pulse bg-[#1677ff]"
          }`}
        />
        <span className="min-w-0 truncate">
          {title} · {text.length} 字符
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {/* 纯文字思考流：自由流动，不装窗不折叠（Claude 的正文行为；
          滚动与贴底跟随由外层聊天列统一负责） */}
      {!collapsed && !formatJson && (
        <pre
          data-testid="sliderule-llm-draft-body"
          className="mt-1.5 whitespace-pre-wrap break-all pl-3.5 font-sans text-[12.5px] leading-6 text-stone-500"
        >
          {body}
          {!done && <span className="animate-pulse text-[#1677ff]">▊</span>}
        </pre>
      )}
      {/* 代码/JSON 面板：代码块外观 + 260px 尾窗（Claude 的工具活动行为） */}
      {!collapsed && formatJson && (
        <div className="relative mt-1.5 overflow-hidden rounded-lg border border-[#e5e7eb] bg-[#fafbfc]">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            data-testid="sliderule-llm-draft-window"
            className="max-h-[260px] overflow-y-auto"
          >
            <pre
              data-testid="sliderule-llm-draft-body"
              className="whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11.5px] leading-6 text-[#1f2329]"
            >
              {body}
              {!done && <span className="animate-pulse text-[#1677ff]">▊</span>}
            </pre>
          </div>
          {/* 顶部渐隐：提示窗口上方还有已输出内容（可向上滚动回看） */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-[#fafbfc] to-transparent" />
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
