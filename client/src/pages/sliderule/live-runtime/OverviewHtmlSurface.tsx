import React from "react";
import DOMPurify from "dompurify";
import { createPortal } from "react-dom";
import EchartsChart from "./EchartsChart";
import { buildEchartsOption, DEFAULT_CHART_PALETTE } from "./build-echarts-option";
import type { ChartPalette } from "./build-echarts-option";
import type {
  AppFormFieldSchema,
  AppPageChartSchema,
  OverviewChartSpec,
  OverviewFactSpec,
} from "./app-runtime-schema";
import { formatFieldText } from "./field-text";
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
  // 占位契约。`ALLOW_DATA_ATTR: false` 意味着**只有列在这儿的 data-* 能活下来**，
  // 少一个就是那个能力整条静默失效（逐行会退化成一个空模板）。
  "data-fact", "data-chart",
  "data-rows", "data-field", "data-limit", "data-sort", "data-order",
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

/**
 * 逐行取数的上限。**跟生成侧的 `rowsRef` 预算同值**（Python 那边
 * ROWS_REF_DEFAULT_LIMIT / ROWS_REF_MAX_LIMIT），理由跟 FREEFORM_MAX_DEPTH
 * 两侧同值一样：快照恢复、历史产物不重跑生成侧，这条路必须自己夹一次。
 */
const ROWS_DEFAULT_LIMIT = 5;
const ROWS_MAX_LIMIT = 20;

/** 空态的类名——设计可以在 <style> 里给它上样式，但文案由运行时给。 */
const ROWS_EMPTY_CLASS = "ov-rows-empty";

function clampLimit(raw: string | null): number {
  // 属性没写就是走默认。**不能直接 Number(raw)**：`Number(null)` 是 0、
  // `Number("")` 也是 0，都会被夹成 1，于是"不声明条数"变成"只画一行"。
  const text = (raw ?? "").trim();
  if (!text) return ROWS_DEFAULT_LIMIT;
  const n = Number(text);
  if (!Number.isFinite(n)) return ROWS_DEFAULT_LIMIT;
  return Math.max(1, Math.min(ROWS_MAX_LIMIT, Math.trunc(n)));
}

/**
 * 按声明取这一段列表要显示的行。
 *
 * 排序缺省不排（跟 `rowsRef.sortByRef` 缺省一致，按数据源自然顺序）；声明了
 * 排序字段就比较：两边都是有限数值时按数值比，否则按本地化字符串比——日期存的是
 * `YYYY-MM-DD`，字符串序跟时间序一致，不需要再解析一次。
 */
export function selectRowsFor(
  el: HTMLElement,
  entityRows: Record<string, RuntimeRow[]> | undefined
): RuntimeRow[] {
  const entity = el.getAttribute("data-rows") ?? "";
  const all = (entityRows ?? {})[entity] ?? [];
  const sortBy = el.getAttribute("data-sort") ?? "";
  const desc = (el.getAttribute("data-order") ?? "desc").toLowerCase() !== "asc";
  const picked = sortBy
    ? [...all].sort((a, b) => {
        const av = a.values?.[sortBy];
        const bv = b.values?.[sortBy];
        const an = Number(av);
        const bn = Number(bv);
        const cmp =
          Number.isFinite(an) && Number.isFinite(bn)
            ? an - bn
            : String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN");
        return desc ? -cmp : cmp;
      })
    : all;
  return picked.slice(0, clampLimit(el.getAttribute("data-limit")));
}

/**
 * 把 `data-rows` 容器里那份"一行的模板"按真实行数展开（2026-08-12）。
 *
 * ## 补的是什么洞
 *
 * 这个载体此前没有逐行能力，而受限树那条路一直有（`rowsRef`）。后果在真跑里
 * 很具体：拿参照图还原那版三张选题卡的分数**全是同一个「76.8 分」**——模型只能
 * 把同一个聚合 `data-fact` 复制三份充当列表。生成侧现在会拦这种写法并要求改用
 * `data-rows`，这里负责把它渲染出来。
 *
 * ## 纪律跟聚合数字完全一样
 *
 * 模板里 `data-field` 留空，值从**真实行**里取、按字段声明补单位
 * （`formatFieldText` 用的是跟表格同一张判定表）。HTML 里依旧一个数字都没有。
 *
 * 展开时把模板内的 `data-fact` / `data-chart` 属性**摘掉**：生成侧已经拦了，
 * 但历史产物/手改产物不重跑生成侧——重复的图表占位会让 React portal 撞 key，
 * 重复的聚合占位会让每行显示同一个数（正是要消灭的那个形态）。
 */
export function expandRowTemplates(
  root: ParentNode,
  entityRows: Record<string, RuntimeRow[]> | undefined,
  fieldSchemaOf?: (entityId: string, fieldId: string) => AppFormFieldSchema | undefined
): void {
  root.querySelectorAll<HTMLElement>("[data-rows]").forEach(container => {
    // 嵌套的 data-rows 生成侧会拦；万一漏进来，内层会在外层被 innerHTML 覆盖时
    // 一起消失，不会半展开——这里不额外处理，保持行为可预测。
    const entity = container.getAttribute("data-rows") ?? "";
    const template = container.innerHTML;
    const rows = selectRowsFor(container, entityRows);
    if (rows.length === 0) {
      // 诚实空态：不留空盒子（读者会以为在加载），也不编行。
      container.innerHTML = "";
      const empty = container.ownerDocument.createElement("div");
      empty.className = ROWS_EMPTY_CLASS;
      empty.textContent = "暂无数据";
      container.appendChild(empty);
      return;
    }
    const doc = container.ownerDocument;
    const frag = doc.createDocumentFragment();
    for (const row of rows) {
      const holder = doc.createElement("div");
      holder.innerHTML = template;
      holder.querySelectorAll<HTMLElement>("[data-fact],[data-chart]").forEach(el => {
        el.removeAttribute("data-fact");
        el.removeAttribute("data-chart");
      });
      holder.querySelectorAll<HTMLElement>("[data-field]").forEach(el => {
        const fieldId = el.getAttribute("data-field") ?? "";
        el.textContent = formatFieldText(
          row.values?.[fieldId],
          fieldSchemaOf?.(entity, fieldId)
        );
      });
      // holder 只是拆包用的容器，别把它自己塞进版式里——它会多出一层 div，
      // 把设计写的 grid/flex 子项关系打断。
      while (holder.firstChild) frag.appendChild(holder.firstChild);
    }
    container.innerHTML = "";
    container.appendChild(frag);
  });
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
  entityRows: Record<string, RuntimeRow[]> | undefined,
  fieldSchemaOf?: (entityId: string, fieldId: string) => AppFormFieldSchema | undefined
): Array<{ id: string; el: HTMLElement }> {
  shadow.innerHTML = `<style>${SHADOW_BASE_CSS}</style>${clean}`;
  // 先展开逐行，再填聚合、再收图表位：展开会产生新节点，顺序颠倒的话模板里
  // 那份占位只会被处理一次、复制出来的那些是空的。
  expandRowTemplates(shadow, entityRows, fieldSchemaOf);
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
  fieldSchemaOf,
}: {
  payload: OverviewHtmlPayload;
  entityRows?: Record<string, RuntimeRow[]>;
  chartPalette?: ChartPalette;
  /**
   * 字段的完整声明。**逐行的值靠它补单位**——不传的话 `data-field` 出来的是裸值，
   * 百分比丢百分号、金额丢 ¥、枚举漏内部 id（这三样都是真跑逮到过的）。
   * 跟积木族共用宿主那一份（AppRuntimeScreen 的 fieldSchemaOf），不另建一条线。
   */
  fieldSchemaOf?: (entityId: string, fieldId: string) => AppFormFieldSchema | undefined;
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
    const found = mountOverviewInto(
      shadowRef.current,
      clean,
      payload.facts,
      entityRows,
      fieldSchemaOf
    );
    setChartHosts(prev =>
      prev.length === found.length &&
      prev.every((p, i) => p.el === found[i].el && p.id === found[i].id)
        ? prev
        : found
    );
  }, [clean, payload.facts, entityRows, fieldSchemaOf]);

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
