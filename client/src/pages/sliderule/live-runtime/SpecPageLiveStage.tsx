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
 * ## 渲染走沙箱 iframe，不走 Shadow DOM —— 这条是踩出来的
 *
 * 第一版挂的是 BoundHtmlSurface（DOMPurify + closed Shadow DOM）。真机一跑，
 * 右侧是一堆裸文字加一个撑满屏的蓝图标：**一条 CSS 都没生效**。
 *
 * 病因不是"样式丢了"，是页面的**全部**样式来自两个 script（Tailwind Play CDN
 * 的运行时 JIT + 内联的 `tailwind.config` 配色），而消毒层按定义要摘掉 script。
 * 而且这不是"放行 script 就能修"：Play CDN 扫 document 再往 document.head 注
 * 样式，影子根里的元素它扫不到、注出来的也跨不过影子边界——
 * **Shadow DOM 与 CDN 版 Tailwind 在原理上不兼容。**
 *
 * 换成 sandbox iframe（v0 / bolt / screenshot-to-code 的同款做法）：脚本能跑，
 * 但跑在不透明源里，外带与表单提交由框内 CSP 掐死。判据与取舍写在
 * sandboxed-page-frame.tsx 头注，那边是唯一的安全边界所在。
 *
 * ## 素颜页与打过孔的页
 *
 * `bound=false` 是第 3 步的素颜页：还没打 data-* 孔（孔要等第 6.5 步，那时
 * 实体字段才定死校验过）。角标如实说明，不装作已经接上了。
 *
 * 填数走 deriveBindingSource（五系统模型 + 运行时状态），跟老区块渲染**共用
 * 同一份数据**——各读各的等于同一个应用有两份互不相干的数据。
 */

import React from "react";

import { HtmlAppSurface } from "./html-app-surface";
import { deriveBindingSource } from "./derive-binding-source";
import type { BindingActionEvent } from "./html-binding-runtime";
import type { RuntimeState } from "./live-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";

export interface SpecPageLive {
  pageId: string;
  html: string;
  current: number;
  total: number;
  bound: boolean;
}

export interface SpecPageLiveStageProps {
  pages: SpecPageLive[];
  /** 当前步骤一句话（"逐页画界面（并发）"…）——右上角标注，不重复左栏 */
  statusLabel?: string | null;
  /** 还在推演中。角标据此说"生成中 n/m"还是"共 n 页"——**跑完了还挂着
   *  「生成中」是在撒谎**，用户会一直等一个不会再变的东西。 */
  running?: boolean;
  /** 五系统模型 + 运行时状态 → 页面上的 data-* 孔真的填得上数。
   *  ⚠ 缺任一个都只是"没数据"，不是"渲染失败"——角标如实说。 */
  model?: FiveSystemModel | null;
  runtime?: RuntimeState | null;
  /** 页面里的动作（新建/查看/编辑）——交给宿主的运行时去改数据 */
  onAction?: (event: BindingActionEvent) => void;
  /** 游标：鼠标停在带绑定的元素上 */
  onHoverBinding?: (info: { attr: string; value: string; el: Element } | null) => void;
  className?: string;
}

export function SpecPageLiveStage({
  pages,
  statusLabel = null,
  running = true,
  model = null,
  runtime = null,
  onAction,
  onHoverBinding,
  className = "",
}: SpecPageLiveStageProps): React.ReactElement | null {
  // 手动选过就听手动的；没选过恒跟最新一页（页面在陆续到达，跟着最新的
  // 才叫"实时"）。⚠ 存 pageId 而不是下标：下标会被新到达的页面挤走，
  // 表现是"我明明点了甲页，它自己跳到乙页去了"。
  const [picked, setPicked] = React.useState<string | null>(null);
  // 填数报告：填了几个孔、哪些孔填不上。**如实展示**——填不上是模型的问题
  // （引用了不存在的实体/字段），拿假数据盖住等于把问题藏起来。
  const [report, setReport] = React.useState<{ filled: number; problems: string[] } | null>(null);

  const source = React.useMemo(() => deriveBindingSource(model, runtime), [model, runtime]);

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
        {running ? (
          <span className="flex items-center gap-1.5 rounded-full bg-[#FDF6F1] px-2 py-0.5 text-[10px] font-medium text-[#C05621]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1677ff]" />
            界面生成中 {pages.length}/{total || pages.length}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            运行中 · 共 {pages.length} 页
          </span>
        )}
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
            report?.problems.length
              ? `填不上的孔：\n${report.problems.slice(0, 6).join("\n")}`
              : active.bound
                ? "已接上数据（第 6.5 步打过 data-* 孔）"
                : "第 3 步的页面：还没接数据，孔要等实体字段定死之后才打"
          }
        >
          {/* ⚠ 报**实际填了多少**，不是报"这一版理论上打过孔"。
              两者会分叉：孔打了但引用的实体不存在时，bound 是 true 而
              一个格子都没填上——那时说"已接数据"就是在撒谎。 */}
          {report
            ? report.filled > 0
              ? `已接数据 · 填了 ${report.filled} 处${
                  report.problems.length ? ` · ${report.problems.length} 处填不上` : ""
                }`
              : active.bound
                ? "打过孔但没填上数据"
                : "尚未接数据"
            : active.bound
              ? "已接数据"
              : "尚未接数据"}
        </span>
        {statusLabel && (
          <span className="w-full truncate text-[11px] text-stone-400">
            {statusLabel}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#e5e7eb]">
        {/* ⚠ key 带 pageId：换页必须重建 iframe。srcdoc 换值时浏览器的重载
            时机不一致（Safari 上尤其），复用同一个框会看到上一页残留一瞬。
            ⚠ 框内自己滚，外层 overflow-hidden：跟 ComponentsLibraryPage 那次
            拒绝 iframe 的理由（26 份高度要跨文档同步）不一样——这里只有一份，
            而且给的是固定高度，不需要把高度同步回来。 */}
        <HtmlAppSurface
          key={active.pageId}
          html={active.html}
          source={source}
          onAction={onAction}
          onNavigate={setPicked}
          onHoverBinding={onHoverBinding}
          onReport={r =>
            setReport({
              filled: Object.values(r.filled).reduce((a, b) => a + b, 0),
              problems: r.problems,
            })
          }
        />
      </div>
    </div>
  );
}
