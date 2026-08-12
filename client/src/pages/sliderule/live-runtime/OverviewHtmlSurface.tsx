import React from "react";
import DOMPurify from "dompurify";
import { createPortal } from "react-dom";
import EchartsChart from "./EchartsChart";
import { buildEchartsOption, DEFAULT_CHART_PALETTE } from "./build-echarts-option";
import type { ChartPalette } from "./build-echarts-option";
import type {
  AppPageChartSchema,
  OverviewChartSpec,
  OverviewFactSpec,
} from "./app-runtime-schema";
import type { RuntimeRow } from "./live-runtime";

/**
 * 首页总览的 **HTML 载体**渲染端（2026-08-12）。
 *
 * ## 分工：HTML 只管版式，数字和图表归运行时
 *
 * 生成侧（services/overview_html.py）产出的 HTML 里**一个数字都没有**，只有占位：
 *
 *     <span data-fact="today_appointments"></span>
 *     <div  data-chart="c_status" style="height:260px"></div>
 *
 * 这里负责填。为什么这么分：受限 JSON 树那条路最硬的纪律是"数字不能编"——
 * 每个数字必须挂 dataRef 由运行时现算。换成 HTML 若让模型自己写数，那条保证
 * 就没了。原型实测过：LLM 自己算的「处理中工单」是 0，而同一页的环图从**同一份
 * 数据**算出 5，同一页自相矛盾且无人能发现。HTML 里不出现数字，也就无从写错。
 *
 * ## 两条隔离，各管各的逃逸面
 *
 * 这段 HTML 是 LLM 产出的不可信内容，两个逃逸面要分开对付：
 *
 *   **脚本 → DOMPurify**。生成侧已经拒过一遍 script、on* 事件、javascript: 伪协议、外链；
 *   这里再过一遍，因为快照恢复、历史产物不重跑生成侧，这条路必须自己站得住
 *   （纵深防御，跟 FREEFORM_MAX_DEPTH 两侧同值一个道理）。用久经打磨的库而不
 *   自己写正则：HTML 消毒出了名的容易写漏（mXSS、伪协议、命名空间穿越）。
 *
 *   **CSS → Shadow DOM**。这一层允许 `<style>`（版式的一半在 CSS 里），而
 *   页面级 CSS 没有作用域：一条 `body{display:none}` 就能把整个宿主搞掉。
 *   影子根把样式彻底关在里面。
 *
 * ## 为什么不是 iframe
 *
 * 通行结论是"外部、不可信、与宿主无协作的内容用 iframe；Shadow DOM 只防意外
 * 干扰、不是强隔离"。这里选 Shadow DOM，是因为**脚本这一面已经被 DOMPurify
 * 彻底端掉了**——消毒后的产物里一行可执行代码都没有，剩下的唯一逃逸面就是
 * CSS，而那正是影子根的强项。代价也小：图表还能用现成的 EchartsChart（同一个
 * 组件、同一套配色），不用把 1.1MB 的 echarts 塞进 iframe，也不用搞高度回传。
 *
 * ⚠ **这个取舍的前提是"产物里没有脚本"。** 哪天这一层要放开 `<script>`
 * （比如让设计自带交互），Shadow DOM 就不够了，必须换成 sandbox iframe。
 * 这行字是界桩，别绕过它。
 */

export type { OverviewChartSpec, OverviewFactSpec };

export interface OverviewHtmlPayload {
  html: string;
  facts: OverviewFactSpec[];
  charts: OverviewChartSpec[];
}

/**
 * 允许的标签与属性。
 *
 * 比 DOMPurify 的默认白名单**更窄**：默认允许 `<form>`/`<input>`/`<a href>`，
 * 而这一层是纯展示——一个能点的东西都不该有（点了没反应比没有更糟）。
 *
 * 比 GitHub 那套（hast-util-sanitize 的 defaultSchema）**多一个 `<style>`**：
 * 它服务的是 Markdown 正文，剥掉样式是对的；这里样式就是产物本身。多出来的
 * 那点风险由 Shadow DOM 兜住——这两个决定是一对，不能只抄一半。
 */
const ALLOWED_TAGS = [
  "div", "span", "p", "section", "article", "header", "footer", "main", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "strong", "em", "b", "i", "small", "code", "pre", "blockquote",
  "hr", "br", "style",
  "svg", "path", "circle", "rect", "line", "polyline", "polygon", "g",
];
const ALLOWED_ATTR = [
  "class", "style", "id", "title", "colspan", "rowspan", "scope",
  "data-fact", "data-chart",
  // 内联 svg 的形状属性——图标是设计的一部分，禁掉版式会缺一块
  "viewBox", "fill", "stroke", "stroke-width", "d", "cx", "cy", "r",
  "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points",
  "stroke-linecap", "stroke-linejoin", "opacity", "transform",
];
const FORBID_TAGS = [
  "script", "iframe", "object", "embed", "link", "meta", "base",
  "form", "input", "button", "select", "textarea", "a",
];

/**
 * 消毒。**没有 DOM 就返回空串**——消毒不了就不渲染。
 *
 * DOMPurify 在没有 window 的环境里默认导出的是工厂函数而不是实例，
 * `.sanitize` 压根不存在。那种情况下"原样返回"等于把不可信 HTML 直接放行，
 * 所以这里 fail-closed：宁可这一块空着，也不能漏一次。
 */
export function sanitizeOverviewHtml(markup: string): string {
  const purify = DOMPurify as unknown as { sanitize?: (s: string, c: object) => string };
  if (typeof purify.sanitize !== "function") return "";
  return purify.sanitize(markup, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}

/** 影子根里的地基样式：字体从宿主继承，否则影子里会掉回浏览器默认字体。 */
const SHADOW_BASE_CSS = `:host{display:block;font:inherit;color:inherit}
*{box-sizing:border-box}`;

/** 一个事实的真实数值。算不出来如实显「—」，不回落任何假值。 */
export function computeFactText(
  fact: OverviewFactSpec,
  entityRows: Record<string, RuntimeRow[]> | undefined
): string {
  const rows = (entityRows ?? {})[fact.entityRef];
  if (!rows) return "—";
  if (fact.aggregate === "count") return rows.length.toLocaleString("zh-CN");
  const m = /^(sum|avg):(.+)$/.exec(fact.aggregate);
  if (!m) return "—";
  const [, kind, fieldId] = m;
  const nums = rows.map(r => Number(r.values?.[fieldId])).filter(v => Number.isFinite(v));
  // 跟 computeDataRefText 同一条 SQL/pandas 语义：一行合法数值都没有时不显 0
  // ——用户分不清"真的是 0"和"根本没数据"。
  if (nums.length === 0) return "—";
  const total = nums.reduce((a, b) => a + b, 0);
  const value = kind === "sum" ? total : total / nums.length;
  const text = value.toLocaleString("zh-CN", {
    maximumFractionDigits: kind === "sum" ? 2 : 1,
  });
  // 单位写法跟表格 renderCell / KPI computeDataRefText 逐字一致
  switch (fact.format) {
    case "percent":
    case "progress":
      return `${text}%`;
    case "money":
      return `¥${value.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    case "score":
      return `${text} 分`;
    default:
      return text;
  }
}

/** 把声明翻成 buildEchartsOption 认的形状。 */
function toChartSchema(spec: OverviewChartSpec): AppPageChartSchema {
  const [kind, field] = spec.metric.split(":");
  return {
    id: spec.id,
    label: spec.title,
    type: (["bar", "line", "pie", "donut"].includes(spec.type)
      ? spec.type
      : "bar") as AppPageChartSchema["type"],
    entityId: spec.entityRef,
    dimensionFieldId: spec.dimensionFieldId,
    dimensionLabel: spec.dimensionFieldId,
    metric: kind === "sum" ? "sum" : "count",
    metricFieldId: kind === "sum" ? field : undefined,
    metricLabel: kind === "sum" ? field : "数量",
  } as AppPageChartSchema;
}

/** 把消毒后的 HTML 挂进影子根，填好事实，返回图表占位节点。纯 DOM 操作，可单测。 */
export function mountOverviewInto(
  shadow: ShadowRoot,
  clean: string,
  facts: OverviewFactSpec[],
  entityRows: Record<string, RuntimeRow[]> | undefined
): Array<{ id: string; el: HTMLElement }> {
  shadow.innerHTML = `<style>${SHADOW_BASE_CSS}</style>${clean}`;
  const factById = new Map(facts.map(f => [f.id, f]));
  shadow.querySelectorAll<HTMLElement>("[data-fact]").forEach(el => {
    const fact = factById.get(el.getAttribute("data-fact") ?? "");
    // 认不出的占位如实留「—」，不编一个数塞进去
    el.textContent = fact ? computeFactText(fact, entityRows) : "—";
  });
  const hosts: Array<{ id: string; el: HTMLElement }> = [];
  shadow.querySelectorAll<HTMLElement>("[data-chart]").forEach(el => {
    const id = el.getAttribute("data-chart") ?? "";
    if (id) hosts.push({ id, el });
  });
  return hosts;
}

export default function OverviewHtmlSurface({
  payload,
  entityRows,
  chartPalette,
}: {
  payload: OverviewHtmlPayload;
  entityRows?: Record<string, RuntimeRow[]>;
  chartPalette?: ChartPalette;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const shadowRef = React.useRef<ShadowRoot | null>(null);
  const [chartHosts, setChartHosts] = React.useState<Array<{ id: string; el: HTMLElement }>>([]);

  const clean = React.useMemo(() => sanitizeOverviewHtml(payload.html), [payload.html]);

  // 挂载 + 填数。**数据变了要重跑**——事实是活的，用户写入第一条真实记录之后
  // 这些数字必须跟着变（种子被整批替换正是这个时刻）。
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) {
      // attachShadow 只能调一次；重复调会抛
      shadowRef.current = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    }
    const found = mountOverviewInto(shadowRef.current, clean, payload.facts, entityRows);
    setChartHosts(prev =>
      prev.length === found.length &&
      prev.every((p, i) => p.el === found[i].el && p.id === found[i].id)
        ? prev
        : found
    );
  }, [clean, payload.facts, entityRows]);

  const chartById = React.useMemo(
    () => new Map(payload.charts.map(c => [c.id, c])),
    [payload.charts]
  );

  return (
    <div data-testid="overview-html-surface">
      <div ref={hostRef} />
      {chartHosts.map(({ id, el }) => {
        const spec = chartById.get(id);
        if (!spec) return null;
        const rows = (entityRows ?? {})[spec.entityRef] ?? [];
        const option = buildEchartsOption(
          toChartSchema(spec),
          rows,
          chartPalette ?? DEFAULT_CHART_PALETTE
        );
        if (!option) return null;
        // 高度由设计写的那个占位盒决定——版式归它，我们只往里画
        const height = Math.max(120, Math.round(el.getBoundingClientRect().height) || 240);
        return createPortal(
          <EchartsChart option={option} height={height} ariaLabel={spec.title} />,
          el,
          id
        );
      })}
    </div>
  );
}
