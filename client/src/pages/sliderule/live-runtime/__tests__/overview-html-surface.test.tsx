// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
// jsdom 环境下 import.meta.url 是 http:// 不是 file://，readFileSync 用不了；
// ?raw 是 Vite 自带的原文导入，跟测试环境无关。
import screenSrc from "../AppRuntimeScreen.tsx?raw";
import surfaceSrc from "../OverviewHtmlSurface.tsx?raw";
import previewSrc from "../FreeformPreviewScreen.tsx?raw";
import {
  computeFactText,
  expandRowTemplates,
  mountOverviewInto,
  sanitizeOverviewHtml,
  selectRowsFor,
} from "../OverviewHtmlSurface";
import type { AppFormFieldSchema, OverviewFactSpec } from "../app-runtime-schema";
import type { RuntimeRow } from "../live-runtime";

/**
 * 首页总览 HTML 载体的渲染端（2026-08-12）。
 *
 * 这一层守两件事，其它都是版式：
 *
 *   ① **数字不能编** —— HTML 里一个数字都没有，只有 data-fact 占位，
 *      值由 computeFactText 从真实行现算。原型实测过放开会怎样：LLM 自己算的
 *      「处理中工单」是 0，而同一页的环图从同一份数据算出 5。
 *
 *   ② **消毒** —— 这段 HTML 是 LLM 产出的不可信内容。生成侧已经拒了一遍
 *      script/外链，这里再过 DOMPurify：快照恢复、历史产物不重跑生成侧，
 *      这条路必须自己站得住（跟 FREEFORM_MAX_DEPTH 两侧同值一个道理）。
 */

const rows = (values: Array<Record<string, unknown>>): RuntimeRow[] =>
  values.map((v, i) => ({ id: `r${i}`, values: v }) as RuntimeRow);

const fact = (over: Partial<OverviewFactSpec> = {}): OverviewFactSpec => ({
  id: "f",
  label: "指标",
  entityRef: "e",
  aggregate: "count",
  ...over,
});

describe("① 数字从真实行现算", () => {
  it("count 数行数", () => {
    expect(computeFactText(fact(), { e: rows([{}, {}, {}]) })).toBe("3");
  });

  it("avg 带上字段声明的单位", () => {
    const f = fact({ aggregate: "avg:rate", format: "percent" });
    expect(computeFactText(f, { e: rows([{ rate: 40 }, { rate: 60 }]) })).toBe("50%");
  });

  it("money / score 跟表格是同一套写法", () => {
    expect(
      computeFactText(fact({ aggregate: "sum:amt", format: "money" }), {
        e: rows([{ amt: 1200 }, { amt: 800 }]),
      })
    ).toBe("¥2,000.00");
    expect(
      computeFactText(fact({ aggregate: "avg:s", format: "score" }), {
        e: rows([{ s: 70 }, { s: 80 }])
      })
    ).toBe("75 分");
  });

  it("一行合法数值都没有时显「—」，不拿 0 冒充", () => {
    // SQL 的 SUM over 空集是 NULL、pandas 的 min_count=1 是 NaN —— 用户分不清
    // "真的是 0" 和 "根本没数据"，所以不能显 0。跟 computeDataRefText 同一条。
    expect(computeFactText(fact({ aggregate: "sum:x" }), { e: rows([{}, {}]) })).toBe("—");
  });

  it("实体查不到时显「—」，不回落任何假值", () => {
    expect(computeFactText(fact(), {})).toBe("—");
    expect(computeFactText(fact(), undefined)).toBe("—");
  });
});

describe("② 消毒", () => {
  it("脚本、事件属性、伪协议一律不留", () => {
    const dirty = `<div>ok<script>alert(1)</script><img src=x onerror="alert(1)">
      <a href="javascript:alert(1)">点我</a></div>`;
    const clean = sanitizeOverviewHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("javascript:");
    expect(clean, "正文被连坐删掉了").toContain("ok");
  });

  it("表单控件不留 —— 这一层是纯展示，点了没反应比没有更糟", () => {
    const clean = sanitizeOverviewHtml(
      `<div><form><input value="x"><button>提交</button></form></div>`
    );
    expect(clean).not.toContain("<input");
    expect(clean).not.toContain("<button");
    expect(clean).not.toContain("<form");
  });

  it("占位契约必须活着 —— 它们被删掉的话整页没有数字", () => {
    const clean = sanitizeOverviewHtml(
      `<div><span data-fact="a"></span><div data-chart="c" style="height:200px"></div></div>`
    );
    expect(clean, "data-fact 被消毒掉了").toContain('data-fact="a"');
    expect(clean, "data-chart 被消毒掉了").toContain('data-chart="c"');
    expect(clean, "高度没了 —— 图表容器会塌成 0").toContain("height:200px");
  });

  it("版式要素保留：style 块、表格、内联 svg", () => {
    const clean = sanitizeOverviewHtml(
      `<div><style>.a{color:red}</style><table><tr><td>x</td></tr></table>
       <svg viewBox="0 0 24 24"><path d="M0 0h24"/></svg></div>`
    );
    expect(clean).toContain("<style");
    expect(clean).toContain("<td");
    expect(clean).toContain("<svg");
    expect(clean).toContain('d="M0 0h24"');
  });
});

describe("③ 接线", () => {
  const screen = screenSrc;

  it("HTML 载体优先于受限树 —— 两者同时只会有一个", () => {
    const i = screen.indexOf("const renderFreeformOverview");
    expect(i, "锚点要重找").toBeGreaterThan(-1);
    const body = screen.slice(i, i + 1400);
    expect(body, "没接 HTML 载体，开关打开也看不到东西").toContain(
      "page?.freeformOverviewHtml?.html"
    );
    // 顺序：先看 HTML，再落回受限树
    expect(body.indexOf("freeformOverviewHtml")).toBeLessThan(
      body.indexOf("if (!page?.freeformOverview) return null;")
    );
  });

  it("逐行的值要按字段声明补单位 —— 宿主得把 fieldSchemaOf 传下来", () => {
    // 不传的后果是真跑逮到过三次的那类事故：百分比丢百分号、金额丢 ¥、
    // 枚举把内部 id（`music_member`）漏到界面上。
    // 锚在 JSX 那处用法上，不是文件顶上那句 React.lazy 声明
    const i = screen.indexOf("payload={page.freeformOverviewHtml}");
    expect(i, "锚点要重找").toBeGreaterThan(-1);
    expect(screen.slice(i, i + 600)).toContain("fieldSchemaOf");
  });

  it("自检预览页也要认 HTML 载体 —— 否则默认路径的截图/体检全量不到", () => {
    // 跟 designRecipeRef 那次是同一类断口，只是更彻底：走 HTML 那条路的页面
    // 根本没有受限树产物，自检页只会显示"预览内容不可用"。
    expect(previewSrc).toContain("overviewHtml");
    expect(previewSrc, "没渲染 HTML 载体").toContain("LazyOverviewHtmlSurface");
    expect(previewSrc, "逐行的单位在自检画面里也不能丢").toContain("fieldSchemaOf");
  });

  it("数据变了数字要跟着变 —— 事实是活的，不是渲染一次就定死", () => {
    const src = surfaceSrc;
    const i = src.indexOf("React.useEffect(");
    const body = src.slice(i, i + 1200);
    expect(body, "entityRows 不在依赖里 —— 写入第一条真实记录后数字不会更新").toContain(
      "entityRows"
    );
  });
});

describe("④ 影子根：CSS 关在里面", () => {
  const facts = [fact({ id: "a", aggregate: "count", entityRef: "e" })];

  it("样式挂进影子根，不落到宿主文档", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    mountOverviewInto(
      shadow,
      `<style>body{display:none}</style><div><span data-fact="a"></span></div>`,
      facts,
      { e: rows([{}, {}]) }
    );
    // 影子里有它，宿主文档里没有 —— 这就是隔离本身
    expect(shadow.querySelector("style")).not.toBeNull();
    expect(
      document.body.querySelector(":scope > style"),
      "LLM 的 CSS 漏到宿主文档了 —— body{display:none} 能把整个应用弄没"
    ).toBeNull();
    // 顺带确认事实真的被填上了
    expect(shadow.querySelector("[data-fact]")?.textContent).toBe("2");
    host.remove();
  });

  it("认不出的占位填「—」，不编数", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    mountOverviewInto(shadow, `<span data-fact="unknown"></span>`, facts, {});
    expect(shadow.querySelector("[data-fact]")?.textContent).toBe("—");
  });

  it("图表占位被收集出来交给 React 挂 ECharts", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const hosts = mountOverviewInto(
      shadow,
      `<div data-chart="c1" style="height:260px"></div><div data-chart="c2"></div>`,
      facts,
      {}
    );
    expect(hosts.map(h => h.id)).toEqual(["c1", "c2"]);
  });
});

/**
 * ⑤ 逐行（data-rows / data-field）—— 2026-08-12 补的那个功能倒退。
 *
 * 倒退长什么样：拿参照图还原那版**三张选题卡的分数全是同一个「76.8 分」**。
 * 没有逐行能力，模型只能把同一个聚合 data-fact 复制三份充当列表。受限树那条路
 * 一直有 rowsRef。这一组用例把"三张卡三个不同的分数"钉住。
 */
describe("⑤ 逐行", () => {
  const TOPIC_ROWS: RuntimeRow[] = rows([
    { title: "冷启动怎么做", score: 76.8, owner: "a1", state: "draft" },
    { title: "定价实验复盘", score: 91.2, owner: "a2", state: "live" },
    { title: "渠道投放盘点", score: 64.5, owner: "a3", state: "draft" },
    { title: "低分选题", score: 12.0, owner: "a4", state: "live" },
  ]);
  const schemaOf = (_e: string, f: string): AppFormFieldSchema | undefined =>
    ({
      title: { id: "title", label: "标题", type: "string" },
      score: { id: "score", label: "评分", type: "number", format: "score" },
      state: {
        id: "state",
        label: "状态",
        type: "enum",
        options: [
          { id: "draft", label: "草稿", tone: "default" },
          { id: "live", label: "已发布", tone: "success" },
        ],
      },
    } as Record<string, AppFormFieldSchema>)[f];

  const expand = (html: string, rowsByEntity = { topic: TOPIC_ROWS }) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    expandRowTemplates(host, rowsByEntity, schemaOf);
    return host;
  };

  it("模板按真实行展开，每行是**自己**那一行的值", () => {
    const host = expand(
      `<div data-rows="topic" data-limit="3">
         <article class="card"><h4 data-field="title"></h4><b data-field="score"></b></article>
       </div>`
    );
    const cards = [...host.querySelectorAll("article.card")];
    expect(cards).toHaveLength(3);
    expect(cards.map(c => c.querySelector("h4")?.textContent)).toEqual([
      "冷启动怎么做", "定价实验复盘", "渠道投放盘点",
    ]);
    // 这一行是这次改动的全部意义：三个分数必须是三个不同的数，且带单位
    expect(cards.map(c => c.querySelector("b")?.textContent)).toEqual([
      "76.8 分", "91.2 分", "64.5 分",
    ]);
  });

  it("不多包一层 —— 多出来的 div 会把设计写的 grid 子项关系打断", () => {
    const host = expand(
      `<div class="grid" data-rows="topic" data-limit="2"><span data-field="title"></span></div>`
    );
    expect([...host.querySelector(".grid")!.children].map(c => c.tagName)).toEqual([
      "SPAN", "SPAN",
    ]);
  });

  it("排序与条数按声明来", () => {
    const el = document.createElement("div");
    el.setAttribute("data-rows", "topic");
    el.setAttribute("data-sort", "score");
    el.setAttribute("data-limit", "2");
    expect(selectRowsFor(el, { topic: TOPIC_ROWS }).map(r => r.values.score)).toEqual([
      91.2, 76.8,
    ]);
    el.setAttribute("data-order", "asc");
    expect(selectRowsFor(el, { topic: TOPIC_ROWS }).map(r => r.values.score)).toEqual([
      12.0, 64.5,
    ]);
    // 不声明排序就按数据源自然顺序（跟 rowsRef.sortByRef 缺省一致）
    el.removeAttribute("data-sort");
    el.removeAttribute("data-order");
    expect(selectRowsFor(el, { topic: TOPIC_ROWS }).map(r => r.values.score)).toEqual([
      76.8, 91.2,
    ]);
  });

  it("limit 夹在生成侧同一个预算里 —— 快照恢复不重跑生成侧", () => {
    const el = document.createElement("div");
    el.setAttribute("data-rows", "topic");
    const many = rows(Array.from({ length: 40 }, (_, i) => ({ title: `t${i}` })));
    el.setAttribute("data-limit", "500");
    expect(selectRowsFor(el, { topic: many })).toHaveLength(20); // ROWS_MAX_LIMIT
    el.setAttribute("data-limit", "0");
    expect(selectRowsFor(el, { topic: many })).toHaveLength(1);
    el.removeAttribute("data-limit");
    expect(selectRowsFor(el, { topic: many })).toHaveLength(5); // 默认
  });

  it("一行都没有时出诚实空态 —— 不留空盒子、不编行", () => {
    const host = expand(
      `<div data-rows="topic"><span data-field="title"></span></div>`,
      { topic: [] }
    );
    expect(host.querySelectorAll("[data-field]")).toHaveLength(0);
    expect(host.querySelector(".ov-rows-empty")?.textContent).toBe("暂无数据");
  });

  it("认不出的字段/实体如实留「—」，不编值", () => {
    const host = expand(
      `<div data-rows="topic" data-limit="1"><span data-field="nope"></span></div>`
    );
    expect(host.querySelector("[data-field]")?.textContent).toBe("—");
    // 实体查不到 → 走空态，不是崩
    const missing = expand(
      `<div data-rows="ghost"><span data-field="title"></span></div>`
    );
    expect(missing.querySelector(".ov-rows-empty")).not.toBeNull();
  });

  it("模板里混进来的聚合/图表占位被摘掉 —— 否则每行一个同样的数、N 张同 key 的图", () => {
    // 生成侧已经拦了这种写法；这条守的是历史产物/手改产物那条路（纵深防御）
    const host = expand(
      `<div data-rows="topic" data-limit="2">
         <span data-field="title"></span>
         <span data-fact="avg_score"></span>
         <div data-chart="c1"></div>
       </div>`
    );
    expect(host.querySelectorAll("[data-fact]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-chart]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-field]")).toHaveLength(2);
  });

  it("消毒不能把逐行契约删掉 —— 删了就是整段静默失效", () => {
    const clean = sanitizeOverviewHtml(
      `<div data-rows="topic" data-limit="3" data-sort="score" data-order="asc">
         <span data-field="title"></span></div>`
    );
    for (const attr of ["data-rows", "data-field", "data-limit", "data-sort", "data-order"]) {
      expect(clean, `${attr} 被消毒掉了`).toContain(attr);
    }
  });

  it("挂载时先展开再填聚合 —— 顺序反了复制出来的行是空的", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    mountOverviewInto(
      shadow,
      `<span data-fact="a"></span>
       <div data-rows="topic" data-limit="2"><i data-field="state"></i></div>`,
      [fact({ id: "a", entityRef: "topic", aggregate: "count" })],
      { topic: TOPIC_ROWS },
      schemaOf
    );
    expect(shadow.querySelector("[data-fact]")?.textContent).toBe("4");
    // 枚举出中文标签，不漏内部 id
    expect([...shadow.querySelectorAll("i")].map(i => i.textContent)).toEqual([
      "草稿", "已发布",
    ]);
  });
});
