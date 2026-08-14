/**
 * 推演中的右侧舞台：spec-first 第 3 步一出页面就渲染出来。
 *
 * ## 为什么现在能做，以前不能
 *
 * 以前右侧在推演期只有三个跳动的点。那不是偷懒——**当时确实没有能看的
 * 东西**：老链路要等五系统模型齐了才谈得上页面，模型齐了就等于跑完了。
 *
 * 新链路不一样：第 3 步直接产出**一整份能独立打开的 HTML**，第一页在整轮
 * 的第二分钟就到。那四五分钟的转圈不是"还没算出来"，是"算出来了没往外发"。
 *
 * ⚠ 这不推翻 2026-07-14 那条裁决（执行期不看中间过程）。那条说的是系统屏、
 * 证据看板、起草 JSON——**过程的碎片**，看了也拼不出东西。这里上屏的是
 * 成品页面本身，跟最后交付的是同一份 HTML。两者不是一类东西。
 *
 * ## 渲染走宿主安全层，不自己拼一个
 *
 * 内容是 LLM 生成的整份 HTML，直接 `dangerouslySetInnerHTML` 进主文档有
 * 两个独立的问题（可执行内容、样式外溢），各由 DOMPurify 与 Shadow DOM 治。
 * 那一层已经写好了（BoundHtmlSurface），这里只管挂——**安全判据只有一处**，
 * 多一条渲染路径就多一处会漏的地方。
 *
 * ## 素颜页与打过孔的页
 *
 * `bound=false` 是第 3 步的素颜页：还没打 data-* 孔（孔要等第 6.5 步，那时
 * 实体字段才定死校验过）。所以此时数据源恒为空——**不是渲染失败**，是这个
 * 阶段本来就还没有数据。角标如实说明，不装作已经接上了。
 */

import React from "react";

import { BoundHtmlSurface } from "./bound-html-surface";
import type { BindingSource } from "./html-binding-runtime";

export interface SpecPageLive {
  pageId: string;
  html: string;
  current: number;
  total: number;
  bound: boolean;
}

/** 素颜页没有数据源。空对象而不是 undefined——解释器要的是形状，不是可选。 */
const EMPTY_SOURCE: BindingSource = { rows: {}, fields: {} };

export interface SpecPageLiveStageProps {
  pages: SpecPageLive[];
  /** 当前步骤一句话（"逐页画界面（并发）"…）——右上角标注，不重复左栏 */
  statusLabel?: string | null;
  source?: BindingSource;
  className?: string;
}

export function SpecPageLiveStage({
  pages,
  statusLabel = null,
  source,
  className = "",
}: SpecPageLiveStageProps): React.ReactElement | null {
  // 手动选过就听手动的；没选过恒跟最新一页（页面在陆续到达，跟着最新的
  // 才叫"实时"）。⚠ 存 pageId 而不是下标：下标会被新到达的页面挤走，
  // 表现是"我明明点了甲页，它自己跳到乙页去了"。
  const [picked, setPicked] = React.useState<string | null>(null);

  const activeId =
    (picked && pages.some(p => p.pageId === picked) ? picked : null) ??
    pages[pages.length - 1]?.pageId ??
    null;
  const active = pages.find(p => p.pageId === activeId) ?? null;

  if (!active) return null;

  const total = Math.max(active.total || 0, pages.length);

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col gap-2 ${className}`}
      data-testid="sliderule-spec-page-stage"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1.5 rounded-full bg-[#FDF6F1] px-2 py-0.5 text-[10px] font-medium text-[#C05621]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1677ff]" />
          界面生成中 {pages.length}/{total || pages.length}
        </span>
        {pages.map(p => (
          <button
            key={p.pageId}
            type="button"
            onClick={() => setPicked(p.pageId)}
            data-testid={`sliderule-spec-page-tab-${p.pageId}`}
            aria-pressed={p.pageId === activeId}
            className={`max-w-[140px] truncate rounded-full px-2.5 py-0.5 text-[11px] transition ${
              p.pageId === activeId
                ? "bg-[#1677ff] font-medium text-white"
                : "bg-white text-stone-500 ring-1 ring-[#e5e7eb] hover:bg-[#f8f9fb]"
            }`}
            title={p.pageId}
          >
            {p.pageId}
          </button>
        ))}
        <span
          className="ml-auto shrink-0 text-[10px] text-stone-400"
          data-testid="sliderule-spec-page-bound"
          title={
            active.bound
              ? "已接上数据（第 6.5 步打过 data-* 孔）"
              : "第 3 步的页面：还没接数据，孔要等实体字段定死之后才打"
          }
        >
          {active.bound ? "已接数据" : "尚未接数据"}
        </span>
        {statusLabel && (
          <span className="w-full truncate text-[11px] text-stone-400">
            {statusLabel}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-white shadow-sm ring-1 ring-[#e5e7eb]">
        <BoundHtmlSurface
          // ⚠ key 带 pageId：换页要重挂，否则影子根里还是上一页的内容
          //   （挂载副作用按 html 变化重跑，但 host 元素被 React 复用）。
          key={active.pageId}
          html={active.html}
          source={source ?? EMPTY_SOURCE}
        />
      </div>
    </div>
  );
}
